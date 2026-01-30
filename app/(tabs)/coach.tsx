import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

// Cargar expo-speech de forma segura (evita crash si el dev build aún no lo incluye)
let Speech: any = null;
try {
  Speech = require("expo-speech");
} catch {
  Speech = null;
}

// Cargar expo-av de forma segura (evita crash si el dev build aún no lo incluye)
let Audio: any = null;
try {
  Audio = require("expo-av")?.Audio;
} catch {
  Audio = null;
}

type Msg = {
  id: string;
  role: "user" | "coach";
  text: string;
  ts: number;
  intent?: string;
  plan?: any;
  plan_id?: string;
};

const STORAGE_KEY = "wr_coach_messages_v1";
const PROFILE_KEY = "wr_profile_v1";
const MODE_KEY = "wr_mode_v1";

const TTS_VOICE_KEY = "wr_tts_voice_v1";
const TTS_RATE_KEY = "wr_tts_rate_v1";
const TTS_ENABLED_KEY = "wr_tts_enabled_v1";

const TTS_PITCH_KEY = "wr_tts_pitch_v1";

const AI_BASE_URL_KEY = "wr_ai_base_url_v1";
const CHECKLIST_COLLAPSED_KEY = "wr_checklist_collapsed_v1";
const PLAN_TODAY_KEY = "wr_plan_today_v1";

// Daily checklist (per day)
const DAILY_TASKS_KEY_PREFIX = "wr_daily_tasks_v1"; // stored as `${prefix}:${YYYY-MM-DD}`

type DailyTask = { id: string; label: string; done: boolean };

function dailyTasksKey(dateKey: string) {
  return `${DAILY_TASKS_KEY_PREFIX}:${dateKey}`;
}

function buildDefaultDailyTasks(mode: PlanMode, meals: MealsSummary, targets: NutritionTargets): DailyTask[] {
  // Keep it simple & actionable. We generate a small set that changes with context.
  const tasks: DailyTask[] = [];

  // 1) Log meals
  const logTarget = mode === "agresiva" ? 3 : mode === "mantenimiento" ? 2 : 2;
  tasks.push({
    id: "log_meals",
    label: `Registrar ${logTarget} comidas (llevas ${meals.mealsCount})`,
    done: meals.mealsCount >= logTarget,
  });

  // 2) Protein focus
  const proteinLeft = Math.max(0, targets.protein_g - meals.protein_g);
  tasks.push({
    id: "protein",
    label:
      proteinLeft > 0
        ? `Subir proteína (+${Math.min(40, Math.max(20, Math.round(proteinLeft / 2) || 25))} g hoy)`
        : "Proteína en objetivo (mantener)",
    done: proteinLeft <= 0,
  });

  // 3) Movement
  const walkMin = mode === "agresiva" ? 20 : mode === "mantenimiento" ? 30 : 15;
  tasks.push({ id: "walk", label: `Caminar ${walkMin} min (o equivalente)`, done: false });

  // 4) Sleep / stress micro-habit
  tasks.push({ id: "breath", label: "90s respiración 4–6 (cuando haya estrés/antojo)", done: false });

  return tasks;
}

async function loadOrInitDailyTasks(params: {
  dateKey: string;
  mode: PlanMode;
  meals: MealsSummary;
  targets: NutritionTargets;
}): Promise<DailyTask[]> {
  const { dateKey, mode, meals, targets } = params;
  const key = dailyTasksKey(dateKey);

  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Update dynamic labels/done states without wiping manual checks
        const defaults = buildDefaultDailyTasks(mode, meals, targets);
        const byId = new Map<string, DailyTask>();
        for (const t of parsed) {
          if (t && typeof t === "object" && typeof (t as any).id === "string") {
            byId.set((t as any).id, {
              id: String((t as any).id),
              label: String((t as any).label ?? ""),
              done: !!(t as any).done,
            });
          }
        }
        const merged = defaults.map((d) => {
          const existing = byId.get(d.id);
          if (!existing) return d;
          // Keep user's done state, but refresh label + auto-done if it becomes true.
          return {
            ...d,
            done: d.done ? true : existing.done,
          };
        });
        return merged;
      }
    }
  } catch {
    // ignore
  }

  const fresh = buildDefaultDailyTasks(mode, meals, targets);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(fresh));
  } catch {
    // ignore
  }
  return fresh;
}

// --- Coach AI (Next API) ---
// Tries to infer your LAN host from the Expo dev server, then targets Next on :3000
function inferLanHostFromExpo(): string | null {
  try {
    // Common places depending on Expo runtime
    const anyC: any = Constants as any;
    const hostUri: string | undefined = anyC?.expoConfig?.hostUri || anyC?.manifest2?.extra?.expoClient?.hostUri;
    const debuggerHost: string | undefined = anyC?.manifest?.debuggerHost || anyC?.expoConfig?.debuggerHost;

    const raw = hostUri || debuggerHost;
    if (!raw) return null;

    // raw examples:
    // - "192.168.1.243:8081"
    // - "192.168.1.243:19000"
    // - "exp://192.168.1.243:8081"
    const cleaned = String(raw).replace(/^exp:\/\//, "");
    const host = cleaned.split("/")[0].split(":")[0];
    return host || null;
  } catch {
    return null;
  }
}

async function getCoachApiBaseUrl(): Promise<string> {
  // Allow overriding via AsyncStorage or env (useful for production)
  const override = await AsyncStorage.getItem(AI_BASE_URL_KEY);
  if (override && override.trim()) return override.trim().replace(/\/+$/, "");

  const env =
    typeof process !== "undefined" &&
    (process as any)?.env &&
    typeof (process as any).env.EXPO_PUBLIC_AI_BASE_URL === "string"
      ? (process as any).env.EXPO_PUBLIC_AI_BASE_URL
      : "";

  if (env && env.trim()) return env.trim().replace(/\/+$/, "");

  const host = inferLanHostFromExpo();
  if (host) return `http://${host}:3000`;

  // Last resort: localhost (only works on emulators, not physical devices)
  return "http://localhost:3000";
}

type CoachHistoryMsg = { role: "user" | "assistant"; content: string };

async function callCoachAI(params: {
  message: string;
  mode: PlanMode;
  profileRaw: string | null;
  derivedName?: string;
  meals: MealsSummary;
  targets: NutritionTargets;
  history: Msg[];
}): Promise<{ reply: string; intent?: string; plan?: any } | null> {
  const { message, mode, profileRaw, derivedName, meals, targets, history } = params;

  // Build a compact history for the model (last ~16 msgs, keeps it coherent without bloating tokens)
  const recent = history.slice(-16).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.text,
  })) as CoachHistoryMsg[];

  let profileObj: any = null;
  try {
    profileObj = profileRaw ? JSON.parse(profileRaw) : null;
  } catch {
    profileObj = null;
  }

  // Ensure the API always gets a usable name/mode even if perfil/onboarding stored different keys.
  const p: any = profileObj && typeof profileObj === "object" ? { ...profileObj } : {};
  const name = (typeof derivedName === "string" ? derivedName : "").trim();
  if (name) {
    if (!p.nombre && !p.name && !p.firstName && !p.first_name && !p.fullName && !p.full_name) {
      p.nombre = name;
    }
  }
  if (!p.mode && !p.planMode && !p.plan && !p.goalMode) {
    p.mode = mode;
  }

  const payload = {
    message,
    locale: "es-MX",
    mode,
    profile: p,
    nutrition: {
      total: {
        calories: meals.calories,
        protein_g: meals.protein_g,
        carbs_g: meals.carbs_g,
        fat_g: meals.fat_g,
      },
      targets,
    },
    history: recent,
  };

  const base = await getCoachApiBaseUrl();
  const url = `${base}/api/coach/chat`;

  // Timeout protection
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) return null;

    const reply = json?.data?.reply ?? json?.reply;
    const intent = json?.data?.intent ?? json?.intent;
    const plan = json?.data?.plan ?? json?.plan;

    const replyText = typeof reply === "string" ? reply.trim() : "";
    if (!replyText) return null;

    return {
      reply: replyText,
      intent: typeof intent === "string" ? intent : undefined,
      plan: plan ?? undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

type PlanMode = "agresiva" | "balance" | "mantenimiento";
const MODE_LABEL: Record<PlanMode, string> = {
  agresiva: "Agresiva",
  balance: "Balance",
  mantenimiento: "Mantenimiento",
};

type NutritionTargets = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

const TARGETS_BY_MODE: Record<PlanMode, NutritionTargets> = {
  agresiva: { calories: 1600, protein_g: 140, carbs_g: 140, fat_g: 45 },
  balance: { calories: 1900, protein_g: 130, carbs_g: 190, fat_g: 60 },
  mantenimiento: { calories: 2200, protein_g: 120, carbs_g: 240, fat_g: 70 },
};

type MealsSummary = {
  mealsCount: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

const STORAGE_KEY_MEALS_CANDIDATES = [
  "wr_meals_v1",
  "wr_meals_log_v1",
  "wr_food_log_v1",
  "wr_food_entries_v1",
  "wr_comidas_v1",
];

function normalizeMode(v: any): PlanMode {
  const raw = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!raw) return "balance";

  // Accept common variants from UI labels / old data / English
  if (
    raw === "agresiva" ||
    raw === "agresivo" ||
    raw === "aggressive" ||
    raw === "cut" ||
    raw === "deficit" ||
    raw === "déficit"
  ) {
    return "agresiva";
  }

  if (
    raw === "mantenimiento" ||
    raw === "mantener" ||
    raw === "maintenance" ||
    raw === "maintain" ||
    raw === "maint" ||
    raw === "maintainance"
  ) {
    return "mantenimiento";
  }

  return "balance";
}

function safeMode(v: any): PlanMode {
  // Back-compat helper
  return normalizeMode(v);
}

function getProfileNameAndMode(savedProfile: string | null): { name: string; mode: PlanMode | null } {
  if (!savedProfile) return { name: "", mode: null };
  try {
    const p: any = JSON.parse(savedProfile);

    const first =
      typeof p?.name === "string"
        ? p.name
        : typeof p?.firstName === "string"
        ? p.firstName
        : typeof p?.first_name === "string"
        ? p.first_name
        : typeof p?.nombre === "string"
        ? p.nombre
        : "";

    const last =
      typeof p?.lastName === "string"
        ? p.lastName
        : typeof p?.last_name === "string"
        ? p.last_name
        : typeof p?.apellido === "string"
        ? p.apellido
        : "";

    const full =
      typeof p?.fullName === "string"
        ? p.fullName
        : typeof p?.full_name === "string"
        ? p.full_name
        : "";

    const name = (full || [first, last].filter(Boolean).join(" ")).trim();

    const rawMode = p?.mode ?? p?.planMode ?? p?.plan ?? p?.goalMode;
    const mode = typeof rawMode === "string" ? normalizeMode(rawMode) : null;

    return { name, mode };
  } catch {
    return { name: "", mode: null };
  }
}

function toNumber(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }
  return Number(v) || 0;
}

function isoDateKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function inferMealDateKey(m: any): string | null {
  if (!m) return null;
  if (typeof m.dateKey === "string" && m.dateKey.length >= 10) return m.dateKey.slice(0, 10);
  if (typeof m.date === "string" && m.date.length >= 10) return m.date.slice(0, 10);
  if (typeof m.created_at === "string" && m.created_at.length >= 10) return m.created_at.slice(0, 10);
  if (typeof m.ts === "number") return isoDateKey(new Date(m.ts));
  return null;
}

function extractTotals(m: any) {
  const a = m?.analysis ?? m;
  const t = a?.totals ?? a?.total ?? {};
  return {
    calories: toNumber(t.calories),
    protein_g: toNumber(t.protein_g),
    carbs_g: toNumber(t.carbs_g),
    fat_g: toNumber(t.fat_g),
  };
}

function parseItemsFromRaw(raw: string): any[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      const p: any = parsed;
      if (Array.isArray(p.items)) return p.items;
      if (Array.isArray(p.meals)) return p.meals;
      if (Array.isArray(p.log)) return p.log;

      const merged: any[] = [];
      for (const v of Object.values(p)) {
        if (Array.isArray(v)) merged.push(...v);
        if (v && typeof v === "object") {
          for (const vv of Object.values(v as any)) {
            if (Array.isArray(vv)) merged.push(...vv);
          }
        }
      }
      if (merged.length) return merged;
    }
    return [];
  } catch {
    return [];
  }
}

async function getMealsSummaryForDate(dateKey: string): Promise<MealsSummary> {
  const items: any[] = [];

  const keysToTry: string[] = [...STORAGE_KEY_MEALS_CANDIDATES];
  for (const k of STORAGE_KEY_MEALS_CANDIDATES) {
    keysToTry.push(`${k}_${dateKey}`);
    keysToTry.push(`${k}:${dateKey}`);
    keysToTry.push(`${k}-${dateKey}`);
  }

  for (const key of keysToTry) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) continue;
    const arr = parseItemsFromRaw(raw);
    if (arr.length) items.push(...arr);
  }

  if (items.length === 0) {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const likely = allKeys.filter((k) => k.startsWith("wr_") && /meal|meals|comida|food|registro/i.test(k));
      for (const key of likely) {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const arr = parseItemsFromRaw(raw);
        if (arr.length) items.push(...arr);
      }
    } catch {
      // ignore
    }
  }

  const todayMeals = items.filter((m) => inferMealDateKey(m) === dateKey);

  let calories = 0;
  let protein_g = 0;
  let carbs_g = 0;
  let fat_g = 0;

  for (const m of todayMeals) {
    const t = extractTotals(m);
    calories += toNumber(t.calories);
    protein_g += toNumber(t.protein_g);
    carbs_g += toNumber(t.carbs_g);
    fat_g += toNumber(t.fat_g);
  }

  return {
    mealsCount: todayMeals.length,
    calories: Math.round(calories),
    protein_g: Math.round(protein_g),
    carbs_g: Math.round(carbs_g),
    fat_g: Math.round(fat_g),
  };
}

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function looksLikePlanRequest(userText: string) {
  const t = (userText || "").toLowerCase();
  return (
    t.includes("plan") ||
    t.includes("checklist") ||
    t.includes("qué hago") ||
    t.includes("que hago") ||
    t.includes("plan de hoy") ||
    t.includes("plan con checklist")
  );
}

function extractPlanFromReply(replyText: string): {
  title: string;
  actions: string[];
  meals?: {
    desayuno?: string;
    comida?: string;
    cena?: string;
    snacks?: string[];
  };
  notes?: string;
} {
  const text = (replyText || "").trim();
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const actions: string[] = [];
  const meals: any = {};
  const snacks: string[] = [];

  const pushAction = (s: string) => {
    const clean = s.replace(/^[-•\s]+/, "").trim();
    if (!clean) return;
    if (actions.length >= 6) return;
    if (!actions.includes(clean)) actions.push(clean);
  };

  const pickValue = (line: string) => line.replace(/^.*?:\s*/, "").trim();

  for (const l of lines) {
    // Actions: numbered or explicit "Acción" lines
    if (/^(\d+\)|\d+\.|\(\d+\))\s+/.test(l)) {
      pushAction(l.replace(/^(\d+\)|\d+\.|\(\d+\))\s+/, ""));
      continue;
    }
    if (/^acci[oó]n(es)?\s*[:\-]/i.test(l)) {
      pushAction(pickValue(l));
      continue;
    }
    if (/^siguiente(s)?\s*paso(s)?\s*[:\-]/i.test(l)) {
      pushAction(pickValue(l));
      continue;
    }
    if (/^\-\s+/.test(l) && actions.length < 6) {
      // bullets often are actions in plan-like responses
      pushAction(l);
      continue;
    }

    // Meals: capture simple labels
    if (/^desayuno\s*[:\-]/i.test(l)) {
      meals.desayuno = pickValue(l);
      continue;
    }
    if (/^comida\s*[:\-]/i.test(l)) {
      meals.comida = pickValue(l);
      continue;
    }
    if (/^cena\s*[:\-]/i.test(l)) {
      meals.cena = pickValue(l);
      continue;
    }
    if (/^snack(s)?\s*[:\-]/i.test(l)) {
      const v = pickValue(l);
      if (v) snacks.push(v);
      continue;
    }
  }

  if (snacks.length) meals.snacks = snacks;

  const notesCandidates = lines
    .filter((l) => !/^\d+[\)\.]\s+/.test(l))
    .filter((l) => !/^acci[oó]n(es)?\s*[:\-]/i.test(l))
    .filter((l) => !/^siguiente(s)?\s*paso(s)?\s*[:\-]/i.test(l))
    .filter((l) => !/^desayuno\s*[:\-]/i.test(l))
    .filter((l) => !/^comida\s*[:\-]/i.test(l))
    .filter((l) => !/^cena\s*[:\-]/i.test(l))
    .filter((l) => !/^snack(s)?\s*[:\-]/i.test(l));

  const notes = notesCandidates.slice(0, 4).join(" ").trim();

  const out: any = {
    title: "Plan de hoy",
    actions: actions.slice(0, 6),
  };
  if (Object.keys(meals).length) out.meals = meals;
  if (notes) out.notes = notes;
  return out;
}

async function maybeSavePlanToday(params: {
  userText: string;
  replyText: string;
  mode: PlanMode;
  plan?: any;
}): Promise<boolean> {
  const { userText, replyText, mode, plan } = params;

  // Prefer structured plan from API when available
  const structured = plan && typeof plan === "object" ? plan : null;

  if (!structured && !looksLikePlanRequest(userText)) return false;

  const extracted = structured
    ? {
        title: String((structured as any)?.title || "Plan de hoy"),
        actions: Array.isArray((structured as any)?.actions)
          ? (structured as any).actions.map((x: any) => String(x)).filter(Boolean).slice(0, 12)
          : [],
        meals: (structured as any)?.meals,
        notes: (structured as any)?.notes,
      }
    : extractPlanFromReply(replyText);

  const payload: any = {
    date: todayISO(),
    mode,
    title: extracted.title,
    actions: extracted.actions,
    meals: extracted.meals,
    notes: extracted.notes,
    saved_at: new Date().toISOString(),
  };

  // Preserve helpful numeric hints when they exist
  if (structured) {
    const h = (structured as any)?.hydration_liters;
    const mm = (structured as any)?.movement_minutes;
    if (typeof h === "number") payload.hydration_liters = h;
    if (typeof mm === "number") payload.movement_minutes = mm;
  }

  try {
    await AsyncStorage.setItem(PLAN_TODAY_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function basicCoachReply(
  userText: string,
  mode: PlanMode,
  meals: MealsSummary,
  targets: NutritionTargets,
  userName?: string,
  opts?: { shouldGreet?: boolean; seed?: number }
) {
  const raw = (userText || "").trim();
  const t = raw.toLowerCase();

  const seed = typeof opts?.seed === "number" ? opts!.seed : Date.now();
  const pick = <T,>(arr: T[]) => arr[Math.abs(seed) % arr.length];

  const cleanName = userName && userName.trim() ? userName.trim() : "";
  const shouldGreet = opts?.shouldGreet ?? true;

  // Intents (simple but effective)
  type Intent = "cravings" | "stress" | "sleep" | "what_now" | "protein" | "summary" | "generic";
  const intent: Intent = (() => {
    if (t.includes("antojo") || t.includes("ansiedad") || t.includes("dulce") || t.includes("snack")) return "cravings";
    if (t.includes("estres") || t.includes("estrés") || t.includes("ansioso") || t.includes("ansiedad")) return "stress";
    if (t.includes("dormi") || t.includes("dormí") || t.includes("sueño") || t.includes("sueno") || t.includes("desvelo")) return "sleep";
    if (t.includes("que hago") || t.includes("qué hago") || t.includes("ahora que") || t.includes("ahorita")) return "what_now";
    if (t.includes("prote") || t.includes("proteína") || t.includes("proteina")) return "protein";
    if (t.includes("resumen") || t.includes("cómo voy") || t.includes("como voy")) return "summary";
    return "generic";
  })();

  const proteinLeft = Math.max(0, targets.protein_g - meals.protein_g);
  const caloriesLeft = Math.max(0, targets.calories - meals.calories);

  const pct = (v: number, total: number) => {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((v / total) * 100)));
  };

  const pPct = pct(meals.protein_g, targets.protein_g);
  const cPct = pct(meals.calories, targets.calories);

  const tone =
    mode === "agresiva"
      ? {
          openers: [
            "Bien. Vamos directo a lo importante.",
            "Listo. Cero drama: plan simple.",
            "Perfecto. Hoy jugamos a ganar.",
          ],
          closer: [
            "Una decisión buena hoy vale más que mil perfectas mañana.",
            "Corto, claro y al punto.",
            "Sin excusas, pero con compasión.",
          ],
        }
      : mode === "mantenimiento"
      ? {
          openers: [
            "Perfecto. Hoy buscamos estabilidad y energía.",
            "Va. Mantener es ganar.",
            "Ok. Vamos a sostenerlo fácil.",
          ],
          closer: [
            "Consistencia. Eso es lo que cambia el cuerpo.",
            "Suave pero constante.",
            "Esto se construye con días normales.",
          ],
        }
      : {
          openers: [
            "Ok, te entiendo. Vamos paso a paso.",
            "Va. Lo hacemos simple.",
            "Estoy contigo. Vamos con una cosa a la vez.",
          ],
          closer: [
            "Pequeños ajustes, grandes resultados.",
            "Sostenible y real.",
            "Hoy cuenta. Aunque sea 1%.",
          ],
        };

  const greetingLine = shouldGreet
    ? cleanName
      ? pick([`Hola ${cleanName}.`, `Hey ${cleanName}.`, `Qué onda ${cleanName}.`])
      : pick(["Hola.", "Hey.", "Listo."])
    : "";

  // summary (shorter + less repetitive)
  const summaryLine = pick([
    `Hoy: ${meals.mealsCount} comidas · ${meals.calories}/${targets.calories} kcal · P ${meals.protein_g}/${targets.protein_g} g.`,
    `Progreso hoy: ${meals.calories}/${targets.calories} kcal · proteína ${meals.protein_g}/${targets.protein_g} g · ${meals.mealsCount} comidas.`,
  ]);

  // insights (only 1–2 lines, not always the same)
  const insightLines: string[] = [];
  if (meals.mealsCount === 0) {
    insightLines.push(
      pick([
        "Aún no has registrado comidas hoy. Con 1 registro ya te guío mucho mejor.",
        "Hoy está en cero comidas registradas. Si metes una, te ajusto el plan en caliente.",
      ])
    );
  } else {
    if (proteinLeft > 0) {
      insightLines.push(
        pick([
          `Te falta proteína (${pPct}% del objetivo). Eso te sube saciedad y control de antojos.`,
          `Proteína está baja hoy (${pPct}%). Si la subimos, el día se vuelve más fácil.`,
        ])
      );
    } else {
      insightLines.push(
        pick([
          "Proteína va bien hoy. Buenísimo para mantener músculo.",
          "Proteína sólida hoy. Eso te protege el progreso.",
        ])
      );
    }

    if (meals.calories > targets.calories) {
      insightLines.push(
        pick([
          `Vas arriba en calorías (${cPct}%). No pasa nada: ajustamos la próxima comida.`,
          `Hoy ya te pasaste calorías (${cPct}%). Solo hacemos la siguiente comida más ligera.`,
        ])
      );
    } else {
      insightLines.push(
        pick([
          `Vas dentro de calorías (${cPct}%). Bien control.`,
          `Calorías bien (${cPct}%). Sigue así.`,
        ])
      );
    }
  }

  const actionForProtein = () => {
    if (proteinLeft <= 0)
      return pick(["Acción: mantén proteína y porciones normales.", "Acción: proteína ok. Enfócate en verduras/agua."]);
    const grams = Math.min(40, Math.max(20, Math.round(proteinLeft / 2) || 25));
    return pick([
      `Acción: en tu siguiente comida agrega ${grams} g de proteína (atún, pollo, huevos, yogurt griego).`,
      `Acción: suma ${grams} g de proteína hoy (yogurt griego, atún, cottage, huevos).`,
    ]);
  };

  const actionForCalories = () => {
    if (meals.calories <= targets.calories) {
      return pick([
        "Acción: proteína + verduras; carbs porción chica.",
        "Acción: comida simple: proteína + verduras. Carbo moderado.",
      ]);
    }
    return pick([
      "Acción: próxima comida ligera: proteína + verduras. Sin picoteo extra.",
      "Acción: haz la siguiente comida ‘reset’: proteína + verduras + agua.",
    ]);
  };

  // Build reply per intent (different body so it doesn't feel identical)
  let bodyLines: string[] = [];

  if (intent === "cravings") {
    bodyLines = [
      pick(["Ok. Antojos se manejan mejor con un plan corto.", "Va. Antojo no es enemigo: lo bajamos de volumen."]),
      pick(["Pregunta rápida: ¿es hambre real o es ansiedad/aburrimiento?", "Dime: ¿se siente físico (estómago) o mental (ansiedad)?"]),
      pick([
        "Acción: agua + 10 min. Luego 1 snack con proteína (yogurt griego, atún, cottage) y listo.",
        "Acción: 90s respiración 4–6 + agua. Después proteína primero; si aún quieres dulce, porción chica.",
      ]),
    ];
  } else if (intent === "stress") {
    bodyLines = [
      pick(["Ok. Primero bajamos estrés, luego decisiones.", "Entiendo. Vamos a bajar la tensión antes de comer."]),
      pick(["Del 1 al 10, ¿cuánto estrés sientes ahora?", "¿Qué lo detonó: trabajo, cansancio o hambre?"]),
      pick([
        "Acción: 90s respiración 4–6. Luego caminata corta o agua. Y comida simple: proteína + verduras.",
        "Acción: pausa 60s (hombros abajo). Luego agua. Después: proteína + verduras, sin decisión complicada.",
      ]),
    ];
  } else if (intent === "sleep") {
    bodyLines = [
      pick(["Si dormiste mal, hoy la meta es estabilidad (no perfección).", "Con poco sueño, el cuerpo pide más carbs. Lo guiamos."]),
      pick(["¿A qué hora planeas tu primera comida fuerte hoy?", "¿Cómo andas de energía del 1 al 10?"]),
      pick(["Acción: comidas simples: proteína + verduras. Camina 10–15 min para energía.", "Acción: proteína temprano + agua. Cafeína solo temprano. Caminata 10 min."]),
    ];
  } else if (intent === "what_now") {
    bodyLines = [
      pick(["Te digo el siguiente paso más fácil.", "Vamos con una acción pequeña ahora."]),
      pick([
        "Elige 1 ahora: (1) registrar 1 comida, (2) caminar 10 min, (3) proteína rápida. ¿Cuál haces?",
        "¿Tu siguiente comida es comida o cena? Así te digo porción.",
      ]),
      pick([
        "Acción (3 pasos):\n1) Proteína primero\n2) Verduras (medio plato)\n3) Caminata 15–20 min.",
        mode === "agresiva"
          ? "Acción: proteína + verduras y caminata 20–25 min."
          : mode === "mantenimiento"
          ? "Acción: proteína + verduras y caminata 25–30 min."
          : "Acción: proteína + verduras y caminata 15–20 min.",
      ]),
    ];
  } else if (intent === "protein") {
    bodyLines = [
      pick(["Perfecto. Subir proteína es el hack #1.", "Va. Proteína primero y todo mejora."]),
      pick(["¿Prefieres proteína rápida (snack) o una comida completa?", "¿Qué tienes a la mano: huevos, atún, pollo o yogurt?"]),
      actionForProtein(),
    ];
  } else if (intent === "summary") {
    bodyLines = [
      pick(["Resumen rápido y acción.", "Así vas hoy y qué haría ahora."]),
      pick([
        meals.calories > targets.calories ? "Hoy ya vas arriba en calorías; no pasa nada." : "Vas bien para tu objetivo.",
        proteinLeft > 0
          ? `Tu mayor palanca hoy: proteína (+${Math.min(40, Math.max(20, Math.round(proteinLeft / 2) || 25))}g).`
          : "Proteína ya está bien hoy.",
      ]),
      meals.calories > targets.calories ? actionForCalories() : actionForProtein(),
      pick(["¿Quieres que te proponga tu siguiente comida o un snack rápido?", "¿Qué viene: comida o cena?"]),
    ];
  } else {
    // generic: choose biggest lever
    const action = proteinLeft > 0 ? actionForProtein() : actionForCalories();
    bodyLines = [
      pick(["Ok. Lo hacemos simple.", "Entendido. Vamos con lo que más mueve la aguja."]),
      pick(["¿Qué te cuesta más ahora: antojos, estrés, sueño o comida?", "Dime en una frase qué está pasando ahorita."]),
      action,
    ];
  }

  const out: string[] = [];
  if (greetingLine) out.push(greetingLine);
  out.push(pick(tone.openers));
  out.push(summaryLine);

  // keep at most 2 insights
  out.push(...insightLines.slice(0, 2));
  out.push(...bodyLines.filter(Boolean));
  out.push(pick(tone.closer));

  return out.filter(Boolean).join("\n");
}

export default function CoachScreen() {
  const scrollRef = useRef<ScrollView | null>(null);
  const msgsRef = useRef<Msg[]>([]);
  const forceScrollOnNextContentSizeRef = useRef<boolean>(true);

  const [stickToBottom, setStickToBottom] = useState(true);
  const contentHeightRef = useRef(0);
  const layoutHeightRef = useRef(0);
  const scrollYRef = useRef(0);

  const computeIsNearBottom = useCallback(() => {
    const contentH = contentHeightRef.current;
    const layoutH = layoutHeightRef.current;
    const y = scrollYRef.current;
    if (!contentH || !layoutH) return true;
    const distanceFromBottom = contentH - (y + layoutH);
    return distanceFromBottom < 120; // px threshold
  }, []);

  const scrollToBottom = useCallback((animated: boolean = false) => {
    // Ensure we scroll after React Native has laid out the list
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated });
      });
    });
  }, []);

  const [mode, setMode] = useState<PlanMode>("balance");
  const [profileName, setProfileName] = useState<string>("");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string>("");
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [thinkingDots, setThinkingDots] = useState<string>("…");
  const [planSavedToast, setPlanSavedToast] = useState<string>("");

  // --- Plan de hoy (fijo dentro del Coach) ---
  const [planToday, setPlanToday] = useState<any | null>(null);
  const [planTodayLoading, setPlanTodayLoading] = useState<boolean>(false);

  const loadPlanToday = useCallback(async () => {
    setPlanTodayLoading(true);
    try {
      const raw = await AsyncStorage.getItem(PLAN_TODAY_KEY);
      if (!raw) {
        setPlanToday(null);
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        setPlanToday(null);
        return null;
      }
      setPlanToday(parsed);
      return parsed;
    } catch {
      setPlanToday(null);
      return null;
    } finally {
      setPlanTodayLoading(false);
    }
  }, []);

  const togglePlanTodayAction = useCallback(
    async (idx: number) => {
      try {
        const raw = await AsyncStorage.getItem(PLAN_TODAY_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return;
        const actions: any[] = Array.isArray((parsed as any).actions) ? (parsed as any).actions : [];
        if (!actions[idx]) return;

        // Support both string[] and {text,done}[]
        const nextActions = actions.map((a: any, i: number) => {
          if (i !== idx) return a;
          if (typeof a === "string") return { text: a, done: true };
          if (a && typeof a === "object") return { ...a, done: !a.done };
          return a;
        });

        const next = { ...parsed, actions: nextActions, updated_at: new Date().toISOString() };
        await AsyncStorage.setItem(PLAN_TODAY_KEY, JSON.stringify(next));
        setPlanToday(next);
      } catch {
        // ignore
      }
    },
    []
  );

  // Daily checklist
  const [tasksDateKey, setTasksDateKey] = useState<string>(isoDateKey(new Date()));
  const [dailyTasks, setDailyTasks] = useState<DailyTask[]>([]);
  const [checklistCollapsed, setChecklistCollapsed] = useState<boolean>(true);

  // --- Voice STT (Option B) ---
  const recordingRef = useRef<any>(null);
  const stoppingRef = useRef<boolean>(false);
  const [sttStatus, setSttStatus] = useState<"idle" | "recording" | "transcribing">("idle");
  const [sttError, setSttError] = useState<string>("");

  const sttBusy = sttStatus !== "idle";

  // Auto-stop settings
  const STT_METER_INTERVAL_MS = 300;
  const STT_SILENCE_DB_THRESHOLD = -45; // lower = quieter
  const STT_SILENCE_DURATION_MS = 1400;
  const STT_MIN_RECORD_MS = 700;
  const STT_MAX_RECORD_MS = 12000;

  const recordingStartedAtRef = useRef<number>(0);
  const silenceSinceRef = useRef<number | null>(null);
  const autoStopArmedRef = useRef<boolean>(false);
  const autoStopTimerRef = useRef<any>(null);
  const noMeteringFallbackTimerRef = useRef<any>(null);
  const gotMeteringRef = useRef<boolean>(false);
  const stopRecordingFnRef = useRef<() => Promise<void>>(async () => {});

  // AI server URL modal state
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [aiBaseUrl, setAiBaseUrl] = useState<string>("");
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState<string>("");
  const [aiHint, setAiHint] = useState<string>("");

  // TTS settings (voice picker)
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<any[]>([]);
  const [ttsVoiceId, setTtsVoiceId] = useState<string | null>(null);
  const [ttsRate, setTtsRate] = useState<number>(0.98);
  const [ttsPitch, setTtsPitch] = useState<number>(1.0);

  const [mealsSummary, setMealsSummary] = useState<MealsSummary>({
    mealsCount: 0,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
  });

  const insets = useSafeAreaInsets();
  const inputBarExtraBottom = insets.bottom;
  const inputBarHeight = 56;

  const quick = useMemo(
    () => [
      { label: "Resumen de hoy", text: "Resumen de hoy" },
      { label: "¿Qué hago hoy?", text: "¿Qué hago hoy?" },
      { label: "Me falta proteína", text: "Me falta proteína" },
      { label: "Tengo antojos", text: "Tengo antojos" },
      { label: "Dormí mal", text: "Dormí mal" },
      { label: "Estoy estresado", text: "Estoy estresado" },
    ],
    []
  );

  const targets = useMemo(() => TARGETS_BY_MODE[mode], [mode]);

  const getFreshContext = useCallback(async () => {
    const [savedMode, savedProfile] = await Promise.all([
      AsyncStorage.getItem(MODE_KEY),
      AsyncStorage.getItem(PROFILE_KEY),
    ]);

    const { name: nextName, mode: profileMode } = getProfileNameAndMode(savedProfile);
    const nextMode = normalizeMode(profileMode ?? savedMode);

    setProfileName(nextName);

    const ms = await getMealsSummaryForDate(isoDateKey(new Date()));
    const nextTargets = TARGETS_BY_MODE[nextMode];

    setMode(nextMode);
    setMealsSummary(ms);

    const dk = isoDateKey(new Date());
    setTasksDateKey(dk);
    const t = await loadOrInitDailyTasks({ dateKey: dk, mode: nextMode, meals: ms, targets: nextTargets });
    setDailyTasks(t);
    try {
      await AsyncStorage.setItem(dailyTasksKey(dk), JSON.stringify(t));
    } catch {}

    return { nextMode, ms, nextTargets, nextName };
  }, []);

  const loadCoachData = useCallback(async () => {
    try {
      const [savedMsgs, savedMode, savedProfile] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(MODE_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
      ]);

      const { name: nextName, mode: profileMode } = getProfileNameAndMode(savedProfile);
      const nextMode = normalizeMode(profileMode ?? savedMode);
      setMode(nextMode);
      setProfileName(nextName);

      if (savedMsgs) {
        const parsed = JSON.parse(savedMsgs);
        const arr: any[] = Array.isArray(parsed) ? parsed : [];
        const safe: Msg[] = arr
          .filter(Boolean)
          .map((m: any) => ({
            id: String(m.id || uid()),
            role: m.role === "user" ? "user" : "coach",
            text: String(m.text || ""),
            ts: typeof m.ts === "number" ? m.ts : Date.now(),
            intent: typeof m.intent === "string" ? m.intent : undefined,
            plan: m.plan ?? undefined,
          }))
          .filter((m) => m.text.trim().length > 0);

        msgsRef.current = safe;
        setMsgs(safe);
      } else {
        const hello: Msg = {
          id: uid(),
          role: "coach",
          ts: Date.now(),
          text: `Hola${nextName ? ` ${nextName}` : ""} Soy tu Coach.\nEscríbeme “Resumen de hoy” o usa los botones rápidos.`,
        };
        msgsRef.current = [hello];
        setMsgs([hello]);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([hello]));
      }

      const dk = isoDateKey(new Date());
      const ms = await getMealsSummaryForDate(dk);
      setMealsSummary(ms);

      setTasksDateKey(dk);
      const nextTargets = TARGETS_BY_MODE[nextMode];
      const t = await loadOrInitDailyTasks({ dateKey: dk, mode: nextMode, meals: ms, targets: nextTargets });
      setDailyTasks(t);
      try {
        await AsyncStorage.setItem(dailyTasksKey(dk), JSON.stringify(t));
      } catch {}
      await loadPlanToday();
    } catch {
      // ignore
    }
  }, [loadPlanToday]);

  useEffect(() => {
    loadCoachData();
  }, [loadCoachData]);

  useEffect(() => {
    if (!msgs || msgs.length === 0) return;
    scrollToBottom(false);
  }, [msgs.length, scrollToBottom]);

  useEffect(() => {
    if (!loading) {
      setThinkingDots("…");
      return;
    }

    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % 3;
      setThinkingDots(i === 0 ? "…" : i === 1 ? "……" : "………");
    }, 450);

    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [savedVoice, savedRate, savedPitch, savedAiBase, savedTtsEnabled, savedChecklistCollapsed] = await Promise.all([
          AsyncStorage.getItem(TTS_VOICE_KEY),
          AsyncStorage.getItem(TTS_RATE_KEY),
          AsyncStorage.getItem(TTS_PITCH_KEY),
          AsyncStorage.getItem(AI_BASE_URL_KEY),
          AsyncStorage.getItem(TTS_ENABLED_KEY),
          AsyncStorage.getItem(CHECKLIST_COLLAPSED_KEY),
        ]);

        // Hint: inferred LAN host (best effort)
        const inferredHost = inferLanHostFromExpo();
        if (inferredHost) {
          setAiHint(`Sugerido (LAN): http://${inferredHost}:3000`);
        } else {
          setAiHint("Sugerido (LAN): http://TU_IP:3000");
        }

        if (savedAiBase && savedAiBase.trim()) {
          const cleaned = savedAiBase.trim().replace(/\/+$/, "");
          setAiBaseUrl(cleaned);
          setAiBaseUrlDraft(cleaned);
        }

        if (!alive) return;

        if (savedVoice) setTtsVoiceId(savedVoice);
        if (savedRate && !Number.isNaN(Number(savedRate))) setTtsRate(Number(savedRate));
        if (savedPitch && !Number.isNaN(Number(savedPitch))) setTtsPitch(Number(savedPitch));
        if (savedTtsEnabled != null) {
          // stored as "1" (enabled) or "0" (muted)
          setSpeakEnabled(savedTtsEnabled === "1");
        }
        if (savedChecklistCollapsed != null) {
          setChecklistCollapsed(savedChecklistCollapsed === "1");
        }

        if (!Speech?.getAvailableVoicesAsync) return;

        const voices = await Speech.getAvailableVoicesAsync();
        if (!alive) return;

        const spanish = (voices || [])
          .filter((v: any) => String(v?.language || "").toLowerCase().startsWith("es"))
          .sort((a: any, b: any) => {
            const la = String(a?.language || "").toLowerCase();
            const lb = String(b?.language || "").toLowerCase();
            const amx = la === "es-mx" ? 1 : 0;
            const bmx = lb === "es-mx" ? 1 : 0;
            if (amx !== bmx) return bmx - amx;

            const aq = String(a?.quality || "").toLowerCase();
            const bq = String(b?.quality || "").toLowerCase();
            const aEnh = aq.includes("enhanced") ? 1 : 0;
            const bEnh = bq.includes("enhanced") ? 1 : 0;
            if (aEnh !== bEnh) return bEnh - aEnh;

            return String(a?.name || "").localeCompare(String(b?.name || ""));
          });

        setAvailableVoices(spanish);

        // Auto-select best voice if none saved
        if (!savedVoice && spanish.length) {
          const best =
            spanish.find((v: any) => String(v?.language || "").toLowerCase() === "es-mx") ||
            spanish[0];
          if (best?.identifier) {
            setTtsVoiceId(best.identifier);
            await AsyncStorage.setItem(TTS_VOICE_KEY, best.identifier);
          }
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        // Force one scroll-to-bottom after content lays out
        forceScrollOnNextContentSizeRef.current = true;
        await loadCoachData();
        if (!alive) return;
        // Also attempt an immediate scroll (helps when content is already laid out)
        scrollToBottom(false);
        await loadPlanToday();
      })();

      return () => {
        alive = false;
      };
    }, [loadCoachData, scrollToBottom, loadPlanToday])
  );

  async function persist(next: Msg[]) {
    msgsRef.current = next;
    setMsgs(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  async function resetChat() {
    try {
      // Stop any ongoing speech
      try {
        Speech?.stop?.();
      } catch {}

      // Stop any ongoing recording
      try {
        recordingRef.current?.stopAndUnloadAsync?.();
      } catch {}
      recordingRef.current = null;
      setSttStatus("idle");
      setSttError("");

      setInput("");
      setLoading(false);
      setStickToBottom(true);

      // Rebuild a fresh hello message using the latest saved profile/mode
      const [savedMode, savedProfile] = await Promise.all([
        AsyncStorage.getItem(MODE_KEY),
        AsyncStorage.getItem(PROFILE_KEY),
      ]);
      const { name: nextName, mode: profileMode } = getProfileNameAndMode(savedProfile);
      const nextMode = normalizeMode(profileMode ?? savedMode);
      setMode(nextMode);
      setProfileName(nextName);

      const hello: Msg = {
        id: uid(),
        role: "coach",
        ts: Date.now(),
        text: `Hola${nextName ? ` ${nextName}` : ""} Soy tu Coach.\nEscríbeme “Resumen de hoy” o usa los botones rápidos.`,
      };

      msgsRef.current = [hello];
      setMsgs([hello]);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([hello]));

      // Scroll to bottom after reset
      scrollToBottom(false);
    } catch {
      // ignore
    }
  }

  async function toggleTask(taskId: string) {
    const dk = tasksDateKey || isoDateKey(new Date());
    const next = (dailyTasks || []).map((t) => (t.id === taskId ? { ...t, done: !t.done } : t));
    setDailyTasks(next);
    try {
      await AsyncStorage.setItem(dailyTasksKey(dk), JSON.stringify(next));
    } catch {}
  }

  async function regenerateTasks() {
    const dk = isoDateKey(new Date());
    const nextTargets = TARGETS_BY_MODE[mode];
    const freshMeals = await getMealsSummaryForDate(dk);
    setMealsSummary(freshMeals);
    const fresh = buildDefaultDailyTasks(mode, freshMeals, nextTargets);
    setTasksDateKey(dk);
    setDailyTasks(fresh);
    try {
      await AsyncStorage.setItem(dailyTasksKey(dk), JSON.stringify(fresh));
    } catch {}
  }

  function buildChecklistPlanPrompt() {
    const done = (dailyTasks || []).filter((t) => t.done);
    const pending = (dailyTasks || []).filter((t) => !t.done);

    const doneLines = done.length ? done.map((t) => `- ✅ ${t.label}`).join("\n") : "- (ninguna aún)";
    const pendingLines = pending.length ? pending.map((t) => `- ☐ ${t.label}`).join("\n") : "- (todas completas)";

    return (
      `Con base en mi checklist de hoy, conviértelo en un plan de acción concreto para el resto del día. ` +
      `Modo: ${MODE_LABEL[mode]}. ` +
      `Hoy llevo ${mealsSummary.mealsCount} comidas, ${mealsSummary.calories}/${targets.calories} kcal y ` +
      `proteína ${mealsSummary.protein_g}/${targets.protein_g} g.\n\n` +
      `Checklist completado:\n${doneLines}\n\n` +
      `Checklist pendiente:\n${pendingLines}\n\n` +
      `Dame: (1) 3 acciones siguientes, (2) sugerencia de próxima comida (MX), (3) mini recordatorio de hidratación/estrés.`
    );
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setLoading(true);
    setStickToBottom(true);

    const userMsg: Msg = { id: uid(), role: "user", ts: Date.now(), text: trimmed };
    const baseNext = [...(msgsRef.current || []), userMsg];
    await persist(baseNext);

    try {
      const { nextMode, ms, nextTargets, nextName } = await getFreshContext();

      // Pull the raw profile so the AI can use name/sexo/edad/etc if present
      const profileRaw = await AsyncStorage.getItem(PROFILE_KEY);

      // 1) Try AI
      const ai = await callCoachAI({
        message: trimmed,
        mode: nextMode,
        profileRaw,
        derivedName: nextName,
        meals: ms,
        targets: nextTargets,
        history: baseNext,
      });

      // 2) Fallback: local basic coach
      const lastCoach = [...(msgsRef.current || [])].reverse().find((m) => m.role === "coach");
      const shouldGreet = !(lastCoach?.text || "").trim().toLowerCase().startsWith("hola");

      const replyText =
        (ai?.reply && ai.reply.trim() ? ai.reply.trim() : "") ||
        basicCoachReply(trimmed, nextMode, ms, nextTargets, nextName, {
          shouldGreet,
          seed: (msgsRef.current?.length || 0) + Date.now(),
        });

      const coachMsg: Msg = {
        id: uid(),
        role: "coach",
        ts: Date.now() + 1,
        text: replyText,
        intent: typeof ai?.intent === "string" ? ai.intent : undefined,
        plan: ai?.plan,
      };
      const finalNext = [...baseNext, coachMsg];
      await persist(finalNext);

      // If the user asked for a plan/checklist-based plan, save it for the Plan tab.
      const saved = await maybeSavePlanToday({
        userText: trimmed,
        replyText,
        mode: nextMode,
        plan: ai?.plan,
      });
      if (saved) {
        setPlanSavedToast("✅ Guardé tu Plan de hoy");
        setTimeout(() => setPlanSavedToast(""), 2500);
        // Refresh fixed plan
        await loadPlanToday();
      }

      speakNow(replyText);
      scrollToBottom(true);
    } finally {
      setInput("");
      setLoading(false);
    }
  }

  const sanitizeForTTS = useCallback((text: string) => {
    if (!text) return "";

    // Make replies sound natural in TTS:
    // - remove emojis/symbols
    // - remove markdown
    // - convert newlines/bullets into short pauses
    // - normalize excessive whitespace
    return text
      // remove variation selector (Android/iOS emoji issues)
      .replace(/\uFE0F/g, "")
      // remove emojis (wide range)
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      // remove a few common symbols that get read weirdly
      .replace(/[✅⚠️❌⭐🔥💪]/g, "")
      // remove markdown-ish formatting
      .replace(/\*\*/g, "")
      .replace(/`+/g, "")
      // normalize bullets and separators into pauses
      .replace(/^[\s]*[-•]\s+/gm, "")
      .replace(/\s*[·|•]\s*/g, ", ")
      // turn line breaks into sentence pauses
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, ", ")
      // avoid weird double punctuation
      .replace(/\s*([,.!?])\s*/g, "$1 ")
      .replace(/\.{3,}/g, "…")
      // collapse whitespace
      .replace(/\s+/g, " ")
      .trim();
  }, []);

  const speakNow = useCallback(
    (text: string, overrideVoiceId?: string | null) => {
      if (!speakEnabled) return;
      setVoiceError("");
      if (!Speech?.speak) {
        setVoiceError(
          "🔊 Voz aún no está incluida en este build. Reinstala/reconstruye el dev build para habilitarla."
        );
        return;
      }
      const safe = sanitizeForTTS(text);
      if (!safe) return;
      try {
        Speech.stop?.();
        Speech.speak(safe, {
          language: "es-MX",
          voice: (overrideVoiceId ?? ttsVoiceId) || undefined,
          rate: ttsRate,
          pitch: ttsPitch,
          onError: () => {
            setVoiceError("🔊 No se pudo reproducir voz en este dispositivo/build.");
          },
        });
      } catch {
        setVoiceError("🔊 No se pudo reproducir voz en este dispositivo/build.");
      }
    },
    [sanitizeForTTS, speakEnabled, ttsVoiceId, ttsRate, ttsPitch]
  );

  async function transcribeAudioUri(uri: string): Promise<string | null> {
    try {
      const base = await getCoachApiBaseUrl();
      const url = `${base}/api/voice/transcribe`;

      const form = new FormData();
      // React Native requires a file-like object
      form.append(
        "audio",
        {
          uri,
          name: "audio.m4a",
          type: "audio/m4a",
        } as any
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);

      try {
        const res = await fetch(url, {
          method: "POST",
          body: form,
          signal: controller.signal,
          // NOTE: do NOT set Content-Type; RN will set the multipart boundary
        });

        const json = await res.json().catch(() => null);
        if (!res.ok) return null;

        const text = json?.data?.text ?? json?.text;
        return typeof text === "string" && text.trim() ? text.trim() : null;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return null;
    }
  }

  const startRecording = useCallback(async () => {
    try {
      setSttError("");
      setVoiceError("");
      stoppingRef.current = false;

      if (!Audio) {
        setSttError(
          "La voz (grabación) no está incluida en este build. Instala expo-av y reconstruye/reinstala el dev build para habilitar STT."
        );
        setSttStatus("idle");
        return;
      }

      // Permissions
      const perm = await Audio.requestPermissionsAsync?.();
      if (!perm?.granted) {
        setSttError("Permiso de micrófono denegado.");
        return;
      }

      // iOS/Android audio mode
      await Audio.setAudioModeAsync?.({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new (Audio.Recording as any)();

      // Enable metering when possible
      const opts: any = { ...(Audio.RecordingOptionsPresets as any).HIGH_QUALITY };
      if (opts?.ios) opts.ios = { ...opts.ios, isMeteringEnabled: true };
      if (opts?.android) opts.android = { ...opts.android, isMeteringEnabled: true };

      await rec.prepareToRecordAsync(opts);

      // Metering-based auto-stop (silence -> stop)
      try {
        rec.setProgressUpdateInterval?.(STT_METER_INTERVAL_MS);
        rec.setOnRecordingStatusUpdate?.((status: any) => {
          if (!autoStopArmedRef.current) return;
          if (!status?.isRecording) return;

          const now = Date.now();
          const startedAt = recordingStartedAtRef.current || now;
          const elapsed = now - startedAt;

          // Some platforms may not provide metering; in that case we rely on max duration.
          const metering = typeof status?.metering === "number" ? status.metering : null;
          if (metering != null) {
            gotMeteringRef.current = true;
          }
          if (metering == null) return;

          const isSilent = metering <= STT_SILENCE_DB_THRESHOLD;
          if (isSilent) {
            if (silenceSinceRef.current == null) silenceSinceRef.current = now;
            const silenceMs = now - (silenceSinceRef.current || now);
            if (elapsed >= STT_MIN_RECORD_MS && silenceMs >= STT_SILENCE_DURATION_MS) {
              autoStopArmedRef.current = false;
              // Stop and send automatically
              stopRecordingFnRef.current?.();
            }
          } else {
            silenceSinceRef.current = null;
          }
        });
      } catch {
        // ignore
      }

      // Reset metering detection for this session
      gotMeteringRef.current = false;
      await rec.startAsync();

      recordingStartedAtRef.current = Date.now();
      silenceSinceRef.current = null;
      autoStopArmedRef.current = true;

      // Safety: stop after max duration even if metering isn't available
      try {
        if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      } catch {}
      autoStopTimerRef.current = setTimeout(() => {
        if (!autoStopArmedRef.current) return;
        autoStopArmedRef.current = false;
        stopRecordingFnRef.current?.();
      }, STT_MAX_RECORD_MS);

      // Fallback: if metering is not available on this device, auto-stop after a reasonable time
      // so the user doesn't have to tap twice.
      try {
        if (noMeteringFallbackTimerRef.current) clearTimeout(noMeteringFallbackTimerRef.current);
      } catch {}
      noMeteringFallbackTimerRef.current = setTimeout(() => {
        // Give it a moment to start reporting status updates.
        if (gotMeteringRef.current) return;
        if (!autoStopArmedRef.current) return;
        // No metering detected -> stop after ~6s total recording time.
        const startedAt = recordingStartedAtRef.current || Date.now();
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, 6000 - elapsed);
        setTimeout(() => {
          if (!autoStopArmedRef.current) return;
          autoStopArmedRef.current = false;
          stopRecordingFnRef.current?.();
        }, remaining);
      }, 1200);

      recordingRef.current = rec;
      setSttStatus("recording");
      scrollToBottom(true);
    } catch {
      setSttError("No se pudo iniciar la grabación.");
      setSttStatus("idle");
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      const rec = recordingRef.current;
      // Disarm auto-stop timers/state
      autoStopArmedRef.current = false;
      silenceSinceRef.current = null;
      recordingStartedAtRef.current = 0;
      try {
        if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      } catch {}
      autoStopTimerRef.current = null;
      try {
        if (noMeteringFallbackTimerRef.current) clearTimeout(noMeteringFallbackTimerRef.current);
      } catch {}
      noMeteringFallbackTimerRef.current = null;
      if (!rec) {
        setSttStatus("idle");
        return;
      }

      try {
        setSttStatus("transcribing");
        await rec.stopAndUnloadAsync();
        try {
          rec.setOnRecordingStatusUpdate?.(null);
        } catch {}
        const uri = rec.getURI();
        recordingRef.current = null;

        if (!uri) {
          setSttError("No se encontró el audio grabado.");
          setSttStatus("idle");
          return;
        }

        const text = await transcribeAudioUri(uri);
        if (!text) {
          setSttError("No pude transcribir el audio. Intenta de nuevo.");
          setSttStatus("idle");
          return;
        }

        // Send immediately
        setInput("");
        await send(text);
        setSttStatus("idle");
      } catch {
        setSttError("Falló la transcripción. Intenta de nuevo.");
        setSttStatus("idle");
      }
    } finally {
      stoppingRef.current = false;
    }
  }, [send]);

  // Keep latest stopRecording in a ref (used by auto-stop handler)
  useEffect(() => {
    stopRecordingFnRef.current = stopRecording;
  }, [stopRecording]);

  const toggleRecording = useCallback(async () => {
    if (loading) return;
    if (sttStatus === "recording") {
      await stopRecording();
    } else if (sttStatus === "idle") {
      await startRecording();
    }
  }, [loading, sttStatus, startRecording, stopRecording]);

  // Cleanup: stop recording if screen unmounts
  useEffect(() => {
    return () => {
      try {
        if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      } catch {}
      autoStopTimerRef.current = null;
      try {
        if (noMeteringFallbackTimerRef.current) clearTimeout(noMeteringFallbackTimerRef.current);
      } catch {}
      noMeteringFallbackTimerRef.current = null;

      try {
        recordingRef.current?.stopAndUnloadAsync?.();
      } catch {}
      recordingRef.current = null;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>Coach</Text>
            <View style={styles.headerActions}>
              <Pressable
                onPress={async () => {
                  const current = (await AsyncStorage.getItem(AI_BASE_URL_KEY)) || "";
                  const cleaned = current.trim().replace(/\/+$/, "");
                  setAiBaseUrl(cleaned);
                  setAiBaseUrlDraft(cleaned || aiHint.replace("Sugerido (LAN): ", ""));
                  setServerModalOpen(true);
                }}
                style={styles.serverBtn}
              >
                <Text style={styles.serverBtnText}>Servidor</Text>
              </Pressable>

              <Pressable
                onPress={resetChat}
                style={[styles.serverBtn, styles.resetBtn]}
                disabled={loading || sttBusy}
              >
                <Text style={styles.resetBtnText}>Nuevo</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.sub}>
            Modo: {MODE_LABEL[mode]} · Hoy: {mealsSummary.mealsCount} comidas · {mealsSummary.calories}/{targets.calories} kcal
          </Text>

          <Text style={styles.baseLine}>
            AI: {aiBaseUrl ? aiBaseUrl : "Auto (LAN)"}
          </Text>

          {loading ? (
            <View style={styles.thinkingHeaderRow}>
              <ActivityIndicator />
              <Text style={styles.loadingLine}>Pensando{thinkingDots}</Text>
            </View>
          ) : null}
          {planSavedToast ? <Text style={styles.planSavedToast}>{planSavedToast}</Text> : null}
          {sttStatus === "recording" ? (
            <Text style={styles.loadingLine}>Escuchando… (habla y haz pausa para enviar)</Text>
          ) : sttStatus === "transcribing" ? (
            <Text style={styles.loadingLine}>Transcribiendo…</Text>
          ) : null}
        </View>

        <Modal
          visible={serverModalOpen}
          animationType="slide"
          onRequestClose={() => setServerModalOpen(false)}
          transparent
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Servidor AI</Text>
                <Pressable onPress={() => setServerModalOpen(false)} style={styles.modalClose}>
                  <Text style={styles.modalCloseText}>Cerrar</Text>
                </Pressable>
              </View>

              <Text style={styles.modalHint}>{aiHint}</Text>
              <Text style={styles.modalHint2}>Ejemplo: http://192.168.1.243:3000</Text>

              <TextInput
                value={aiBaseUrlDraft}
                onChangeText={setAiBaseUrlDraft}
                placeholder="http://TU_IP:3000"
                placeholderTextColor="rgba(255,255,255,0.55)"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.serverInput}
              />

              <View style={styles.serverActions}>
                <Pressable
                  onPress={async () => {
                    // Save
                    const cleaned = (aiBaseUrlDraft || "").trim().replace(/\/+$/, "");
                    if (cleaned) {
                      await AsyncStorage.setItem(AI_BASE_URL_KEY, cleaned);
                      setAiBaseUrl(cleaned);
                    } else {
                      await AsyncStorage.removeItem(AI_BASE_URL_KEY);
                      setAiBaseUrl("");
                    }
                    setServerModalOpen(false);
                  }}
                  style={styles.serverActionBtn}
                >
                  <Text style={styles.serverActionText}>Guardar</Text>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    // Use auto
                    await AsyncStorage.removeItem(AI_BASE_URL_KEY);
                    setAiBaseUrl("");
                    setAiBaseUrlDraft(aiHint.replace("Sugerido (LAN): ", ""));
                    setServerModalOpen(false);
                  }}
                  style={styles.serverActionBtnGhost}
                >
                  <Text style={styles.serverActionTextGhost}>Auto</Text>
                </Pressable>
              </View>

              <Text style={styles.modalHint2}>
                Tip: tu Android y tu Mac deben estar en la misma red Wi-Fi.
              </Text>
            </View>
          </View>
        </Modal>

        {voiceError ? (
          <View style={styles.voiceErr}>
            <Text style={styles.voiceErrText}>🎙️ {voiceError}</Text>
          </View>
        ) : null}
        {sttError ? (
          <View style={styles.voiceErr}>
            <Text style={styles.voiceErrText}>🎙️ {sttError}</Text>
          </View>
        ) : null}

        <ScrollView
          ref={(r) => (scrollRef.current = r)}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 18 + inputBarHeight + inputBarExtraBottom },
          ]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(_, h) => {
            contentHeightRef.current = h;

            // On first open, always jump to bottom once after layout.
            if (forceScrollOnNextContentSizeRef.current) {
              forceScrollOnNextContentSizeRef.current = false;
              requestAnimationFrame(() => {
                scrollRef.current?.scrollToEnd({ animated: false });
              });
              return;
            }

            // Only auto-scroll if user is near the bottom (prevents fighting manual scrolling)
            if (sttBusy) return;
            const nearBottom = computeIsNearBottom();
            if (stickToBottom && nearBottom) {
              scrollRef.current?.scrollToEnd({ animated: true });
            }
          }}
          onLayout={(e) => {
            layoutHeightRef.current = e.nativeEvent.layout.height;
          }}
          onScroll={(e) => {
            scrollYRef.current = e.nativeEvent.contentOffset.y;
            const nearBottom = computeIsNearBottom();
            // If the user scrolls up, disable auto-stick. If they return to bottom, re-enable.
            if (!nearBottom && stickToBottom) setStickToBottom(false);
            if (nearBottom && !stickToBottom) setStickToBottom(true);
          }}
          scrollEventThrottle={16}
        >
          <View style={styles.checklistCard}>
            {(() => {
              const doneCount = (dailyTasks || []).filter((t) => t.done).length;
              const totalCount = (dailyTasks || []).length || 1;
              const pct = Math.round((doneCount / totalCount) * 100);

              return (
                <>
                  <View style={styles.checklistHeader}>
                    <Text style={styles.checklistTitle}>Checklist de hoy</Text>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Pressable
                        onPress={async () => {
                          const next = !checklistCollapsed;
                          setChecklistCollapsed(next);
                          try {
                            await AsyncStorage.setItem(CHECKLIST_COLLAPSED_KEY, next ? "1" : "0");
                          } catch {}
                        }}
                        style={styles.checklistToggle}
                        disabled={loading || sttBusy}
                      >
                        <Text style={styles.checklistToggleText}>{checklistCollapsed ? "Mostrar" : "Ocultar"}</Text>
                      </Pressable>

                      <Pressable
                        onPress={regenerateTasks}
                        style={styles.checklistReset}
                        disabled={loading || sttBusy}
                      >
                        <Text style={styles.checklistResetText}>Actualizar</Text>
                      </Pressable>
                    </View>
                  </View>

                  <Text style={styles.checklistSub}>
                    {tasksDateKey} · {doneCount}/{(dailyTasks || []).length} completadas · {pct}%
                  </Text>

                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>

                  <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                    <Pressable
                      onPress={() => {
                        const prompt = buildChecklistPlanPrompt();
                        send(prompt);
                        // minimize scrolling: collapse checklist after sending
                        setChecklistCollapsed(true);
                        AsyncStorage.setItem(CHECKLIST_COLLAPSED_KEY, "1").catch(() => {});
                      }}
                      style={styles.planFromChecklistBtn}
                      disabled={loading || sttBusy || (dailyTasks || []).length === 0}
                    >
                      <Text style={styles.planFromChecklistText}>Plan con checklist</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => scrollToBottom(true)}
                      style={styles.jumpToChatBtn}
                      disabled={loading || sttBusy}
                    >
                      <Text style={styles.jumpToChatText}>Ir al chat</Text>
                    </Pressable>
                  </View>

                  {!checklistCollapsed ? (
                    <View style={{ marginTop: 10, gap: 8 }}>
                      {(dailyTasks || []).map((t) => (
                        <Pressable
                          key={t.id}
                          onPress={() => toggleTask(t.id)}
                          style={[styles.taskRow, t.done && styles.taskRowDone]}
                          disabled={loading || sttBusy}
                        >
                          <Text style={[styles.taskCheck, t.done && styles.taskCheckDone]}>{t.done ? "✅" : "☐"}</Text>
                          <Text style={[styles.taskLabel, t.done && styles.taskLabelDone]}>{t.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              );
            })()}
          </View>
          
          <View style={styles.planTodayCard}>
            <View style={styles.planTodayHeader}>
              <Text style={styles.planTodayTitle}>Plan de hoy</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Pressable
                  onPress={async () => {
                    await loadPlanToday();
                    // keep user near chat if they want
                  }}
                  style={[styles.planTodayBtn, planTodayLoading && { opacity: 0.7 }]}
                  disabled={loading || sttBusy || planTodayLoading}
                >
                  <Text style={styles.planTodayBtnText}>{planTodayLoading ? "Cargando…" : "Actualizar"}</Text>
                </Pressable>

                {planToday ? (
                  <Pressable
                    onPress={async () => {
                      try {
                        await AsyncStorage.removeItem(PLAN_TODAY_KEY);
                      } catch {}
                      setPlanToday(null);
                    }}
                    style={styles.planTodayBtnGhost}
                    disabled={loading || sttBusy}
                  >
                    <Text style={styles.planTodayBtnGhostText}>Borrar</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {!planToday ? (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.planTodayEmpty}>Aún no tienes un plan guardado hoy.</Text>
                <Text style={styles.planTodayEmpty2}>
                  Tip: toca “Plan con checklist” arriba, o escribe: “Hazme un plan de hoy con checklist”.
                </Text>
              </View>
            ) : (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.planTodayMeta}>
                  {String(planToday?.date || "")} · Modo: {MODE_LABEL[normalizeMode(planToday?.mode)]}
                </Text>

                <Text style={styles.planTodayHeading}>{String(planToday?.title || "Plan de hoy")}</Text>

                {Array.isArray(planToday?.actions) && planToday.actions.length ? (
                  <View style={{ marginTop: 10, gap: 8 }}>
                    {planToday.actions.slice(0, 10).map((a: any, idx: number) => {
                      const isObj = a && typeof a === "object";
                      const text = isObj ? String(a.text || "") : String(a || "");
                      const done = isObj ? !!a.done : false;
                      if (!text) return null;

                      return (
                        <Pressable
                          key={`plan_today_${idx}`}
                          onPress={() => togglePlanTodayAction(idx)}
                          style={[styles.planTodayRow, done && styles.planTodayRowDone]}
                          disabled={loading || sttBusy}
                        >
                          <Text style={[styles.planTodayCheck, done && styles.planTodayCheckDone]}>{done ? "✅" : "☐"}</Text>
                          <Text style={[styles.planTodayRowText, done && styles.planTodayRowTextDone]}>{text}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {planToday?.meals && typeof planToday.meals === "object" ? (
                  <View style={{ marginTop: 12, gap: 6 }}>
                    {planToday.meals?.desayuno ? (
                      <Text style={styles.planTodayMeal}>🍳 Desayuno: {String(planToday.meals.desayuno)}</Text>
                    ) : null}
                    {planToday.meals?.comida ? (
                      <Text style={styles.planTodayMeal}>🍽️ Comida: {String(planToday.meals.comida)}</Text>
                    ) : null}
                    {planToday.meals?.cena ? (
                      <Text style={styles.planTodayMeal}>🥣 Cena: {String(planToday.meals.cena)}</Text>
                    ) : null}
                    {Array.isArray(planToday.meals?.snacks) && planToday.meals.snacks.length ? (
                      <Text style={styles.planTodayMeal}>
                        🍏 Snacks: {planToday.meals.snacks.slice(0, 4).map((s: any) => String(s)).join(", ")}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {planToday?.notes ? (
                  <Text style={styles.planTodayNotes}>{String(planToday.notes)}</Text>
                ) : null}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  {typeof planToday?.hydration_liters === "number" ? (
                    <Text style={styles.planTodayPill}>💧 {planToday.hydration_liters} L</Text>
                  ) : null}
                  {typeof planToday?.movement_minutes === "number" ? (
                    <Text style={styles.planTodayPill}>🏃 {planToday.movement_minutes} min</Text>
                  ) : null}

                  <Pressable
                    onPress={() => {
                      // Jump to chat area without collapsing user's scroll state too hard
                      scrollToBottom(true);
                    }}
                    style={styles.planTodayJump}
                    disabled={loading || sttBusy}
                  >
                    <Text style={styles.planTodayJumpText}>Ir al chat</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      send("Ajusta mi plan de hoy basado en cómo voy. Hazlo más simple y real para el resto del día.");
                    }}
                    style={styles.planTodayRefine}
                    disabled={loading || sttBusy}
                  >
                    <Text style={styles.planTodayRefineText}>Mejorar plan</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          <View style={styles.quickRow}>
            {quick.map((q) => (
              <Pressable
                key={q.label}
                style={styles.quickBtn}
                onPress={() => send(q.text)}
                disabled={loading || sttBusy}
              >
                <Text style={styles.quickText}>{q.label}</Text>
              </Pressable>
            ))}
          </View>

          {msgs.map((m) => (
            <View
              key={m.id}
              style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.coachBubble]}
            >
              <Text style={[styles.bubbleText, m.role === "user" ? styles.userText : styles.coachText]}>
                {m.text}
              </Text>

              {m.role === "coach" && m.plan && typeof m.plan === "object" ? (
                <View style={styles.planCardInline}>
                  <Text style={styles.planTitleInline}>{String(m.plan?.title || "Plan de hoy")}</Text>

                  {Array.isArray(m.plan?.actions) && m.plan.actions.length ? (
                    <View style={{ marginTop: 8, gap: 6 }}>
                      {m.plan.actions.slice(0, 8).map((a: any, idx: number) => (
                        <View key={`${m.id}_a_${idx}`} style={styles.planActionRow}>
                          <Text style={styles.planActionNum}>{idx + 1}.</Text>
                          <Text style={styles.planActionText}>{String(a)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {m.plan?.meals && typeof m.plan.meals === "object" ? (
                    <View style={{ marginTop: 10, gap: 6 }}>
                      {m.plan.meals?.desayuno ? (
                        <Text style={styles.planMealLine}>🍳 Desayuno: {String(m.plan.meals.desayuno)}</Text>
                      ) : null}
                      {m.plan.meals?.comida ? (
                        <Text style={styles.planMealLine}>🍽️ Comida: {String(m.plan.meals.comida)}</Text>
                      ) : null}
                      {m.plan.meals?.cena ? (
                        <Text style={styles.planMealLine}>🥣 Cena: {String(m.plan.meals.cena)}</Text>
                      ) : null}
                      {Array.isArray(m.plan.meals?.snacks) && m.plan.meals.snacks.length ? (
                        <Text style={styles.planMealLine}>
                          🍏 Snacks: {m.plan.meals.snacks.slice(0, 4).map((s: any) => String(s)).join(", ")}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  <View style={{ marginTop: 10, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                    {typeof m.plan?.hydration_liters === "number" ? (
                      <Text style={styles.planPillInline}>💧 {m.plan.hydration_liters} L</Text>
                    ) : null}
                    {typeof m.plan?.movement_minutes === "number" ? (
                      <Text style={styles.planPillInline}>🏃 {m.plan.movement_minutes} min</Text>
                    ) : null}
                  </View>

                  {m.plan?.notes ? (
                    <Text style={styles.planNotesInline}>{String(m.plan.notes)}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
          {loading ? (
            <View style={[styles.bubble, styles.coachBubble, styles.thinkingBubble, styles.thinkingRow]}>
              <ActivityIndicator />
              <Text style={[styles.bubbleText, styles.coachText, styles.thinkingText]}>{thinkingDots}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: 12 + inputBarExtraBottom }]}>
          <Pressable
            style={[styles.micBtn, { opacity: loading ? 0.6 : 0.55 }]}
            onPress={toggleRecording}
            disabled={loading || sttStatus === "transcribing" || !Audio}
          >
            <Text style={styles.micText}>
              {sttStatus === "recording" ? "⏹️" : !Audio ? "🚫" : "🎙️"}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.speakBtn, !speakEnabled && { opacity: 0.55 }]}
            onPress={() => {
              setSpeakEnabled((v) => {
                const next = !v;
                // If user is muting, stop any ongoing speech immediately
                if (!next) {
                  try {
                    Speech?.stop?.();
                  } catch {}
                }
                // Persist
                AsyncStorage.setItem(TTS_ENABLED_KEY, next ? "1" : "0").catch(() => {});
                return next;
              });
            }}
            disabled={loading}
          >
            <Text style={styles.speakText}>{speakEnabled ? "🔊" : "🔇"}</Text>
          </Pressable>

          <Pressable
            style={[styles.voiceBtn, loading && { opacity: 0.6 }]}
            onPress={() => {
              if (!Speech?.speak) {
                setVoiceError(
                  "🔊 Voz aún no está incluida en este build. Reinstala/reconstruye el dev build para habilitarla."
                );
                return;
              }
              setVoiceModalOpen(true);
            }}
            disabled={loading}
          >
            <Text style={styles.voiceBtnText}>Voz</Text>
          </Pressable>

          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Escribe aquí…"
            style={styles.input}
            editable={!loading && !sttBusy}
            multiline
            blurOnSubmit={false}
            onSubmitEditing={Platform.OS === "web" ? () => send(input) : undefined}
            returnKeyType="send"
          />
          <Pressable
            style={[styles.sendBtn, loading && { opacity: 0.6 }]}
            onPress={() => send(input)}
            disabled={loading || sttBusy}
          >
            <Text style={styles.sendText}>Enviar</Text>
          </Pressable>
        </View>

        <Modal
          visible={voiceModalOpen}
          animationType="slide"
          onRequestClose={() => setVoiceModalOpen(false)}
          transparent
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Voz del Coach</Text>
                <Pressable onPress={() => setVoiceModalOpen(false)} style={styles.modalClose}>
                  <Text style={styles.modalCloseText}>Cerrar</Text>
                </Pressable>
              </View>

              <Text style={styles.modalHint}>
                Selecciona una voz en español (recomendado: Español (México)).
              </Text>

              <View style={styles.controlsRow}>
                <Pressable
                  onPress={async () => {
                    const next = Math.max(0.85, Math.round((ttsRate - 0.05) * 100) / 100);
                    setTtsRate(next);
                    await AsyncStorage.setItem(TTS_RATE_KEY, String(next));
                  }}
                  style={styles.controlBtn}
                >
                  <Text style={styles.controlBtnText}>− Vel</Text>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    const next = Math.min(1.15, Math.round((ttsRate + 0.05) * 100) / 100);
                    setTtsRate(next);
                    await AsyncStorage.setItem(TTS_RATE_KEY, String(next));
                  }}
                  style={styles.controlBtn}
                >
                  <Text style={styles.controlBtnText}>+ Vel</Text>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    const next = Math.max(0.85, Math.round((ttsPitch - 0.05) * 100) / 100);
                    setTtsPitch(next);
                    await AsyncStorage.setItem(TTS_PITCH_KEY, String(next));
                  }}
                  style={styles.controlBtn}
                >
                  <Text style={styles.controlBtnText}>− Tono</Text>
                </Pressable>

                <Pressable
                  onPress={async () => {
                    const next = Math.min(1.15, Math.round((ttsPitch + 0.05) * 100) / 100);
                    setTtsPitch(next);
                    await AsyncStorage.setItem(TTS_PITCH_KEY, String(next));
                  }}
                  style={styles.controlBtn}
                >
                  <Text style={styles.controlBtnText}>+ Tono</Text>
                </Pressable>
              </View>

              <Text style={styles.modalHint2}>
                Velocidad: {ttsRate.toFixed(2)} · Tono: {ttsPitch.toFixed(2)}
              </Text>

              <ScrollView style={styles.voiceList} keyboardShouldPersistTaps="handled">
                {availableVoices.length === 0 ? (
                  <Text style={styles.emptyVoices}>
                    No encontré voces en español. En Android revisa: Configuración → Texto a voz → descarga Español (México).
                  </Text>
                ) : (
                  availableVoices.map((v: any) => {
                    const id = v?.identifier;
                    const selected = !!id && id === ttsVoiceId;
                    const label = `${v?.name || "Voz"} · ${v?.language || "es"}${v?.quality ? ` · ${v.quality}` : ""}`;

                    return (
                      <Pressable
                        key={String(id || label)}
                        onPress={async () => {
                          if (!id) return;
                          setTtsVoiceId(id);
                          await AsyncStorage.setItem(TTS_VOICE_KEY, id);
                          speakNow("Esta es la voz del coach.", id);
                        }}
                        style={[styles.voiceRow, selected && styles.voiceRowSelected]}
                      >
                        <Text style={[styles.voiceLabel, selected && styles.voiceLabelSelected]}>
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // --- Plan de hoy (card fija) ---
  planTodayCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  planTodayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  planTodayTitle: { fontWeight: "900", fontSize: 16, color: "#111" },
  planTodayBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FFE1CC",
    backgroundColor: "#FFF3EA",
    justifyContent: "center",
    alignItems: "center",
  },
  planTodayBtnText: { fontWeight: "900", color: "#B54708" },
  planTodayBtnGhost: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  planTodayBtnGhostText: { fontWeight: "900", color: "#111" },
  planTodayEmpty: { marginTop: 2, color: "#111", fontWeight: "800" },
  planTodayEmpty2: { marginTop: 6, color: "#666" },
  planTodayMeta: { color: "#888", fontSize: 12 },
  planTodayHeading: { marginTop: 6, fontSize: 15, fontWeight: "900", color: "#111" },
  planTodayRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#EEF2F7",
  },
  planTodayRowDone: {
    backgroundColor: "#ECFDF5",
    borderColor: "#BBF7D0",
  },
  planTodayCheck: { width: 22, fontWeight: "900", color: "#111" },
  planTodayCheckDone: { color: "#16A34A" },
  planTodayRowText: { flex: 1, color: "#111", fontWeight: "700" },
  planTodayRowTextDone: { color: "#166534", textDecorationLine: "line-through" },
  planTodayMeal: { color: "#111", fontWeight: "700" },
  planTodayNotes: { marginTop: 10, color: "#374151" },
  planTodayPill: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    fontWeight: "900",
    color: "#111",
  },
  planTodayJump: {
    borderWidth: 1,
    borderColor: "#FFE1CC",
    backgroundColor: "#FFF3EA",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  planTodayJumpText: { fontWeight: "900", color: "#B54708" },
  planTodayRefine: {
    borderWidth: 1,
    borderColor: "#111",
    backgroundColor: "#111",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  planTodayRefineText: { fontWeight: "900", color: "#fff" },
  safe: { flex: 1, backgroundColor: "#fff" },
  wrap: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },
  title: { fontSize: 28, fontWeight: "800" },
  sub: { marginTop: 6, color: "#666" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  serverBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FFE1CC",
    backgroundColor: "#FFF3EA",
    justifyContent: "center",
    alignItems: "center",
  },
  serverBtnText: { fontWeight: "900", color: "#B54708" },
  resetBtn: {
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  resetBtnText: { fontWeight: "900", color: "#111" },
  baseLine: { marginTop: 6, color: "#888", fontSize: 12 },
  loadingLine: { marginTop: 6, color: "#ff7a00", fontWeight: "800" },
  planSavedToast: { marginTop: 6, color: "#16A34A", fontWeight: "900" },
  thinkingHeaderRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },

  voiceErr: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  voiceErrText: { color: "#991B1B", fontWeight: "700" },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingBottom: 18 },

  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  quickBtn: {
    borderWidth: 1,
    borderColor: "#FFE1CC",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#FFF3EA",
  },
  quickText: { fontWeight: "800", color: "#B54708" },

  bubble: { maxWidth: "92%", padding: 12, borderRadius: 14, marginVertical: 6 },
  userBubble: { backgroundColor: "#111", alignSelf: "flex-end" },
  coachBubble: { backgroundColor: "#F5F5F5", alignSelf: "flex-start" },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  userText: { color: "#fff" },
  coachText: { color: "#111" },
  thinkingBubble: { opacity: 0.7 },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  thinkingText: {
    fontWeight: "900",
  },

  inputBar: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    gap: 10,
    backgroundColor: "#fff",
    alignItems: "flex-end",
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FFE1CC",
    backgroundColor: "#FFF3EA",
  },
  micText: { fontSize: 18, fontWeight: "900", color: "#111" },

  speakBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eee",
    backgroundColor: "#fff",
  },
  speakText: { fontSize: 18, fontWeight: "900" },

  voiceBtn: {
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#FFE1CC",
    backgroundColor: "#FFF3EA",
  },
  voiceBtnText: { fontWeight: "900", color: "#B54708" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#101214",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  modalTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  modalClose: { paddingVertical: 6, paddingHorizontal: 8 },
  modalCloseText: { color: "#fff", fontWeight: "800" },
  });
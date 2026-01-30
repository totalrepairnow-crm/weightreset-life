import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

function clampStr(s, max = 1200) {
  const str = typeof s === "string" ? s : "";
  return str.length > max ? str.slice(0, max) : str;
}

function normalizeMode(mode) {
  const m = String(mode || "").toLowerCase();
  if (m.includes("agres")) return "agresiva";
  if (m.includes("mant")) return "mantenimiento";
  return "balance";
}

function briefProfile(p) {
  if (!p || typeof p !== "object") return "";
  const parts = [];
  if (p.nombre) parts.push(`Nombre: ${p.nombre}`);
  if (typeof p.edad === "number") parts.push(`Edad: ${p.edad}`);
  if (p.sexo) parts.push(`Sexo: ${p.sexo}`);
  if (typeof p.altura_cm === "number") parts.push(`Altura: ${p.altura_cm} cm`);
  if (typeof p.peso_kg === "number") parts.push(`Peso: ${p.peso_kg} kg`);
  return parts.join(" · ");
}

function briefNutrition(total, notes) {
  if (!total && !notes) return "";
  const t = total || {};
  const parts = [];
  if (typeof t.calories === "number") parts.push(`${Math.round(t.calories)} kcal`);
  if (typeof t.protein_g === "number") parts.push(`${Math.round(t.protein_g)} g proteína`);
  if (typeof t.carbs_g === "number") parts.push(`${Math.round(t.carbs_g)} g carbohidratos`);
  if (typeof t.fat_g === "number") parts.push(`${Math.round(t.fat_g)} g grasa`);
  const line = parts.length ? `Hoy (aprox): ${parts.join(" · ")}` : "";
  const n = notes ? `Notas: ${clampStr(notes, 240)}` : "";
  return [line, n].filter(Boolean).join("\n");
}

function safeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];

  for (const item of raw.slice(-16)) {
    if (!item || typeof item !== "object") continue;

    // App messages might come as { role: 'user' | 'coach', text: '...' }
    // or already normalized as { role: 'user' | 'assistant', content: '...' }
    const rawRole = item.role;
    const role = rawRole === "coach" ? "assistant" : rawRole;

    const content =
      typeof item.content === "string"
        ? item.content
        : typeof item.text === "string"
          ? item.text
          : "";

    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      out.push({ role, content: clampStr(content, 800) });
    }
  }

  return out;
}

function safeJsonParse(text) {
  try {
    const value = JSON.parse(String(text || ""));
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function stripJsonFences(s) {
  const str = String(s || "").trim();
  // Remove ```json ... ``` or ``` ... ``` wrappers if present
  if (str.startsWith("```")) {
    const lines = str.split("\n");
    // drop first fence line
    lines.shift();
    // drop last fence line if it ends with ```
    if (lines.length && lines[lines.length - 1].trim().startsWith("```")) lines.pop();
    return lines.join("\n").trim();
  }
  return str;
}

function extractFirstJsonObject(text) {
  const cleaned = stripJsonFences(text);

  // 1) Try direct parse first
  const direct = safeJsonParse(cleaned);
  if (direct.ok && direct.value && typeof direct.value === "object") return direct.value;

  // 2) Try to locate a JSON object within the text and parse that
  const s = String(cleaned || "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = s.slice(first, last + 1);
    const parsed = safeJsonParse(candidate);
    if (parsed.ok && parsed.value && typeof parsed.value === "object") return parsed.value;
  }

  return null;
}

function clampNumber(n, min, max, fallback) {
  const x = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, x));
}

function normalizeStringArray(arr, maxItems) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    if (typeof it === "string" && it.trim()) out.push(it.trim());
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeMeals(meals) {
  const m = meals && typeof meals === "object" ? meals : {};
  const desayuno = typeof m.desayuno === "string" ? m.desayuno.trim() : "";
  const comida = typeof m.comida === "string" ? m.comida.trim() : "";
  const cena = typeof m.cena === "string" ? m.cena.trim() : "";
  const snacks = normalizeStringArray(m.snacks, 3);

  return {
    desayuno: desayuno || "Huevos con tortilla de maíz y fruta.",
    comida: comida || "Pollo o pescado con arroz y ensalada.",
    cena: cena || "Sopa/crema de verduras con proteína ligera.",
    snacks: snacks.length ? snacks : ["Yogur natural", "Fruta fresca"],
  };
}

function buildFallbackPlan(mode) {
  const title =
    mode === "agresiva"
      ? "Plan Agresivo para Hoy"
      : mode === "mantenimiento"
        ? "Plan de Mantenimiento para Hoy"
        : "Plan Balanceado para Hoy";

  const actionsBase =
    mode === "agresiva"
      ? [
          "Toma un vaso grande de agua al despertar.",
          "Incluye proteína en cada comida (porción del tamaño de tu palma).",
          "Camina 30–45 min hoy (o 8,000 pasos).",
          "Evita bebidas azucaradas y pan dulce hoy.",
          "Cena temprano y ligero.",
        ]
      : mode === "mantenimiento"
        ? [
            "Hidrátate al despertar (1 vaso grande).",
            "Come con horarios parejos (sin saltarte comidas).",
            "Haz 20–30 min de movimiento + 10 min de fuerza ligera.",
            "Incluye verduras en comida y cena.",
            "Prioriza dormir 7–8 horas.",
          ]
        : [
            "Toma un vaso grande de agua al despertar.",
            "Incluye proteína en cada comida.",
            "Muévete 30 min (caminar, bici o estiramientos).",
            "Elige 1 comida casera hoy.",
            "Desconéctate de pantallas 30 min antes de dormir.",
          ];

  return {
    title,
    actions: actionsBase.slice(0, 6),
    meals: {
      desayuno: "Huevos revueltos con jitomate + tortilla de maíz.",
      comida: "Pollo a la plancha con arroz y ensalada verde.",
      cena: "Sopa de verduras + queso panela o atún.",
      snacks: ["Yogur natural sin azúcar", "Manzana"],
    },
    hydration_liters: mode === "agresiva" ? 2.5 : 2,
    movement_minutes: mode === "agresiva" ? 40 : 30,
    notes: "Realista, simple y sostenible. Ajusta por hambre/saciedad.",
  };
}

function normalizePlan(plan, mode) {
  const p = plan && typeof plan === "object" ? plan : {};

  const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : buildFallbackPlan(mode).title;
  const actions = normalizeStringArray(p.actions, 6);
  const meals = normalizeMeals(p.meals);

  const hydration_liters = clampNumber(p.hydration_liters, 1.0, 3.5, buildFallbackPlan(mode).hydration_liters);
  const movement_minutes = clampNumber(p.movement_minutes, 10, 60, buildFallbackPlan(mode).movement_minutes);
  const notes = typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : buildFallbackPlan(mode).notes;

  return {
    title,
    actions: actions.length ? actions : buildFallbackPlan(mode).actions,
    meals,
    hydration_liters,
    movement_minutes,
    notes,
  };
}

function systemPrompt(locale) {
  const isEs = !locale || String(locale).toLowerCase().startsWith("es");
  if (!isEs) {
    return "You are a friendly, motivating lifestyle coach for weight loss and wellness. Keep replies concise, actionable, and empathetic. Avoid medical claims. Ask at most one question.";
  }

  return `Eres el Coach de WeightReset Life. Hablas español de México, tono cálido, directo y motivador (no regañón).

Reglas:
- NO eres médico. No des diagnósticos ni tratamientos. Si hay síntomas preocupantes, recomienda consultar a un profesional.
- No uses jerga clínica. Enfócate en hábitos, energía, bienestar y consistencia.
- Personaliza usando el nombre SOLO ocasionalmente (inicio o cierre), no en cada mensaje.
- Si NO es la primera interacción, evita saludar de nuevo (sin “hola” repetido) y ve directo a ayudar.
- Respuestas cortas y humanas: 1 párrafo + 3 bullets accionables + 1 pregunta (máximo) para continuar.
- Ajusta la intensidad según el modo:
  • Agresiva: más directa y enfocada a déficit/estructura, pero segura.
  • Balance: flexible, sostenible.
  • Mantenimiento: hábitos y recomposición ligera.
- Si hay data de comida/macros, úsala para dar 1 insight concreto (p. ej. “te falta proteína”).
- Evita repetir la misma respuesta: siempre referencia lo que el usuario preguntó y cambia los bullets según el caso.
- Evita promesas irreales.
- No incluyas emojis.

Formato de salida:
- Texto natural.
- Incluye 3 bullets con acciones.
- Termina con una sola pregunta abierta.`;
}

function detectIntent(message) {
  const t = String(message || "").toLowerCase();
  if (
    t.includes("plan") ||
    t.includes("checklist") ||
    t.includes("plan de hoy") ||
    t.includes("plan con checklist") ||
    t.includes("qué hago") ||
    t.includes("que hago") ||
    t.includes("menu") ||
    t.includes("menú")
  ) {
    return "plan";
  }
  return "general";
}

function modeGuidance(mode) {
  if (mode === "agresiva") {
    return "Modo: Agresiva. Prioriza estructura, porciones claras, proteína alta, pasos diarios. Sugiere acciones concretas hoy.";
  }
  if (mode === "mantenimiento") {
    return "Modo: Mantenimiento. Prioriza consistencia, fuerza ligera, balance y recuperación. Evita déficit agresivo.";
  }
  return "Modo: Balance. Prioriza sostenibilidad, flexibilidad, hábitos simples y consistencia.";
}

function planJsonInstruction() {
  return (
    "Devuelve SOLO JSON válido, sin markdown, sin texto extra. Estructura exacta:\n" +
    "{\n" +
    '  "reply": string,\n' +
    '  "intent": "plan",\n' +
    '  "plan": {\n' +
    '    "title": string,\n' +
    '    "actions": string[],\n' +
    '    "meals": {"desayuno": string, "comida": string, "cena": string, "snacks": string[]},\n' +
    '    "hydration_liters": number,\n' +
    '    "movement_minutes": number,\n' +
    '    "notes": string\n' +
    "  }\n" +
    "}\n" +
    "Reglas: actions máximo 6; snacks máximo 3; hydration_liters entre 1.0 y 3.5; movement_minutes entre 10 y 60. " +
    "Hazlo realista para México (comidas comunes)."
  );
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));

    const message = clampStr(body?.message, 1200);
    const locale = clampStr(body?.locale || "es-MX", 16) || "es-MX";
    const mode = normalizeMode(body?.mode);
    const profile = body?.profile || null;

    const nutritionTotal = body?.nutrition?.total;
    const nutritionNotes = body?.nutrition?.notes;
    const nutritionLine = briefNutrition(nutritionTotal, nutritionNotes);

    const history = safeHistory(body?.history);
    const isFirstTurn = history.length === 0;
    const intent = detectIntent(message);

    if (!message) {
      return NextResponse.json({ ok: false, error: "Falta 'message'." }, { status: 400 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prof = briefProfile(profile);

    const userContextLines = [];
    if (prof) userContextLines.push(prof);
    userContextLines.push(modeGuidance(mode));
    if (nutritionLine) userContextLines.push(nutritionLine);
    userContextLines.push(`Conversación: ${isFirstTurn ? "primera_interacción" : "continuación"}`);
    userContextLines.push(`Intención: ${intent}`);

    const contextBlock = userContextLines.filter(Boolean).join("\n");

    const messages = [{ role: "system", content: systemPrompt(locale) }];

    // Put user context in its own system message so the model can keep it as guidance,
    // while keeping the user's latest message clean.
    if (contextBlock) {
      messages.push({
        role: "system",
        content: `Contexto del usuario (solo para personalizar, no inventes datos):\n${contextBlock}`,
      });
    }

    // Output format depends on intent.
    if (intent === "plan") {
      messages.push({
        role: "system",
        content:
          "Eres un coach de bienestar (no médico). Mantén el tono cálido y práctico. " +
          "Cuando el usuario pide un PLAN/CHECKLIST, debes responder en JSON para que la app lo renderice. " +
          "No uses emojis. No inventes datos.\n\n" +
          planJsonInstruction(),
      });
    } else {
      messages.push({
        role: "system",
        content:
          "Recuerda el formato: 1 párrafo breve + 3 bullets accionables + 1 sola pregunta al final. No emojis. No inventes datos. Responde distinto según la pregunta y el historial.",
      });
    }

    // Recent conversation
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }

    // Latest user message
    messages.push({ role: "user", content: message });

    const baseReq = {
      model: "gpt-4.1-mini",
      messages,
      temperature: intent === "plan" ? 0.6 : 0.8,
      presence_penalty: 0.25,
      frequency_penalty: 0.15,
      max_tokens: intent === "plan" ? 650 : 520,
    };

    // For PLAN intent we try to force JSON output. If the SDK/model doesn't support
    // response_format here, we retry without it.
    let completion;
    if (intent === "plan") {
      try {
        completion = await client.chat.completions.create({
          ...baseReq,
          response_format: { type: "json_object" },
        });
      } catch {
        completion = await client.chat.completions.create(baseReq);
      }
    } else {
      completion = await client.chat.completions.create(baseReq);
    }

    const reply = completion.choices?.[0]?.message?.content?.trim() || "";

    if (intent === "plan") {
      const parsedObj = extractFirstJsonObject(reply);

      // Always return a well-formed plan payload for the app.
      if (parsedObj && typeof parsedObj === "object") {
        const v = parsedObj;
        const outReply = typeof v.reply === "string" && v.reply.trim() ? v.reply.trim() : "Aquí tienes tu plan para hoy.";
        const outPlan = normalizePlan(v.plan, mode);

        return NextResponse.json({
          ok: true,
          data: {
            reply: outReply,
            mode,
            locale,
            intent: "plan",
            plan: outPlan,
          },
        });
      }

      // If model didn't produce valid JSON, fall back deterministically.
      const fallback = buildFallbackPlan(mode);
      return NextResponse.json({
        ok: true,
        data: {
          reply: reply || "Aquí tienes tu plan para hoy.",
          mode,
          locale,
          intent: "plan",
          plan: fallback,
        },
      });
    }

    const safeReply = reply.replace(/[\u{1F300}-\u{1FAFF}]/gu, "");

    return NextResponse.json({
      ok: true,
      data: { reply: safeReply.trim(), mode, locale, intent },
    });
  } catch (err) {
    const msg = typeof err?.message === "string" ? err.message : "Error desconocido";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
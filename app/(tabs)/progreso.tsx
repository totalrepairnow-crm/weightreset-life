import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { router } from 'expo-router';

import { isoDateKey } from '../../constants/date';
import { getAchievementFeed } from '../../lib/achievements';

const COLORS = {
  bg: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  orange: '#FF6A00',
  orangeSoft: '#FFE6D5',
};

const STORAGE_KEY_CHECKED_PREFIX = 'wr_checked_v1_';
const STORAGE_KEY_CHECKIN_PREFIX = 'wr_checkin_v1_';
const STORAGE_KEY_ACTIVE_WEEK = 'wr_active_week_v1';

type ActiveWeek = {
  weekIndex: number;
  title: string;
  focus: string;
  dailyActions: string[];
};

type CheckedState = [boolean, boolean, boolean];

type Checkin = {
  sueno_horas: number; // 0-12
  estres: number; // 1-5
  antojos: number; // 0-3
  movimiento_min: number; // 0-300
  date?: string;
  created_at?: string;
};

type NutritionTotals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type DayRow = {
  dateKey: string;
  checked: CheckedState;
  checkin: Checkin;
  score: number;
  mealsCount?: number;
  nutrition?: NutritionTotals;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNumLoose(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : Number.NaN;
  }
  return Number(v);
}

async function getCheckedForDate(dateKey: string): Promise<CheckedState> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_KEY_CHECKED_PREFIX + dateKey);
  if (!raw) return [false, false, false];
  try {
    const parsed = JSON.parse(raw) as CheckedState;
    if (Array.isArray(parsed) && parsed.length === 3) return parsed as CheckedState;
    return [false, false, false];
  } catch {
    return [false, false, false];
  }
}

async function setCheckedForDate(dateKey: string, checked: CheckedState): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.setItem(STORAGE_KEY_CHECKED_PREFIX + dateKey, JSON.stringify(checked));
}

async function getCheckinForDate(dateKey: string): Promise<Checkin | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_KEY_CHECKIN_PREFIX + dateKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;

    const sueno = toNumLoose(parsed.sueno_horas ?? parsed.sleepHours);
    const estres = toNumLoose(parsed.estres ?? parsed.stress);
    const antojos = toNumLoose(parsed.antojos ?? parsed.cravings);
    const mov = toNumLoose(parsed.movimiento_min ?? parsed.movementMin);

    if ([sueno, estres, antojos, mov].some((v) => Number.isNaN(v))) return null;

    return {
      sueno_horas: clamp(sueno, 0, 12),
      estres: clamp(estres, 1, 5),
      antojos: clamp(antojos, 0, 3),
      movimiento_min: clamp(mov, 0, 300),
      date: parsed.date,
      created_at: parsed.created_at,
    };
  } catch {
    return null;
  }
}

async function getActiveWeek(): Promise<ActiveWeek | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_WEEK);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.dailyActions)) return null;

    return {
      weekIndex: Number(parsed.weekIndex ?? 0),
      title: String(parsed.title ?? ''),
      focus: String(parsed.focus ?? ''),
      dailyActions: parsed.dailyActions.map((x: any) => String(x)).slice(0, 3),
    } as ActiveWeek;
  } catch {
    return null;
  }
}

function safeTotals(t: any): NutritionTotals | null {
  const cal = toNumLoose(t?.calories);
  const p = toNumLoose(t?.protein_g ?? t?.protein);
  const c = toNumLoose(t?.carbs_g ?? t?.carbs);
  const f = toNumLoose(t?.fat_g ?? t?.fat);
  if ([cal, p, c, f].some((x) => Number.isNaN(x))) return null;
  return {
    calories: Math.max(0, cal),
    protein_g: Math.max(0, p),
    carbs_g: Math.max(0, c),
    fat_g: Math.max(0, f),
  };
}

function sumNutritionFromMealLike(meal: any): NutritionTotals | null {
  // Accept shapes: {analysis:{totals}}, {totals}, {data:{total}}, {total}
  const t =
    meal?.analysis?.totals ??
    meal?.analysis?.total ??
    meal?.totals ??
    meal?.total ??
    meal?.data?.total ??
    meal?.data?.totals;
  return safeTotals(t);
}

function addTotals(a: NutritionTotals, b: NutritionTotals): NutritionTotals {
  return {
    calories: a.calories + b.calories,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
  };
}

async function getNutritionForDate(dateKey: string): Promise<{ count: number; totals: NutritionTotals } | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  const tryKeys = [
    `wr_meals_v1_${dateKey}`,
    `wr_meals_${dateKey}`,
    `wr_food_v1_${dateKey}`,
    `wr_comidas_v1_${dateKey}`,
    `wr_comidas_${dateKey}`,
    `wr_meal_entries_${dateKey}`,
  ];

  async function parseRaw(raw: string | null) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      // Accept: array of meals, or {meals:[...]}, or {items:[...]}
      const arr: any[] =
        Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.meals)
            ? parsed.meals
            : Array.isArray(parsed?.items)
              ? parsed.items
              : null;
      if (!arr) return null;

      let count = 0;
      let totals: NutritionTotals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };

      for (const m of arr) {
        const t = sumNutritionFromMealLike(m);
        if (!t) continue;
        totals = addTotals(totals, t);
        count += 1;
      }

      if (!count) return null;
      return { count, totals };
    } catch {
      return null;
    }
  }

  // 1) Try common keys first
  for (const k of tryKeys) {
    const raw = await AsyncStorage.getItem(k);
    const got = await parseRaw(raw);
    if (got) return got;
  }

  // 2) Fallback: scan storage for any key that includes the date and looks meal-related
  try {
    const keys: string[] = await AsyncStorage.getAllKeys();
    const candidates = keys.filter((k) =>
      k.includes(dateKey) && /meal|meals|comida|comidas|food|registro/i.test(k)
    );

    for (const k of candidates) {
      const raw = await AsyncStorage.getItem(k);
      const got = await parseRaw(raw);
      if (got) return got;
    }
  } catch {
    // ignore
  }

  return null;
}

function fmtKcal(n: number) {
  return `${Math.round(n)} kcal`;
}

function fmtMacros(t: NutritionTotals) {
  return `${Math.round(t.protein_g)}P · ${Math.round(t.carbs_g)}C · ${Math.round(t.fat_g)}G`;
}

function computeWellnessScore(checked: CheckedState, checkin: Checkin | null) {
  const base = 45;
  const done = checked.filter(Boolean).length;
  const actionPts = done * 12;

  const sleepPts = checkin ? clamp((checkin.sueno_horas - 5) * 7, 0, 14) : 6;
  const movePts = checkin ? clamp(checkin.movimiento_min / 5, 0, 12) : 6;
  const stressPts = checkin ? clamp((6 - checkin.estres) * 2.5, 0, 10) : 5;
  const cravingsPts = checkin ? clamp((3 - checkin.antojos) * 2.5, 0, 7) : 4;

  return clamp(Math.round(base + actionPts + sleepPts + movePts + stressPts + cravingsPts), 0, 100);
}

function mean(nums: number[]) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmtDate(dateKey: string) {
  const [, m, d] = dateKey.split('-');
  return `${d}/${m}`;
}

function scoreColor(score: number) {
  if (score >= 80) return '#16A34A'; // verde
  if (score >= 60) return '#F59E0B'; // amarillo
  return '#EF4444'; // rojo
}

function monthMatrix(year: number, month: number) {
  // month: 0-11
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];

  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

type InsightTone = 'good' | 'warn' | 'bad';
type RecTarget = 'sleep' | 'move' | 'stress' | 'cravings' | 'none';

type Insight = {
  key: string;
  icon: string;
  title: string;
  text: string;
  ready: boolean;
  tone?: InsightTone;
  recTarget?: RecTarget;
};

function InsightCard({
  insight,
  onMarkAction,
}: {
  insight: Insight;
  onMarkAction?: () => void;
}) {
  const bg =
    insight.tone === 'bad'
      ? '#FEF2F2'
      : insight.tone === 'warn'
        ? '#FFFBEB'
        : insight.tone === 'good'
          ? '#ECFDF5'
          : '#fff';

  const border =
    insight.tone === 'bad'
      ? '#FCA5A5'
      : insight.tone === 'warn'
        ? '#FCD34D'
        : insight.tone === 'good'
          ? '#6EE7B7'
          : COLORS.border;

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: border,
        borderRadius: 16,
        padding: 12,
        backgroundColor: bg,
        marginTop: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 18 }}>{insight.icon}</Text>
        <Text style={{ flex: 1, color: COLORS.text, fontWeight: '900' }}>{insight.title}</Text>
      </View>

      <Text style={{ marginTop: 8, color: insight.ready ? COLORS.text : COLORS.muted, fontWeight: '700' }}>
        {insight.text}
      </Text>

      {!insight.ready ? (
        <Text style={{ marginTop: 6, color: COLORS.muted, fontSize: 12 }}>
          Tip: registra más días variados para activar este insight.
        </Text>
      ) : null}

      {insight.key === 'recommendation' && insight.ready && onMarkAction ? (
        <Pressable
          onPress={onMarkAction}
          style={{
            marginTop: 10,
            paddingVertical: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: '#fff',
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900', color: COLORS.text }}>Marcar 1 acción hoy</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ProgresoScreen() {
  const [days, setDays] = useState<DayRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<DayRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [achUnlocked, setAchUnlocked] = useState<any[]>([]);
  const [achLocked, setAchLocked] = useState<any[]>([]);
  const [activeWeek, setActiveWeek] = useState<ActiveWeek | null>(null);

  const hasData = days.length > 0;

  const todayKey = useMemo(() => isoDateKey(), []);

  const markRecommendedActionDoneToday = useCallback(
    async (target: RecTarget) => {
      const checked = await getCheckedForDate(todayKey);

      // All done
      const firstPending = checked.findIndex((v) => !v);
      if (firstPending === -1) {
        Alert.alert('✅ Listo', 'Ya completaste tus 3 acciones hoy.');
        return;
      }

      // Try to pick the best action index based on the recommendation
      const actions = activeWeek?.dailyActions?.slice(0, 3) ?? [];
      const lcActions = actions.map((a) => a.toLowerCase());

      const KEYWORDS: Record<Exclude<RecTarget, 'none'>, string[]> = {
        sleep: ['sueño', 'dorm', 'sleep', 'descanso', 'acost'],
        move: ['camina', 'walk', 'mov', 'pasos', 'cardio', 'ejerc'],
        stress: ['respir', 'calma', 'medit', 'estres', 'relaj'],
        cravings: ['antojo', 'prote', 'fibra', 'snack', 'dulce'],
      };

      let chosen: number | null = null;
      if (target !== 'none' && actions.length) {
        const keys = KEYWORDS[target as Exclude<RecTarget, 'none'>];
        for (let i = 0; i < lcActions.length; i++) {
          if (checked[i as 0 | 1 | 2]) continue; // already done
          const txt = lcActions[i];
          if (keys.some((k) => txt.includes(k))) {
            chosen = i;
            break;
          }
        }
      }

      const idx = (chosen ?? firstPending) as 0 | 1 | 2;

      const next: CheckedState = [...checked] as CheckedState;
      next[idx] = true;

      await setCheckedForDate(todayKey, next);

      // Update days list (if today exists)
      setDays((prev) =>
        prev.map((r) => {
          if (r.dateKey !== todayKey) return r;
          const nextScore = computeWellnessScore(next, r.checkin);
          return { ...r, checked: next, score: nextScore };
        })
      );

      // If detail modal is open for today, update it too
      setSelectedRow((prev) => {
        if (!prev) return prev;
        if (selectedDateKey !== todayKey) return prev;
        const nextScore = computeWellnessScore(next, prev.checkin);
        return { ...prev, checked: next, score: nextScore };
      });

      const label = actions[idx] ?? `Acción ${idx + 1}`;
      Alert.alert('✅ Acción marcada', `Se marcó: ${label}`);
    },
    [todayKey, selectedDateKey, activeWeek]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);

    const rows: DayRow[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = isoDateKey(d);

      const ci = await getCheckinForDate(key);
      if (!ci) continue;

      const ch = await getCheckedForDate(key);
      const score = computeWellnessScore(ch, ci);

      // Nutrition (from Comidas) for the same day
      let nutrition: NutritionTotals | undefined;
      let mealsCount: number | undefined;
      try {
        const n = await getNutritionForDate(key);
        if (n) {
          nutrition = n.totals;
          mealsCount = n.count;
        }
      } catch {
        // ignore
      }

      rows.push({ dateKey: key, checked: ch, checkin: ci, score, nutrition, mealsCount });
    }

    rows.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    setDays(rows);
    try {
      const feed = await getAchievementFeed();
      setAchUnlocked(feed.unlocked as any);
      setAchLocked(feed.locked as any);
    } catch {
      setAchUnlocked([]);
      setAchLocked([]);
    }
    try {
      const aw = await getActiveWeek();
      setActiveWeek(aw);
    } catch {
      setActiveWeek(null);
    }
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {};
    }, [refresh])
  );

  // ===== Insights inteligentes v2 (siempre 4 tarjetas) =====
  const insights = useMemo(() => {
    if (!days.length) return [] as Insight[];

    const out: Insight[] = [];

    const last7 = days.slice(0, 7);
    const last30 = days.slice(0, 30);

    const avg = (rows: DayRow[], pick: (d: DayRow) => number) => {
      const nums = rows.map(pick).filter((n) => typeof n === 'number' && !Number.isNaN(n));
      return nums.length ? mean(nums) : 0;
    };

    const pctComplete = (rows: DayRow[]) => {
      if (!rows.length) return 0;
      const completed = rows.filter((d) => d.checked.every(Boolean)).length;
      return Math.round((completed / rows.length) * 100);
    };

    // ---- 1) Resumen 7 vs 30 días ----
    const s7 = {
      sleep: avg(last7, (d) => d.checkin.sueno_horas),
      stress: avg(last7, (d) => d.checkin.estres),
      cravings: avg(last7, (d) => d.checkin.antojos),
      move: avg(last7, (d) => d.checkin.movimiento_min),
      score: avg(last7, (d) => d.score),
      complete: pctComplete(last7),
    };

    const s30 = {
      sleep: avg(last30, (d) => d.checkin.sueno_horas),
      stress: avg(last30, (d) => d.checkin.estres),
      cravings: avg(last30, (d) => d.checkin.antojos),
      move: avg(last30, (d) => d.checkin.movimiento_min),
      score: avg(last30, (d) => d.score),
      complete: pctComplete(last30),
    };

    const nAvg = (rows: DayRow[]) => {
      const withN = rows.filter((r) => r.nutrition);
      if (!withN.length) return null;
      const totals = withN.reduce(
        (acc, r) => addTotals(acc, r.nutrition as NutritionTotals),
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
      );
      return {
        days: withN.length,
        calories: totals.calories / withN.length,
        protein_g: totals.protein_g / withN.length,
        carbs_g: totals.carbs_g / withN.length,
        fat_g: totals.fat_g / withN.length,
      };
    };

    const n7 = nAvg(last7);
    const n30 = nAvg(last30);

    out.push({
      key: 'summary_7_30',
      icon: '📊',
      title: 'Promedios (7 vs 30 días)',
      ready: true,
      text:
        `7 días: score ${Math.round(s7.score)} · sueño ${s7.sleep.toFixed(1)}h · estrés ${s7.stress.toFixed(1)} · antojos ${s7.cravings.toFixed(1)} · mov ${Math.round(s7.move)}m · completos ${s7.complete}%` +
        (n7
          ? `\nNutrición (prom): ${fmtKcal(n7.calories)} · ${Math.round(n7.protein_g)}P · ${Math.round(n7.carbs_g)}C · ${Math.round(n7.fat_g)}G (${n7.days} días con comidas)`
          : '') +
        `\n\n30 días: score ${Math.round(s30.score)} · sueño ${s30.sleep.toFixed(1)}h · estrés ${s30.stress.toFixed(1)} · antojos ${s30.cravings.toFixed(1)} · mov ${Math.round(s30.move)}m · completos ${s30.complete}%` +
        (n30
          ? `\nNutrición (prom): ${fmtKcal(n30.calories)} · ${Math.round(n30.protein_g)}P · ${Math.round(n30.carbs_g)}C · ${Math.round(n30.fat_g)}G (${n30.days} días con comidas)`
          : ''),
    });

    // ---- 2) Riesgo de antojos mañana (0-100) ----
    const latest = days[0];
    let risk = 35;

    if (latest.checkin.sueno_horas < 7) risk += 18;
    if (latest.checkin.estres >= 4) risk += 18;
    if (latest.checkin.movimiento_min < 20) risk += 12;
    if (latest.checkin.antojos >= 2) risk += 20;

    // Bonus: si ayer también tuvo antojos altos
    const yesterday = days[1];
    if (yesterday && yesterday.checkin.antojos >= 2) risk += 8;

    risk = clamp(Math.round(risk), 0, 100);

    const riskLabel = risk >= 75 ? 'alto' : risk >= 55 ? 'medio' : 'bajo';

    const tone: InsightTone = risk >= 75 ? 'bad' : risk >= 55 ? 'warn' : 'good';

    out.push({
      key: 'cravings_risk',
      icon: '⚠️',
      title: 'Riesgo de antojos (mañana)',
      ready: true,
      tone,
      text: `Estimación: ${risk}/100 (${riskLabel}). Basado en tu sueño, estrés, movimiento y antojos recientes.`,
    });

    // ---- 3) Recomendación automática (1 acción) ----
    let rec = 'Mantén la consistencia: repite lo que ya te está funcionando.';
    let recTarget: RecTarget = 'none';

    if (latest.checkin.sueno_horas < 7) {
      rec = 'Prioriza dormir +45 min hoy (hora fija + pantalla fuera 30 min antes).';
      recTarget = 'sleep';
    } else if (latest.checkin.movimiento_min < 20) {
      rec = 'Haz 10–15 min de caminata después de comer para bajar antojos y estrés.';
      recTarget = 'move';
    } else if (latest.checkin.estres >= 4) {
      rec = 'Estrés alto: 3 min de respiración (4-4-6) + agua. Luego una caminata corta.';
      recTarget = 'stress';
    } else if (latest.checkin.antojos >= 2) {
      rec = 'Antojos altos: proteína + fibra en la próxima comida (y evita ayunos largos).';
      recTarget = 'cravings';
    }

    out.push({
      key: 'recommendation',
      icon: '🧠',
      title: 'Tu mejor siguiente paso',
      ready: true,
      recTarget,
      text: rec,
    });

    // ---- 4) Patrón principal (Sueño→Estrés o Movimiento→Antojos) ----
    const sleepOk = days.filter((d) => d.checkin.sueno_horas >= 7);
    const sleepLow = days.filter((d) => d.checkin.sueno_horas < 7);

    const moveHi = days.filter((d) => d.checkin.movimiento_min >= 30);
    const moveLo = days.filter((d) => d.checkin.movimiento_min < 30);

    const canSleep = sleepOk.length >= 2 && sleepLow.length >= 2;
    const canMove = moveHi.length >= 2 && moveLo.length >= 2;

    if (canSleep || canMove) {
      const stressOk = canSleep ? mean(sleepOk.map((d) => d.checkin.estres)) : 0;
      const stressLow = canSleep ? mean(sleepLow.map((d) => d.checkin.estres)) : 0;
      const diffStress = canSleep ? stressLow - stressOk : -999;

      const cravingsHi = canMove ? mean(moveHi.map((d) => d.checkin.antojos)) : 0;
      const cravingsLo = canMove ? mean(moveLo.map((d) => d.checkin.antojos)) : 0;
      const diffCravings = canMove ? cravingsLo - cravingsHi : -999;

      if (diffStress >= diffCravings) {
        out.push({
          key: 'pattern_sleep_stress',
          icon: '😴',
          title: 'Patrón: sueño → estrés',
          ready: true,
          text: `Con ≥7h tu estrés baja (${stressOk.toFixed(1)} vs ${stressLow.toFixed(1)}).`,
        });
      } else {
        out.push({
          key: 'pattern_move_cravings',
          icon: '🏃',
          title: 'Patrón: movimiento → antojos',
          ready: true,
          text: `Con ≥30 min tus antojos bajan (${cravingsHi.toFixed(1)} vs ${cravingsLo.toFixed(1)}).`,
        });
      }
    } else {
      out.push({
        key: 'pattern_not_ready',
        icon: '🔎',
        title: 'Patrón principal',
        ready: false,
        text: 'Registra más días variados para detectar patrones (sueño y movimiento).',
      });
    }

    // Siempre 4 tarjetas
    return out.slice(0, 4);
  }, [days]);

  const last7 = useMemo(() => days.slice(0, 7), [days]);

  // ===== Calendario =====
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-11

  const cells = useMemo(() => monthMatrix(year, month), [year, month]);

  const byDate = useMemo(() => {
    const m = new Map<string, DayRow>();
    days.forEach((d) => m.set(d.dateKey, d));
    return m;
  }, [days]);

  const prevMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 0) {
        setYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 11) {
        setYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const openDayDetail = useCallback(
    (dateKey: string, row: DayRow | null) => {
      setSelectedDateKey(dateKey);
      setSelectedRow(row);
      setDetailOpen(true);
    },
    []
  );

  const closeDayDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  const goEditDay = useCallback(() => {
    if (!selectedDateKey) return;
    // Abrir Registrar para esa fecha y volver a Progreso al guardar
    router.push({ pathname: '/(tabs)/registrar', params: { date: selectedDateKey, returnTo: 'progreso' } } as any);
    setDetailOpen(false);
  }, [selectedDateKey]);

  const toggleDetailAction = useCallback(
    async (idx: 0 | 1 | 2) => {
      if (!selectedDateKey || !selectedRow) return;

      const nextChecked: CheckedState = [...selectedRow.checked] as CheckedState;
      nextChecked[idx] = !nextChecked[idx];

      // Persist
      await setCheckedForDate(selectedDateKey, nextChecked);

      // Update selected row + recompute score
      const nextScore = computeWellnessScore(nextChecked, selectedRow.checkin);
      setSelectedRow({ ...selectedRow, checked: nextChecked, score: nextScore });

      // Update list (so Últimos 7 días / calendario reflect immediately)
      setDays((prev) =>
        prev.map((r) => (r.dateKey === selectedDateKey ? { ...r, checked: nextChecked, score: nextScore } : r))
      );
    },
    [selectedDateKey, selectedRow]
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ fontSize: 30, fontWeight: '900', color: COLORS.text }}>Progreso</Text>
          <Text style={{ marginTop: 4, color: COLORS.muted }}>Insights basados en tus check-ins.</Text>
        </View>

        <Pressable
          onPress={refresh}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: '#fff',
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          <Text style={{ fontWeight: '900', color: COLORS.text }}>{refreshing ? '...' : 'Actualizar'}</Text>
        </Pressable>
      </View>

      {/* Insights */}
      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 16, backgroundColor: COLORS.orangeSoft }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.text }}>Tus Insights</Text>

        {!hasData ? (
          <Text style={{ marginTop: 10, color: COLORS.text, fontWeight: '700' }}>
            Aún no hay suficientes datos. Haz tu check-in 3–4 días y vuelve aquí.
          </Text>
        ) : (
          <>
            {insights.map((ins) => (
              <InsightCard
                key={ins.key}
                insight={ins}
                onMarkAction={
                  ins.key === 'recommendation'
                    ? () => markRecommendedActionDoneToday(ins.recTarget ?? 'none')
                    : undefined
                }
              />
            ))}
          </>
        )}
      </View>

      {/* Últimos 7 días */}
      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 16, backgroundColor: '#fff' }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.text }}>Últimos 7 días</Text>
        <Text style={{ marginTop: 4, color: COLORS.muted }}>Puntaje + resumen rápido.</Text>

        {!hasData ? (
          <Text style={{ marginTop: 10, color: COLORS.muted }}>Sin datos aún.</Text>
        ) : (
          <View style={{ marginTop: 10, gap: 10 }}>
            {last7.map((d) => {
              const done = d.checked.filter(Boolean).length;
              return (
                <Pressable
                  key={d.dateKey}
                  onPress={() => openDayDetail(d.dateKey, d)}
                  style={{
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    borderRadius: 14,
                    padding: 12,
                    backgroundColor: '#fff',
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontWeight: '900', color: COLORS.text }}>{fmtDate(d.dateKey)}</Text>
                    <Text style={{ fontWeight: '900', color: COLORS.orange }}>{d.score}</Text>
                  </View>

                  <Text style={{ marginTop: 6, color: COLORS.muted }}>
                    Sueño {d.checkin.sueno_horas}h · Estrés {d.checkin.estres}/5 · Antojos {d.checkin.antojos}/3 · Movimiento{' '}
                    {d.checkin.movimiento_min} min · Acciones {done}/3
                    {d.nutrition ? `\n🍽️ ${d.mealsCount ?? 0} comidas · ${fmtKcal(d.nutrition.calories)} · ${fmtMacros(d.nutrition)}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* Calendario */}
      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 16, backgroundColor: '#fff' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.text }}>Calendario</Text>

          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Pressable onPress={prevMonth}>
              <Text style={{ fontWeight: '900', fontSize: 18 }}>‹</Text>
            </Pressable>

            <Text style={{ color: COLORS.muted, fontWeight: '700' }}>
              {new Date(year, month).toLocaleString('es-MX', { month: 'long', year: 'numeric' })}
            </Text>

            <Pressable onPress={nextMonth}>
              <Text style={{ fontWeight: '900', fontSize: 18 }}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap' }}>
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => (
            <Text
              key={d}
              style={{
                width: '14.285%',
                textAlign: 'center',
                color: COLORS.muted,
                fontWeight: '700',
                marginBottom: 6,
              }}
            >
              {d}
            </Text>
          ))}

          {cells.map((d, idx) => {
            if (!d) return <View key={idx} style={{ width: '14.285%', height: 44 }} />;

            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const row = byDate.get(key);
            const score = row?.score;
            const bg = score != null ? scoreColor(score) : '#E5E7EB';

            return (
              <TouchableOpacity
                key={idx}
                onPress={() => {
                  openDayDetail(key, row ?? null);
                }}
                style={{ width: '14.285%', height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                {(() => {
                  const isToday = key === isoDateKey();
                  const hasScore = score != null;
                  const textColor = hasScore ? '#FFFFFF' : COLORS.text;

                  return (
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderWidth: isToday ? 2 : 0,
                        borderColor: isToday ? COLORS.orange : 'transparent',
                      }}
                    >
                      <Text style={{ fontWeight: '900', color: textColor }}>{d}</Text>
                    </View>
                  );
                })()}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={{ marginTop: 10, color: COLORS.muted, fontSize: 12 }}>
          Tip: si un día está gris, todavía no hay check-in guardado.
        </Text>
      </View>

      <Modal
        visible={detailOpen}
        transparent
        animationType="fade"
        onRequestClose={closeDayDetail}
      >
        <Pressable
          onPress={closeDayDetail}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            padding: 16,
            justifyContent: 'center',
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: '#fff',
              borderRadius: 18,
              borderWidth: 1,
              borderColor: COLORS.border,
              padding: 16,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.text }}>
              {selectedDateKey ? `Detalle ${selectedDateKey}` : 'Detalle'}
            </Text>

            {selectedRow ? (
              <>
                <Text style={{ marginTop: 10, color: COLORS.muted }}>
                  Puntaje: <Text style={{ fontWeight: '900', color: COLORS.orange }}>{selectedRow.score}</Text>
                </Text>
                {selectedRow.nutrition ? (
                  <Text style={{ marginTop: 8, color: COLORS.muted }}>
                    🍽️ Comidas: <Text style={{ fontWeight: '900', color: COLORS.text }}>{selectedRow.mealsCount ?? 0}</Text> ·{' '}
                    <Text style={{ fontWeight: '900', color: COLORS.text }}>{fmtKcal(selectedRow.nutrition.calories)}</Text> ·{' '}
                    <Text style={{ fontWeight: '900', color: COLORS.text }}>{fmtMacros(selectedRow.nutrition)}</Text>
                  </Text>
                ) : null}
                <Text style={{ marginTop: 8, color: COLORS.text, fontWeight: '700' }}>
                  😴 Sueño: {selectedRow.checkin.sueno_horas}h
                </Text>
                <Text style={{ marginTop: 6, color: COLORS.text, fontWeight: '700' }}>
                  😮‍💨 Estrés: {selectedRow.checkin.estres}/5
                </Text>
                <Text style={{ marginTop: 6, color: COLORS.text, fontWeight: '700' }}>
                  🍫 Antojos: {selectedRow.checkin.antojos}/3
                </Text>
                <Text style={{ marginTop: 6, color: COLORS.text, fontWeight: '700' }}>
                  🏃 Movimiento: {selectedRow.checkin.movimiento_min} min
                </Text>
                <View style={{ marginTop: 10 }}>
                  <Text style={{ color: COLORS.text, fontWeight: '900' }}>✅ Acciones</Text>

                  {(
                    activeWeek?.dailyActions?.length ? activeWeek.dailyActions : ['Acción 1', 'Acción 2', 'Acción 3']
                  ).map((label, idx) => {
                    const done = !!selectedRow.checked[idx as 0 | 1 | 2];
                    return (
                      <Pressable
                        key={`${idx}-${label}`}
                        onPress={() => toggleDetailAction(idx as 0 | 1 | 2)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}
                      >
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: done ? COLORS.orange : COLORS.border,
                            backgroundColor: done ? COLORS.orangeSoft : '#fff',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ fontWeight: '900', color: COLORS.text }}>{done ? '✓' : ''}</Text>
                        </View>
                        <Text style={{ flex: 1, color: done ? COLORS.text : COLORS.muted, fontWeight: '700' }}>{label}</Text>
                      </Pressable>
                    );
                  })}

                  <Text style={{ marginTop: 8, color: COLORS.muted }}>
                    {selectedRow.checked.filter(Boolean).length}/3 completadas
                  </Text>
                </View>
              </>
            ) : (
              <Text style={{ marginTop: 10, color: COLORS.muted }}>
                No hay check-in guardado este día.
              </Text>
            )}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={closeDayDetail}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  backgroundColor: '#fff',
                }}
              >
                <Text style={{ textAlign: 'center', fontWeight: '900', color: COLORS.text }}>
                  Cerrar
                </Text>
              </Pressable>

              <Pressable
                onPress={goEditDay}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: COLORS.orange,
                  backgroundColor: COLORS.orange,
                }}
              >
                <Text style={{ textAlign: 'center', fontWeight: '900', color: 'white' }}>
                  {selectedRow ? 'Editar' : 'Crear'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Logros (preview) */}
      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 16, backgroundColor: '#fff' }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.text }}>🏅 Logros</Text>
        <Text style={{ marginTop: 4, color: COLORS.muted }}>Tu progreso hacia los próximos logros.</Text>

        {achUnlocked.length ? (
          <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {achUnlocked.slice(0, 6).map((a: any) => (
              <Pressable
                key={a.id}
                onPress={() => Alert.alert(a.title, `${a.description}${a.unlockedAt ? `\n\nDesbloqueado: ${new Date(a.unlockedAt).toLocaleDateString('es-MX')}` : ''}`)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: COLORS.orangeSoft,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                }}
              >
                <Text style={{ fontWeight: '900', color: COLORS.text }}>{a.title}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={{ marginTop: 10, color: COLORS.muted }}>Aún no hay logros desbloqueados.</Text>
        )}

        {achLocked.length ? (
          <View style={{ marginTop: 14 }}>
            <Text style={{ fontWeight: '900', color: COLORS.text }}>Próximos</Text>
            <Text style={{ marginTop: 4, color: COLORS.muted }}>Lo que te falta para desbloquearlos.</Text>

            <View style={{ marginTop: 10, gap: 10 }}>
              {achLocked.slice(0, 3).map((a: any) => (
                <Pressable
                  key={a.id}
                  onPress={() => Alert.alert(a.title, `${a.description}\n\n${a.progressText}`)}
                  style={{
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    borderRadius: 14,
                    padding: 12,
                    backgroundColor: '#F9FAFB',
                  }}
                >
                  <Text style={{ fontWeight: '900', color: COLORS.text }}>{a.title}</Text>
                  <Text style={{ marginTop: 6, color: COLORS.muted, fontWeight: '700' }}>{a.progressText}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => router.push('/(tabs)/perfil')}
              style={{
                marginTop: 12,
                paddingVertical: 12,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: COLORS.border,
                backgroundColor: '#fff',
              }}
            >
              <Text style={{ textAlign: 'center', fontWeight: '900', color: COLORS.text }}>Ver todos en Perfil</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 16, backgroundColor: '#fff' }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.text }}>Siguiente</Text>
        <Text style={{ marginTop: 8, color: COLORS.muted }}>• Logros (badges) por rachas y hábitos</Text>
      </View>
    </ScrollView>
  );
}
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useRouter } from 'expo-router';

const COLORS = {
  bg: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  orange: '#FF6A00',
  orangeSoft: '#FFE6D5',
};

type WeekPlan = {
  title: string;
  focus: string;
  dailyActions: string[];
  meals: {
    desayunos: string[];
    comidas: string[];
    cenas: string[];
    snacks: string[];
  };
  grocery: string[];
  swaps: string[];
};

const WEEKS: WeekPlan[] = [
  {
    title: 'Semana 1: Reinicio',
    focus: 'Energía + saciedad (sin extremos)',
    dailyActions: [
      'Proteína en el desayuno (huevos / yogurt griego / frijoles)',
      'Verduras en 2 comidas (½ plato)',
      'Caminata 15 min (o 3 x 5 min)',
    ],
    meals: {
      desayunos: [
        'Huevos a la mexicana + 2 tortillas + fruta',
        'Avena con yogurt griego + canela + plátano chico',
        'Mollete integral: frijol + queso moderado + pico de gallo',
      ],
      comidas: [
        'Pollo asado + ensalada grande + arroz (porción)',
        'Tacos de bistec (2–3) + nopales + salsa',
        'Lentejas con verduras + ensalada',
      ],
      cenas: [
        'Quesadillas (2) tortilla maíz + champiñón/espinaca',
        'Ensalada con atún/pollo + aceite medido',
        'Caldo de pollo + verduras + 1–2 tortillas',
      ],
      snacks: ['Jícama/pepino con limón', 'Yogurt griego natural', 'Puño chico de nueces'],
    },
    grocery: [
      'Huevo, pollo, atún, frijoles/lentejas',
      'Tortilla de maíz, avena, arroz, camote/papa',
      'Jícama, pepino, nopales, brócoli/calabacita, ensalada',
      'Yogurt griego natural, queso (moderado)',
      'Aguacate, aceite de oliva, nueces/semillas',
    ],
    swaps: [
      'Tortilla ↔ pan integral ↔ arroz (misma “ranura” de carbo)',
      'Frijoles/lentejas = carb + proteína (súper México)',
      'Agua fresca → sin azúcar (o muy ligera)',
    ],
  },
  {
    title: 'Semana 2: Control de antojos',
    focus: 'Fibra + horario + azúcar bajo control',
    dailyActions: [
      '1 porción de leguminosa (frijol/lenteja) al día',
      'Postre/azúcar: 1 decisión consciente (no automático)',
      'Cafeína antes de las 2 pm',
    ],
    meals: {
      desayunos: [
        'Omelette con verduras + 1–2 tortillas',
        'Chilaquiles “ligeros”: horneados + pollo + crema medida',
        'Avena + canela + fruta',
      ],
      comidas: [
        'Bowl: arroz + pollo + verduras + aguacate (porción)',
        'Pescado a la plancha + ensalada + 1 carb',
        'Tinga de pollo + tostadas horneadas + verduras',
      ],
      cenas: ['Sopa de verduras + proteína', 'Ensalada grande + queso moderado', 'Tacos de pollo (2) + nopales'],
      snacks: ['Manzana/pera', 'Palomitas naturales', 'Yogurt griego'],
    },
    grocery: ['Verduras extra para volumen', 'Frijoles/lentejas', 'Proteína fácil (pollo/atún)', 'Fruta (1–2 al día)'],
    swaps: ['Antojo dulce → fruta + yogurt', 'Pan dulce → avena con canela', 'Refresco → agua mineral con limón'],
  },
  {
    title: 'Semana 3: Fuerza + recomposición',
    focus: 'Más músculo = mejor metabolismo',
    dailyActions: ['2 mini-sesiones de fuerza (10–12 min) en la semana', 'Proteína en 2 comidas', 'Pasos: +1,000 vs tu promedio'],
    meals: {
      desayunos: ['Huevos + frijoles + salsa', 'Yogurt griego + avena + fruta', 'Tacos de huevo con nopal'],
      comidas: ['Carne magra + verduras + 1 carb', 'Pollo + verduras salteadas + arroz', 'Atún + tostadas horneadas + ensalada'],
      cenas: ['Caldo + verduras', 'Ensalada + proteína', 'Quesadillas (2) + verduras'],
      snacks: ['Nueces (porción chica)', 'Jícama/pepino', 'Yogurt griego'],
    },
    grocery: ['Proteínas (pollo, huevo, atún, res magra)', 'Verduras variadas', 'Carbs base (tortilla, arroz, avena)'],
    swaps: ['Si no hay salmón: atún/sardina', 'Si no hay quinoa: arroz integral', 'Si no hay gym: fuerza en casa 10 min'],
  },
  {
    title: 'Semana 4: Consolidación',
    focus: 'Que sea tu estilo de vida',
    dailyActions: ['Planea 2 comidas “seguras” (rápidas y sanas)', '1 salida social: estrategia (sin culpa)', 'Dormir 7+ horas 3 noches'],
    meals: {
      desayunos: ['Omelette + fruta', 'Avena + yogurt', 'Mollete integral moderado'],
      comidas: ['Tacos (2–3) + nopales + agua', 'Pollo asado + ensalada', 'Lentejas + ensalada'],
      cenas: ['Ensalada + proteína', 'Caldo + tortillas', 'Quesadillas + verduras'],
      snacks: ['Fruta', 'Jícama/pepino', 'Yogurt griego'],
    },
    grocery: ['Kit base: huevo, pollo, atún, frijol', 'Verduras para volumen', 'Tortillas/avena/arroz'],
    swaps: ['Restaurante: proteína + verduras primero', 'Alcohol: 1–2 máximo + agua', 'Si te sales: vuelves en la siguiente comida'],
  },
];


const STORAGE_KEY_ACTIVE_WEEK = 'wr_active_week_v1';
const STORAGE_MODE = 'wr_mode_v1';
const STORAGE_TODAY_PLAN = 'wr_plan_today_v1';
const STORAGE_TODAY_PLAN_DONE = 'wr_plan_today_done_v1';

type PlanMode = 'agresiva' | 'balance' | 'mantenimiento';
const MODE_LABEL: Record<PlanMode, string> = {
  agresiva: 'Agresiva',
  balance: 'Balance',
  mantenimiento: 'Mantenimiento',
};

type NutritionTargets = { calories: number; protein_g: number; carbs_g: number; fat_g: number };
const TARGETS_BY_MODE: Record<PlanMode, NutritionTargets> = {
  agresiva: { calories: 1600, protein_g: 140, carbs_g: 140, fat_g: 45 },
  balance: { calories: 1900, protein_g: 130, carbs_g: 190, fat_g: 60 },
  mantenimiento: { calories: 2200, protein_g: 120, carbs_g: 240, fat_g: 70 },
};

const WEEKLY_GOAL_BY_MODE: Record<PlanMode, { title: string; detail: string }> = {
  agresiva: {
    title: '-0.5 a -0.9 kg por semana (agresivo pero realista)',
    detail: 'Clave: proteína alta, verduras, pasos y sueño. Sin extremos.',
  },
  balance: {
    title: '-0.3 a -0.7 kg por semana (sostenible)',
    detail: 'Si bajas menos pero duermes mejor y tienes energía, vas ganando.',
  },
  mantenimiento: {
    title: '0 a -0.2 kg por semana (mantener + recomposición)',
    detail: 'Meta: sentirte con energía y construir hábitos que duren.',
  },
};

function safeMode(v: any): PlanMode {
  return v === 'agresiva' || v === 'mantenimiento' ? v : 'balance';
}

function applyModeToWeek(w: WeekPlan, mode: PlanMode): WeekPlan {
  // Ajustes ligeros: enfoque + 3 acciones diarias por defecto
  const walk = mode === 'agresiva' ? '25 min (o 5 x 5 min)' : mode === 'mantenimiento' ? '30 min (o 3 x 10 min)' : '15 min (o 3 x 5 min)';

  const baseActions = w.dailyActions?.slice(0, 3) ?? [];

  const defaultsByMode: string[] =
    mode === 'agresiva'
      ? ['Proteína en el desayuno (huevos / yogurt griego / frijoles)', 'Verduras en 2 comidas (½ plato)', `Caminata ${walk}`]
      : mode === 'mantenimiento'
      ? ['Verduras en 2 comidas (½ plato)', 'Proteína en 2 comidas', `Movimiento ${walk}`]
      : ['Proteína en el desayuno (huevos / yogurt griego / frijoles)', 'Verduras en 2 comidas (½ plato)', `Caminata ${walk}`];

  const actions = baseActions.length === 3 ? [baseActions[0], baseActions[1], baseActions[2]] : defaultsByMode;

  const focusAddon =
    mode === 'agresiva'
      ? ' · Déficit moderado, proteína alta'
      : mode === 'mantenimiento'
      ? ' · Energía + recomposición'
      : ' · Sostenible';

  return {
    ...w,
    focus: (w.focus || '').replace(/\s+$/g, '') + focusAddon,
    dailyActions: actions,
  };
}

type ActiveWeekPayload = {
  weekIndex: number;
  title: string;
  focus: string;
  dailyActions: string[];
  saved_at?: string;
};

type TodayPlanPayload = {
  date?: string; // YYYY-MM-DD (local)
  mode?: PlanMode;
  title?: string;
  actions?: string[];
  done?: boolean[]; // optional local completion state (legacy/back-compat)
  meals?: {
    desayuno?: string;
    comida?: string;
    cena?: string;
    snacks?: string[];
  };
  notes?: string;
  saved_at?: string; // ISO
};

function todayKeyLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getTodayPlan(): Promise<TodayPlanPayload | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_TODAY_PLAN);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TodayPlanPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function clearTodayPlan() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.removeItem(STORAGE_TODAY_PLAN);
}

type TodayDoneStore = Record<string, boolean[]>;

async function getTodayDone(dateKey: string): Promise<boolean[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_TODAY_PLAN_DONE);
  if (!raw) return null;
  try {
    const store = JSON.parse(raw) as TodayDoneStore;
    const arr = store?.[dateKey];
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function setTodayDone(dateKey: string, done: boolean[]) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_TODAY_PLAN_DONE);
  let store: TodayDoneStore = {};
  try {
    store = raw ? (JSON.parse(raw) as TodayDoneStore) : {};
  } catch {
    store = {};
  }
  store[dateKey] = done;
  await AsyncStorage.setItem(STORAGE_TODAY_PLAN_DONE, JSON.stringify(store));
}

async function clearTodayDone(dateKey: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_TODAY_PLAN_DONE);
  if (!raw) return;
  try {
    const store = JSON.parse(raw) as TodayDoneStore;
    if (store && typeof store === 'object') {
      delete store[dateKey];
      await AsyncStorage.setItem(STORAGE_TODAY_PLAN_DONE, JSON.stringify(store));
    }
  } catch {
    // ignore
  }
}

function formatSavedAt(saved_at?: string) {
  if (!saved_at) return '';
  try {
    const d = new Date(saved_at);
    return d.toLocaleString();
  } catch {
    return '';
  }
}

async function getActiveWeek(): Promise<ActiveWeekPayload | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_WEEK);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ActiveWeekPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.weekIndex !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function setActiveWeek(payload: ActiveWeekPayload) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  await AsyncStorage.setItem(STORAGE_KEY_ACTIVE_WEEK, JSON.stringify(payload));
}

export default function PlanScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<PlanMode>('balance');
  const [weekIndex, setWeekIndex] = useState(0);
  const baseWeek = useMemo(() => WEEKS[weekIndex], [weekIndex]);
  const week = useMemo(() => applyModeToWeek(baseWeek, mode), [baseWeek, mode]);
  const targets = useMemo(() => TARGETS_BY_MODE[mode], [mode]);
  const weeklyGoal = useMemo(() => WEEKLY_GOAL_BY_MODE[mode], [mode]);

  const [activeWeekIndex, setActiveWeekIndex] = useState<number | null>(null);

  // New state for today plan
  const [todayPlan, setTodayPlan] = useState<TodayPlanPayload | null>(null);
  const [todayPlanLoading, setTodayPlanLoading] = useState(false);
  const [todayDone, setTodayDoneState] = useState<boolean[]>([]);
  const [todayDoneSaving, setTodayDoneSaving] = useState(false);

  // Editable fields for the selected week
  const [editTitle, setEditTitle] = useState(week.title);
  const [editFocus, setEditFocus] = useState(week.focus);
  const [editA1, setEditA1] = useState(week.dailyActions[0] ?? '');
  const [editA2, setEditA2] = useState(week.dailyActions[1] ?? '');
  const [editA3, setEditA3] = useState(week.dailyActions[2] ?? '');

  // When weekIndex changes, reset edits to defaults for that week
  const syncEditsFromWeek = useCallback(() => {
    setEditTitle(week.title);
    setEditFocus(week.focus);
    setEditA1(week.dailyActions[0] ?? '');
    setEditA2(week.dailyActions[1] ?? '');
    setEditA3(week.dailyActions[2] ?? '');
  }, [week]);

  const loadActive = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    try {
      const rawMode = await AsyncStorage.getItem(STORAGE_MODE);
      setMode(safeMode(rawMode));
    } catch {
      setMode('balance');
    }

    const aw = await getActiveWeek();
    setActiveWeekIndex(typeof aw?.weekIndex === 'number' ? aw!.weekIndex : null);

    // If there is an active week, default the picker to it (first time)
    if (aw && typeof aw.weekIndex === 'number') {
      setWeekIndex(aw.weekIndex);
      // Load edits from stored active week (so user sees what is actually active)
      setEditTitle(aw.title ?? WEEKS[aw.weekIndex]?.title ?? '');
      setEditFocus(aw.focus ?? WEEKS[aw.weekIndex]?.focus ?? '');
      setEditA1((aw.dailyActions?.[0] ?? WEEKS[aw.weekIndex]?.dailyActions?.[0]) ?? '');
      setEditA2((aw.dailyActions?.[1] ?? WEEKS[aw.weekIndex]?.dailyActions?.[1]) ?? '');
      setEditA3((aw.dailyActions?.[2] ?? WEEKS[aw.weekIndex]?.dailyActions?.[2]) ?? '');
    } else {
      // No active week yet; make sure edits match current selection
      syncEditsFromWeek();
    }

    // Load today's plan
    const tp = await getTodayPlan();
    setTodayPlan(tp);

    const dk = (tp?.date || todayKeyLocal());
    const actionCount = Array.isArray(tp?.actions) ? tp!.actions!.length : 0;
    const savedDone = await getTodayDone(dk);
    if (Array.isArray(savedDone) && savedDone.length === actionCount) {
      setTodayDoneState(savedDone);
    } else if (Array.isArray(tp?.done) && tp!.done!.length === actionCount) {
      // legacy/back-compat if we ever stored it inside the plan object
      setTodayDoneState(tp!.done!);
    } else {
      setTodayDoneState(Array.from({ length: actionCount }, () => false));
    }
  }, [syncEditsFromWeek]);

  useFocusEffect(
    useCallback(() => {
      loadActive();
      return () => {};
    }, [loadActive])
  );

  // Effect to refresh today plan on mode changes
  useEffect(() => {
    (async () => {
      const tp = await getTodayPlan();
      setTodayPlan(tp);

      const dk = (tp?.date || todayKeyLocal());
      const actionCount = Array.isArray(tp?.actions) ? tp!.actions!.length : 0;
      const savedDone = await getTodayDone(dk);
      if (Array.isArray(savedDone) && savedDone.length === actionCount) {
        setTodayDoneState(savedDone);
      } else if (Array.isArray(tp?.done) && tp!.done!.length === actionCount) {
        setTodayDoneState(tp!.done!);
      } else {
        setTodayDoneState(Array.from({ length: actionCount }, () => false));
      }
    })();
  }, [mode]);

  // If user manually changes the picker, reset edits to that week's defaults
  const onChangeWeek = useCallback(
    (next: number) => {
      setWeekIndex(next);
      setActiveWeekIndex((prev) => prev); // no-op, just explicit
      // reset edits to defaults for the newly selected week (ajustado por modo)
      const w = applyModeToWeek(WEEKS[next], mode);
      setEditTitle(w.title);
      setEditFocus(w.focus);
      setEditA1(w.dailyActions[0] ?? '');
      setEditA2(w.dailyActions[1] ?? '');
      setEditA3(w.dailyActions[2] ?? '');
    },
    [mode]
  );

  const isActive = activeWeekIndex === weekIndex;

  const save = useCallback(async () => {
    const actions = [editA1, editA2, editA3].map((s) => (s ?? '').trim()).filter(Boolean);
    if (actions.length !== 3) {
      Alert.alert('Faltan acciones', 'Necesitas 3 acciones (una por línea).');
      return;
    }

    await setActiveWeek({
      weekIndex,
      title: (editTitle ?? '').trim() || week.title,
      focus: (editFocus ?? '').trim() || week.focus,
      dailyActions: actions,
      saved_at: new Date().toISOString(),
    });

    setActiveWeekIndex(weekIndex);
    Alert.alert('Listo ✅', 'Semana activada. Ve a “Hoy” para ver tus 3 acciones.');
  }, [editA1, editA2, editA3, editFocus, editTitle, week.focus, week.title, weekIndex]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 28, fontWeight: '900', color: COLORS.text }}>Plan</Text>
      <Text style={{ color: COLORS.muted }}>
        Un plan realista para México: comida local, porciones y hábitos. Sin castigos.
      </Text>

      {/* Plan de hoy (del coach) card */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.text }}>🤖 Plan de hoy (del coach)</Text>
          <Pressable
            onPress={() => {
              // abre la pestaña Coach para regenerar / ajustar el plan
              try {
                router.push('/(tabs)/coach');
              } catch {
                // fallback: no-op
              }
            }}
            style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' }}
          >
            <Text style={{ fontWeight: '900', color: COLORS.text }}>Abrir coach</Text>
          </Pressable>
        </View>

        {todayPlan ? (
          <View style={{ marginTop: 10 }}>
            <Text style={{ color: COLORS.muted }}>
              {todayPlan.date ? `Fecha: ${todayPlan.date}` : `Fecha: ${todayKeyLocal()}`}
              {todayPlan.mode ? ` · Modo: ${MODE_LABEL[safeMode(todayPlan.mode)]}` : ''}
              {todayPlan.saved_at ? ` · Guardado: ${formatSavedAt(todayPlan.saved_at)}` : ''}
            </Text>

            {todayPlan.title ? (
              <Text style={{ marginTop: 10, fontSize: 16, fontWeight: '900', color: COLORS.text }}>{todayPlan.title}</Text>
            ) : null}

            {Array.isArray(todayPlan.actions) && todayPlan.actions.length ? (
              <View style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <Text style={{ fontWeight: '900', color: COLORS.text }}>Acciones clave</Text>
                  <Text style={{ color: COLORS.muted, fontWeight: '800' }}>
                    {todayDone.filter(Boolean).length}/{todayPlan.actions.length} hechas
                  </Text>
                </View>

                {todayPlan.actions.slice(0, 6).map((a, idx) => {
                  const checked = !!todayDone[idx];
                  return (
                    <Pressable
                      key={`${a}-${idx}`}
                      onPress={async () => {
                        try {
                          const dk = (todayPlan.date || todayKeyLocal());
                          const next = [...todayDone];
                          next[idx] = !next[idx];
                          setTodayDoneState(next);
                          setTodayDoneSaving(true);
                          await setTodayDone(dk, next);
                        } finally {
                          setTodayDoneSaving(false);
                        }
                      }}
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10 }}
                    >
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          borderWidth: 2,
                          borderColor: checked ? COLORS.orange : COLORS.border,
                          backgroundColor: checked ? COLORS.orangeSoft : '#fff',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginTop: 2,
                        }}
                      >
                        <Text style={{ color: checked ? COLORS.orange : COLORS.muted, fontWeight: '900' }}>
                          {checked ? '✓' : ''}
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: COLORS.text,
                          fontWeight: '600',
                          flex: 1,
                          textDecorationLine: checked ? 'line-through' : 'none',
                          opacity: checked ? 0.75 : 1,
                        }}
                      >
                        {a}
                      </Text>
                    </Pressable>
                  );
                })}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable
                    onPress={async () => {
                      const dk = (todayPlan.date || todayKeyLocal());
                      const all = Array.from({ length: todayPlan.actions!.length }, () => true);
                      setTodayDoneState(all);
                      setTodayDoneSaving(true);
                      try {
                        await setTodayDone(dk, all);
                      } finally {
                        setTodayDoneSaving(false);
                      }
                    }}
                    style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' }}
                    disabled={todayDoneSaving}
                  >
                    <Text style={{ color: COLORS.text, fontWeight: '900', textAlign: 'center' }}>
                      {todayDoneSaving ? '...' : 'Marcar todo'}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={async () => {
                      const dk = (todayPlan.date || todayKeyLocal());
                      const none = Array.from({ length: todayPlan.actions!.length }, () => false);
                      setTodayDoneState(none);
                      setTodayDoneSaving(true);
                      try {
                        await setTodayDone(dk, none);
                      } finally {
                        setTodayDoneSaving(false);
                      }
                    }}
                    style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: COLORS.orange }}
                    disabled={todayDoneSaving}
                  >
                    <Text style={{ color: 'white', fontWeight: '900', textAlign: 'center' }}>
                      {todayDoneSaving ? '...' : 'Reiniciar'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Text style={{ marginTop: 10, color: COLORS.muted }}>
                Aún no hay un plan guardado. Entra a Coach y pídele: “Hazme un plan para hoy”.
              </Text>
            )}

            {todayPlan.meals ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontWeight: '900', color: COLORS.text }}>Comidas sugeridas</Text>
                {todayPlan.meals.desayuno ? <Bullet text={`Desayuno: ${todayPlan.meals.desayuno}`} /> : null}
                {todayPlan.meals.comida ? <Bullet text={`Comida: ${todayPlan.meals.comida}`} /> : null}
                {todayPlan.meals.cena ? <Bullet text={`Cena: ${todayPlan.meals.cena}`} /> : null}
                {Array.isArray(todayPlan.meals.snacks) && todayPlan.meals.snacks.length ? (
                  <Bullet text={`Snacks: ${todayPlan.meals.snacks.slice(0, 3).join(' · ')}`} />
                ) : null}
              </View>
            ) : null}

            {todayPlan.notes ? <Text style={{ marginTop: 10, color: COLORS.muted }}>{todayPlan.notes}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                onPress={async () => {
                  setTodayPlanLoading(true);
                  try {
                    const dk = (todayPlan?.date || todayKeyLocal());
                    await clearTodayPlan();
                    await clearTodayDone(dk);
                    setTodayPlan(null);
                    setTodayDoneState([]);
                    Alert.alert('Listo ✅', 'Se limpió el plan de hoy.');
                  } finally {
                    setTodayPlanLoading(false);
                  }
                }}
                style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' }}
                disabled={todayPlanLoading}
              >
                <Text style={{ color: COLORS.text, fontWeight: '900', textAlign: 'center' }}>{todayPlanLoading ? '...' : 'Limpiar'}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  Alert.alert(
                    'Tip',
                    'En Coach, pídele: “Dame un plan para hoy con desayuno, comida, cena y 3 acciones”. Luego vuelve aquí.'
                  );
                }}
                style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: COLORS.orange }}
              >
                <Text style={{ color: 'white', fontWeight: '900', textAlign: 'center' }}>Cómo generarlo</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={{ marginTop: 10, color: COLORS.muted }}>
            Aún no hay un plan guardado. Entra a Coach y pídele: “Hazme un plan para hoy”.
          </Text>
        )}
      </Card>

      <Card>
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.text }}>🎯 Modo actual</Text>
        <Text style={{ marginTop: 6, color: COLORS.muted }}>
          {MODE_LABEL[mode]} · Objetivo diario: <Text style={{ fontWeight: '900', color: COLORS.text }}>{targets.calories} kcal</Text> ·{' '}
          <Text style={{ fontWeight: '900', color: COLORS.text }}>{targets.protein_g}g proteína</Text>
        </Text>
        <Text style={{ marginTop: 6, color: COLORS.muted }}>
          Nota: cambia el modo en <Text style={{ fontWeight: '900', color: COLORS.text }}>Perfil</Text> cuando quieras.
        </Text>
      </Card>

      <Card style={{ backgroundColor: COLORS.orangeSoft, borderColor: COLORS.orangeSoft }}>
        <Text style={{ color: COLORS.text, fontWeight: '800' }}>Tu meta semanal</Text>
        <Text style={{ marginTop: 8, color: COLORS.text, fontWeight: '700' }}>{weeklyGoal.title}</Text>
        <Text style={{ marginTop: 6, color: COLORS.muted }}>{weeklyGoal.detail}</Text>
      </Card>

      <WeekPicker value={weekIndex} onChange={onChangeWeek} activeIndex={activeWeekIndex} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.text }}>{week.title}</Text>
          {isActive ? (
            <View style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: COLORS.orangeSoft, borderWidth: 1, borderColor: COLORS.orange }}>
              <Text style={{ fontWeight: '900', color: COLORS.text }}>Activa</Text>
            </View>
          ) : null}
        </View>

        <Text style={{ marginTop: 10, fontWeight: '900', color: COLORS.text }}>Título (editable)</Text>
        <Input value={editTitle} onChangeText={setEditTitle} placeholder={week.title} />

        <Text style={{ marginTop: 10, fontWeight: '900', color: COLORS.text }}>Enfoque (editable)</Text>
        <Input value={editFocus} onChangeText={setEditFocus} placeholder={week.focus} />

        <Text style={{ marginTop: 14, fontWeight: '900', color: COLORS.text }}>Acciones diarias (3) (editable)</Text>
        <Input value={editA1} onChangeText={setEditA1} placeholder={week.dailyActions[0]} multiline />
        <Input value={editA2} onChangeText={setEditA2} placeholder={week.dailyActions[1]} multiline />
        <Input value={editA3} onChangeText={setEditA3} placeholder={week.dailyActions[2]} multiline />

        <Pressable onPress={save} style={{ marginTop: 14, backgroundColor: COLORS.orange, padding: 14, borderRadius: 14 }}>
          <Text style={{ color: 'white', fontWeight: '900', textAlign: 'center' }}>Guardar y activar semana</Text>
        </Pressable>

        <Pressable
          onPress={syncEditsFromWeek}
          style={{ marginTop: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' }}
        >
          <Text style={{ color: COLORS.text, fontWeight: '900', textAlign: 'center' }}>Restaurar texto por defecto</Text>
        </Pressable>
      </Card>

      <Card>
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.text }}>Menú guía (elige 1 por sección)</Text>
        <Section title="Desayunos" items={week.meals.desayunos} />
        <Section title="Comidas" items={week.meals.comidas} />
        <Section title="Cenas" items={week.meals.cenas} />
        <Section title="Snacks (si hace falta)" items={week.meals.snacks} />
        <Text style={{ marginTop: 10, color: COLORS.muted }}>Tip: regla del plato: ½ verduras, ¼ proteína, ¼ carbo.</Text>
        <Text style={{ marginTop: 6, color: COLORS.muted }}>
          Porciones por modo: {mode === 'agresiva' ? 'carbo porción chica (1 tortilla o ½ taza arroz)' : mode === 'mantenimiento' ? 'carbo normal (2 tortillas o 1 taza arroz) si tienes actividad' : 'carbo moderado (1–2 tortillas o ¾ taza arroz)' }.
        </Text>
      </Card>

      <Card>
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.text }}>Lista del súper</Text>
        {week.grocery.map((t) => (
          <Bullet key={t} text={t} />
        ))}
      </Card>

      <Card>
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.text }}>Intercambios inteligentes</Text>
        {week.swaps.map((t) => (
          <Bullet key={t} text={t} />
        ))}
      </Card>

      <Text style={{ color: COLORS.muted }}>Objetivo: sentirte ligero, fuerte y con energía para disfrutar tu vida.</Text>
    </ScrollView>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return (
    <View
      style={[
        { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 16 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function Input({
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      multiline={multiline}
      style={{
        marginTop: 8,
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 12,
        color: COLORS.text,
        backgroundColor: '#fff',
      }}
    />
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
      <Text style={{ color: COLORS.orange, fontWeight: '900' }}>•</Text>
      <Text style={{ color: COLORS.text, fontWeight: '600', flex: 1 }}>{text}</Text>
    </View>
  );
}

function WeekPicker({
  value,
  onChange,
  activeIndex,
}: {
  value: number;
  onChange: (next: number) => void;
  activeIndex: number | null;
}) {
  const labels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {labels.map((label, i) => {
        const active = i === value;
        const isStoredActive = activeIndex === i;
        return (
          <Pressable
            key={label}
            onPress={() => onChange(i)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? COLORS.orange : COLORS.border,
              backgroundColor: active ? COLORS.orangeSoft : '#fff',
              opacity: isStoredActive ? 1 : 1,
            }}
          >
            <Text style={{ color: COLORS.text, fontWeight: '800' }}>
              {label}{isStoredActive ? ' ✓' : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontWeight: '900', color: COLORS.text }}>{title}</Text>
      {items.map((t) => (
        <Bullet key={title + t} text={t} />
      ))}
    </View>
  );
}
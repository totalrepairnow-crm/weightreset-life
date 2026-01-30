import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWRTheme } from '../../theme/theme';

import { isoDateKey } from '../../constants/date';


const STORAGE_KEY_ACTIVE_WEEK = 'wr_active_week_v1';
const STORAGE_KEY_CHECKED_PREFIX = 'wr_checked_v1_';
const STORAGE_KEY_CHECKIN_PREFIX = 'wr_checkin_v1_'; // legacy (sleep/stress/cravings/movement)
const STORAGE_KEY_MOOD_PREFIX = 'wr_mood_v1_'; // new: energy/valence (How We Feel style)
const STORAGE_MODE = 'wr_mode_v1';

type PlanMode = 'agresiva' | 'balance' | 'mantenimiento';
const MODE_LABEL: Record<PlanMode, string> = {
  agresiva: 'Agresiva',
  balance: 'Balance',
  mantenimiento: 'Mantenimiento',
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

const DEFAULT_ACTIONS_BY_MODE: Record<PlanMode, string[]> = {
  agresiva: ['Proteína en el desayuno', 'Caminata 25 min', 'Agua 2 L (mínimo)'],
  balance: ['Proteína en el desayuno', 'Caminata 15 min', 'Cafeína antes de las 2 pm'],
  mantenimiento: ['Verduras en 2 comidas', 'Movimiento 30 min', 'Dormir 7–8 h'],
};

function safeMode(v: any): PlanMode {
  return v === 'agresiva' || v === 'mantenimiento' ? v : 'balance';
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function hexToRgba(hex: string, alpha: number) {
  const h = (hex || '').trim();
  if (!h.startsWith('#')) return `rgba(255,255,255,${alpha})`;
  const clean = h.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return `rgba(255,255,255,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

function isLightHex(hex: string) {
  const h = (hex || '').trim();
  if (!h.startsWith('#')) return false;
  const clean = h.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return false;
  // Relative luminance (sufficient for choosing text color)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62;
}

type ActiveWeek = {
  weekIndex: number;
  title: string;
  focus: string;
  dailyActions: string[];
};

type CheckedState = [boolean, boolean, boolean];

type Checkin = {
  date?: string;
  sueno_horas: number; // 0-12
  estres: number; // 1-5
  antojos: number; // 0-3
  movimiento_min: number; // 0-300
  created_at?: string;
};

type MoodEnergy = 'high' | 'low';
type MoodValence = 'pleasant' | 'unpleasant';

type MoodCheckin = {
  date?: string;
  energy: MoodEnergy;
  valence: MoodValence;
  created_at?: string;
  ts?: number;
};

type MealAnalysisTotals = {
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
};

type MealsSummary = {
  mealsCount: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

const STORAGE_KEY_MEALS_CANDIDATES = [
  'wr_meals_v1',
  'wr_meals_log_v1',
  'wr_food_log_v1',
  'wr_food_entries_v1',
  'wr_comidas_v1',
  'wr_meals_by_date_v1',
  'wr_day_meals_v1',
  'wr_nutrition_log_v1',
  'wr_nutrition_by_day_v1',
];

function toNumber(v: any): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }
  return Number(v) || 0;
}

function inferMealDateKey(m: any): string | null {
  if (!m) return null;
  if (typeof m.dateKey === 'string' && m.dateKey.length >= 10) return m.dateKey.slice(0, 10);
  if (typeof m.date === 'string' && m.date.length >= 10) return m.date.slice(0, 10);
  if (typeof m.created_at === 'string' && m.created_at.length >= 10) return m.created_at.slice(0, 10);
  if (typeof m.ts === 'number') return isoDateKey(new Date(m.ts));
  return null;
}

function extractTotals(m: any): MealAnalysisTotals {
  const a = m?.analysis ?? m;
  const t = a?.totals ?? a?.total ?? {};
  return {
    calories: toNumber(t.calories),
    protein_g: toNumber(t.protein_g),
    carbs_g: toNumber(t.carbs_g),
    fat_g: toNumber(t.fat_g),
  };
}

async function getMealsSummaryForDate(dateKey: string): Promise<MealsSummary> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  const parseItemsFromRaw = (raw: string): any[] => {
    try {
      const parsed = JSON.parse(raw);
      const out: any[] = [];
      const seen = new WeakSet<object>();

      const pushIfEntryLike = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        const hasNutritionShape =
          !!obj.analysis ||
          !!obj.totals ||
          !!obj.total ||
          typeof obj.calories !== 'undefined' ||
          typeof obj.protein_g !== 'undefined' ||
          typeof obj.carbs_g !== 'undefined' ||
          typeof obj.fat_g !== 'undefined';

        if (!hasNutritionShape) return;
        const dk = inferMealDateKey(obj);
        if (!dk) return;
        out.push(obj);
      };

      const walk = (node: any) => {
        if (!node) return;
        if (Array.isArray(node)) {
          for (const item of node) {
            if (item && typeof item === 'object') {
              pushIfEntryLike(item);
              out.push(item);
              walk(item);
            }
          }
          return;
        }

        if (typeof node !== 'object') return;
        if (seen.has(node)) return;
        seen.add(node);

        const n: any = node;
        if (Array.isArray(n.items)) out.push(...n.items);
        if (Array.isArray(n.meals)) out.push(...n.meals);
        if (Array.isArray(n.log)) out.push(...n.log);
        if (Array.isArray(n.entries)) out.push(...n.entries);

        pushIfEntryLike(n);

        for (const v of Object.values(n)) {
          walk(v);
        }
      };

      walk(parsed);
      return out.filter((x) => x && typeof x === 'object');
    } catch {
      return [];
    }
  };

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
      const allKeys: string[] = await AsyncStorage.getAllKeys();
      const likely = allKeys.filter((k) =>
        k.startsWith('wr_') && /meal|meals|comida|food|registro|nutrition|nutri|macro|kcal/i.test(k)
      );

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

  const todayMeals = items
    .filter((m) => inferMealDateKey(m) === dateKey)
    .filter((m, idx, arr) => {
      const id = typeof (m as any)?.id === 'string' ? (m as any).id : '';
      if (id) return arr.findIndex((x: any) => x?.id === id) === idx;
      const sig = JSON.stringify({
        created_at: (m as any)?.created_at,
        dateKey: (m as any)?.dateKey,
        totals: extractTotals(m),
      });
      return (
        arr.findIndex((x: any) => {
          const xs = JSON.stringify({
            created_at: x?.created_at,
            dateKey: x?.dateKey,
            totals: extractTotals(x),
          });
          return xs === sig;
        }) === idx
      );
    });

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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function getActiveWeek(): Promise<ActiveWeek | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_WEEK);
  return raw ? (JSON.parse(raw) as ActiveWeek) : null;
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

    const toNumLoose = (v: any): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const m = v.match(/-?\d+(?:\.\d+)?/);
        return m ? Number(m[0]) : Number.NaN;
      }
      return Number(v);
    };

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

async function getMoodCheckinForDate(dateKey: string): Promise<MoodCheckin | null> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const raw = await AsyncStorage.getItem(STORAGE_KEY_MOOD_PREFIX + dateKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || typeof parsed !== 'object') return null;

    const energy = parsed.energy as MoodEnergy;
    const valence = parsed.valence as MoodValence;
    const isEnergyOk = energy === 'high' || energy === 'low';
    const isValenceOk = valence === 'pleasant' || valence === 'unpleasant';
    if (!isEnergyOk || !isValenceOk) return null;

    return {
      date: parsed.date ?? dateKey,
      energy,
      valence,
      created_at: parsed.created_at,
      ts: typeof parsed.ts === 'number' ? parsed.ts : undefined,
    };
  } catch {
    return null;
  }
}

async function setMoodCheckinForDate(dateKey: string, mood: MoodCheckin): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const payload = {
    ...mood,
    date: mood.date ?? dateKey,
    ts: mood.ts ?? Date.now(),
    created_at: mood.created_at ?? new Date().toISOString(),
  };
  await AsyncStorage.setItem(STORAGE_KEY_MOOD_PREFIX + dateKey, JSON.stringify(payload));
}

async function computeStreak(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  let streak = 0;

  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = isoDateKey(d);

    const checkedRaw = await AsyncStorage.getItem(STORAGE_KEY_CHECKED_PREFIX + dateKey);
    if (!checkedRaw) break;

    let doneAll = false;
    try {
      const arr = JSON.parse(checkedRaw) as CheckedState;
      doneAll = Array.isArray(arr) && arr.length === 3 && arr.every(Boolean);
    } catch {
      doneAll = false;
    }

    if (!doneAll) break;

    const checkinRaw = await AsyncStorage.getItem(STORAGE_KEY_CHECKIN_PREFIX + dateKey);
    if (!checkinRaw) break;

    streak += 1;
  }

  return streak;
}

async function computeCheckinStreak(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  let streak = 0;

  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = isoDateKey(d);

    const checkinRaw = await AsyncStorage.getItem(STORAGE_KEY_CHECKIN_PREFIX + dateKey);
    const moodRaw = await AsyncStorage.getItem(STORAGE_KEY_MOOD_PREFIX + dateKey);
    if (!checkinRaw && !moodRaw) break;

    streak += 1;
  }

  return streak;
}

function inferFocusText(weekFocus: string | undefined, checkin: Checkin | null) {
  if (!checkin) return weekFocus ?? 'Sueño + Consistencia';

  const lowSleep = checkin.sueno_horas < 7;
  const highStress = checkin.estres >= 4;
  const highCravings = checkin.antojos >= 2;
  const lowMovement = checkin.movimiento_min < 20;

  if (lowSleep && highStress) return 'Sueño + Estrés (prioridad)';
  if (lowSleep) return 'Sueño + Recuperación';
  if (highStress) return 'Estrés + Calma';
  if (highCravings) return 'Antojos + Control (sin castigo)';
  if (lowMovement) return 'Movimiento + Energía';
  return weekFocus ?? 'Consistencia';
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

const CARD_SHADOW = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  android: {
    elevation: 10,
  },
  default: {},
});

const DEFAULT_RADIUS = { xs: 10, sm: 14, md: 18, lg: 22, xl: 28 };
const DEFAULT_SPACING = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 };
const DEFAULT_COLORS = {
  bg: '#0B0F14',
  surface: '#0F141C',
  card: '#121826',
  text: '#FFFFFF',
  muted: '#9CA3AF',
  border: '#1F2937',
  primary: '#E7C66B',
  accent2: '#22C55E',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
};

export default function HoyScreen() {
  const ctx = useWRTheme();
  const theme = ctx?.theme;

  // Theme tokens (defensive defaults so we never crash even if theme is temporarily undefined)
  const radius = theme?.radius ?? DEFAULT_RADIUS;
  const spacing = theme?.spacing ?? DEFAULT_SPACING;
  const colors = theme?.colors ?? DEFAULT_COLORS;

  const { width: windowWidth } = useWindowDimensions();

  const insets = useSafeAreaInsets();

  // Floating tab bar overlaps content on Android (esp. Z Fold when folded).
  // Add bottom padding so cards/buttons are never hidden behind it.
  // IMPORTANT: keep this predictable; over-padding makes folded layout look like it has "less room".
  const contentBottomPadding = useMemo(() => {
    // Tab bar height in app/(tabs)/_layout.tsx is 64, plus vertical padding and shadow.
    // Use a conservative value so we don't waste space.
    const tabBarVisualHeight = 64;
    const extraChrome = 18; // shadow/offset + small breathing room
    const safe = insets?.bottom ?? 0;
    return spacing.lg + tabBarVisualHeight + extraChrome + safe;
  }, [spacing.lg, insets?.bottom]);

  // Real container width (Z Fold can report a larger screen width than the visible pane when folded).
  // Use the onLayout width of the mood container as the source of truth when available.
  const [moodContainerWidth, setMoodContainerWidth] = useState(0);
  const didLogWidthsRef = React.useRef(false);
  const layoutWidth = moodContainerWidth > 0 ? moodContainerWidth : windowWidth;

  // When folded, the "usable" width is smaller than what Android sometimes reports.
  // Clamp compact layout width so the grid stays 2x2 and doesn't drift.
  const effectiveWidth = useMemo(() => {
    if (layoutWidth <= 0) return windowWidth;

    // Z Fold (and some Android devices) can report a larger width than the visible pane when folded.
    // We treat "compact" as anything under ~600dp and clamp the usable width a bit tighter so
    // the 2x2 grid doesn't drift toward oversized cards.
    const isProbablyFoldedPane = layoutWidth < 600;

    if (isProbablyFoldedPane) {
      // Keep within a realistic folded inner-pane range.
      // If the reported width is larger (sometimes ~700-800), clamp it.
      const clamped = Math.min(layoutWidth, 500);
      // Also protect against unrealistically small values.
      return Math.max(clamped, 320);
    }

    // Not folded/compact: use layout width directly.
    return layoutWidth;
  }, [layoutWidth, windowWidth]);

  // Treat unfold (Z Fold expanded) as >= 600dp; folded pane is clamped below that.
  const isExpanded = effectiveWidth >= 600;
  const contentMaxWidth = isExpanded ? 1200 : 9999;

  // Mood grid (foldables):
  // - Compact/folded: force 2 columns and keep cards from becoming huge.
  // - Expanded: 2 columns, and 3 only on very wide screens.
  const MOOD_GRID_GAP = spacing.sm;

  const moodGridColumns = useMemo(() => {
    // Folded/compact: keep the selector as 2x2.
    // Expanded: allow 3 columns when there is enough real container width.
    if (effectiveWidth >= 900) return 3;
    return 2;
  }, [effectiveWidth]);

  const moodCardWidth = useMemo(() => {
    // Use the real measured container width when available.
    // Expanded: fill the whole available row with 3 columns.
    // Compact: stable 2 columns without overflow.

    const containerPadding = spacing.md * 2;
    const maxContainer = Math.min(effectiveWidth, contentMaxWidth);
    const available = Math.max(0, maxContainer - containerPadding);

    const cols = moodGridColumns;
    const gaps = MOOD_GRID_GAP * (cols - 1);
    let raw = Math.floor((available - gaps) / cols);

    if (!isExpanded) {
      // Compact/folded: always 2 columns and prevent oversized cards.
      const maxBySpace = Math.floor((available - MOOD_GRID_GAP) / 2);
      const maxCompact = Math.min(190, maxBySpace);
      const minCompact = 140;

      raw = clamp(raw, minCompact, maxCompact);

      // Hard guarantee: if rounding still overflows, shrink until it fits.
      while (raw * 2 + MOOD_GRID_GAP > available && raw > minCompact) {
        raw -= 1;
      }

      return raw;
    }

    // Expanded: ensure the cards are not too small, but never exceed what fits.
    const minW = 180;
    const maxBySpace = Math.floor((available - gaps) / cols);
    const maxW = Math.max(minW, maxBySpace);
    return clamp(raw, minW, maxW);
  }, [effectiveWidth, contentMaxWidth, moodGridColumns, MOOD_GRID_GAP, spacing.md, isExpanded]);

  const moodGridWidth = useMemo(() => {
    // Expanded: let the grid occupy the full available row width.
    // Compact: keep the exact 2-column width for a centered 2x2 selector.
    if (isExpanded) {
      const containerPadding = spacing.md * 2;
      const maxContainer = Math.min(effectiveWidth, contentMaxWidth);
      const available = Math.max(0, maxContainer - containerPadding);
      return available;
    }

    const gaps = MOOD_GRID_GAP * (moodGridColumns - 1);
    return moodGridColumns * moodCardWidth + gaps;
  }, [isExpanded, effectiveWidth, contentMaxWidth, spacing.md, moodCardWidth, moodGridColumns, MOOD_GRID_GAP]);

  // DEBUG (one-time): log widths to diagnose Z Fold folded/expanded layout.
  if (!didLogWidthsRef.current && moodContainerWidth > 0) {
    didLogWidthsRef.current = true;
    console.log('[WR][MOOD WIDTHS]', {
      windowWidth,
      moodContainerWidth,
      layoutWidth,
      effectiveWidth,
      moodCardWidth,
      moodGridWidth,
    });
  }

  const q = {
    highUnpleasant: colors.danger,
    highPleasant: colors.warning,
    lowUnpleasant: '#7B61FF',
    lowPleasant: colors.success,
  } as const;
  const [activeWeek, setActiveWeekState] = useState<ActiveWeek | null>(null);
  const [checked, setChecked] = useState<CheckedState>([false, false, false]);
  const [streakDays, setStreakDays] = useState(0);
  const [checkinStreakDays, setCheckinStreakDays] = useState(0);
  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [mood, setMood] = useState<MoodCheckin | null>(null);
  const [moodSelected, setMoodSelected] = useState<{ energy: MoodEnergy; valence: MoodValence } | null>(null);

  const [mode, setMode] = useState<PlanMode>('balance');
  const [showDetails, setShowDetails] = useState(false);

  const [mealsSummary, setMealsSummary] = useState<MealsSummary>({
    mealsCount: 0,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
  });

  const todayKey = useMemo(() => isoDateKey(), []);

  const refresh = useCallback(async () => {
    const aw = await getActiveWeek();
    setActiveWeekState(aw);

    const saved = await getCheckedForDate(todayKey);
    setChecked(saved);

    const ci = await getCheckinForDate(todayKey);
    setCheckin(ci);

    const mc = await getMoodCheckinForDate(todayKey);
    setMood(mc);
    setMoodSelected(mc ? { energy: mc.energy, valence: mc.valence } : null);

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      const rawMode = await AsyncStorage.getItem(STORAGE_MODE);
      setMode(safeMode(rawMode));
    } catch {
      setMode('balance');
    }

    const ms = await getMealsSummaryForDate(todayKey);
    setMealsSummary(ms);

    const s = await computeStreak();
    setStreakDays(s);

    const cs = await computeCheckinStreak();
    setCheckinStreakDays(cs);
  }, [todayKey]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {};
    }, [refresh])
  );

  const focusText = useMemo(() => inferFocusText(activeWeek?.focus, checkin), [activeWeek, checkin]);

  const actions = useMemo(() => {
    if (activeWeek?.dailyActions?.length) return activeWeek.dailyActions.slice(0, 3);
    return DEFAULT_ACTIONS_BY_MODE[mode];
  }, [activeWeek, mode]);

  const score = useMemo(() => computeWellnessScore(checked, checkin), [checked, checkin]);
  const targets = useMemo(() => TARGETS_BY_MODE[mode], [mode]);

  const moodSubtitle = useMemo(() => {
    const s = moodSelected ?? (mood ? { energy: mood.energy, valence: mood.valence } : null);
    if (!s) return 'Toca un círculo para empezar';
    if (s.energy === 'high' && s.valence === 'pleasant') return 'Alta energía · agradable';
    if (s.energy === 'high' && s.valence === 'unpleasant') return 'Alta energía · desagradable';
    if (s.energy === 'low' && s.valence === 'pleasant') return 'Baja energía · agradable';
    return 'Baja energía · desagradable';
  }, [moodSelected, mood]);

  const progress = useMemo(() => {
    const cal = mealsSummary.calories;
    const p = mealsSummary.protein_g;
    const c = mealsSummary.carbs_g;
    const f = mealsSummary.fat_g;

    return {
      calories: { done: cal, target: targets.calories, pct: clamp01(targets.calories ? cal / targets.calories : 0) },
      protein: { done: p, target: targets.protein_g, pct: clamp01(targets.protein_g ? p / targets.protein_g : 0) },
      carbs: { done: c, target: targets.carbs_g, pct: clamp01(targets.carbs_g ? c / targets.carbs_g : 0) },
      fat: { done: f, target: targets.fat_g, pct: clamp01(targets.fat_g ? f / targets.fat_g : 0) },
    };
  }, [mealsSummary, targets]);

  const goRegistrar = useCallback((focus?: 'sueno' | 'estres' | 'antojos' | 'movimiento') => {
    router.push({ pathname: '/(tabs)/registrar', params: focus ? { focus } : {} });
  }, []);

  const goComidas = useCallback(() => {
    router.push('/(tabs)/comidas');
  }, []);

  const Card = ({ title, subtitle, right, children }: { title?: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) => (
    <View
      style={[
        {
          width: '100%',
          alignSelf: 'stretch',
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.md,
        },
        CARD_SHADOW,
      ]}
    >
      {(title || subtitle || right) ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            {title ? <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>{title}</Text> : null}
            {subtitle ? <Text style={{ marginTop: 6, color: colors.muted, fontWeight: '700' }}>{subtitle}</Text> : null}
          </View>
          {right ? <View>{right}</View> : null}
        </View>
      ) : null}
      <View style={{ marginTop: (title || subtitle || right) ? spacing.md : 0 }}>{children}</View>
    </View>
  );

  const Chip = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text style={{ fontWeight: '900', color: colors.text }}>{label}</Text>
    </Pressable>
  );

  const Button = ({
    label,
    onPress,
    variant = 'primary',
  }: {
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary';
  }) => {
    const isSecondary = variant === 'secondary';
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor: isSecondary ? colors.surface : colors.primary,
          borderWidth: 1,
          borderColor: isSecondary ? colors.border : 'transparent',
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <Text style={{ color: isSecondary ? colors.text : (isLightHex(colors.primary) ? '#111111' : '#FFFFFF'), fontWeight: '900', textAlign: 'center' }}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        width: '100%',
        maxWidth: contentMaxWidth,
        alignSelf: 'center',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.lg,
        paddingBottom: contentBottomPadding,
        gap: spacing.md,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 34, fontWeight: '900', color: colors.text, letterSpacing: 0.2 }}>Hoy</Text>
          <Text style={{ marginTop: 4, color: colors.muted, fontWeight: '600' }}>
            Tu plan para sentirte ligero, fuerte y con energía.
          </Text>
        </View>

        <Pressable
          onPress={() => setShowDetails((v) => !v)}
          style={({ pressed }) => ({
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: showDetails ? colors.primary : colors.surface,
            borderWidth: 1,
            borderColor: showDetails ? 'transparent' : colors.border,
            alignSelf: 'flex-start',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text
            style={{
              fontWeight: '900',
              color: showDetails ? (isLightHex(colors.primary) ? '#111111' : '#FFFFFF') : colors.text,
            }}
          >
            {showDetails ? 'Menos' : 'Detalles'}
          </Text>
        </Pressable>
      </View>

      {/* Actions row */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 6, flexWrap: isExpanded ? 'wrap' : 'nowrap' }}>
        <Button label="Registrar" onPress={() => goRegistrar()} />
        <Button label="Comidas" onPress={goComidas} variant="secondary" />
      </View>

      {/* Mood check-in */}
      <Card title="¿Cómo te sientes ahora?" subtitle={moodSubtitle}>
        <View
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            setMoodContainerWidth((prev) => (prev === w ? prev : w));
          }}
          style={{ marginTop: 2, width: '100%', alignSelf: 'stretch' }}
        >
          {(() => {
            const items = [
              { label: 'Alta energía · Desagradable', energy: 'high' as const, valence: 'unpleasant' as const, color: q.highUnpleasant },
              { label: 'Alta energía · Agradable', energy: 'high' as const, valence: 'pleasant' as const, color: q.highPleasant },
              { label: 'Baja energía · Desagradable', energy: 'low' as const, valence: 'unpleasant' as const, color: q.lowUnpleasant },
              { label: 'Baja energía · Agradable', energy: 'low' as const, valence: 'pleasant' as const, color: q.lowPleasant },
            ];

            // Build rows deterministically: [0,1], [2,3] for 2 cols; for 3+ cols, slice accordingly.
            const rows: typeof items[] = [];
            for (let i = 0; i < items.length; i += moodGridColumns) {
              rows.push(items.slice(i, i + moodGridColumns));
            }

            return (
              <View style={{ width: '100%', alignItems: 'center' }}>
                <View style={{ width: moodGridWidth, gap: MOOD_GRID_GAP, alignSelf: isExpanded ? 'stretch' : 'center' }}>
                {rows.map((row, rowIdx) => {
                  const colsInRow = row.length;

                  return (
                    <View
                      key={`mood-row-${rowIdx}`}
                      style={{
                        flexDirection: 'row',
                        gap: MOOD_GRID_GAP,
                        justifyContent: 'space-between',
                      }}
                    >
                      {row.map((item) => {
                        const isSelected =
                          (moodSelected?.energy ?? mood?.energy) === item.energy &&
                          (moodSelected?.valence ?? mood?.valence) === item.valence;

                        return (
                          <Pressable
                            key={item.label}
                            onPress={() => setMoodSelected({ energy: item.energy, valence: item.valence })}
                            style={{
                              width: moodCardWidth,
                              borderRadius: radius.md,
                              padding: spacing.md,
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: isSelected ? hexToRgba(colors.text, 0.25) : colors.border,
                              alignItems: 'center',
                            }}
                          >
                            <View
                              style={{
                                width: Math.min(92, Math.max(68, Math.floor(moodCardWidth * 0.45))),
                                height: Math.min(92, Math.max(68, Math.floor(moodCardWidth * 0.45))),
                                borderRadius: 999,
                                backgroundColor: item.color,
                                opacity: 0.95,
                              }}
                            />
                            <Text
                              numberOfLines={3}
                              style={{
                                marginTop: spacing.md,
                                color: colors.text,
                                fontWeight: '900',
                                textAlign: 'center',
                                maxWidth: '100%',
                            
                                lineHeight: 19,
                                fontSize: 14,
                              }}
                            >
                              {item.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
                </View>
              </View>
            );
          })()}
        </View>

        <Pressable
          disabled={!moodSelected}
          onPress={async () => {
            if (!moodSelected) return;
            await setMoodCheckinForDate(todayKey, {
              energy: moodSelected.energy,
              valence: moodSelected.valence,
              date: todayKey,
            });
            const mc = await getMoodCheckinForDate(todayKey);
            setMood(mc);
            const cs = await computeCheckinStreak();
            setCheckinStreakDays(cs);
          }}
          style={{
            marginTop: spacing.md,
            backgroundColor: colors.primary,
            paddingVertical: 14,
            paddingHorizontal: 16,
            borderRadius: 999,
            opacity: moodSelected ? 1 : 0.45,
          }}
        >
          <Text style={{ color: isLightHex(colors.primary) ? '#111111' : '#FFFFFF', fontWeight: '900', textAlign: 'center' }}>
            {mood ? 'Actualizar check-in' : 'Guardar check-in'}
          </Text>
        </Pressable>

        <Text style={{ marginTop: spacing.sm, color: hexToRgba(colors.text, 0.55), fontWeight: '700' }}>
          Esto ayuda al Coach a ajustar tu plan según energía/estrés.
        </Text>
      </Card>

      {/* Today summary */}
      <Card
        title="Tu día en 10 segundos"
        subtitle={`Enfoque: ${focusText}`}
        right={<Text style={{ fontSize: 44, fontWeight: '900', color: colors.primary, lineHeight: 48 }}>{score}</Text>}
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: isExpanded ? 'wrap' : 'nowrap' }}>
          {[
            { value: MODE_LABEL[mode], label: 'Modo' },
            { value: String(streakDays), label: 'Racha' },
            { value: String(checkinStreakDays), label: 'Check-in' },
          ].map((p) => (
            <View
              key={p.label}
              style={{
                flex: 1,
                minWidth: isExpanded ? 200 : 0,
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderRadius: radius.md,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontWeight: '900', color: colors.text, fontSize: 16 }}>{p.value}</Text>
              <Text style={{ marginTop: 4, color: colors.muted, fontWeight: '700', fontSize: 12 }}>{p.label}</Text>
            </View>
          ))}
        </View>

        {showDetails ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={{ color: colors.muted, fontWeight: '600' }}>No es perfección. Es volver a sentirte tú.</Text>
            <View style={{ marginTop: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label={`Sueño: ${checkin ? `${Math.round(checkin.sueno_horas)} h` : '—'}`} onPress={() => goRegistrar('sueno')} />
              <Chip label={`Estrés: ${checkin ? `${checkin.estres}/5` : '—'}`} onPress={() => goRegistrar('estres')} />
              <Chip label={`Antojos: ${checkin ? `${checkin.antojos}/3` : '—'}`} onPress={() => goRegistrar('antojos')} />
              <Chip label={`Movimiento: ${checkin ? `${checkin.movimiento_min} min` : '—'}`} onPress={() => goRegistrar('movimiento')} />
            </View>
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontWeight: '600' }}>Tip: toca “Detalles” para ver sueño/estrés/antojos.</Text>
        )}
      </Card>

      {/* Nutrition */}
      <Card
        title="Nutrición de hoy"
        subtitle={`Comidas: ${mealsSummary.mealsCount}`}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>{mealsSummary.calories}</Text>
            <Text style={{ color: colors.muted, fontWeight: '700' }}>/ {targets.calories} kcal</Text>
          </View>
        }
      >
        <View style={{ gap: 10 }}>
          {[
            {
              label: 'Calorías',
              done: mealsSummary.calories,
              target: targets.calories,
              pct: progress.calories.pct,
              suffix: '',
            },
            {
              label: 'Proteína',
              done: mealsSummary.protein_g,
              target: targets.protein_g,
              pct: progress.protein.pct,
              suffix: ' g',
            },
          ].map((row) => (
            <View key={row.label}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.muted, fontWeight: '700' }}>{row.label}</Text>
                <Text style={{ fontWeight: '900', color: colors.text }}>
                  {row.done}/{row.target}
                  {row.suffix}
                </Text>
              </View>
              <View style={{
                marginTop: 6,
                height: 10,
                borderRadius: 999,
                backgroundColor: colors.surface,
                overflow: 'hidden',
              }}>
                <View style={{
                  height: '100%',
                  backgroundColor: colors.primary,
                  width: `${Math.round(row.pct * 100)}%`,
                }} />
              </View>
            </View>
          ))}

          {showDetails ? (
            [
              {
                label: 'Carbs',
                done: mealsSummary.carbs_g,
                target: targets.carbs_g,
                pct: progress.carbs.pct,
                suffix: ' g',
              },
              {
                label: 'Grasa',
                done: mealsSummary.fat_g,
                target: targets.fat_g,
                pct: progress.fat.pct,
                suffix: ' g',
              },
            ].map((row) => (
              <View key={row.label}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.muted, fontWeight: '700' }}>{row.label}</Text>
                  <Text style={{ fontWeight: '900', color: colors.text }}>
                    {row.done}/{row.target}
                    {row.suffix}
                  </Text>
                </View>
                <View style={{
                  marginTop: 6,
                  height: 10,
                  borderRadius: 999,
                  backgroundColor: colors.surface,
                  overflow: 'hidden',
                }}>
                  <View style={{
                    height: '100%',
                    backgroundColor: colors.primary,
                    width: `${Math.round(row.pct * 100)}%`,
                  }} />
                </View>
              </View>
            ))
          ) : null}
        </View>

        <Text style={{ color: colors.muted, fontWeight: '600', marginTop: 10 }}>
          Siguiente paso:{' '}
          {mealsSummary.protein_g < targets.protein_g ? (
            <Text style={{ fontWeight: '900', color: colors.text }}>sube proteína</Text>
          ) : (
            <Text style={{ fontWeight: '900', color: colors.text }}>mantén consistencia</Text>
          )}{' '}
          (ej: huevos, pollo, atún, yogurt griego).
        </Text>

        <View style={{ marginTop: 12 }}>
          <Button label="Ver / Agregar comidas" onPress={goComidas} />
        </View>
      </Card>

      {/* Plan */}
      <Card title="Plan de hoy" subtitle={`3 acciones (fecha: ${todayKey})`}>
        <View style={{ gap: 10 }}>
          {actions.map((t, i) => {
            const isOn = !!checked[i];
            return (
              <Pressable
                key={t}
                onPress={async () => {
                  setChecked((prev) => {
                    const next: CheckedState = [...prev] as CheckedState;
                    next[i] = !next[i];
                    setCheckedForDate(todayKey, next);
                    return next;
                  });

                  const s = await computeStreak();
                  setStreakDays(s);
                }}
                style={({ pressed }) => ({
                  borderWidth: 1,
                  borderColor: isOn ? colors.primary : colors.border,
                  backgroundColor: isOn ? hexToRgba(colors.primary, 0.18) : colors.surface,
                  borderRadius: radius.md,
                  padding: spacing.sm,
                  opacity: pressed ? 0.92 : 1,
                })}
              >
                <Text style={{ color: colors.text, fontWeight: '800' }}>
                  {isOn ? '✅ ' : '☐ '}
                  {t}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: 12 }}>
          <Button label="Marcar progreso" onPress={() => goRegistrar()} />
        </View>

        {showDetails ? (
          <Text style={{ marginTop: 10, color: hexToRgba(colors.text, 0.55), fontWeight: '700' }}>Meta: tener energía para jugar, correr, viajar y disfrutar.</Text>
        ) : null}
      </Card>

      <View style={{ height: 8 }} />
    </ScrollView>
  );
}
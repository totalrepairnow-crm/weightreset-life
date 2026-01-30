import AsyncStorage from '@react-native-async-storage/async-storage';
import { ACHIEVEMENTS, AchievementId, UnlockedAchievement } from '../constants/achievements';
import { isoDateKey } from '../constants/date';

const KEY_ACH = 'wr_achievements_v1';
const STORAGE_KEY_CHECKIN_PREFIX = 'wr_checkin_v1_';
const STORAGE_KEY_CHECKED_PREFIX = 'wr_checked_v1_';

const MAX_LOOKBACK_DAYS = 365;

type CheckedState = [boolean, boolean, boolean];

export type AchievementStatus = {
  id: AchievementId;
  title: string;
  description: string;
  unlockedAt?: string;
  unlocked: boolean;
  progress: number; // 0..goal
  goal: number;
  progressText: string;
};

type EvalCtx = {
  todayKey: string;
  totalCheckins: number;
  currentStreak: number;
  checkinsLast7: number;
  perfectDays: number;
  sleep7Streak: number;
  move30Last7: number;
  lowCravingsLast7: number;
};

type GoalDef = {
  id: AchievementId;
  goal: number;
  compute: (ctx: EvalCtx) => number;
  progressText: (p: number, goal: number) => string;
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

function parseDateKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const d = new Date(key);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function hasCheckin(dateKey: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_CHECKIN_PREFIX + dateKey);
  return !!raw;
}

async function getCheckin(dateKey: string): Promise<any | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_CHECKIN_PREFIX + dateKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function getChecked(dateKey: string): Promise<CheckedState> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_CHECKED_PREFIX + dateKey);
  if (!raw) return [false, false, false];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 3) return parsed as CheckedState;
    return [false, false, false];
  } catch {
    return [false, false, false];
  }
}

export async function getAchievements(): Promise<UnlockedAchievement[]> {
  const raw = await AsyncStorage.getItem(KEY_ACH);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as UnlockedAchievement[];
  } catch {
    return [];
  }
}

async function saveAchievements(list: UnlockedAchievement[]) {
  await AsyncStorage.setItem(KEY_ACH, JSON.stringify(list));
}

export async function unlockAchievement(id: AchievementId): Promise<UnlockedAchievement | null> {
  const current = await getAchievements();
  if (current.some((a) => a.id === id)) return null;

  const meta = ACHIEVEMENTS[id];
  const unlocked: UnlockedAchievement = {
    id,
    title: meta.title,
    description: meta.description,
    unlockedAt: new Date().toISOString(),
  };

  const next = [unlocked, ...current];
  await saveAchievements(next);
  return unlocked;
}

async function computeCheckinStreakFromToday(todayKey: string): Promise<number> {
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const key = isoDateKey(d);
    const ok = await hasCheckin(key);
    if (!ok) break;
    streak += 1;
  }
  return streak;
}

async function countCheckinsLastDays(todayKey: string, days: number): Promise<number> {
  let count = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const key = isoDateKey(d);
    if (await hasCheckin(key)) count += 1;
  }
  return count;
}

export async function evaluateAchievementsAfterSave(dateKey?: string): Promise<UnlockedAchievement[]> {
  const todayKey = dateKey ?? isoDateKey();
  const newlyUnlocked: UnlockedAchievement[] = [];

  // 1) Primer check-in
  const first = await unlockAchievement('first_checkin');
  if (first) newlyUnlocked.push(first);

  // 2) Rachas por check-in
  const streak = await computeCheckinStreakFromToday(todayKey);

  if (streak >= 3) {
    const a = await unlockAchievement('streak_3');
    if (a) newlyUnlocked.push(a);
  }
  if (streak >= 7) {
    const a = await unlockAchievement('streak_7');
    if (a) newlyUnlocked.push(a);
  }

  // 3) Día completo: check-in + 3/3 acciones
  const checked = await getChecked(todayKey);
  const doneAll = checked.every(Boolean);
  if (doneAll) {
    const a = await unlockAchievement('perfect_day');
    if (a) newlyUnlocked.push(a);
  }

  // 4) Semana activa: 5+ check-ins en 7 días
  const last7 = await countCheckinsLastDays(todayKey, 7);
  if (last7 >= 5) {
    const a = await unlockAchievement('active_week');
    if (a) newlyUnlocked.push(a);
  }

  // 5) Sueño sólido: >=7h por 3 días seguidos
  let sleep7Streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const dk = isoDateKey(d);
    const ci = await getCheckin(dk);
    if (!ci) break;
    const sueno = Number(ci.sueno_horas ?? ci.sleepHours);
    if (Number.isNaN(sueno) || sueno < 7) break;
    sleep7Streak += 1;
  }
  if (sleep7Streak >= 3) {
    const a = await unlockAchievement('sleep_streak_3');
    if (a) newlyUnlocked.push(a);
  }

  // 6) Semana en movimiento: >=30 min en 5 días (últimos 7)
  let move30Last7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const dk = isoDateKey(d);
    const ci = await getCheckin(dk);
    if (!ci) continue;
    const mov = Number(ci.movimiento_min ?? ci.movementMin);
    if (!Number.isNaN(mov) && mov >= 30) move30Last7 += 1;
  }
  if (move30Last7 >= 5) {
    const a = await unlockAchievement('move30_week');
    if (a) newlyUnlocked.push(a);
  }

  // 7) Control de antojos: antojos <=1 en 5 días (últimos 7)
  let lowCravingsLast7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const dk = isoDateKey(d);
    const ci = await getCheckin(dk);
    if (!ci) continue;
    const anto = Number(ci.antojos ?? ci.cravings);
    if (!Number.isNaN(anto) && anto <= 1) lowCravingsLast7 += 1;
  }
  if (lowCravingsLast7 >= 5) {
    const a = await unlockAchievement('low_cravings_week');
    if (a) newlyUnlocked.push(a);
  }

  return newlyUnlocked;
}

async function getAllStorageKeysSafe(): Promise<string[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return Array.isArray(keys) ? keys : [];
  } catch {
    return [];
  }
}

async function buildContext(todayKey: string): Promise<EvalCtx> {
  const keys = await getAllStorageKeysSafe();
  const keySet = new Set(keys);

  const checkinDateKeys = keys
    .filter((k) => k.startsWith(STORAGE_KEY_CHECKIN_PREFIX))
    .map((k) => k.slice(STORAGE_KEY_CHECKIN_PREFIX.length))
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));

  const todayDate = parseDateKey(todayKey) ?? new Date();
  const recentCheckins = checkinDateKeys.filter((dk) => {
    const d = parseDateKey(dk);
    if (!d) return false;
    const diffDays = Math.floor((todayDate.getTime() - d.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= MAX_LOOKBACK_DAYS;
  });

  const totalCheckins = recentCheckins.length;

  // Current streak (ending todayKey)
  let currentStreak = 0;
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const dk = isoDateKey(d);
    if (!keySet.has(STORAGE_KEY_CHECKIN_PREFIX + dk)) break;
    currentStreak += 1;
  }

  // Checkins last 7 days
  let checkinsLast7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const dk = isoDateKey(d);
    if (keySet.has(STORAGE_KEY_CHECKIN_PREFIX + dk)) checkinsLast7 += 1;
  }

  // Perfect days across recent check-ins
  let perfectDays = 0;
  for (const dk of recentCheckins) {
    const checked = await getChecked(dk);
    if (checked.every(Boolean)) perfectDays += 1;
  }

  // Sleep streak (>=7h) ending todayKey
  let sleep7Streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const dk = isoDateKey(d);
    const ci = await getCheckin(dk);
    if (!ci) break;

    const sueno = Number(ci.sueno_horas ?? ci.sleepHours);
    if (Number.isNaN(sueno) || sueno < 7) break;

    sleep7Streak += 1;
  }

  // Last 7 days: move>=30 and cravings<=1
  let move30Last7 = 0;
  let lowCravingsLast7 = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - i);
    const dk = isoDateKey(d);
    const ci = await getCheckin(dk);
    if (!ci) continue;

    const mov = Number(ci.movimiento_min ?? ci.movementMin);
    const anto = Number(ci.antojos ?? ci.cravings);

    if (!Number.isNaN(mov) && mov >= 30) move30Last7 += 1;
    if (!Number.isNaN(anto) && anto <= 1) lowCravingsLast7 += 1;
  }

  return {
    todayKey,
    totalCheckins,
    currentStreak,
    checkinsLast7,
    perfectDays,
    sleep7Streak,
    move30Last7,
    lowCravingsLast7,
  };
}

const GOALS: GoalDef[] = [
  {
    id: 'first_checkin',
    goal: 1,
    compute: (c) => c.totalCheckins,
    progressText: (p, g) => `Check-ins: ${Math.min(p, g)}/${g}`,
  },
  {
    id: 'streak_3',
    goal: 3,
    compute: (c) => c.currentStreak,
    progressText: (p, g) => `Racha: ${Math.min(p, g)}/${g} días`,
  },
  {
    id: 'streak_7',
    goal: 7,
    compute: (c) => c.currentStreak,
    progressText: (p, g) => `Racha: ${Math.min(p, g)}/${g} días`,
  },
  {
    id: 'perfect_day',
    goal: 1,
    compute: (c) => c.perfectDays,
    progressText: (p, g) => `Días completos: ${Math.min(p, g)}/${g}`,
  },
  {
    id: 'active_week',
    goal: 5,
    compute: (c) => c.checkinsLast7,
    progressText: (p, g) => `Últimos 7 días: ${Math.min(p, g)}/${g}`,
  },
  {
    id: 'sleep_streak_3',
    goal: 3,
    compute: (c) => c.sleep7Streak,
    progressText: (p, g) => `Sueño ≥7h: ${Math.min(p, g)}/${g} días seguidos`,
  },
  {
    id: 'move30_week',
    goal: 5,
    compute: (c) => c.move30Last7,
    progressText: (p, g) => `≥30 min: ${Math.min(p, g)}/${g} en últimos 7`,
  },
  {
    id: 'low_cravings_week',
    goal: 5,
    compute: (c) => c.lowCravingsLast7,
    progressText: (p, g) => `Antojos ≤1: ${Math.min(p, g)}/${g} en últimos 7`,
  },
];

export async function getAchievementStatuses(dateKey?: string): Promise<AchievementStatus[]> {
  const todayKey = dateKey ?? isoDateKey();
  const ctx = await buildContext(todayKey);
  const unlocked = await getAchievements();
  const unlockedMap = new Map(unlocked.map((a) => [a.id, a] as const));

  return GOALS.map((g) => {
    const meta = ACHIEVEMENTS[g.id];
    const unlockedRec = unlockedMap.get(g.id);
    const rawProgress = g.compute(ctx);
    const progress = clamp(rawProgress, 0, g.goal);

    return {
      id: g.id,
      title: meta.title,
      description: meta.description,
      unlockedAt: unlockedRec?.unlockedAt,
      unlocked: !!unlockedRec,
      progress,
      goal: g.goal,
      progressText: g.progressText(rawProgress, g.goal),
    };
  });
}

export async function getAchievementFeed(dateKey?: string) {
  const all = await getAchievementStatuses(dateKey);
  return {
    unlocked: all.filter((a) => a.unlocked),
    locked: all.filter((a) => !a.unlocked),
    all,
  };
}
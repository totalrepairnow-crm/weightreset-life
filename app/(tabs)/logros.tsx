import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { isoDateKey } from '../../constants/date';
import { useWRTheme } from '../../theme/theme';
import Card from '../../ui/Card';
import Screen from '../../ui/Screen';
import WRText from '../../ui/Text';

// ─── Keys de AsyncStorage (solo lectura — no se crean nuevas) ────────────────
const CHECKIN_PREFIX = 'wr_checkin_v1_';
const MEALS_PREFIX = 'wr_meals_v1_';
const LEGACY_ACH_KEY = 'wr_achievements_v1'; // escrito por lib/achievements.ts

// ─── Tipos ──────────────────────────────────────────────────────────────────
type Ctx = {
  totalCheckins: number;
  checkinStreak: number;
  checkinsLast7: number;
  hasMeals: boolean;
  mealStreak: number;
};

type AchievementDef = {
  id: string;
  /** ID en wr_achievements_v1 para recuperar la fecha de desbloqueo */
  legacyId?: string;
  icon: string;
  title: string;
  description: string;
  goal: number;
  getProgress: (ctx: Ctx) => number;
  progressText: (progress: number, goal: number) => string;
};

type AchievementState = AchievementDef & {
  progress: number;
  isUnlocked: boolean;
  unlockedAt: string | null; // ISO string o null
};

// ─── Definiciones de los 7 logros ────────────────────────────────────────────
const LOGROS: AchievementDef[] = [
  {
    id: 'first_checkin',
    legacyId: 'first_checkin',
    icon: '🌱',
    title: 'Primer paso',
    description: 'Completaste tu primer check-in.',
    goal: 1,
    getProgress: (c) => Math.min(c.totalCheckins, 1),
    progressText: () => 'Haz tu primer check-in en la tab Registrar.',
  },
  {
    id: 'streak_3',
    legacyId: 'streak_3',
    icon: '🔥',
    title: 'Racha de 3 días',
    description: 'Tres check-ins consecutivos sin parar.',
    goal: 3,
    getProgress: (c) => Math.min(c.checkinStreak, 3),
    progressText: (p, g) => `Racha actual: ${p} de ${g} días.`,
  },
  {
    id: 'streak_7',
    legacyId: 'streak_7',
    icon: '🏆',
    title: 'Racha de 7 días',
    description: 'Una semana completa de check-ins consecutivos.',
    goal: 7,
    getProgress: (c) => Math.min(c.checkinStreak, 7),
    progressText: (p, g) => `Racha actual: ${p} de ${g} días.`,
  },
  {
    id: 'streak_30',
    icon: '💫',
    title: 'Racha de 30 días',
    description: 'Un mes completo de check-ins sin fallar ni un día.',
    goal: 30,
    getProgress: (c) => Math.min(c.checkinStreak, 30),
    progressText: (p, g) => `Racha actual: ${p} de ${g} días.`,
  },
  {
    id: 'first_meal',
    icon: '🍽️',
    title: 'Primera comida registrada',
    description: 'Registraste tu primera comida en la app.',
    goal: 1,
    getProgress: (c) => (c.hasMeals ? 1 : 0),
    progressText: () => 'Registra una comida en la tab Comidas.',
  },
  {
    id: 'meal_streak_7',
    icon: '📅',
    title: '7 días de comidas',
    description: 'Registraste al menos una comida 7 días consecutivos.',
    goal: 7,
    getProgress: (c) => Math.min(c.mealStreak, 7),
    progressText: (p, g) => `Días seguidos con comidas: ${p} de ${g}.`,
  },
  {
    id: 'consistency_80',
    icon: '📊',
    title: 'Consistencia 80%',
    description: 'Hiciste check-in 6 de los últimos 7 días.',
    goal: 6,
    getProgress: (c) => Math.min(c.checkinsLast7, 6),
    progressText: (p, g) => `Últimos 7 días: ${p} de ${g} check-ins.`,
  },
];

// ─── Carga de datos ──────────────────────────────────────────────────────────
async function loadData(): Promise<{ ctx: Ctx; legacyDates: Map<string, string> }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  // 1) Todas las keys de AsyncStorage (una sola llamada)
  const allKeys: string[] = await AsyncStorage.getAllKeys();
  const keySet = new Set<string>(allKeys);

  const totalCheckins = allKeys.filter((k) => k.startsWith(CHECKIN_PREFIX)).length;
  const hasMeals = allKeys.some((k) => k.startsWith(MEALS_PREFIX));

  // 2) Racha de check-ins + checkinsLast7 (multiGet últimos 90 días)
  const checkinLookback = 90;
  const checkinDateKeys: string[] = [];
  for (let i = 0; i < checkinLookback; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    checkinDateKeys.push(CHECKIN_PREFIX + isoDateKey(d));
  }
  // Usamos keySet en lugar de multiGet para no hacer 90 llamadas — ya las tenemos
  const hasCheckin: boolean[] = checkinDateKeys.map((k) => keySet.has(k));

  let checkinStreak = 0;
  let streakStarted = false;
  for (let i = 0; i < hasCheckin.length; i++) {
    if (hasCheckin[i]) {
      streakStarted = true;
      checkinStreak++;
    } else {
      if (streakStarted) break;
      if (i === 0) continue; // hoy vacío: no penaliza
      break;
    }
  }
  const checkinsLast7 = hasCheckin.slice(0, 7).filter(Boolean).length;

  // 3) Racha de comidas (multiGet últimos 30 días — necesitamos el valor para validar)
  const mealLookback = 30;
  const mealStorageKeys: string[] = [];
  for (let i = 0; i < mealLookback; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    mealStorageKeys.push(MEALS_PREFIX + isoDateKey(d));
  }
  const mealPairs: [string, string | null][] = await AsyncStorage.multiGet(mealStorageKeys);

  const hasMealPerDay: boolean[] = mealPairs.map(([, v]) => {
    if (!v) return false;
    try {
      const parsed = JSON.parse(v);
      // Acepta array directo o { meals: [...] }
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.meals)
          ? parsed.meals
          : [];
      return arr.length > 0;
    } catch {
      return false;
    }
  });

  let mealStreak = 0;
  let mealStarted = false;
  for (let i = 0; i < hasMealPerDay.length; i++) {
    if (hasMealPerDay[i]) {
      mealStarted = true;
      mealStreak++;
    } else {
      if (mealStarted) break;
      if (i === 0) continue;
      break;
    }
  }

  // 4) Fechas de desbloqueo de logros "legacy" (guardados por lib/achievements.ts)
  const legacyDates = new Map<string, string>();
  try {
    const achRaw = await AsyncStorage.getItem(LEGACY_ACH_KEY);
    if (achRaw) {
      const arr = JSON.parse(achRaw);
      if (Array.isArray(arr)) {
        for (const a of arr) {
          if (a?.id && a?.unlockedAt) legacyDates.set(a.id, a.unlockedAt);
        }
      }
    }
  } catch { /* ignore */ }

  return {
    ctx: { totalCheckins, checkinStreak, checkinsLast7, hasMeals, mealStreak },
    legacyDates,
  };
}

function buildStates(ctx: Ctx, legacyDates: Map<string, string>): AchievementState[] {
  return LOGROS.map((def) => {
    const progress = def.getProgress(ctx);
    const isUnlocked = progress >= def.goal;
    // Fecha: si tiene legacyId y está en el mapa de desbloqueados legacy, la usamos
    const unlockedAt =
      isUnlocked && def.legacyId ? (legacyDates.get(def.legacyId) ?? null) : null;
    return { ...def, progress, isUnlocked, unlockedAt };
  });
}

// ─── Formateo de fecha ───────────────────────────────────────────────────────
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────
function ProgressBar({
  progress,
  goal,
  color,
  bgColor,
}: {
  progress: number;
  goal: number;
  color: string;
  bgColor: string;
}) {
  const pct = goal > 0 ? Math.min((progress / goal) * 100, 100) : 0;
  return (
    <View
      style={{
        height: 5,
        borderRadius: 3,
        backgroundColor: bgColor,
        overflow: 'hidden',
        marginTop: 8,
      }}
    >
      <View
        style={{
          height: 5,
          borderRadius: 3,
          backgroundColor: color,
          width: `${pct}%`,
        }}
      />
    </View>
  );
}

function UnlockedCard({
  ach,
  colors,
}: {
  ach: AchievementState;
  colors: Record<string, string>;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: 'rgba(231,198,107,0.35)',
        borderRadius: 16,
        padding: 14,
        backgroundColor: 'rgba(231,198,107,0.10)',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {/* Icono */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: 'rgba(231,198,107,0.20)',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <WRText style={{ fontSize: 22 }}>{ach.icon}</WRText>
      </View>

      {/* Texto */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <WRText style={{ fontWeight: '900', color: colors.primary, fontSize: 15, flex: 1 }}>
            {ach.title}
          </WRText>
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: 'rgba(231,198,107,0.25)',
              borderWidth: 1,
              borderColor: 'rgba(231,198,107,0.5)',
            }}
          >
            <WRText style={{ fontSize: 10, fontWeight: '900', color: colors.primary }}>
              ✓ Logrado
            </WRText>
          </View>
        </View>

        <WRText style={{ marginTop: 3, color: colors.muted, fontWeight: '700', fontSize: 13 }}>
          {ach.description}
        </WRText>

        {ach.unlockedAt ? (
          <WRText style={{ marginTop: 5, color: colors.primary, fontSize: 11, fontWeight: '700' }}>
            📅 {formatDate(ach.unlockedAt)}
          </WRText>
        ) : (
          <WRText style={{ marginTop: 5, color: colors.muted, fontSize: 11, fontWeight: '700' }}>
            ✓ Desbloqueado
          </WRText>
        )}
      </View>
    </View>
  );
}

function LockedCard({
  ach,
  colors,
}: {
  ach: AchievementState;
  colors: Record<string, string>;
}) {
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        padding: 14,
        backgroundColor: colors.card,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
      }}
    >
      {/* Icono (atenuado) */}
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          opacity: 0.5,
        }}
      >
        <WRText style={{ fontSize: 22 }}>{ach.icon}</WRText>
      </View>

      {/* Texto + progreso */}
      <View style={{ flex: 1 }}>
        <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 15 }}>
          {ach.title}
        </WRText>
        <WRText style={{ marginTop: 3, color: colors.muted, fontWeight: '700', fontSize: 13 }}>
          {ach.description}
        </WRText>

        <ProgressBar
          progress={ach.progress}
          goal={ach.goal}
          color={colors.primary}
          bgColor={colors.border}
        />

        <WRText style={{ marginTop: 5, color: colors.muted, fontSize: 12, fontWeight: '700' }}>
          {ach.progressText(ach.progress, ach.goal)}
        </WRText>
      </View>
    </View>
  );
}

// ─── Pantalla ────────────────────────────────────────────────────────────────
export default function LogrosScreen() {
  const { theme } = useWRTheme();
  const { colors, spacing } = theme;

  const [loading, setLoading] = useState(true);
  const [states, setStates] = useState<AchievementState[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { ctx, legacyDates } = await loadData();
      setStates(buildStates(ctx, legacyDates));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load])
  );

  const unlocked = useMemo(() => states.filter((s) => s.isUnlocked), [states]);
  const locked = useMemo(() => states.filter((s) => !s.isUnlocked), [states]);
  const totalCount = LOGROS.length;

  if (loading) {
    return (
      <Screen style={{ backgroundColor: colors.bg }} padded={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <WRText style={{ marginTop: 12, color: colors.muted }}>Cargando logros…</WRText>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ gap: spacing.md, paddingBottom: 100 }}
    >
      {/* Header */}
      <View style={{ marginTop: spacing.xs }}>
        <WRText style={{ fontSize: 30, fontWeight: '900', color: colors.text }}>Logros</WRText>
        <WRText style={{ marginTop: 4, color: colors.muted }}>
          Tu historial de hitos alcanzados
        </WRText>
      </View>

      {/* Resumen global */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 15 }}>
            Progreso total
          </WRText>
          <WRText style={{ fontWeight: '900', color: colors.primary, fontSize: 15 }}>
            {unlocked.length}/{totalCount}
          </WRText>
        </View>
        <ProgressBar
          progress={unlocked.length}
          goal={totalCount}
          color={colors.primary}
          bgColor={colors.border}
        />
        <WRText style={{ marginTop: 6, color: colors.muted, fontSize: 12, fontWeight: '700' }}>
          {unlocked.length === totalCount
            ? '¡Completaste todos los logros! Eres una leyenda. 🏆'
            : `Te faltan ${totalCount - unlocked.length} logro${totalCount - unlocked.length !== 1 ? 's' : ''} por desbloquear.`}
        </WRText>
      </Card>

      {/* Desbloqueados */}
      {unlocked.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 16 }}>
            ✨ Desbloqueados ({unlocked.length})
          </WRText>
          {unlocked.map((ach) => (
            <UnlockedCard key={ach.id} ach={ach} colors={colors} />
          ))}
        </View>
      )}

      {/* Sin logros aún */}
      {unlocked.length === 0 && (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: spacing.md }}>
            <WRText style={{ fontSize: 40 }}>🏅</WRText>
            <WRText
              style={{ marginTop: spacing.sm, fontWeight: '900', color: colors.text, textAlign: 'center' }}
            >
              Sin logros todavía
            </WRText>
            <WRText style={{ marginTop: 6, color: colors.muted, textAlign: 'center', lineHeight: 20 }}>
              Haz tu primer check-in en la tab{' '}
              <WRText style={{ color: colors.primary, fontWeight: '900' }}>Registrar</WRText>{' '}
              y empieza a desbloquear logros.
            </WRText>
          </View>
        </Card>
      )}

      {/* Por desbloquear */}
      {locked.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 16 }}>
            🔒 Por desbloquear ({locked.length})
          </WRText>
          {locked.map((ach) => (
            <LockedCard key={ach.id} ach={ach} colors={colors} />
          ))}
        </View>
      )}
    </Screen>
  );
}

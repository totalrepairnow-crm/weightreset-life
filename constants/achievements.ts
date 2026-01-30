export const ACHIEVEMENTS = {
  first_checkin: {
    title: '🌱 Primer paso',
    description: 'Completaste tu primer check-in.',
  },
  streak_3: {
    title: '🔥 3 días seguidos',
    description: 'Tres días cuidándote (check-in consecutivo).',
  },
  streak_7: {
    title: '🏆 7 días seguidos',
    description: 'Una semana completa de check-ins consecutivos.',
  },
  perfect_day: {
    title: '✅ Día completo',
    description: 'Hoy hiciste check-in y completaste 3/3 acciones.',
  },
  active_week: {
    title: '💪 Semana activa',
    description: 'Hiciste 5+ check-ins en los últimos 7 días.',
  },
  sleep_streak_3: {
    title: '😴 Sueño sólido',
    description: 'Dormiste ≥7h por 3 días seguidos.',
  },
  move30_week: {
    title: '🏃 Semana en movimiento',
    description: 'Hiciste ≥30 min de movimiento en 5 días (últimos 7).',
  },
  low_cravings_week: {
    title: '🍫 Control de antojos',
    description: 'Tuviste antojos ≤1 en 5 días (últimos 7).',
  },
} as const;

export type AchievementId = keyof typeof ACHIEVEMENTS;

export type UnlockedAchievement = {
  id: AchievementId;
  title: string;
  description: string;
  unlockedAt: string; // ISO
};
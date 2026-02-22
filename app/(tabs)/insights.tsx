import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { isoDateKey } from '../../constants/date';
import { useWRTheme } from '../../theme/theme';
import Card from '../../ui/Card';
import Screen from '../../ui/Screen';
import WRText from '../../ui/Text';

// ─── Storage keys ───────────────────────────────────────────────────────────
const CHECKIN_PREFIX = 'wr_checkin_v1_';

// ─── Types ──────────────────────────────────────────────────────────────────
type Checkin = {
  sueno_horas: number;
  estres: number;
  antojos: number;
  movimiento_min: number;
};

type DayData = {
  dateKey: string;
  checkin: Checkin | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }
  return Number(v);
}

function parseCheckin(raw: string | null): Checkin | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return null;
    const s = toNum((p as any).sueno_horas ?? (p as any).sleepHours);
    const e = toNum((p as any).estres ?? (p as any).stress);
    const a = toNum((p as any).antojos ?? (p as any).cravings);
    const m = toNum((p as any).movimiento_min ?? (p as any).movementMin);
    if ([s, e, a, m].some(Number.isNaN)) return null;
    return {
      sueno_horas: clamp(s, 0, 12),
      estres: clamp(e, 1, 5),
      antojos: clamp(a, 0, 3),
      movimiento_min: clamp(m, 0, 300),
    };
  } catch {
    return null;
  }
}

async function loadLast7Days(): Promise<DayData[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const days: DayData[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = isoDateKey(d);
    const raw = await AsyncStorage.getItem(CHECKIN_PREFIX + key);
    days.push({ dateKey: key, checkin: parseCheckin(raw) });
  }
  return days; // days[0] = hoy, days[6] = hace 6 días
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Cuenta días consecutivos con check-in hacia atrás desde hoy.
 *  Si hoy no tiene check-in, no se penaliza (el día puede no haber terminado). */
function computeStreak(days: DayData[]): number {
  let streak = 0;
  let started = false;
  for (let i = 0; i < days.length; i++) {
    if (days[i].checkin !== null) {
      started = true;
      streak++;
    } else {
      if (started) break;
      if (i === 0) continue; // hoy vacío: sigue hacia ayer
      break;
    }
  }
  return streak;
}

// ─── Sub-componentes ────────────────────────────────────────────────────────
type InsightCardData = {
  icon: string;
  title: string;
  body: string;
  tone: 'good' | 'warn' | 'bad';
};

function InsightCard({
  card,
  colors,
}: {
  card: InsightCardData;
  colors: Record<string, string>;
}) {
  const accentColor =
    card.tone === 'bad' ? colors.danger : card.tone === 'warn' ? colors.warning : colors.success;

  const bgColor =
    card.tone === 'bad'
      ? 'rgba(239,68,68,0.08)'
      : card.tone === 'warn'
        ? 'rgba(245,158,11,0.08)'
        : 'rgba(34,197,94,0.08)';

  const priorityLabel =
    card.tone === 'bad' ? 'URGENTE' : card.tone === 'warn' ? 'ATENCIÓN' : '¡BIEN!';

  return (
    <View
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: accentColor + '30',
        backgroundColor: bgColor,
        marginTop: 10,
      }}
    >
      {/* Borde izquierdo de acento por severidad */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          backgroundColor: accentColor,
        }}
      />

      <View style={{ paddingLeft: 16, paddingRight: 12, paddingTop: 12, paddingBottom: 14 }}>
        {/* Fila: ícono en círculo · título · etiqueta de prioridad */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: accentColor + '22',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <WRText style={{ fontSize: 20 }}>{card.icon}</WRText>
          </View>

          <WRText style={{ flex: 1, fontWeight: '900', color: accentColor, fontSize: 14, lineHeight: 19 }}>
            {card.title}
          </WRText>

          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: accentColor + '20',
              borderWidth: 1,
              borderColor: accentColor + '50',
              flexShrink: 0,
            }}
          >
            <WRText style={{ fontSize: 9, fontWeight: '900', color: accentColor, letterSpacing: 0.5 }}>
              {priorityLabel}
            </WRText>
          </View>
        </View>

        {/* Cuerpo — indentado bajo el ícono */}
        <WRText
          style={{ marginTop: 10, marginLeft: 48, color: colors.text, fontWeight: '700', lineHeight: 20, fontSize: 13 }}
        >
          {card.body}
        </WRText>
      </View>
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  unit,
  valueColor,
  colors,
}: {
  icon: string;
  label: string;
  value: string;
  unit: string;
  valueColor: string;
  colors: Record<string, string>;
}) {
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        padding: 14,
        backgroundColor: colors.card,
      }}
    >
      <WRText style={{ fontSize: 18 }}>{icon}</WRText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 6 }}>
        <WRText style={{ fontSize: 22, fontWeight: '900', color: valueColor }}>{value}</WRText>
        <WRText style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>{unit}</WRText>
      </View>
      <WRText style={{ marginTop: 2, color: colors.muted, fontSize: 12, fontWeight: '700' }}>
        {label}
      </WRText>
    </View>
  );
}

// ─── Pantalla principal ──────────────────────────────────────────────────────
export default function InsightsScreen() {
  const { theme } = useWRTheme();
  const { colors, spacing } = theme;

  const [days, setDays] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDays(await loadLast7Days());
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

  const daysWithData = useMemo(() => days.filter((d) => d.checkin !== null), [days]);
  const hasData = daysWithData.length > 0;

  const avgSueno = useMemo(
    () => mean(daysWithData.map((d) => d.checkin!.sueno_horas)),
    [daysWithData]
  );
  const avgEstres = useMemo(
    () => mean(daysWithData.map((d) => d.checkin!.estres)),
    [daysWithData]
  );
  const avgAntojos = useMemo(
    () => mean(daysWithData.map((d) => d.checkin!.antojos)),
    [daysWithData]
  );
  const avgMovimiento = useMemo(
    () => mean(daysWithData.map((d) => d.checkin!.movimiento_min)),
    [daysWithData]
  );

  const streak = useMemo(() => computeStreak(days), [days]);

  // Consistencia: días con check-in sobre los 7 totales del período
  const consistencia = useMemo(
    () => Math.round((daysWithData.length / 7) * 100),
    [daysWithData.length]
  );

  // ── Hasta 3 insight cards, solo si su condición se cumple ──
  const insightCards = useMemo<InsightCardData[]>(() => {
    if (!hasData) return [];
    const cards: InsightCardData[] = [];

    if (avgSueno < 6) {
      cards.push({
        icon: '😴',
        title: 'Sueño insuficiente',
        body: `Promedio de ${avgSueno.toFixed(1)}h — por debajo de las 6h mínimas. El poco sueño eleva el cortisol y dispara antojos. Intenta acostarte 30 min antes esta semana.`,
        tone: 'bad',
      });
    }

    if (cards.length < 3 && avgEstres > 3) {
      cards.push({
        icon: '😮‍💨',
        title: 'Estrés elevado',
        body: `Tu estrés promedio es ${avgEstres.toFixed(1)}/5 esta semana. El estrés crónico aumenta los antojos de azúcar y dificulta el descanso. Prueba 3 min de respiración al despertar.`,
        tone: avgEstres > 4 ? 'bad' : 'warn',
      });
    }

    if (cards.length < 3 && consistencia > 80) {
      cards.push({
        icon: '🔥',
        title: '¡Consistencia de campeonato!',
        body: `Registraste ${daysWithData.length} de los últimos 7 días (${consistencia}%). La constancia es la base del cambio real. ¡Sigue así!`,
        tone: 'good',
      });
    }

    return cards;
  }, [hasData, avgSueno, avgEstres, consistencia, daysWithData.length]);

  // ── Recomendación principal: el dato más crítico manda ──
  const recomendacion = useMemo(() => {
    if (!hasData) return null;
    if (avgSueno < 6) {
      return {
        icon: '🛌',
        text: 'Prioriza el sueño: acuéstate 30 min antes y apaga pantallas a las 10 pm. Un buen descanso es la palanca que mejora todo lo demás — antojos, energía y estado de ánimo.',
      };
    }
    if (avgEstres > 3.5) {
      return {
        icon: '🧘',
        text: 'Reduce el estrés: practica respiración 4-4-6 al despertar y haz una caminata de 10 min después de comer. Dos hábitos pequeños con gran impacto.',
      };
    }
    if (avgAntojos >= 2) {
      return {
        icon: '🥗',
        text: 'Controla los antojos: incluye proteína y fibra en cada comida, y no dejes pasar más de 4 h sin comer. La saciedad es tu mejor aliada.',
      };
    }
    if (avgMovimiento < 20) {
      return {
        icon: '🚶',
        text: 'Mueve el cuerpo: con solo 15 min de caminata diaria reduces antojos, bajas el estrés y mejoras el sueño. Empieza hoy después de la siguiente comida.',
      };
    }
    if (consistencia < 50) {
      return {
        icon: '📋',
        text: 'La clave es el registro: tu check-in diario toma menos de 30 segundos y es la base de todos tus insights. Ponlo en tu rutina de la noche.',
      };
    }
    return {
      icon: '⭐',
      text: '¡Vas muy bien! Tus métricas están en zona verde. Mantén la racha y sigue registrando — el progreso real se construye semana a semana con constancia.',
    };
  }, [hasData, avgSueno, avgEstres, avgAntojos, avgMovimiento, consistencia]);

  // ── Loading state ──
  if (loading) {
    return (
      <Screen style={{ backgroundColor: colors.bg }} padded={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <WRText style={{ marginTop: 12, color: colors.muted }}>Cargando insights…</WRText>
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
        <WRText style={{ fontSize: 30, fontWeight: '900', color: colors.text }}>Insights</WRText>
        <WRText style={{ marginTop: 4, color: colors.muted }}>
          {hasData
            ? `Últimos 7 días · ${daysWithData.length} día${daysWithData.length !== 1 ? 's' : ''} con registro`
            : 'Basados en tus check-ins diarios'}
        </WRText>
      </View>

      {/* Estado vacío */}
      {!hasData ? (
        <Card>
          <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
            <WRText style={{ fontSize: 44 }}>📊</WRText>
            <WRText
              style={{
                marginTop: spacing.md,
                fontWeight: '900',
                color: colors.text,
                textAlign: 'center',
                fontSize: 18,
              }}
            >
              Sin datos todavía
            </WRText>
            <WRText
              style={{ marginTop: spacing.sm, color: colors.muted, textAlign: 'center', lineHeight: 21 }}
            >
              Haz tu check-in diario en la tab{' '}
              <WRText style={{ color: colors.primary, fontWeight: '900' }}>Registrar</WRText>{' '}
              durante al menos un día y regresa aquí para ver tus insights personalizados.
            </WRText>
          </View>
        </Card>
      ) : (
        <>
          {/* Promedios 2×2 */}
          <View style={{ gap: spacing.sm }}>
            <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 16 }}>
              Promedios de la semana
            </WRText>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <StatTile
                icon="😴"
                label="Sueño"
                value={avgSueno.toFixed(1)}
                unit="h"
                valueColor={
                  avgSueno < 6 ? colors.danger : avgSueno < 7 ? colors.warning : colors.success
                }
                colors={colors}
              />
              <StatTile
                icon="😮‍💨"
                label="Estrés"
                value={avgEstres.toFixed(1)}
                unit="/5"
                valueColor={
                  avgEstres > 4 ? colors.danger : avgEstres > 3 ? colors.warning : colors.success
                }
                colors={colors}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <StatTile
                icon="🍫"
                label="Antojos"
                value={avgAntojos.toFixed(1)}
                unit="/3"
                valueColor={avgAntojos >= 2 ? colors.warning : colors.success}
                colors={colors}
              />
              <StatTile
                icon="🏃"
                label="Movimiento"
                value={String(Math.round(avgMovimiento))}
                unit="min"
                valueColor={avgMovimiento < 20 ? colors.warning : colors.success}
                colors={colors}
              />
            </View>
          </View>

          {/* Racha + Consistencia */}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <StatTile
              icon="🔥"
              label="Racha actual"
              value={String(streak)}
              unit={streak === 1 ? 'día' : 'días'}
              valueColor={
                streak >= 5 ? colors.success : streak >= 3 ? colors.warning : colors.primary
              }
              colors={colors}
            />
            <StatTile
              icon="📋"
              label="Consistencia"
              value={String(consistencia)}
              unit="% (7 días)"
              valueColor={
                consistencia > 80
                  ? colors.success
                  : consistencia > 50
                    ? colors.warning
                    : colors.danger
              }
              colors={colors}
            />
          </View>

          {/* Insight cards (máx 3, condicionales) */}
          {insightCards.length > 0 && (
            <View>
              <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 16, marginBottom: 2 }}>
                Insights de la semana
              </WRText>
              {insightCards.map((card, i) => (
                <InsightCard key={i} card={card} colors={colors} />
              ))}
            </View>
          )}

          {/* Recomendación principal */}
          {recomendacion && (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.sm }}>
                <WRText style={{ fontSize: 22 }}>{recomendacion.icon}</WRText>
                <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 16, flex: 1 }}>
                  Tu mejor siguiente paso
                </WRText>
              </View>
              <WRText style={{ color: colors.text, fontWeight: '700', lineHeight: 22 }}>
                {recomendacion.text}
              </WRText>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

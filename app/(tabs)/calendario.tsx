import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { isoDateKey } from '../../constants/date';
import { useWRTheme } from '../../theme/theme';
import Card from '../../ui/Card';
import Screen from '../../ui/Screen';
import WRText from '../../ui/Text';

// ─── Storage keys (solo lectura — no se crean keys nuevas) ──────────────────
const CHECKIN_PREFIX = 'wr_checkin_v1_';
const CHECKED_PREFIX = 'wr_checked_v1_';
const MEALS_PREFIX = 'wr_meals_v1_';

// ─── Constantes de UI ───────────────────────────────────────────────────────
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const STREAK_LOOKBACK = 90; // días hacia atrás para calcular mejor racha

// ─── Tipos ──────────────────────────────────────────────────────────────────
type Checkin = {
  sueno_horas: number;
  estres: number;
  antojos: number;
  movimiento_min: number;
};

type DayData = {
  checkin: Checkin | null;
  actionsDone: number; // 0-3
  calories: number | null;
};

type DayStatus = 'none' | 'partial' | 'complete';

// ─── Helpers de parseo ──────────────────────────────────────────────────────
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

function parseCheckin(raw: string | null | undefined): Checkin | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as any;
    if (!p || typeof p !== 'object') return null;
    const s = toNum(p.sueno_horas ?? p.sleepHours);
    const e = toNum(p.estres ?? p.stress);
    const a = toNum(p.antojos ?? p.cravings);
    const m = toNum(p.movimiento_min ?? p.movementMin);
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

function parseChecked(raw: string | null | undefined): [boolean, boolean, boolean] {
  if (!raw) return [false, false, false];
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p) && p.length === 3) return p as [boolean, boolean, boolean];
  } catch { /* ignore */ }
  return [false, false, false];
}

function parseCalories(raw: string | null | undefined): number | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as any;
    const arr: any[] = Array.isArray(p)
      ? p
      : Array.isArray(p?.meals)
        ? p.meals
        : Array.isArray(p?.items)
          ? p.items
          : [];
    if (!arr.length) return null;
    let total = 0;
    let found = false;
    for (const meal of arr) {
      const t =
        meal?.analysis?.totals ??
        meal?.analysis?.total ??
        meal?.totals ??
        meal?.total ??
        meal?.data?.totals ??
        meal?.data?.total;
      const cal = toNum(t?.calories);
      if (!Number.isNaN(cal) && cal > 0) {
        total += cal;
        found = true;
      }
    }
    return found ? Math.round(total) : null;
  } catch {
    return null;
  }
}

function getDayStatus(data: DayData | undefined): DayStatus {
  if (!data?.checkin) return 'none';
  if (data.actionsDone === 3) return 'complete';
  return 'partial';
}

// ─── Carga de datos ─────────────────────────────────────────────────────────

/** Carga datos de un conjunto de fechas usando multiGet (una sola llamada). */
async function loadDaysData(dateKeys: string[]): Promise<Map<string, DayData>> {
  if (!dateKeys.length) return new Map();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  const allKeys = dateKeys.flatMap((k) => [
    CHECKIN_PREFIX + k,
    CHECKED_PREFIX + k,
    MEALS_PREFIX + k,
  ]);

  const pairs: [string, string | null][] = await AsyncStorage.multiGet(allKeys);
  const kv = new Map<string, string | null>(pairs);

  const result = new Map<string, DayData>();
  for (const k of dateKeys) {
    result.set(k, {
      checkin: parseCheckin(kv.get(CHECKIN_PREFIX + k)),
      actionsDone: parseChecked(kv.get(CHECKED_PREFIX + k)).filter(Boolean).length,
      calories: parseCalories(kv.get(MEALS_PREFIX + k)),
    });
  }
  return result;
}

/** Calcula racha actual y mejor racha sobre los últimos STREAK_LOOKBACK días. */
async function loadStreaks(): Promise<{ current: number; best: number }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;

  const dateKeys: string[] = [];
  for (let i = 0; i < STREAK_LOOKBACK; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dateKeys.push(isoDateKey(d));
  }

  const storageKeys = dateKeys.map((k) => CHECKIN_PREFIX + k);
  const pairs: [string, string | null][] = await AsyncStorage.multiGet(storageKeys);
  // pairs[0] = hoy, pairs[1] = ayer, ...
  const hasCheckin: boolean[] = pairs.map(([, v]) => v !== null);

  // Racha actual: consecutivos desde hoy hacia atrás
  let current = 0;
  let started = false;
  for (let i = 0; i < hasCheckin.length; i++) {
    if (hasCheckin[i]) {
      started = true;
      current++;
    } else {
      if (started) break;
      if (i === 0) continue; // hoy sin check-in: no penalizar
      break;
    }
  }

  // Mejor racha: recorre cronológicamente (más antiguo → más reciente)
  const chrono = [...hasCheckin].reverse();
  let best = 0;
  let run = 0;
  for (const h of chrono) {
    if (h) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }

  return { current, best: Math.max(best, current) };
}

// ─── Calendario: generación de celdas ───────────────────────────────────────
/** Devuelve una lista de dateKeys (YYYY-MM-DD) o null (padding) para el grid. */
function buildMonthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];

  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(
      `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function getMonthDateKeys(year: number, month: number): string[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatMonthYear(year: number, month: number) {
  return capitalize(
    new Date(year, month).toLocaleString('es-MX', { month: 'long', year: 'numeric' })
  );
}

function formatDayLabel(dateKey: string) {
  const [y, m, d] = dateKey.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return capitalize(
    date.toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
  );
}

// ─── Pantalla ────────────────────────────────────────────────────────────────
export default function CalendarioScreen() {
  const { theme } = useWRTheme();
  const { colors, spacing } = theme;

  const today = useMemo(() => isoDateKey(), []);
  const todayDate = useMemo(() => new Date(), []);

  const [year, setYear] = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth()); // 0-indexed
  const [dayDataMap, setDayDataMap] = useState<Map<string, DayData>>(new Map());
  const [streaks, setStreaks] = useState<{ current: number; best: number }>({ current: 0, best: 0 });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);

  // Carga los datos del mes visible + rachas
  const loadAll = useCallback(async (y: number, m: number) => {
    setLoading(true);
    try {
      const [map, str] = await Promise.all([
        loadDaysData(getMonthDateKeys(y, m)),
        loadStreaks(),
      ]);
      setDayDataMap(map);
      setStreaks(str);
    } finally {
      setLoading(false);
    }
  }, []);

  // Recarga al enfocar la tab
  useFocusEffect(
    useCallback(() => {
      loadAll(year, month);
      return () => {};
    }, [loadAll, year, month])
  );

  // Navegación de mes
  const goPrevMonth = useCallback(() => {
    setSelectedDate(null);
    setMonth((m) => {
      const newM = m === 0 ? 11 : m - 1;
      const newY = m === 0 ? year - 1 : year;
      if (m === 0) setYear(newY);
      loadAll(newY, newM);
      return newM;
    });
  }, [year, loadAll]);

  const goNextMonth = useCallback(() => {
    setSelectedDate(null);
    setMonth((m) => {
      const newM = m === 11 ? 0 : m + 1;
      const newY = m === 11 ? year + 1 : year;
      if (m === 11) setYear(newY);
      loadAll(newY, newM);
      return newM;
    });
  }, [year, loadAll]);

  // Color según estado del día
  const statusColor = useCallback(
    (status: DayStatus) => {
      if (status === 'complete') return colors.success;
      if (status === 'partial') return colors.warning;
      return colors.border;
    },
    [colors]
  );

  const selectedData = selectedDate ? dayDataMap.get(selectedDate) : undefined;

  // ── Loading ──
  if (loading) {
    return (
      <Screen style={{ backgroundColor: colors.bg }} padded={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <WRText style={{ marginTop: 12, color: colors.muted }}>Cargando calendario…</WRText>
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
        <WRText style={{ fontSize: 30, fontWeight: '900', color: colors.text }}>Calendario</WRText>
        <WRText style={{ marginTop: 4, color: colors.muted }}>
          Historial de registros diarios
        </WRText>
      </View>

      {/* Rachas */}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
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
          <WRText style={{ fontSize: 18 }}>🔥</WRText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 6 }}>
            <WRText
              style={{
                fontSize: 26,
                fontWeight: '900',
                color: streaks.current >= 5 ? colors.success : streaks.current >= 3 ? colors.warning : colors.primary,
              }}
            >
              {streaks.current}
            </WRText>
            <WRText style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>
              {streaks.current === 1 ? 'día' : 'días'}
            </WRText>
          </View>
          <WRText style={{ marginTop: 2, color: colors.muted, fontSize: 12, fontWeight: '700' }}>
            Racha actual
          </WRText>
        </View>

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
          <WRText style={{ fontSize: 18 }}>🏆</WRText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 6 }}>
            <WRText
              style={{
                fontSize: 26,
                fontWeight: '900',
                color: streaks.best >= 7 ? colors.success : streaks.best >= 3 ? colors.warning : colors.primary,
              }}
            >
              {streaks.best}
            </WRText>
            <WRText style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>
              {streaks.best === 1 ? 'día' : 'días'}
            </WRText>
          </View>
          <WRText style={{ marginTop: 2, color: colors.muted, fontSize: 12, fontWeight: '700' }}>
            Mejor racha
          </WRText>
        </View>
      </View>

      {/* Calendario mensual */}
      <Card>
        {/* Navegación de mes */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <Pressable
            onPress={goPrevMonth}
            hitSlop={12}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <WRText style={{ fontWeight: '900', fontSize: 18, color: colors.text }}>‹</WRText>
          </Pressable>

          <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 15 }}>
            {formatMonthYear(year, month)}
          </WRText>

          <Pressable
            onPress={goNextMonth}
            hitSlop={12}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <WRText style={{ fontWeight: '900', fontSize: 18, color: colors.text }}>›</WRText>
          </Pressable>
        </View>

        {/* Encabezados de días */}
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          {DIAS_SEMANA.map((d) => (
            <WRText
              key={d}
              style={{
                width: '14.285%',
                textAlign: 'center',
                color: colors.muted,
                fontWeight: '700',
                fontSize: 12,
              }}
            >
              {d}
            </WRText>
          ))}
        </View>

        {/* Grid de días */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((dateKey, idx) => {
            if (!dateKey) {
              return <View key={`pad-${idx}`} style={{ width: '14.285%', height: 46 }} />;
            }

            const data = dayDataMap.get(dateKey);
            const status = getDayStatus(data);
            const isToday = dateKey === today;
            const isSelected = dateKey === selectedDate;
            const dayNum = Number(dateKey.split('-')[2]);

            const circleBg = status !== 'none' ? statusColor(status) : 'transparent';
            const textColor =
              status !== 'none' ? '#FFFFFF' : isToday ? colors.primary : colors.text;

            return (
              <Pressable
                key={dateKey}
                onPress={() =>
                  setSelectedDate((prev) => (prev === dateKey ? null : dateKey))
                }
                style={{ width: '14.285%', height: 46, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: circleBg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: isToday ? 2 : isSelected ? 1.5 : 0,
                    borderColor: isToday
                      ? colors.primary
                      : isSelected
                        ? colors.text
                        : 'transparent',
                  }}
                >
                  <WRText style={{ fontWeight: '900', fontSize: 13, color: textColor }}>
                    {dayNum}
                  </WRText>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Leyenda */}
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, justifyContent: 'center' }}>
          {[
            { color: colors.success, label: 'Completo' },
            { color: colors.warning, label: 'Parcial' },
            { color: colors.border, label: 'Sin registro' },
          ].map(({ color, label }) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
              <WRText style={{ fontSize: 11, color: colors.muted, fontWeight: '700' }}>{label}</WRText>
            </View>
          ))}
        </View>
      </Card>

      {/* Panel de detalle del día seleccionado */}
      <Card>
        {!selectedDate ? (
          <WRText style={{ color: colors.muted, textAlign: 'center', paddingVertical: spacing.sm }}>
            Toca un día para ver el resumen
          </WRText>
        ) : (
          <>
            {/* Fecha */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <WRText style={{ fontWeight: '900', color: colors.text, fontSize: 15, flex: 1 }}>
                {formatDayLabel(selectedDate)}
              </WRText>
              {(() => {
                const status = getDayStatus(selectedData);
                const pill =
                  status === 'complete'
                    ? { label: 'Completo', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)', color: colors.success }
                    : status === 'partial'
                      ? { label: 'Parcial', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', color: colors.warning }
                      : null;
                if (!pill) return null;
                return (
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: pill.bg,
                      borderWidth: 1,
                      borderColor: pill.border,
                    }}
                  >
                    <WRText style={{ fontSize: 11, fontWeight: '900', color: pill.color }}>
                      {pill.label}
                    </WRText>
                  </View>
                );
              })()}
            </View>

            {!selectedData?.checkin ? (
              <WRText style={{ color: colors.muted }}>Sin registro este día.</WRText>
            ) : (
              <>
                {/* Métricas de bienestar */}
                <View style={{ gap: 10 }}>
                  {[
                    {
                      icon: '😴',
                      label: 'Sueño',
                      value: `${selectedData.checkin.sueno_horas}h`,
                      warn: selectedData.checkin.sueno_horas < 6,
                    },
                    {
                      icon: '😮‍💨',
                      label: 'Estrés',
                      value: `${selectedData.checkin.estres}/5`,
                      warn: selectedData.checkin.estres > 3,
                    },
                    {
                      icon: '🍫',
                      label: 'Antojos',
                      value: `${selectedData.checkin.antojos}/3`,
                      warn: selectedData.checkin.antojos >= 2,
                    },
                    {
                      icon: '🏃',
                      label: 'Movimiento',
                      value: `${selectedData.checkin.movimiento_min} min`,
                      warn: selectedData.checkin.movimiento_min < 20,
                    },
                  ].map(({ icon, label, value, warn }) => (
                    <View
                      key={label}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <WRText style={{ fontSize: 16 }}>{icon}</WRText>
                        <WRText style={{ color: colors.muted, fontWeight: '700' }}>{label}</WRText>
                      </View>
                      <WRText
                        style={{
                          fontWeight: '900',
                          color: warn ? colors.warning : colors.text,
                        }}
                      >
                        {value}
                      </WRText>
                    </View>
                  ))}

                  {/* Calorías (si hay datos de comidas) */}
                  {selectedData.calories !== null && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <WRText style={{ fontSize: 16 }}>🍽️</WRText>
                        <WRText style={{ color: colors.muted, fontWeight: '700' }}>Calorías</WRText>
                      </View>
                      <WRText style={{ fontWeight: '900', color: colors.text }}>
                        {selectedData.calories.toLocaleString('es-MX')} kcal
                      </WRText>
                    </View>
                  )}

                  {/* Acciones diarias */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 2,
                      paddingTop: spacing.sm,
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <WRText style={{ fontSize: 16 }}>✅</WRText>
                      <WRText style={{ color: colors.muted, fontWeight: '700' }}>Acciones del día</WRText>
                    </View>
                    <WRText
                      style={{
                        fontWeight: '900',
                        color:
                          selectedData.actionsDone === 3
                            ? colors.success
                            : selectedData.actionsDone > 0
                              ? colors.warning
                              : colors.muted,
                      }}
                    >
                      {selectedData.actionsDone}/3
                    </WRText>
                  </View>
                </View>
              </>
            )}
          </>
        )}
      </Card>
    </Screen>
  );
}

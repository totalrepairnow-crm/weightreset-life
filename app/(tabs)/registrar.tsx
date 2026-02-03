import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { isoDateKey } from '../../constants/date';
import { evaluateAchievementsAfterSave } from '../../lib/achievements';
import { useWRTheme } from '../../theme/theme';
import Card from '../../ui/Card';
import Screen from '../../ui/Screen';
import Text from '../../ui/Text';

const STORAGE_KEY_CHECKIN_PREFIX = 'wr_checkin_v1_';
// Smart notification settings (shared with Perfil)
const STORAGE_SMART_ENABLED = 'wr_notif_smart_enabled_v1';
const STORAGE_SMART_HOUR = 'wr_notif_smart_hour_v1';
const STORAGE_SMART_MIN = 'wr_notif_smart_min_v1';
const STORAGE_SMART_LAST_ID = 'wr_notif_smart_last_id_v1';

const CHANNEL_ID = 'wr_daily';

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'WeightReset',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

async function cancelSmartLast() {
  try {
    const last = await AsyncStorage.getItem(STORAGE_SMART_LAST_ID);
    if (last) await Notifications.cancelScheduledNotificationAsync(last);
  } catch {
    // ignore
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(100, n));
}

function computeCravingsRisk(latest: any, yesterday: any | null) {
  const sueno = Number(latest?.sueno_horas ?? latest?.sleepHours);
  const estres = Number(latest?.estres ?? latest?.stress);
  const antojos = Number(latest?.antojos ?? latest?.cravings);
  const mov = Number(latest?.movimiento_min ?? latest?.movementMin);

  let risk = 35;
  if (!Number.isNaN(sueno) && sueno < 7) risk += 18;
  if (!Number.isNaN(estres) && estres >= 4) risk += 18;
  if (!Number.isNaN(mov) && mov < 20) risk += 12;
  if (!Number.isNaN(antojos) && antojos >= 2) risk += 20;

  const yAnt = Number(yesterday?.antojos ?? yesterday?.cravings);
  if (yesterday && !Number.isNaN(yAnt) && yAnt >= 2) risk += 8;

  risk = clamp01(Math.round(risk));
  const label = risk >= 75 ? 'alto' : risk >= 55 ? 'medio' : 'bajo';

  // Suggested target
  let target: 'sleep' | 'move' | 'stress' | 'cravings' = 'move';
  if (!Number.isNaN(sueno) && sueno < 7) target = 'sleep';
  else if (!Number.isNaN(estres) && estres >= 4) target = 'stress';
  else if (!Number.isNaN(antojos) && antojos >= 2) target = 'cravings';
  else if (!Number.isNaN(mov) && mov < 20) target = 'move';

  return { risk, label, target };
}

async function getCheckinForDate(dateKey: string): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_CHECKIN_PREFIX + dateKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function scheduleSmartTomorrowFromTodayCheckin(todayKey: string, latest: Checkin) {
  // Only run if smart is enabled
  const en = await AsyncStorage.getItem(STORAGE_SMART_ENABLED);
  const enabled = en === '1';
  if (!enabled) return;

  // Read smart time
  const hRaw = await AsyncStorage.getItem(STORAGE_SMART_HOUR);
  const mRaw = await AsyncStorage.getItem(STORAGE_SMART_MIN);
  const hour = clamp(hRaw ? Number(hRaw) : 15, 0, 23);
  const minute = clamp(mRaw ? Number(mRaw) : 0, 0, 59);

  // Permissions
  const perm = await Notifications.getPermissionsAsync();
  if (perm.status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') return;
  }

  await ensureAndroidChannel();

  // Yesterday for context
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = await getCheckinForDate(isoDateKey(y));

  const { risk, label, target } = computeCravingsRisk(latest, yesterday);

  // Anti-spam: only schedule if medium+ risk
  if (risk < 55) {
    // Cancel any previous smart notification so it doesn't become stale
    await cancelSmartLast();
    return;
  }

  // Replace previous smart
  await cancelSmartLast();

  const tmr = new Date();
  tmr.setDate(tmr.getDate() + 1);
  const when = new Date(tmr.getFullYear(), tmr.getMonth(), tmr.getDate(), hour, minute, 0);

  const title = label === 'alto' ? '⚠️ Antojos mañana: alto' : '🟡 Antojos mañana: medio';
  const body =
    target === 'sleep'
      ? 'Hoy: prioriza dormir +45 min. Mañana te ayudará con antojos.'
      : target === 'stress'
        ? 'Estrés alto: respira 3 min + caminata corta. Te ayudará mañana.'
        : target === 'cravings'
          ? 'Plan rápido: proteína + fibra en la próxima comida.'
          : 'Haz 10–15 min de caminata después de comer.';

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
    },
    trigger:
      Platform.OS === 'android'
        ? ({ type: 'date', date: when, channelId: CHANNEL_ID } as any)
        : ({ type: 'date', date: when } as any),
  });

  await AsyncStorage.setItem(STORAGE_SMART_LAST_ID, id);
}

type FocusKey = 'sueno' | 'estres' | 'antojos' | 'movimiento';

type Checkin = {
  date?: string;
  sueno_horas: number; // 0-12
  estres: number; // 1-5
  antojos: number; // 0-3
  movimiento_min: number; // 0-300
  created_at?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function keyForDate(d: Date | string = new Date()) {
  return STORAGE_KEY_CHECKIN_PREFIX + (typeof d === 'string' ? d : isoDateKey(d));
}

function normalizeCheckin(raw: any): Checkin {
  const sueno = Number(raw?.sueno_horas ?? raw?.sleepHours ?? 0);
  const estres = Number(raw?.estres ?? raw?.stress ?? 3);
  const antojos = Number(raw?.antojos ?? raw?.cravings ?? 0);
  const mov = Number(raw?.movimiento_min ?? raw?.movementMin ?? 0);

  return {
    sueno_horas: clamp(Number.isFinite(sueno) ? sueno : 0, 0, 12),
    estres: clamp(Number.isFinite(estres) ? estres : 3, 1, 5),
    antojos: clamp(Number.isFinite(antojos) ? antojos : 0, 0, 3),
    movimiento_min: clamp(Number.isFinite(mov) ? mov : 0, 0, 300),
    date: raw?.date,
    created_at: raw?.created_at,
  };
}

function Chip({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: {
    bg: string;
    surface: string;
    card: string;
    text: string;
    muted: string;
    border: string;
    primary: string;
    accent2: string;
    success: string;
    warning: string;
    danger: string;
  };
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? `${colors.primary}22` : colors.card,
        },
      ]}
    >
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

export default function RegistrarScreen() {
  const { theme } = useWRTheme();
  const colors = theme.colors;
  const params = useLocalSearchParams<{ focus?: FocusKey; date?: string; returnTo?: string }>();
  const focus = params?.focus;

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => isoDateKey(today), [today]);
  const paramDate = typeof params?.date === 'string' ? params.date : undefined;
  const selectedKey = /^\d{4}-\d{2}-\d{2}$/.test(paramDate ?? '') ? (paramDate as string) : todayKey;

  const returnTo = typeof params?.returnTo === 'string' ? params.returnTo : undefined;
  const returnRoute = returnTo === 'progreso' ? '/(tabs)/progreso' : '/(tabs)';

  const [checkin, setCheckin] = useState<Checkin>({
    sueno_horas: 0,
    estres: 3,
    antojos: 0,
    movimiento_min: 0,
    date: selectedKey,
  });

  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const raw = await AsyncStorage.getItem(keyForDate(selectedKey));
    if (!raw) {
      setCheckin((p) => ({ ...p, date: selectedKey }));
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setCheckin({ ...normalizeCheckin(parsed), date: selectedKey });
    } catch {
      setCheckin((p) => ({ ...p, date: selectedKey }));
    }
  }, [selectedKey]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load])
  );

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const payload: Checkin = {
        ...checkin,
        date: selectedKey,
        created_at: new Date().toISOString(),
      };
      await AsyncStorage.setItem(keyForDate(selectedKey), JSON.stringify(payload));
      setCheckin(payload);

      // 🔔 Notificación inteligente: solo si se guardó el día de HOY
      if (selectedKey === isoDateKey(new Date())) {
        try {
          await scheduleSmartTomorrowFromTodayCheckin(selectedKey, payload);
        } catch {
          // nunca romper guardar por notificaciones
        }
      }

      // 🏅 Evaluar logros después de guardar
      const unlocked = await evaluateAchievementsAfterSave(selectedKey);

      if (unlocked.length) {
        Alert.alert(
          '🏅 Nuevo logro',
          unlocked.map((a) => `${a.title}\n${a.description}`).join('\n\n'),
          [{ text: 'OK', onPress: () => router.replace(returnRoute) }]
        );
      } else {
        router.replace(returnRoute);
      }
    } finally {
      setIsSaving(false);
    }
  }, [checkin, selectedKey, returnRoute]);

  return (
    <Screen
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.container]}
    >
      <View style={styles.topSpacer} />
      <View style={styles.header}>
        <Text style={styles.title}>Registrar</Text>
        <Text style={styles.subtitle}>Fecha: {selectedKey}</Text>
      </View>

      <Card
        style={[
          styles.section,
          {
            borderColor: focus === 'sueno' ? colors.primary : colors.border,
            backgroundColor: focus === 'sueno' ? `${colors.primary}22` : colors.card,
          },
        ]}
      >
        <Text style={styles.sectionTitle}>Sueño (horas)</Text>
        <View style={styles.chipRow}>
          {[0, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
            <Chip
              key={h}
              label={`${h} h`}
              active={checkin.sueno_horas === h}
              onPress={() => setCheckin((p) => ({ ...p, sueno_horas: h }))}
              colors={colors}
            />
          ))}
        </View>
      </Card>

      <Card
        style={[
          styles.section,
          {
            borderColor: focus === 'estres' ? colors.primary : colors.border,
            backgroundColor: focus === 'estres' ? `${colors.primary}22` : colors.card,
          },
        ]}
      >
        <Text style={styles.sectionTitle}>Estrés (1–5)</Text>
        <View style={styles.chipRow}>
          {[1, 2, 3, 4, 5].map((v) => (
            <Chip
              key={v}
              label={`${v}`}
              active={checkin.estres === v}
              onPress={() => setCheckin((p) => ({ ...p, estres: v }))}
              colors={colors}
            />
          ))}
        </View>
      </Card>

      <Card
        style={[
          styles.section,
          {
            borderColor: focus === 'antojos' ? colors.primary : colors.border,
            backgroundColor: focus === 'antojos' ? `${colors.primary}22` : colors.card,
          },
        ]}
      >
        <Text style={styles.sectionTitle}>Antojos (0–3)</Text>
        <View style={styles.chipRow}>
          {[0, 1, 2, 3].map((v) => (
            <Chip
              key={v}
              label={`${v}`}
              active={checkin.antojos === v}
              onPress={() => setCheckin((p) => ({ ...p, antojos: v }))}
              colors={colors}
            />
          ))}
        </View>
      </Card>

      <Card
        style={[
          styles.section,
          {
            borderColor: focus === 'movimiento' ? colors.primary : colors.border,
            backgroundColor: focus === 'movimiento' ? `${colors.primary}22` : colors.card,
          },
        ]}
      >
        <Text style={styles.sectionTitle}>Movimiento (min)</Text>
        <View style={styles.chipRow}>
          {[0, 10, 20, 30, 45, 60, 90, 120, 150, 180].map((m) => (
            <Chip
              key={m}
              label={`${m}`}
              active={checkin.movimiento_min === m}
              onPress={() => setCheckin((p) => ({ ...p, movimiento_min: m }))}
              colors={colors}
            />
          ))}
        </View>
      </Card>

      <Pressable
        onPress={save}
        disabled={isSaving}
        style={[
          styles.saveButton,
          { backgroundColor: colors.primary, opacity: isSaving ? 0.7 : 1 },
        ]}
      >
        <Text style={styles.saveButtonText}>{isSaving ? 'Guardando…' : 'Guardar'}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  topSpacer: {
    height: 10,
  },
  header: {
    paddingTop: 6,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  subtitle: {
    marginTop: 6,
    opacity: 0.75,
  },
  section: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  sectionTitle: {
    fontWeight: '900',
    fontSize: 16,
  },
  chipRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    marginBottom: 8,
  },
  chipText: {
    fontWeight: '900',
  },
  saveButton: {
    marginTop: 6,
    padding: 14,
    borderRadius: 14,
  },
  saveButtonText: {
    color: 'white',
    fontWeight: '900',
    textAlign: 'center',
  },
});
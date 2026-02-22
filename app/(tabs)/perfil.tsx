import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, LayoutChangeEvent, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import type { UnlockedAchievement } from '../../constants/achievements';
import { getAchievements } from '../../lib/achievements';
import { useWRTheme } from '../../theme/theme';
import Screen from '../../ui/Screen';

let Notifications: any = {
  AndroidImportance: { DEFAULT: 'default', MAX: 'max' },
  AndroidNotificationVisibility: { PUBLIC: 'public' },
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted: false, status: 'denied' }),
  requestPermissionsAsync: async () => ({ granted: false, status: 'denied' }),
  cancelAllScheduledNotificationsAsync: async () => {},
  cancelScheduledNotificationAsync: async () => {},
  scheduleNotificationAsync: async () => '',
  getAllScheduledNotificationsAsync: async () => [],
};
if (Platform.OS !== 'web') {
  try {
    Notifications = require('expo-notifications');
  } catch {
    // Keep no-op fallback when native notifications are unavailable.
  }
}


// Fallback palette (in case theme isn't available for any reason)
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

const DEFAULT_RADIUS = { xs: 10, sm: 14, md: 18, lg: 22, xl: 28 };
const DEFAULT_SPACING = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 };

const STORAGE_NOTIF_ENABLED = 'wr_notif_enabled_v1';
const STORAGE_NOTIF_HOUR = 'wr_notif_hour_v1';
const STORAGE_NOTIF_MIN = 'wr_notif_min_v1';
const STORAGE_NOTIF_LAST_ID = 'wr_notif_last_id_v1';

const STORAGE_SMART_ENABLED = 'wr_notif_smart_enabled_v1';
const STORAGE_SMART_HOUR = 'wr_notif_smart_hour_v1';
const STORAGE_SMART_MIN = 'wr_notif_smart_min_v1';
const STORAGE_SMART_LAST_ID = 'wr_notif_smart_last_id_v1';

const STORAGE_MODE = 'wr_mode_v1';
const STORAGE_PROFILE = 'wr_profile_v1';
const STORAGE_PROGRESS_PHOTOS = 'wr_progress_photos_v1';

type UserProfile = {
  nombre?: string;
  edad?: number;
  sexo?: 'hombre' | 'mujer' | 'otro' | string;
  altura_cm?: number;
  peso_kg?: number;
};
type ProgressPhoto = {
  id: string;
  date: string; // YYYY-MM-DD
  uri: string;
};
type PlanMode = 'agresiva' | 'balance' | 'mantenimiento';

const MODE_LABEL: Record<PlanMode, string> = {
  agresiva: 'Agresiva',
  balance: 'Balance',
  mantenimiento: 'Mantenimiento',
};

const CHANNEL_ID = 'daily-reminders';

function normalizeMode(raw: any): PlanMode {
  const s = String(raw ?? '').toLowerCase().trim();
  if (s === 'agresiva' || s === 'aggressive' || s.startsWith('agre')) return 'agresiva';
  if (s === 'balance' || s === 'balanced' || s.startsWith('bal')) return 'balance';
  if (s === 'mantenimiento' || s === 'maintenance' || s.startsWith('mant')) return 'mantenimiento';
  // Fallback
  return 'balance';
}

function normalizeProfile(raw: any): UserProfile | null {
  if (!raw || typeof raw !== 'object') return null;

  // Support multiple possible key names from onboarding/older versions
  const nombreRaw =
    raw.nombre ??
    raw.name ??
    raw.firstName ??
    raw.first_name ??
    raw.fullName ??
    raw.full_name;

  const edadRaw = raw.edad ?? raw.age;
  const sexoRaw = raw.sexo ?? raw.gender ?? raw.sex;

  const alturaRaw =
    raw.altura_cm ??
    raw.altura ??
    raw.height_cm ??
    raw.heightCm ??
    raw.height;

  const pesoRaw =
    raw.peso_kg ??
    raw.peso ??
    raw.weight_kg ??
    raw.weightKg ??
    raw.weight;

  const nombre = String(nombreRaw ?? '').trim();
  const edad = Number(edadRaw);
  const altura_cm = Number(alturaRaw);
  const peso_kg = Number(pesoRaw);

  const sexo = String(sexoRaw ?? '').trim();

  const out: UserProfile = {};
  if (nombre) out.nombre = nombre;
  if (!Number.isNaN(edad) && edad > 0) out.edad = edad;
  if (sexo) out.sexo = sexo;
  if (!Number.isNaN(altura_cm) && altura_cm > 0) out.altura_cm = altura_cm;
  if (!Number.isNaN(peso_kg) && peso_kg > 0) out.peso_kg = peso_kg;

  return Object.keys(out).length ? out : null;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function fmtTime(hour: number, minute: number) {
  const h12 = ((hour + 11) % 12) + 1;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const mm = String(minute).padStart(2, '0');
  return `${h12}:${mm} ${ampm}`;
}

function isoDateKey(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Recordatorios diarios',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
    });
  } catch {
    // ignore
  }
}

async function ensurePermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return !!req.granted;
}

async function loadSettings() {
  const [en, h, m, smartEn, smartH, smartM] = await Promise.all([
    AsyncStorage.getItem(STORAGE_NOTIF_ENABLED),
    AsyncStorage.getItem(STORAGE_NOTIF_HOUR),
    AsyncStorage.getItem(STORAGE_NOTIF_MIN),
    AsyncStorage.getItem(STORAGE_SMART_ENABLED),
    AsyncStorage.getItem(STORAGE_SMART_HOUR),
    AsyncStorage.getItem(STORAGE_SMART_MIN),
  ]);

  return {
    enabled: en === '1',
    hour: clamp(h ? Number(h) : 20, 0, 23),
    minute: clamp(m ? Number(m) : 0, 0, 59),
    smartEnabled: smartEn === '1',
    smartHour: clamp(smartH ? Number(smartH) : 15, 0, 23),
    smartMinute: clamp(smartM ? Number(smartM) : 0, 0, 59),
  };
}

async function saveSettings(
  enabled: boolean,
  hour: number,
  minute: number,
  smartEnabled: boolean,
  smartHour: number,
  smartMinute: number
) {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_NOTIF_ENABLED, enabled ? '1' : '0'),
    AsyncStorage.setItem(STORAGE_NOTIF_HOUR, String(hour)),
    AsyncStorage.setItem(STORAGE_NOTIF_MIN, String(minute)),
    AsyncStorage.setItem(STORAGE_SMART_ENABLED, smartEnabled ? '1' : '0'),
    AsyncStorage.setItem(STORAGE_SMART_HOUR, String(smartHour)),
    AsyncStorage.setItem(STORAGE_SMART_MIN, String(smartMinute)),
  ]);
}


async function cancelAllScheduled() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // ignore
  }
}

async function cancelDailyLast() {
  try {
    const last = await AsyncStorage.getItem(STORAGE_NOTIF_LAST_ID);
    if (last) {
      await Notifications.cancelScheduledNotificationAsync(last);
    }
  } catch {
    // ignore
  }
}

async function scheduleDaily(hour: number, minute: number) {
  await ensureAndroidChannel();
  await cancelDailyLast();

  const trigger =
    Platform.OS === 'android'
      ? ({ type: 'daily', hour, minute, channelId: CHANNEL_ID } as any)
      : ({ type: 'calendar', hour, minute, repeats: true } as any);

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Cierra tu día 🌙',
      body: 'Tómate 30 segundos para tu check-in.',
      sound: 'default',
    },
    trigger,
  });
  await AsyncStorage.setItem(STORAGE_NOTIF_LAST_ID, id);
}

async function getCheckinForDate(dateKey: string): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem('wr_checkin_v1_' + dateKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
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

  // Pick a suggested target
  let target: 'sleep' | 'move' | 'stress' | 'cravings' = 'move';
  if (!Number.isNaN(sueno) && sueno < 7) target = 'sleep';
  else if (!Number.isNaN(estres) && estres >= 4) target = 'stress';
  else if (!Number.isNaN(antojos) && antojos >= 2) target = 'cravings';
  else if (!Number.isNaN(mov) && mov < 20) target = 'move';

  return { risk, label, target };
}

async function cancelSmartLast() {
  try {
    const last = await AsyncStorage.getItem(STORAGE_SMART_LAST_ID);
    if (last) {
      await Notifications.cancelScheduledNotificationAsync(last);
    }
  } catch {
    // ignore
  }
}

async function scheduleSmartTomorrow(hour: number, minute: number) {
  await ensureAndroidChannel();

  const today = new Date();
  const todayKey = isoDateKey(today);
  const latest = await getCheckinForDate(todayKey);
  if (!latest) return { scheduled: false as const, reason: 'no-checkin-today' as const };

  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  const yesterday = await getCheckinForDate(isoDateKey(y));

  const { risk, label, target } = computeCravingsRisk(latest, yesterday);

  // Anti-spam: only schedule if medium+ risk
  if (risk < 55) return { scheduled: false as const, reason: 'risk-low' as const, risk, label, target };

  // One smart notification at a time
  await cancelSmartLast();

  const tmr = new Date(today);
  tmr.setDate(tmr.getDate() + 1);

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
        ? ({
            type: 'date',
            date: new Date(tmr.getFullYear(), tmr.getMonth(), tmr.getDate(), hour, minute, 0),
            channelId: CHANNEL_ID,
          } as any)
        : ({
            type: 'calendar',
            year: tmr.getFullYear(),
            month: tmr.getMonth() + 1,
            day: tmr.getDate(),
            hour,
            minute,
            repeats: false,
          } as any),
  });

  await AsyncStorage.setItem(STORAGE_SMART_LAST_ID, id);
  return { scheduled: true as const, risk, label, target, id };
}

function formatPhotoDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SLIDER_HEIGHT = 240;

function BeforeAfterSlider({
  older,
  newer,
  colors,
}: {
  older: ProgressPhoto;
  newer: ProgressPhoto;
  colors: typeof DEFAULT_COLORS;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const containerWidthRef = useRef(0);
  const currentDividerX  = useRef(0);
  const dragStartX       = useRef(0);

  const dividerAnim = useRef(new Animated.Value(0)).current;
  const negDivider  = useRef(Animated.multiply(dividerAnim, -1)).current;
  const dividerLine = useRef(Animated.subtract(dividerAnim, 1)).current;
  const handleLeft  = useRef(Animated.subtract(dividerAnim, 22)).current;

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      if (w === containerWidthRef.current) return;
      containerWidthRef.current = w;
      setContainerWidth(w);
      const half = w / 2;
      currentDividerX.current = half;
      dragStartX.current      = half;
      dividerAnim.setValue(half);
    },
    [dividerAnim],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Only claim horizontal movement so vertical scroll still works
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > Math.abs(gs.dy),
      onPanResponderGrant: () => {
        dragStartX.current = currentDividerX.current;
      },
      onPanResponderMove: (_, gs) => {
        const w    = containerWidthRef.current;
        const newX = Math.max(0, Math.min(w, dragStartX.current + gs.dx));
        dividerAnim.setValue(newX);
      },
      onPanResponderRelease: (_, gs) => {
        const w    = containerWidthRef.current;
        const newX = Math.max(0, Math.min(w, dragStartX.current + gs.dx));
        currentDividerX.current = newX;
        dividerAnim.setValue(newX);
      },
    }),
  ).current;

  return (
    <View>
      {/* Slider canvas */}
      <View
        onLayout={onLayout}
        style={{
          height: SLIDER_HEIGHT,
          borderRadius: 14,
          overflow: 'hidden',
          backgroundColor: colors.card,
        }}
        {...panResponder.panHandlers}
      >
        {containerWidth > 0 && (
          <>
            {/* ── Before: older photo, full width beneath ── */}
            <Image
              source={{ uri: older.uri }}
              style={{ position: 'absolute', width: containerWidth, height: SLIDER_HEIGHT }}
              resizeMode="cover"
            />

            {/* ── After: newer photo, clipped to right of divider ── */}
            <Animated.View
              style={{
                position: 'absolute',
                left:     dividerAnim,
                top:      0,
                right:    0,
                bottom:   0,
                overflow: 'hidden',
              }}
            >
              <Animated.View
                style={{
                  position:  'absolute',
                  width:     containerWidth,
                  height:    SLIDER_HEIGHT,
                  transform: [{ translateX: negDivider }],
                }}
              >
                <Image
                  source={{ uri: newer.uri }}
                  style={{ width: containerWidth, height: SLIDER_HEIGHT }}
                  resizeMode="cover"
                />
              </Animated.View>
            </Animated.View>

            {/* ── Divider line ── */}
            <Animated.View
              pointerEvents="none"
              style={{
                position:        'absolute',
                left:            dividerLine,
                top:             0,
                bottom:          0,
                width:           2,
                backgroundColor: '#FFFFFF',
              }}
            />

            {/* ── Drag handle ── */}
            <Animated.View
              pointerEvents="none"
              style={{
                position:        'absolute',
                left:            handleLeft,
                top:             SLIDER_HEIGHT / 2 - 22,
                width:           44,
                height:          44,
                borderRadius:    22,
                backgroundColor: '#FFFFFF',
                alignItems:      'center',
                justifyContent:  'center',
                shadowColor:     '#000',
                shadowOpacity:   0.35,
                shadowRadius:    6,
                shadowOffset:    { width: 0, height: 2 },
                elevation:       5,
              }}
            >
              <Text style={{ color: '#333333', fontSize: 14, fontWeight: '900' }}>↔</Text>
            </Animated.View>

            {/* ── INICIO label (top-left) ── */}
            <View
              pointerEvents="none"
              style={{
                position:        'absolute',
                top:             10,
                left:            10,
                backgroundColor: 'rgba(0,0,0,0.60)',
                borderRadius:    8,
                paddingHorizontal: 8,
                paddingVertical:   4,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
                INICIO
              </Text>
            </View>

            {/* ── AHORA label (top-right) ── */}
            <View
              pointerEvents="none"
              style={{
                position:        'absolute',
                top:             10,
                right:           10,
                backgroundColor: 'rgba(0,0,0,0.60)',
                borderRadius:    8,
                paddingHorizontal: 8,
                paddingVertical:   4,
              }}
            >
              <Text style={{ color: '#E7C66B', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 }}>
                AHORA
              </Text>
            </View>
          </>
        )}
      </View>

      {/* ── Dates row ── */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>
          {formatPhotoDate(older.date)}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>
          {formatPhotoDate(newer.date)}
        </Text>
      </View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useWRTheme();
  const colors = theme?.colors ?? DEFAULT_COLORS;

  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.primary : colors.card,
      }}
    >
      <Text style={{ fontWeight: '900', color: active ? colors.bg : colors.text }}>{label}</Text>
    </Pressable>
  );
}

export default function PerfilScreen() {
  const { theme } = useWRTheme();
  const colors = theme?.colors ?? DEFAULT_COLORS;
  const radius = theme?.radius ?? DEFAULT_RADIUS;
  const spacing = theme?.spacing ?? DEFAULT_SPACING;
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState(20);
  const [minute, setMinute] = useState(0);

  const [mode, setMode] = useState<PlanMode>('balance');
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [smartEnabled, setSmartEnabled] = useState(false);
  const [smartHour, setSmartHour] = useState(15);
  const [smartMinute, setSmartMinute] = useState(0);
  const [smartStatus, setSmartStatus] = useState<string>('');

  const [scheduledCount, setScheduledCount] = useState<number>(0);
  const [achievements, setAchievements] = useState<UnlockedAchievement[]>([]);
  const [progressPhotos, setProgressPhotos] = useState<ProgressPhoto[]>([]);

  const timeLabel = useMemo(() => fmtTime(hour, minute), [hour, minute]);

  const refreshScheduledCount = useCallback(async () => {
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      setScheduledCount(all.length);
    } catch {
      setScheduledCount(0);
    }
  }, []);

  const load = useCallback(async () => {
    const s = await loadSettings();
    setEnabled(s.enabled);
    setHour(s.hour);
    setMinute(s.minute);
    setSmartEnabled(s.smartEnabled);
    setSmartHour(s.smartHour);
    setSmartMinute(s.smartMinute);
    await refreshScheduledCount();

    // Normalize and load STORAGE_MODE
    try {
      const rawMode = await AsyncStorage.getItem(STORAGE_MODE);
      const nextMode = normalizeMode(rawMode);
      setMode(nextMode);
      // Persist normalized mode so other screens (Coach/Plan) read a clean value
      await AsyncStorage.setItem(STORAGE_MODE, nextMode);
    } catch {
      setMode('balance');
    }

    // Normalize and load STORAGE_PROFILE
    try {
      const rawProfile = await AsyncStorage.getItem(STORAGE_PROFILE);
      if (!rawProfile) {
        setProfile(null);
      } else {
        const parsed = JSON.parse(rawProfile);
        const normalized = normalizeProfile(parsed);
        setProfile(normalized);

        // Persist normalized profile so Coach can reliably read `nombre` + fields
        // (and to migrate older key names like `name` -> `nombre`).
        const nextRaw = normalized ? JSON.stringify(normalized) : '';
        if (normalized) {
          await AsyncStorage.setItem(STORAGE_PROFILE, nextRaw);
        } else {
          // If it was garbage/empty, clear it.
          await AsyncStorage.removeItem(STORAGE_PROFILE);
        }
      }
    } catch {
      setProfile(null);
    }

    try {
      const list = await getAchievements();
      setAchievements(Array.isArray(list) ? (list as UnlockedAchievement[]) : []);
    } catch {
      setAchievements([]);
    }

    try {
      const rawPhotos = await AsyncStorage.getItem(STORAGE_PROGRESS_PHOTOS);
      const photos: ProgressPhoto[] = rawPhotos ? JSON.parse(rawPhotos) : [];
      setProgressPhotos(Array.isArray(photos) ? photos : []);
    } catch {
      setProgressPhotos([]);
    }
  }, [refreshScheduledCount]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load])
  );

  const apply = useCallback(
    async (nextEnabled: boolean, nextHour: number, nextMinute: number, nextSmartEnabled: boolean, nextSmartHour: number, nextSmartMinute: number) => {
      await saveSettings(nextEnabled, nextHour, nextMinute, nextSmartEnabled, nextSmartHour, nextSmartMinute);

      if (!nextEnabled) {
        // Only cancel the daily reminder; smart reminders are managed separately
        // (we already use cancelAllScheduled in scheduleDaily, so keep daily off by leaving it unscheduled)
      }

      if (!Device.isDevice) {
        // simulador puede fallar, pero igual intentamos
      }

      const ok = await ensurePermission();
      if (!ok) {
        Alert.alert('Permiso denegado', 'Activa las notificaciones en Ajustes para recibir recordatorios.');
        await saveSettings(false, nextHour, nextMinute, nextSmartEnabled, nextSmartHour, nextSmartMinute);
        setEnabled(false);
        await cancelDailyLast();
        await cancelSmartLast();
        await refreshScheduledCount();
        return;
      }

      if (nextEnabled) {
        await scheduleDaily(nextHour, nextMinute);
      }

      if (nextSmartEnabled) {
        const r = await scheduleSmartTomorrow(nextSmartHour, nextSmartMinute);
        if (r.scheduled) {
          setSmartStatus(`✅ Inteligente programada (${r.label} · ${r.risk}/100)`);
        } else {
          const reason = (r as any).reason;
          if (reason === 'no-checkin-today') setSmartStatus('ℹ️ Haz check-in hoy para programar la inteligente.');
          else if (reason === 'risk-low') setSmartStatus('✅ Riesgo bajo: no se programó para evitar spam.');
          else setSmartStatus('ℹ️ No se programó.');
        }
      } else {
        await cancelSmartLast();
        setSmartStatus('');
      }

      await refreshScheduledCount();
    },
    [refreshScheduledCount]
  );

  const toggle = useCallback(async () => {
    const next = !enabled;
    setEnabled(next);
    await apply(next, hour, minute, smartEnabled, smartHour, smartMinute);
  }, [apply, enabled, hour, minute, smartEnabled, smartHour, smartMinute]);

  const toggleSmart = useCallback(async () => {
    const next = !smartEnabled;
    setSmartEnabled(next);
    await apply(enabled, hour, minute, next, smartHour, smartMinute);
  }, [apply, enabled, hour, minute, smartEnabled, smartHour, smartMinute]);

  const disable = useCallback(async () => {
    setEnabled(false);
    await apply(false, hour, minute, smartEnabled, smartHour, smartMinute);
    Alert.alert('Listo', 'Recordatorio desactivado.');
  }, [apply, hour, minute, smartEnabled, smartHour, smartMinute]);

  const setTimePreset = useCallback(
    async (h: number, m: number) => {
      setHour(h);
      setMinute(m);
      if (enabled) {
        await apply(true, h, m, smartEnabled, smartHour, smartMinute);
      } else {
        await saveSettings(false, h, m, smartEnabled, smartHour, smartMinute);
      }
    },
    [apply, enabled, smartEnabled, smartHour, smartMinute]
  );

  const setSmartTimePreset = useCallback(
    async (h: number, m: number) => {
      setSmartHour(h);
      setSmartMinute(m);
      if (smartEnabled) {
        await apply(enabled, hour, minute, true, h, m);
      } else {
        await saveSettings(enabled, hour, minute, false, h, m);
      }
    },
    [apply, enabled, hour, minute, smartEnabled]
  );

  const setModePreset = useCallback(async (next: PlanMode) => {
    setMode(next);
    try {
      await AsyncStorage.setItem(STORAGE_MODE, next);
    } catch {
      // ignore
    }
  }, []);

  const sendTest = useCallback(async () => {
    const ok = await ensurePermission();
    if (!ok) {
      Alert.alert('Permiso denegado', 'Activa notificaciones en Ajustes.');
      return;
    }

    await ensureAndroidChannel();

    try {
      const trigger =
        Platform.OS === 'android'
          ? ({ type: 'timeInterval', seconds: 2, repeats: false, channelId: CHANNEL_ID } as any)
          : ({ seconds: 2 } as any);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Prueba ✅',
          body: 'Si viste esto, tus notificaciones funcionan.',
          sound: 'default',
        },
        trigger,
      });

      Alert.alert('Listo', 'Notificación de prueba enviada (2s).');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'No se pudo enviar la notificación.');
    }
  }, []);

  const profileSummary = useMemo(() => {
    if (!profile) return null;
    const parts: string[] = [];

    const nombre = (profile.nombre ?? '').trim();
    if (nombre) parts.push(nombre);

    const edad = Number(profile.edad);
    if (!Number.isNaN(edad) && edad > 0) parts.push(`${edad} años`);

    const sexo = (profile.sexo ?? '').toString().trim();
    if (sexo) parts.push(sexo);

    const altura = Number(profile.altura_cm);
    if (!Number.isNaN(altura) && altura > 0) parts.push(`${altura} cm`);

    const peso = Number(profile.peso_kg);
    if (!Number.isNaN(peso) && peso > 0) parts.push(`${peso} kg`);

    return parts.length ? parts.join(' · ') : null;
  }, [profile]);

  const profileName = useMemo(() => {
    const n = (profile?.nombre ?? '').toString().trim();
    return n || null;
  }, [profile]);

  const addProgressPhoto = useCallback(async (source: 'camera' | 'gallery') => {
    let result: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permiso denegado', 'Activa el acceso a la cámara en Ajustes.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permiso denegado', 'Activa el acceso a la galería en Ajustes.');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    }
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    const today = isoDateKey();
    const newPhoto: ProgressPhoto = { id: `pp_${Date.now()}`, date: today, uri };
    try {
      const raw = await AsyncStorage.getItem(STORAGE_PROGRESS_PHOTOS);
      const arr: ProgressPhoto[] = raw ? JSON.parse(raw) : [];
      arr.push(newPhoto);
      await AsyncStorage.setItem(STORAGE_PROGRESS_PHOTOS, JSON.stringify(arr));
      setProgressPhotos(arr);
    } catch {
      // ignore
    }
  }, []);

  const sliderPhotos = useMemo(() => {
    if (progressPhotos.length < 2) return null;
    const sorted = [...progressPhotos].sort((a, b) => a.date.localeCompare(b.date));
    return { older: sorted[0], newer: sorted[sorted.length - 1] };
  }, [progressPhotos]);

  return (
    <Screen
      scroll
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl }}
    >
      <Text style={{ fontSize: 30, fontWeight: '900', color: colors.text }}>Perfil</Text>
      <Text style={{ color: colors.muted }}>Ajustes de recordatorios y preferencias.</Text>

      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>👤 Tu perfil</Text>
        <Text style={{ marginTop: 6, color: colors.muted }}>
          {profileName ? `Hola, ${profileName}.` : 'Completa tu perfil para personalizar el Coach, Plan y métricas.'}
        </Text>

        {profileSummary ? (
          <Text style={{ marginTop: 10, fontWeight: '900', color: colors.text }}>{profileSummary}</Text>
        ) : (
          <Text style={{ marginTop: 10, color: colors.muted }}>Aún no hay datos guardados.</Text>
        )}

        <Pressable
          onPress={() => router.push('/onboarding?edit=1&from=perfil')}
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: radius.sm,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900', color: 'white' }}>
            {profileSummary ? 'Editar perfil' : 'Completar perfil'}
          </Text>
        </Pressable>

        <Text style={{ marginTop: 10, color: colors.muted, fontSize: 12 }}>
          Tip: tu nombre se usará para que el Coach te hable de forma más personal.
        </Text>
      </View>

      {/* Fotos de progreso */}
      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>📷 Fotos de progreso</Text>
        <Text style={{ marginTop: 6, color: colors.muted }}>Registra tu transformación semana a semana.</Text>

        <View style={{ marginTop: 10, padding: 10, borderRadius: radius.sm, backgroundColor: `${colors.accent2}15`, borderWidth: 1, borderColor: `${colors.accent2}40` }}>
          <Text style={{ color: colors.accent2, fontWeight: '700', fontSize: 12 }}>🔒 Tus fotos nunca salen de tu teléfono. Solo se guardan localmente.</Text>
        </View>

        <View style={{ marginTop: 12, flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={() => addProgressPhoto('camera')}
            style={({ pressed }) => ({
              flex: 1, padding: 12, borderRadius: radius.sm, alignItems: 'center',
              backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1,
            })}
          >
            <Text style={{ fontWeight: '900', color: '#0B0F14' }}>📸 Cámara</Text>
          </Pressable>
          <Pressable
            onPress={() => addProgressPhoto('gallery')}
            style={({ pressed }) => ({
              flex: 1, padding: 12, borderRadius: radius.sm, alignItems: 'center',
              backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
              opacity: pressed ? 0.88 : 1,
            })}
          >
            <Text style={{ fontWeight: '900', color: colors.text }}>🖼 Galería</Text>
          </Pressable>
        </View>

        {sliderPhotos ? (
          <View style={{ marginTop: 14 }}>
            <BeforeAfterSlider
              key={`${sliderPhotos.older.id}-${sliderPhotos.newer.id}`}
              older={sliderPhotos.older}
              newer={sliderPhotos.newer}
              colors={colors}
            />
          </View>
        ) : progressPhotos.length === 1 ? (
          <View style={{ marginTop: 12 }}>
            <Image
              source={{ uri: progressPhotos[0].uri }}
              style={{ width: 100, height: 130, borderRadius: 12, backgroundColor: colors.border }}
              resizeMode="cover"
            />
            <Text style={{ marginTop: 10, color: colors.muted, fontSize: 13, lineHeight: 20 }}>
              📅 Agrega tu próxima foto en una semana para ver tu progreso.
            </Text>
          </View>
        ) : (
          <Text style={{ marginTop: 12, color: colors.muted, fontSize: 13 }}>
            Aún no hay fotos. Toma tu primera foto de progreso.
          </Text>
        )}
      </View>

      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>🎯 Modo</Text>
        <Text style={{ marginTop: 6, color: colors.muted }}>
          Elige tu objetivo. Se aplicará a tu Plan, Coach y recomendaciones.
        </Text>

        <Text style={{ marginTop: 10, fontWeight: '900', color: colors.text }}>Actual: {MODE_LABEL[mode]}</Text>

        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Chip label="Agresiva" active={mode === 'agresiva'} onPress={() => setModePreset('agresiva')} />
          <Chip label="Balance" active={mode === 'balance'} onPress={() => setModePreset('balance')} />
          <Chip label="Mantenimiento" active={mode === 'mantenimiento'} onPress={() => setModePreset('mantenimiento')} />
        </View>

        <Text style={{ marginTop: 10, color: colors.muted, fontSize: 12 }}>
          Nota: puedes cambiarlo cuando quieras.
        </Text>
      </View>

      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>Recordatorio diario</Text>
        <Text style={{ marginTop: 6, color: colors.muted }}>Check-in para cerrar tu día en 30 segundos.</Text>

        <Pressable
          onPress={toggle}
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: radius.sm,
            backgroundColor: enabled ? colors.primary : colors.card,
            borderWidth: 1,
            borderColor: enabled ? colors.primary : colors.border,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900', color: enabled ? 'white' : colors.text }}>
            {enabled ? 'Activado' : 'Activar'}
          </Text>
        </Pressable>

        {enabled ? (
          <Pressable
            onPress={disable}
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Text style={{ textAlign: 'center', fontWeight: '900', color: colors.text }}>Desactivar</Text>
          </Pressable>
        ) : null}

        <Text style={{ marginTop: 14, fontWeight: '900', color: colors.text }}>Hora</Text>
        <Text style={{ marginTop: 4, color: colors.muted }}>Actual: {timeLabel}</Text>

        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Chip label="7:00 PM" active={hour === 19 && minute === 0} onPress={() => setTimePreset(19, 0)} />
          <Chip label="8:00 PM" active={hour === 20 && minute === 0} onPress={() => setTimePreset(20, 0)} />
          <Chip label="9:00 PM" active={hour === 21 && minute === 0} onPress={() => setTimePreset(21, 0)} />
        </View>

        <Pressable
          onPress={sendTest}
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900', color: colors.text }}>Enviar prueba</Text>
        </Pressable>

        <Text style={{ marginTop: 10, color: colors.muted, fontSize: 12 }}>
          Programadas: {scheduledCount} · Nota: en algunos Android la entrega puede variar por ahorro de batería.
        </Text>

        <View style={{ marginTop: 16, height: 1, backgroundColor: colors.border }} />

        <Text style={{ marginTop: 16, fontSize: 18, fontWeight: '900', color: colors.text }}>Notificación inteligente</Text>
        <Text style={{ marginTop: 6, color: colors.muted }}>
          Basada en tu check-in de hoy. Se programa para mañana si el riesgo de antojos es medio/alto.
        </Text>

        <Pressable
          onPress={toggleSmart}
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: radius.sm,
            backgroundColor: smartEnabled ? colors.primary : colors.card,
            borderWidth: 1,
            borderColor: smartEnabled ? colors.primary : colors.border,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900', color: smartEnabled ? 'white' : colors.text }}>
            {smartEnabled ? 'Inteligente activada' : 'Activar inteligente'}
          </Text>
        </Pressable>

        <Text style={{ marginTop: 14, fontWeight: '900', color: colors.text }}>Hora (inteligente)</Text>
        <Text style={{ marginTop: 4, color: colors.muted }}>Actual: {fmtTime(smartHour, smartMinute)}</Text>

        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Chip label="2:00 PM" active={smartHour === 14 && smartMinute === 0} onPress={() => setSmartTimePreset(14, 0)} />
          <Chip label="3:00 PM" active={smartHour === 15 && smartMinute === 0} onPress={() => setSmartTimePreset(15, 0)} />
          <Chip label="4:00 PM" active={smartHour === 16 && smartMinute === 0} onPress={() => setSmartTimePreset(16, 0)} />
        </View>

        {smartStatus ? (
          <Text style={{ marginTop: 10, color: colors.muted, fontSize: 12 }}>{smartStatus}</Text>
        ) : null}
      </View>

      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>🏅 Logros</Text>
        <Text style={{ marginTop: 6, color: colors.muted }}>Se desbloquean automáticamente con tus check-ins.</Text>

        {achievements.length === 0 ? (
          <Text style={{ marginTop: 10, color: colors.muted }}>Aún no hay logros. Haz un check-in para empezar.</Text>
        ) : (
          <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {achievements.map((a) => (
              <Pressable
                key={a.id}
                onPress={() =>
                  Alert.alert(
                    a.title,
                    `${a.description}\n\nDesbloqueado: ${new Date(a.unlockedAt).toLocaleDateString('es-MX')}`
                  )
                }
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ fontWeight: '900', color: colors.text }}>{a.title}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: colors.text }}>Siguiente</Text>
        <Text style={{ marginTop: 8, color: colors.muted }}>• Insights (patrones de sueño/estrés/antojos)</Text>
        <Text style={{ marginTop: 4, color: colors.muted }}>• Calendario mensual</Text>
      </View>
    </Screen>
  );
}

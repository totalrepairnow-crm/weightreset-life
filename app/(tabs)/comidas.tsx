// SDK 54+ moved legacy helpers like readAsStringAsync to /legacy.
// We use the legacy API here because we need base64 encoding for uploads.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  addMeal,
  analyzeBarcodeOpenFoodFacts,
  analyzeMealMock,
  computeDayTotals,
  listMeals,
  makeMealId,
  MealEntry,
  todayKey,
} from '../../lib/food';
import { useWRTheme } from '../../theme/theme';
import Screen from '../../ui/Screen';


const STORAGE_MODE = 'wr_mode_v1';

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

function safeMode(v: any): PlanMode {
  return v === 'agresiva' || v === 'mantenimiento' ? v : 'balance';
}

export default function ComidasScreen() {
  const dateKey = useMemo(() => todayKey(), []);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [barcode, setBarcode] = useState('');
  const [lastProcessedBarcode, setLastProcessedBarcode] = useState<string>('');

  const [mode, setMode] = useState<PlanMode>('balance');
  const targets = useMemo(() => TARGETS_BY_MODE[mode], [mode]);

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState<string>('');

  const params = useLocalSearchParams<{ scannedBarcode?: string | string[] }>();

  const totals = useMemo(() => computeDayTotals(meals), [meals]);

  const { theme } = useWRTheme();
  const colors = theme?.colors ?? {
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
  const spacing = theme?.spacing ?? { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 };
  const radius = theme?.radius ?? { xs: 10, sm: 14, md: 18, lg: 22, xl: 28 };

  const styles = useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: colors.bg },
        content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },

        title: { fontSize: 30, fontWeight: '900', color: colors.text },
        subtitle: { color: colors.muted },

        card: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.md,
          backgroundColor: colors.card,
        },

        busyCard: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.md,
          backgroundColor: colors.surface,
        },
        busyTitle: { fontWeight: '900', color: colors.text },
        busyBody: { marginTop: spacing.xs, color: colors.muted },

        hint: { color: colors.muted, fontSize: 12 },

        kpiTitle: { fontWeight: '900', color: colors.text },
        kpiRow: { marginTop: spacing.xs, color: colors.text, fontWeight: '800' },

        buttonPrimary: {
          backgroundColor: colors.primary,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          borderRadius: radius.sm,
          opacity: 1,
          alignItems: 'center',
        },
        buttonPrimaryDisabled: { opacity: 0.55 },
        buttonPrimaryText: { color: '#0B0F14', fontWeight: '900', textAlign: 'center' },

        buttonSecondary: {
          backgroundColor: colors.card,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
        },
        buttonSecondaryDisabled: { opacity: 0.55 },
        buttonSecondaryText: { color: colors.text, fontWeight: '900', textAlign: 'center' },

        input: {
          marginTop: spacing.sm,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.sm,
          padding: spacing.sm,
          color: colors.text,
          backgroundColor: colors.surface,
        },

        sectionTitle: { marginTop: spacing.xs, fontSize: 18, fontWeight: '900', color: colors.text },

        mealCard: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          padding: spacing.md,
          backgroundColor: colors.card,
        },
        mealTitle: { fontWeight: '900', color: colors.text },
        mealMeta: { marginTop: spacing.xs, color: colors.muted },
        mealHighlights: { marginTop: spacing.sm, color: colors.text, fontWeight: '700' },

        aiDetails: {
          marginTop: spacing.md,
          padding: spacing.md,
          borderRadius: radius.sm,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        aiDetailsTitle: { fontWeight: '900', color: colors.text },
        aiDetailsItem: { marginTop: spacing.xs, color: colors.text },
        aiDetailsNotes: { marginTop: spacing.sm, color: colors.muted },
      }),
    [colors, spacing, radius]
  );

  const refresh = useCallback(async () => {
    setMeals(await listMeals(dateKey));
  }, [dateKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadMode = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_MODE);
      setMode(safeMode(raw));
    } catch {
      setMode('balance');
    }
  }, []);

  useEffect(() => {
    loadMode();
  }, [loadMode]);

  useFocusEffect(
    useCallback(() => {
      loadMode();
      return () => {};
    }, [loadMode])
  );

  // NOTE: For Android physical device testing, use your Mac's LAN IP (shown by Next: Network: http://192.168.1.243:3000)
  // You can override this via EXPO_PUBLIC_AI_URL in your env.
  const AI_BASE_URL_RAW = (process.env.EXPO_PUBLIC_AI_URL as string) || 'http://192.168.1.243:3000';
  const AI_BASE_URL = AI_BASE_URL_RAW.replace(/\/+$/, '');

  function imagePickerMediaTypes(): any {
    // Use the new API when available. If not, omit mediaTypes entirely.
    // Omitting is preferable to triggering deprecated MediaTypeOptions paths.
    const anyPicker: any = ImagePicker as any;
    const mt = anyPicker?.MediaType;

    if (mt && typeof mt === 'object' && (mt.Images ?? mt.images ?? mt.IMAGE ?? mt.Image)) {
      const images = mt.Images ?? mt.images ?? mt.IMAGE ?? mt.Image;
      return [images];
    }

    return undefined;
  }

  function guessMimeType(uri: string) {
    const u = uri.toLowerCase();
    if (u.endsWith('.png')) return 'image/png';
    if (u.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  function estimateScoreFromTotals(totals: any, mode: PlanMode) {
    const cal = typeof totals?.calories === 'number' ? totals.calories : null;
    const p = typeof totals?.protein_g === 'number' ? totals.protein_g : 0;
    const c = typeof totals?.carbs_g === 'number' ? totals.carbs_g : 0;
    const f = typeof totals?.fat_g === 'number' ? totals.fat_g : 0;

    // Per-meal expectations vary slightly by mode
    const mealCalTarget = mode === 'agresiva' ? 450 : mode === 'mantenimiento' ? 600 : 520;

    let score = 78;

    if (cal != null) {
      const diff = cal - mealCalTarget;
      if (diff <= -150) score += 8;
      else if (diff <= -50) score += 4;
      else if (diff <= 100) score += 0;
      else if (diff <= 250) score -= 6;
      else score -= 12;
    }

    // Protein is key across modes; more important in agresiva
    const proteinBoost = mode === 'agresiva' ? 9 : 6;
    if (p >= 35) score += proteinBoost;
    else if (p >= 25) score += Math.round(proteinBoost * 0.6);
    else if (p >= 15) score += 2;
    else score -= 4;

    // Carbs tolerance differs by mode
    const carbSoftCap = mode === 'agresiva' ? 55 : mode === 'mantenimiento' ? 85 : 70;
    const carbHardCap = mode === 'agresiva' ? 85 : mode === 'mantenimiento' ? 120 : 105;
    if (c > carbHardCap) score -= 10;
    else if (c > carbSoftCap) score -= 5;

    // Fat: keep moderate
    if (f > 35) score -= 6;
    else if (f > 25) score -= 3;

    return clamp(Math.round(score), 0, 100);
  }

  function addModeHighlight(analysis: any, mode: PlanMode) {
    const label = MODE_LABEL[mode];
    const t = analysis?.totals ?? {};
    const p = typeof t?.protein_g === 'number' ? t.protein_g : 0;
    const c = typeof t?.carbs_g === 'number' ? t.carbs_g : 0;

    const tip =
      mode === 'agresiva'
        ? p < 25
          ? 'Tip: sube proteína (huevos, pollo, atún, yogurt griego).'
          : c > 70
          ? 'Tip: baja la porción de carbo (1 tortilla o ½ taza arroz).'
          : 'Tip: proteína alta + verduras. Carbo porción chica.'
        : mode === 'mantenimiento'
        ? p < 20
          ? 'Tip: asegura proteína en 2 comidas para energía.'
          : 'Tip: balancea con verduras y carbo normal si entrenas.'
        : p < 20
        ? 'Tip: sube proteína para controlar hambre.'
        : 'Tip: mantén proteína + verduras. Carbo moderado.';

    analysis.highlights = Array.isArray(analysis.highlights) ? analysis.highlights : [];
    analysis.highlights.unshift(`🎯 ${label}: ${tip}`);
    return analysis;
  }

  async function pickImage(from: 'camera' | 'library') {
    if (from === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permiso', 'Necesitamos permiso de cámara.');
        return null;
      }
      const mt = imagePickerMediaTypes();
      const opts: any = {
        allowsEditing: false, // evita editor/crop nativo
        quality: 0.7,
        base64: true,
      };
      if (mt) opts.mediaTypes = mt;

      const res = await ImagePicker.launchCameraAsync(opts);
      if (res.canceled) return null;
      return res.assets?.[0] || null;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permiso', 'Necesitamos permiso para acceder a tus fotos.');
      return null;
    }
    const mt = imagePickerMediaTypes();
    const opts: any = {
      allowsEditing: false,
      quality: 0.7,
      base64: true,
    };
    if (mt) opts.mediaTypes = mt;

    const res = await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled) return null;
    return res.assets?.[0] || null;
  }

  async function analyzeImageWithAI(opts: { uri: string; base64?: string; mimeType?: string; context: string }) {
    const mimeType = opts.mimeType || guessMimeType(opts.uri);

    // Prefer base64 provided by ImagePicker (fast + avoids deprecated filesystem helpers).
    const imageBase64 = opts.base64;
    if (!imageBase64) {
      throw new Error('No se pudo obtener base64 de la imagen. Intenta de nuevo o usa la galería.');
    }

    // Network call with timeout and friendlier errors.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 25000);

    let resp: Response;
    try {
      resp = await fetch(`${AI_BASE_URL}/api/food/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType,
          locale: 'es',
          context: opts.context,
          mode, // 'agresiva' | 'balance' | 'mantenimiento'
          targets, // macro targets for the day (helps the model tailor suggestions)
        }),
        signal: controller.signal,
      });
    } catch (e: any) {
      const raw = String(e?.message || e || 'Network request failed');
      // Common RN/Fetch errors: "Network request failed", "Failed to fetch", aborted, etc.
      if (raw.toLowerCase().includes('network') || raw.toLowerCase().includes('fetch') || raw.toLowerCase().includes('aborted')) {
        throw new Error(
          `No pude conectar con el servidor de AI (${AI_BASE_URL}). ` +
            'Asegúrate de que esté corriendo y que tu celular y tu Mac estén en la misma red Wi‑Fi.'
        );
      }
      throw new Error(raw);
    } finally {
      clearTimeout(t);
    }

    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json?.ok) {
      const msg = json?.error || `Error ${resp.status} analizando imagen`;
      throw new Error(msg);
    }

    const data = json.data;
    const totals = data?.total || { calories: null, protein_g: null, carbs_g: null, fat_g: null };
    const score = estimateScoreFromTotals(totals, mode);

    // Shape compatible with your existing MealEntry renderer
    const analysis = {
      isAI: true,
      score,
      totals,
      items: data?.items || [],
      highlights: data?.notes ? [String(data.notes)] : [],
      notes: data?.notes || '',
      source: data?.source || 'photo',
      raw: data,
    };

    return analysis;
  }

  useEffect(() => {
    const raw = params.scannedBarcode;
    const scanned = Array.isArray(raw) ? raw[0] : raw;
    if (!scanned) return;
    if (scanned === lastProcessedBarcode) return;

    const code = String(scanned).trim();
    if (!code) return;

    setBarcode(code);

    (async () => {
      try {
        let analysis;
        try {
          analysis = await analyzeBarcodeOpenFoodFacts(code);
        } catch {
          analysis = analyzeMealMock({ mode: 'barcode', barcode: code });
        }
        analysis = addModeHighlight(analysis, mode);

        const meal: MealEntry = {
          id: makeMealId(),
          dateKey,
          source: 'barcode',
          barcode: code,
          analysis,
          created_at: new Date().toISOString(),
        };

        await addMeal(meal);
        await refresh();
        setLastProcessedBarcode(code);
        setBarcode('');
        Alert.alert('✅ Barcode guardado', `Score: ${analysis.score}/100`);
      } catch {
        // ignore
      }
    })();
  }, [params.scannedBarcode, lastProcessedBarcode, dateKey, refresh, mode]);

  const addFromPhoto = useCallback(
    async (from: 'camera' | 'library') => {
      const asset = await pickImage(from);
      if (!asset?.uri) return;

      try {
        setBusy(true);
        setBusyMsg('Analizando comida...');

        let analysis: any;
        try {
          analysis = await analyzeImageWithAI({
            uri: asset.uri,
            base64: (asset as any).base64,
            mimeType: (asset as any).mimeType,
            context: 'comida',
          });
        } catch (err: any) {
          // fallback
          analysis = analyzeMealMock({ mode: 'photo' });
          analysis.isAI = false;
          let msg = err?.message ? String(err.message) : 'No se pudo usar AI. Guardando estimación.';

          // Friendly messages for common failures.
          if (
            msg.toLowerCase().includes('no pude conectar') ||
            msg.toLowerCase().includes('network') ||
            msg.toLowerCase().includes('failed to fetch') ||
            msg.toLowerCase().includes('timeout')
          ) {
            msg = `No se pudo conectar con AI (${AI_BASE_URL}). Guardando una estimación.`;
          }

          // Avoid showing internal/deprecation/native errors to the user.
          if (
            msg.includes('readAsStringAsync') ||
            msg.includes('deprecated') ||
            msg.includes('ExponentImagePicker') ||
            msg.includes('ExpoCamera')
          ) {
            msg = 'No se pudo usar AI en este dispositivo. Guardando una estimación.';
          }

          analysis.highlights = Array.isArray(analysis.highlights) ? analysis.highlights : [];
          analysis.highlights.unshift(`⚠️ ${msg}`);
        }

        analysis = addModeHighlight(analysis, mode);

        const meal: MealEntry = {
          id: makeMealId(),
          dateKey,
          source: 'photo',
          imageUri: asset.uri,
          analysis,
          created_at: new Date().toISOString(),
        };

        await addMeal(meal);
        await refresh();
        const aiLabel = analysis?.isAI ? 'AI' : 'Estimado';
        const cal = Math.round(analysis?.totals?.calories ?? analysis?.totals?.calories ?? 0);
        const p = Math.round(analysis?.totals?.protein_g ?? 0);
        const c = Math.round(analysis?.totals?.carbs_g ?? 0);
        const g = Math.round(analysis?.totals?.fat_g ?? 0);
        const topItems = Array.isArray(analysis?.items)
          ? analysis.items
              .slice(0, 3)
              .map((it: any) => `${it?.name || 'Item'}${it?.qty ? ` (${it.qty})` : ''}`)
              .join('\n')
          : '';

        Alert.alert(
          '✅ Guardado',
          `Análisis: ${aiLabel}\nScore: ${analysis.score}/100\n\n${cal} kcal · P ${p}g · C ${c}g · G ${g}g${topItems ? `\n\nDetectado:\n${topItems}` : ''}`
        );
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'No se pudo analizar la imagen');
      } finally {
        setBusy(false);
        setBusyMsg('');
      }
    },
    [dateKey, refresh, mode]
  );

  const addFromLabel = useCallback(
    async (from: 'camera' | 'library') => {
      const asset = await pickImage(from);
      if (!asset?.uri) return;

      try {
        setBusy(true);
        setBusyMsg('Analizando etiqueta...');

        let analysis: any;
        try {
          analysis = await analyzeImageWithAI({
            uri: asset.uri,
            base64: (asset as any).base64,
            mimeType: (asset as any).mimeType,
            context: 'etiqueta nutricional',
          });
        } catch (err: any) {
          // fallback
          analysis = analyzeMealMock({ mode: 'label' });
          analysis.isAI = false;
          let msg = err?.message ? String(err.message) : 'No se pudo usar AI. Guardando estimación.';

          // Friendly messages for common failures.
          if (
            msg.toLowerCase().includes('no pude conectar') ||
            msg.toLowerCase().includes('network') ||
            msg.toLowerCase().includes('failed to fetch') ||
            msg.toLowerCase().includes('timeout')
          ) {
            msg = `No se pudo conectar con AI (${AI_BASE_URL}). Guardando una estimación.`;
          }

          // Avoid showing internal/deprecation/native errors to the user.
          if (
            msg.includes('readAsStringAsync') ||
            msg.includes('deprecated') ||
            msg.includes('ExponentImagePicker') ||
            msg.includes('ExpoCamera')
          ) {
            msg = 'No se pudo usar AI en este dispositivo. Guardando una estimación.';
          }

          analysis.highlights = Array.isArray(analysis.highlights) ? analysis.highlights : [];
          analysis.highlights.unshift(`⚠️ ${msg}`);
        }

        analysis = addModeHighlight(analysis, mode);

        const meal: MealEntry = {
          id: makeMealId(),
          dateKey,
          source: 'label',
          imageUri: asset.uri,
          analysis,
          created_at: new Date().toISOString(),
        };

        await addMeal(meal);
        await refresh();
        const aiLabel = analysis?.isAI ? 'AI' : 'Estimado';
        const cal = Math.round(analysis?.totals?.calories ?? 0);
        const p = Math.round(analysis?.totals?.protein_g ?? 0);
        const c = Math.round(analysis?.totals?.carbs_g ?? 0);
        const g = Math.round(analysis?.totals?.fat_g ?? 0);
        const topItems = Array.isArray(analysis?.items)
          ? analysis.items
              .slice(0, 3)
              .map((it: any) => `${it?.name || 'Item'}${it?.qty ? ` (${it.qty})` : ''}`)
              .join('\n')
          : '';

        Alert.alert(
          '✅ Etiqueta guardada',
          `Análisis: ${aiLabel}\nScore: ${analysis.score}/100\n\n${cal} kcal · P ${p}g · C ${c}g · G ${g}g${topItems ? `\n\nDetectado:\n${topItems}` : ''}`
        );
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'No se pudo analizar la etiqueta');
      } finally {
        setBusy(false);
        setBusyMsg('');
      }
    },
    [dateKey, refresh, mode]
  );

  const addFromBarcode = useCallback(async () => {
    const code = barcode.trim();
    if (!code) {
      Alert.alert('UPC', 'Escribe o pega un UPC/barcode.');
      return;
    }

    let analysis;
    try {
      analysis = await analyzeBarcodeOpenFoodFacts(code);
    } catch {
      analysis = analyzeMealMock({ mode: 'barcode', barcode: code });
    }
    analysis = addModeHighlight(analysis, mode);

    const meal: MealEntry = {
      id: makeMealId(),
      dateKey,
      source: 'barcode',
      barcode: code,
      analysis,
      created_at: new Date().toISOString(),
    };

    await addMeal(meal);
    setBarcode('');
    await refresh();
    Alert.alert('✅ Barcode guardado', `Score: ${analysis.score}/100`);
  }, [barcode, dateKey, refresh, mode]);

  const Button = (props: { label: string; onPress: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean }) => {
    const variant = props.variant ?? 'primary';
    const isPrimary = variant === 'primary';
    return (
      <Pressable
        disabled={!!props.disabled}
        onPress={props.onPress}
        style={({ pressed }) => [
          isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
          props.disabled ? (isPrimary ? styles.buttonPrimaryDisabled : styles.buttonSecondaryDisabled) : null,
          pressed ? { transform: [{ scale: 0.99 }], opacity: 0.9 } : null,
        ]}
      >
        <Text style={isPrimary ? styles.buttonPrimaryText : styles.buttonSecondaryText}>{props.label}</Text>
      </Pressable>
    );
  };

  return (
    <Screen scroll style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Comidas</Text>
      <Text style={styles.subtitle}>Fecha: {dateKey}</Text>

      <View style={styles.card}>
        <Text style={styles.kpiTitle}>🎯 Modo: {MODE_LABEL[mode]}</Text>
        <Text style={[styles.subtitle, { marginTop: spacing.xs }]}
        >
          Meta diaria:{' '}
          <Text style={{ fontWeight: '900', color: colors.text }}>{targets.calories} kcal</Text> ·{' '}
          <Text style={{ fontWeight: '900', color: colors.text }}>{targets.protein_g}g proteína</Text>
        </Text>
      </View>

      {busy ? (
        <View style={styles.busyCard}>
          <Text style={styles.busyTitle}>⏳ {busyMsg || 'Procesando...'}</Text>
          <Text style={styles.busyBody}>Esto puede tardar 5–20s dependiendo de la imagen.</Text>
        </View>
      ) : null}

      <Text style={styles.hint}>AI server (debe abrir en tu Android): {AI_BASE_URL}</Text>

      <View style={styles.card}>
        <Text style={styles.kpiTitle}>Totales del día (estimados) · {MODE_LABEL[mode]}</Text>
        <Text style={styles.kpiRow}>
          {Math.round(totals.calories)} kcal · P {Math.round(totals.protein_g)}g · C {Math.round(totals.carbs_g)}g · G {Math.round(totals.fat_g)}g
        </Text>
      </View>

      {/* Botón principal — sólido dorado */}
      <Pressable
        disabled={busy}
        onPress={() => addFromPhoto('camera')}
        style={({ pressed }) => ({
          backgroundColor: colors.primary,
          borderRadius: radius.md,
          paddingVertical: 20,
          paddingHorizontal: spacing.lg,
          alignItems: 'center',
          gap: 4,
          opacity: busy ? 0.55 : pressed ? 0.88 : 1,
        })}
      >
        <Text style={{ color: '#0B0F14', fontWeight: '900', fontSize: 17 }}>📸 Tomar foto de comida</Text>
        <Text style={{ color: '#3A2800', fontWeight: '700', fontSize: 12 }}>Analiza tus macros con IA</Text>
      </Pressable>

      {/* Botones secundarios — ícono izquierda + borde sutil */}
      {[
        { icon: '🖼️', label: 'Galería — comida', action: () => addFromPhoto('library') },
        { icon: '🏷️', label: 'Foto de etiqueta nutricional', action: () => addFromLabel('camera') },
        { icon: '🖼️', label: 'Galería — etiqueta', action: () => addFromLabel('library') },
      ].map(({ icon, label, action }) => (
        <Pressable
          key={label}
          disabled={busy}
          onPress={action}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: colors.card,
            paddingVertical: 13,
            paddingHorizontal: spacing.md,
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: busy ? 0.55 : pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontSize: 18 }}>{icon}</Text>
          <Text style={{ color: colors.text, fontWeight: '900', flex: 1 }}>{label}</Text>
        </Pressable>
      ))}

      <View style={[styles.card, { borderColor: colors.accent2 + '55', borderWidth: 1.5 }]}>
        <Text style={[styles.kpiTitle, { color: colors.accent2 }]}>📷 Barcode / UPC</Text>

        <Button
          variant="secondary"
          label="📷 Escanear barcode"
          onPress={() => router.push({ pathname: '/barcode-scan', params: { returnPath: '/(tabs)/comidas' } })}
        />

        <TextInput
          value={barcode}
          onChangeText={setBarcode}
          placeholder="Ej: 041196912395"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />

        <Button variant="secondary" label="Guardar barcode" onPress={addFromBarcode} />
      </View>

      <Text style={styles.sectionTitle}>Historial de hoy</Text>

      {meals.map((m) => (
        <View key={m.id} style={styles.mealCard}>
          <Text style={styles.mealTitle}>
            {m.source === 'photo'
              ? '📸 Foto'
              : m.source === 'label'
              ? '🏷️ Etiqueta'
              : m.source === 'barcode'
              ? '🔢 Barcode'
              : '✍️ Manual'}{' '}
            · {(m.analysis as any)?.isAI ? 'AI' : 'Estimado'} · Score {m.analysis.score}/100
          </Text>

          <Text style={styles.mealMeta}>
            {Math.round(m.analysis.totals.calories)} kcal · P {Math.round(m.analysis.totals.protein_g)}g · C {Math.round(m.analysis.totals.carbs_g)}g · G {Math.round(m.analysis.totals.fat_g)}g
          </Text>

          {m.analysis.highlights?.length ? <Text style={styles.mealHighlights}>{m.analysis.highlights.slice(0, 2).join(' ')}</Text> : null}

          {Array.isArray((m.analysis as any).items) && (m.analysis as any).items.length ? (
            <View style={styles.aiDetails}>
              <Text style={styles.aiDetailsTitle}>🤖 Detalles {((m.analysis as any).raw ? '(AI)' : '(Estimado)')}</Text>
              {(m.analysis as any).items.slice(0, 3).map((it: any, idx: number) => (
                <Text key={`${m.id}-it-${idx}`} style={styles.aiDetailsItem}>
                  • {it?.name || 'Item'}{it?.qty ? ` (${it.qty})` : ''}
                </Text>
              ))}
              {(m.analysis as any).notes ? <Text style={styles.aiDetailsNotes}>{String((m.analysis as any).notes)}</Text> : null}
            </View>
          ) : null}
        </View>
      ))}

      {!meals.length ? <Text style={styles.subtitle}>Aún no hay comidas registradas hoy.</Text> : null}
    </Screen>
  );
}
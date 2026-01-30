// SDK 54+ moved legacy helpers like readAsStringAsync to /legacy.
// We use the legacy API here because we need base64 encoding for uploads.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

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

const COLORS = {
  bg: '#FFFFFF',
  text: '#111827',
  muted: '#6B7280',
  border: '#E5E7EB',
  orange: '#FF6A00',
  orangeSoft: '#FFE6D5',
};

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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Text style={{ fontSize: 30, fontWeight: '900', color: COLORS.text }}>Comidas</Text>
      <Text style={{ color: COLORS.muted }}>Fecha: {dateKey}</Text>
      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 12, backgroundColor: '#fff' }}>
        <Text style={{ fontWeight: '900', color: COLORS.text }}>🎯 Modo: {MODE_LABEL[mode]}</Text>
        <Text style={{ marginTop: 6, color: COLORS.muted }}>
          Meta diaria: <Text style={{ fontWeight: '900', color: COLORS.text }}>{targets.calories} kcal</Text> ·{' '}
          <Text style={{ fontWeight: '900', color: COLORS.text }}>{targets.protein_g}g proteína</Text>
        </Text>
      </View>

      {busy ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: COLORS.orangeSoft, borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ fontWeight: '900', color: COLORS.text }}>⏳ {busyMsg || 'Procesando...'}</Text>
          <Text style={{ marginTop: 6, color: COLORS.muted }}>Esto puede tardar 5–20s dependiendo de la imagen.</Text>
        </View>
      ) : null}

      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
        AI server (debe abrir en tu Android): {AI_BASE_URL}
      </Text>

      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 18, padding: 14, backgroundColor: '#fff' }}>
        <Text style={{ fontWeight: '900', color: COLORS.text }}>
          Totales del día (estimados) · {MODE_LABEL[mode]}
        </Text>
        <Text style={{ marginTop: 6, color: COLORS.text, fontWeight: '800' }}>
          {Math.round(totals.calories)} kcal · P {Math.round(totals.protein_g)}g · C {Math.round(totals.carbs_g)}g · G {Math.round(totals.fat_g)}g
        </Text>
      </View>

      <Pressable
        disabled={busy}
        onPress={() => addFromPhoto('camera')}
        style={{ backgroundColor: busy ? '#F59E0B' : COLORS.orange, padding: 14, borderRadius: 14, opacity: busy ? 0.6 : 1 }}
      >
        <Text style={{ color: 'white', fontWeight: '900', textAlign: 'center' }}>📸 Tomar foto de comida</Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={() => addFromPhoto('library')}
        style={{ backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, opacity: busy ? 0.6 : 1 }}
      >
        <Text style={{ color: COLORS.text, fontWeight: '900', textAlign: 'center' }}>🖼️ Elegir foto de comida (galería)</Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={() => addFromLabel('camera')}
        style={{ backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, opacity: busy ? 0.6 : 1 }}
      >
        <Text style={{ color: COLORS.text, fontWeight: '900', textAlign: 'center' }}>🏷️ Tomar foto de etiqueta</Text>
      </Pressable>

      <Pressable
        disabled={busy}
        onPress={() => addFromLabel('library')}
        style={{ backgroundColor: '#fff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, opacity: busy ? 0.6 : 1 }}
      >
        <Text style={{ color: COLORS.text, fontWeight: '900', textAlign: 'center' }}>🖼️ Elegir etiqueta (galería)</Text>
      </Pressable>

      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, backgroundColor: '#fff' }}>
        <Text style={{ fontWeight: '900', color: COLORS.text }}>🔢 Barcode / UPC</Text>
        <Pressable
          onPress={() => router.push({ pathname: '/barcode-scan', params: { returnPath: '/(tabs)/comidas' } })}
          style={{
            marginTop: 10,
            paddingVertical: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.border,
            backgroundColor: '#fff',
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900', color: COLORS.text }}>📷 Escanear barcode</Text>
        </Pressable>
        <TextInput
          value={barcode}
          onChangeText={setBarcode}
          placeholder="Ej: 041196912395"
          style={{ marginTop: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12 }}
        />
        <Pressable
          onPress={addFromBarcode}
          style={{
            marginTop: 10,
            backgroundColor: COLORS.orangeSoft,
            padding: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.border,
          }}
        >
          <Text style={{ textAlign: 'center', fontWeight: '900', color: COLORS.text }}>Guardar barcode</Text>
        </Pressable>
      </View>

      <Text style={{ marginTop: 6, fontSize: 18, fontWeight: '900', color: COLORS.text }}>Historial de hoy</Text>

      {meals.map((m) => (
        <View key={m.id} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, padding: 12, backgroundColor: '#fff' }}>
          <Text style={{ fontWeight: '900', color: COLORS.text }}>
            {m.source === 'photo'
              ? '📸 Foto'
              : m.source === 'label'
              ? '🏷️ Etiqueta'
              : m.source === 'barcode'
              ? '🔢 Barcode'
              : '✍️ Manual'}{' '}
            · {(m.analysis as any)?.isAI ? 'AI' : 'Estimado'} · Score {m.analysis.score}/100
          </Text>
          <Text style={{ marginTop: 6, color: COLORS.muted }}>
            {Math.round(m.analysis.totals.calories)} kcal · P {Math.round(m.analysis.totals.protein_g)}g · C {Math.round(m.analysis.totals.carbs_g)}g · G {Math.round(m.analysis.totals.fat_g)}g
          </Text>
          {m.analysis.highlights?.length ? (
            <Text style={{ marginTop: 8, color: COLORS.text, fontWeight: '700' }}>{m.analysis.highlights.slice(0, 2).join(' ')}</Text>
          ) : null}

          {Array.isArray((m.analysis as any).items) && (m.analysis as any).items.length ? (
            <View style={{ marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: COLORS.orangeSoft, borderWidth: 1, borderColor: COLORS.border }}>
              <Text style={{ fontWeight: '900', color: COLORS.text }}>
                🤖 Detalles {((m.analysis as any).raw ? '(AI)' : '(Estimado)')}
              </Text>
              {(m.analysis as any).items.slice(0, 3).map((it: any, idx: number) => (
                <Text key={`${m.id}-it-${idx}`} style={{ marginTop: 6, color: COLORS.text }}>
                  • {it?.name || 'Item'}{it?.qty ? ` (${it.qty})` : ''}
                </Text>
              ))}
              {(m.analysis as any).notes ? (
                <Text style={{ marginTop: 8, color: COLORS.muted }}>{String((m.analysis as any).notes)}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ))}

      {!meals.length ? <Text style={{ color: COLORS.muted }}>Aún no hay comidas registradas hoy.</Text> : null}
    </ScrollView>
  );
}
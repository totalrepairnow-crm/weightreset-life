import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

// Dark theme hardcoded — esta pantalla está fuera del tab layout
const C = {
  bg:      "#0B0F14",
  surface: "#0F141C",
  card:    "#121826",
  text:    "#FFFFFF",
  muted:   "#9CA3AF",
  border:  "#1F2937",
  primary: "#E7C66B",
  danger:  "#EF4444",
} as const;

const KEY      = "wr_profile_v1";
const MODE_KEY = "wr_mode_v1";

type ProfileV1 = {
  name:      string;
  mode:      "agresiva" | "balance" | "mantenimiento";
  age?:      number;
  heightCm?: number;
  weightKg?: number;
  sex?:      "M" | "F" | "X";
  createdAt: string;
  updatedAt: string;
};

const MODES: {
  key:     "agresiva" | "balance" | "mantenimiento";
  emoji:   string;
  label:   string;
  tagline: string;
  bullets: string[];
}[] = [
  {
    key:     "agresiva",
    emoji:   "🔥",
    label:   "Agresiva",
    tagline: "Resultados rápidos, alta disciplina",
    bullets: [
      "Déficit de 400–500 kcal diarios",
      "Alta proteína para proteger tu músculo",
      "Resultados visibles en 4–6 semanas",
      "Requiere compromiso y constancia alta",
    ],
  },
  {
    key:     "balance",
    emoji:   "⚖️",
    label:   "Balance",
    tagline: "Flexible y sostenible a largo plazo",
    bullets: [
      "Déficit de 200–300 kcal diarios",
      "Dieta flexible, sin restricciones extremas",
      "Pérdida sin rebote, ritmo saludable",
      "Recomendado para la mayoría",
    ],
  },
  {
    key:     "mantenimiento",
    emoji:   "🎯",
    label:   "Mantenimiento",
    tagline: "Estabiliza y consolida tu peso actual",
    bullets: [
      "Sin déficit calórico",
      "Come para mantener tu peso actual",
      "Enfócate en calidad de hábitos",
      "Ideal si ya alcanzaste tu meta",
    ],
  },
];

const TOTAL_STEPS = 2;

export default function Onboarding() {
  const router  = useRouter();
  const params  = useLocalSearchParams();
  const isEdit  = String((params as any)?.edit ?? "") === "1";

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [step,    setStep]    = useState(1);

  // Step 1 — todos obligatorios
  const [name,     setName]     = useState("");
  const [age,      setAge]      = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [sex,      setSex]      = useState<"M" | "F" | "X">("M");

  // Step 2
  const [mode, setMode] = useState<"agresiva" | "balance" | "mantenimiento">("balance");

  const canContinueStep1 =
    name.trim().length >= 2 &&
    age.trim() !== "" &&
    heightCm.trim() !== "" &&
    weightKg.trim() !== "";

  const isFinalStep     = step === TOTAL_STEPS;
  const continueEnabled = step === 1 ? canContinueStep1 : true;

  // ── Cargar perfil existente ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const p = JSON.parse(raw) as Partial<ProfileV1>;
          if (!isEdit && p?.name) {
            if (!cancelled) router.replace("/(tabs)");
            return;
          }
          if (p) {
            if (typeof p.name === "string")     setName(p.name);
            if (p.mode)                         setMode(p.mode);
            if (typeof p.age === "number")      setAge(String(p.age));
            if (typeof p.heightCm === "number") setHeightCm(String(p.heightCm));
            if (typeof p.weightKg === "number") setWeightKg(String(p.weightKg));
            if (p.sex)                          setSex(p.sex);
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEdit, router]);

  // ── Continuar / Finalizar ──
  async function onContinue() {
    if (step < TOTAL_STEPS) {
      if (step === 1 && !canContinueStep1) return;
      setStep((s) => s + 1);
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      let existing: Partial<ProfileV1> | null = null;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) existing = JSON.parse(raw);
      } catch { existing = null; }

      const payload: ProfileV1 = {
        name:      name.trim(),
        mode,
        age:       age      ? Number(age)      : undefined,
        heightCm:  heightCm ? Number(heightCm) : undefined,
        weightKg:  weightKg ? Number(weightKg) : undefined,
        sex,
        createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : now,
        updatedAt: now,
      };
      await Promise.all([
        AsyncStorage.setItem(KEY, JSON.stringify(payload)),
        AsyncStorage.setItem(MODE_KEY, mode),
      ]);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }

    router.replace(isEdit ? "/(tabs)/perfil" : "/(tabs)");
  }

  if (loading) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Indicador de progreso ── */}
        <View style={s.progressRow}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <View
              key={n}
              style={[s.progressDot, {
                width:           n === step ? 28 : 8,
                backgroundColor: n <= step ? C.primary : C.border,
                opacity:         n < step ? 0.55 : 1,
              }]}
            />
          ))}
        </View>

        {/* Atrás */}
        {step > 1 && (
          <Pressable onPress={() => setStep((s) => s - 1)} style={{ marginBottom: 16 }}>
            <Text style={{ color: C.muted, fontWeight: "700" }}>← Atrás</Text>
          </Pressable>
        )}

        {/* ─────────────────────────────────────────
            Paso 1: Datos personales
        ───────────────────────────────────────── */}
        {step === 1 && (
          <>
            <Text style={s.stepLabel}>Paso 1 de {TOTAL_STEPS}</Text>
            <Text style={s.title}>{isEdit ? "Editar perfil" : "Datos personales"}</Text>
            <Text style={s.motivator}>Tu punto de partida es el primer paso hacia tu meta</Text>
            <Text style={s.subtitle}>
              Todos los campos son necesarios para personalizar tu Plan y Coach.
            </Text>

            <Text style={s.label}>
              Nombre <Text style={{ color: C.danger }}>*</Text>
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ej. Héctor"
              placeholderTextColor={C.muted}
              style={s.input}
              autoCapitalize="words"
            />

            <Text style={[s.label, { marginTop: 18 }]}>
              Edad <Text style={{ color: C.danger }}>*</Text>
            </Text>
            <TextInput
              value={age}
              onChangeText={setAge}
              placeholder="Ej. 35"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              style={s.input}
            />

            <Text style={[s.label, { marginTop: 18 }]}>
              Altura cm <Text style={{ color: C.danger }}>*</Text>
            </Text>
            <TextInput
              value={heightCm}
              onChangeText={setHeightCm}
              placeholder="Ej. 175"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              style={s.input}
            />

            <Text style={[s.label, { marginTop: 18 }]}>
              Peso kg <Text style={{ color: C.danger }}>*</Text>
            </Text>
            <TextInput
              value={weightKg}
              onChangeText={setWeightKg}
              placeholder="Ej. 92"
              placeholderTextColor={C.muted}
              keyboardType="number-pad"
              style={s.input}
            />

            <Text style={[s.label, { marginTop: 18 }]}>
              Sexo <Text style={{ color: C.danger }}>*</Text>
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              {(["M", "F", "X"] as const).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setSex(v)}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical:   11,
                    borderRadius:      999,
                    borderWidth:       sex === v ? 1.5 : 1,
                    borderColor:       sex === v ? C.primary : C.border,
                    backgroundColor:   sex === v ? C.primary + "28" : C.card,
                  }}
                >
                  <Text style={{ fontWeight: "900", color: sex === v ? C.primary : C.text }}>
                    {v === "M" ? "Hombre" : v === "F" ? "Mujer" : "No especificar"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* ─────────────────────────────────────────
            Paso 2: Objetivo / Modo
        ───────────────────────────────────────── */}
        {step === 2 && (
          <>
            <Text style={s.stepLabel}>Paso 2 de {TOTAL_STEPS}</Text>
            <Text style={s.title}>Tu objetivo</Text>
            <Text style={s.subtitle}>
              Elige tu modo. Define tu Plan, Coach y recomendaciones diarias.{"\n"}
              Puedes cambiarlo cuando quieras desde Perfil.
            </Text>

            {MODES.map((opt) => {
              const active = mode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setMode(opt.key)}
                  style={[s.modeCard, {
                    borderColor:     active ? C.primary : C.border,
                    backgroundColor: active ? C.primary + "1A" : C.card,
                    borderWidth:     active ? 1.5 : 1,
                  }]}
                >
                  {/* Header */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Text style={{ fontSize: 28 }}>{opt.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "900", fontSize: 17, color: active ? C.primary : C.text }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: active ? C.primary + "BB" : C.muted, fontWeight: "700", fontSize: 12, marginTop: 2 }}>
                        {opt.tagline}
                      </Text>
                    </View>
                    {active && (
                      <View style={s.checkCircle}>
                        <Text style={{ color: "#0B0F14", fontSize: 11, fontWeight: "900" }}>✓</Text>
                      </View>
                    )}
                  </View>

                  {/* Bullets */}
                  <View style={{ marginTop: 12, gap: 6 }}>
                    {opt.bullets.map((b, i) => (
                      <Text key={i} style={{ color: active ? C.muted : C.muted, fontSize: 13, fontWeight: "600" }}>
                        {"• "}{b}
                      </Text>
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {/* ── Botón principal ── */}
        <Pressable
          onPress={onContinue}
          disabled={!continueEnabled || saving}
          style={({ pressed }) => [s.continueBtn, {
            backgroundColor: continueEnabled && !saving ? C.primary : C.border,
            opacity: pressed ? 0.88 : 1,
          }]}
        >
          <Text style={[s.continueBtnText, {
            color: continueEnabled && !saving ? "#0B0F14" : C.muted,
          }]}>
            {isFinalStep
              ? (isEdit ? "Guardar cambios ✓" : "Comenzar mi transformación 🚀")
              : "Continuar →"}
          </Text>
        </Pressable>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll:          { paddingHorizontal: 22, paddingTop: 54, paddingBottom: 48 },
  progressRow:     { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 32 },
  progressDot:     { height: 6, borderRadius: 3 },
  stepLabel:       { color: "#9CA3AF", fontWeight: "700", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 6 },
  title:           { fontSize: 28, fontWeight: "900", color: "#FFFFFF", marginBottom: 8 },
  motivator:       { fontSize: 14, fontWeight: "700", color: "#E7C66B", marginBottom: 8, lineHeight: 20 },
  subtitle:        { color: "#9CA3AF", fontWeight: "600", marginBottom: 28, lineHeight: 20 },
  label:           { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
  input:           {
    borderWidth: 1, borderColor: "#1F2937", borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 13, marginTop: 8,
    color: "#FFFFFF", backgroundColor: "#0F141C", fontSize: 15,
  },
  modeCard:        { marginBottom: 12, padding: 18, borderRadius: 16 },
  checkCircle:     { width: 22, height: 22, borderRadius: 11, backgroundColor: "#E7C66B", alignItems: "center", justifyContent: "center" },
  continueBtn:     { marginTop: 28, paddingVertical: 17, borderRadius: 16, alignItems: "center" },
  continueBtnText: { fontWeight: "900", fontSize: 16 },
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";

type ProfileV1 = {
  name: string;
  mode: "agresiva" | "balance" | "mantenimiento";
  age?: number;
  heightCm?: number;
  weightKg?: number;
  sex?: "M" | "F" | "X";
  createdAt: string;
  updatedAt: string;
};

const KEY = "wr_profile_v1";

export default function Onboarding() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const isEdit = String((params as any)?.edit ?? "") === "1";

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"agresiva" | "balance" | "mantenimiento">("balance");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [sex, setSex] = useState<"M" | "F" | "X">("X");

  const canContinue = useMemo(() => name.trim().length >= 2, [name]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const p = JSON.parse(raw) as Partial<ProfileV1>;

          // If this is NOT an edit flow and a profile already exists, skip onboarding.
          if (!isEdit && p?.name) {
            if (!cancelled) router.replace("/(tabs)");
            return;
          }

          // Prefill for edit flow (or if we want to show current values)
          if (p) {
            if (typeof p.name === "string") setName(p.name);
            if (p.mode === "agresiva" || p.mode === "balance" || p.mode === "mantenimiento") setMode(p.mode);
            if (typeof p.age === "number") setAge(String(p.age));
            if (typeof p.heightCm === "number") setHeightCm(String(p.heightCm));
            if (typeof p.weightKg === "number") setWeightKg(String(p.weightKg));
            if (p.sex === "M" || p.sex === "F" || p.sex === "X") setSex(p.sex);
          }
        }
      } catch {
        // ignore parse/storage errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEdit, router]);

  async function onContinue() {
    if (!canContinue) return;

    const now = new Date().toISOString();

    let existing: Partial<ProfileV1> | null = null;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) existing = JSON.parse(raw);
    } catch {
      existing = null;
    }

    const payload: ProfileV1 = {
      name: name.trim(),
      mode,
      age: age ? Number(age) : undefined,
      heightCm: heightCm ? Number(heightCm) : undefined,
      weightKg: weightKg ? Number(weightKg) : undefined,
      sex,
      createdAt: typeof existing?.createdAt === "string" ? existing.createdAt : now,
      updatedAt: now,
    };

    await AsyncStorage.setItem(KEY, JSON.stringify(payload));

    // si vienes de Perfil (edit), regresa a Perfil; si no, manda al Home (tabs)
    router.replace(isEdit ? "/(tabs)/perfil" : "/(tabs)");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <Text style={{ fontSize: 34, fontWeight: "800", marginBottom: 6 }}>{isEdit ? "Tu perfil" : "Bienvenido"}</Text>
        <Text style={{ opacity: 0.7, marginBottom: 18 }}>
          1 minuto. Esto permite personalizar tu plan y tu Coach.
        </Text>

        <Text style={{ fontWeight: "800", marginTop: 6 }}>Elige tu plan</Text>
        <Text style={{ opacity: 0.7, marginTop: 6 }}>
          Puedes cambiarlo después en Perfil.
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          {([
            { key: "agresiva", label: "Agresiva" },
            { key: "balance", label: "Balance" },
            { key: "mantenimiento", label: "Mantenimiento" },
          ] as const).map((opt) => {
            const active = mode === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setMode(opt.key)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? "#ff7a00" : "#e5e5e5",
                  backgroundColor: active ? "rgba(255,122,0,0.08)" : "transparent",
                }}
              >
                <Text style={{ fontWeight: "800", color: active ? "#ff7a00" : "#222" }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={{ fontWeight: "700", marginTop: 10 }}>Nombre</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Ej. Héctor"
          style={{
            borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10, marginTop: 8
          }}
        />

        <Text style={{ fontWeight: "700", marginTop: 14 }}>Edad (opcional)</Text>
        <TextInput
          value={age}
          onChangeText={setAge}
          placeholder="Ej. 35"
          keyboardType="number-pad"
          style={{
            borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10, marginTop: 8
          }}
        />

        <Text style={{ fontWeight: "700", marginTop: 14 }}>Altura cm (opcional)</Text>
        <TextInput
          value={heightCm}
          onChangeText={setHeightCm}
          placeholder="Ej. 175"
          keyboardType="number-pad"
          style={{
            borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10, marginTop: 8
          }}
        />

        <Text style={{ fontWeight: "700", marginTop: 14 }}>Peso kg (opcional)</Text>
        <TextInput
          value={weightKg}
          onChangeText={setWeightKg}
          placeholder="Ej. 92"
          keyboardType="number-pad"
          style={{
            borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10, marginTop: 8
          }}
        />

        <Text style={{ fontWeight: "700", marginTop: 14 }}>Sexo (opcional)</Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
          {(["M", "F", "X"] as const).map((v) => (
            <TouchableOpacity
              key={v}
              onPress={() => setSex(v)}
              style={{
                paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
                borderWidth: 1, borderColor: sex === v ? "#ff7a00" : "#e5e5e5",
                backgroundColor: sex === v ? "rgba(255,122,0,0.08)" : "transparent",
              }}
            >
              <Text style={{ fontWeight: "700", color: sex === v ? "#ff7a00" : "#222" }}>
                {v === "M" ? "Hombre" : v === "F" ? "Mujer" : "Prefiero no decir"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={onContinue}
          disabled={!canContinue || loading}
          style={{
            marginTop: 22,
            backgroundColor: canContinue && !loading ? "#ff7a00" : "#f2f2f2",
            paddingVertical: 14,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ color: canContinue && !loading ? "white" : "#999", fontWeight: "800", fontSize: 16 }}>
            Continuar
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
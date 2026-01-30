import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWRTheme } from "../../theme/theme";

// Mapa simple: nombre de pantalla -> icono Ionicons
const ICONS: Record<
  string,
  {
    active: keyof typeof Ionicons.glyphMap;
    inactive: keyof typeof Ionicons.glyphMap;
  }
> = {
  index: { active: "home", inactive: "home-outline" },
  plan: { active: "calendar", inactive: "calendar-outline" },
  registrar: { active: "add-circle", inactive: "add-circle-outline" },
  progreso: { active: "bar-chart", inactive: "bar-chart-outline" },
  comidas: { active: "restaurant", inactive: "restaurant-outline" },
  coach: { active: "chatbubble", inactive: "chatbubble-outline" },
  insights: { active: "sparkles", inactive: "sparkles-outline" },
  calendario: { active: "time", inactive: "time-outline" },
  logros: { active: "trophy", inactive: "trophy-outline" },
  perfil: { active: "person", inactive: "person-outline" },
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { theme } = useWRTheme();

  // Fallback defensivo por si el Provider no está listo aún
  const colors = theme?.colors ?? {
    bg: "#0B0F14",
    surface: "#0F141C",
    card: "#121826",
    text: "#FFFFFF",
    muted: "#9CA3AF",
    border: "#1F2937",
    primary: "#E7C66B",
    accent2: "#22C55E",
    success: "#22C55E",
    warning: "#F59E0B",
    danger: "#EF4444",
  };

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,

        // Colors
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,

        // Reduce visual noise: show label only for the focused tab.
        tabBarShowLabel: true,
        tabBarLabel: ({ focused, color, children }) => {
          if (!focused) return null;
          const label = typeof children === "string" ? children : "";
          return (
            <View style={{ marginTop: 2 }}>
              <Text style={{ color, fontWeight: "900", fontSize: 11 }}>{label}</Text>
            </View>
          );
        },

        // Typography
        tabBarLabelStyle: {
          fontWeight: "900",
          fontSize: 11,
          marginTop: 2,
        },

        // Floating premium bar: rounded, inset, softer border.
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,

          position: "absolute",
          left: 12,
          right: 12,
          bottom: Math.max(10, insets.bottom + 8),

          height: 64,
          paddingTop: 8,
          paddingBottom: 8,

          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.border,

          shadowColor: "#000",
          shadowOpacity: 0.22,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: 14,
        },

        tabBarItemStyle: {
          paddingVertical: 4,
        },

        tabBarIcon: ({ color, size, focused }) => {
          const key = route.name;
          const def = ICONS[key] ?? { active: "ellipse", inactive: "ellipse-outline" };
          const iconName = focused ? def.active : def.inactive;

          const iconSize = Math.max(22, size);

          return (
            <View style={{ alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={iconName} size={iconSize} color={color} />
              {focused ? (
                <View
                  style={{
                    marginTop: 6,
                    width: 16,
                    height: 2,
                    borderRadius: 999,
                    backgroundColor: colors.primary,
                    opacity: 0.8,
                  }}
                />
              ) : (
                <View style={{ marginTop: 6, width: 18, height: 3, borderRadius: 999, opacity: 0 }} />
              )}
            </View>
          );
        },

        // Keep scene background consistent.
        sceneStyle: {
          backgroundColor: colors.bg,
        },
      })}
    >
      {/* Hoy */}
      <Tabs.Screen name="index" options={{ title: "Hoy" }} />
      <Tabs.Screen name="plan" options={{ title: "Plan" }} />
      <Tabs.Screen name="registrar" options={{ title: "Registrar" }} />
      <Tabs.Screen name="progreso" options={{ title: "Progreso" }} />
      <Tabs.Screen name="comidas" options={{ title: "Comidas" }} />
      <Tabs.Screen name="coach" options={{ title: "Coach" }} />
      <Tabs.Screen name="insights" options={{ title: "Insights" }} />
      <Tabs.Screen name="calendario" options={{ title: "Calendario" }} />
      <Tabs.Screen name="logros" options={{ title: "Logros" }} />
      <Tabs.Screen name="perfil" options={{ title: "Perfil" }} />
    </Tabs>
  );
}
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useMemo } from "react";
import { View, useWindowDimensions } from "react-native";
import { WRThemeProvider, useWRTheme } from "../theme/theme";

function RootLayoutInner() {
  const { theme } = useWRTheme();

  // Foldables: remount "soft" cuando cambia el breakpoint (plegado/desplegado)
  const { width } = useWindowDimensions();
  const layoutMode = width >= 600 ? "expanded" : "compact";
  const stackKey = useMemo(() => layoutMode, [layoutMode]);

  return (
    <>
      <StatusBar style="light" backgroundColor={theme.colors.bg} />
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <Stack
          key={stackKey}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
        </Stack>
      </View>
    </>
  );
}

export default function RootLayout() {
  return (
    <WRThemeProvider>
      <RootLayoutInner />
    </WRThemeProvider>
  );
}
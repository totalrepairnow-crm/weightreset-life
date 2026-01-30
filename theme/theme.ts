import { DarkTheme, DefaultTheme, Theme as NavigationTheme } from "@react-navigation/native";
import React, { createContext, useContext, useMemo, useState } from "react";

export type ThemeMode = 'dark' | 'light';

export type ThemeColors = {
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

export type Theme = {
  mode: ThemeMode;
  colors: ThemeColors;
  radius: { xs: number; sm: number; md: number; lg: number; xl: number };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
};

export const DARK_THEME: Theme = {
  mode: 'dark',
  colors: {
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
  },
  radius: { xs: 10, sm: 14, md: 18, lg: 22, xl: 28 },
  spacing: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 },
};

export const LIGHT_THEME: Theme = {
  mode: 'light',
  colors: {
    bg: '#FFFFFF',
    surface: '#F5F6F8',
    card: '#FFFFFF',
    text: '#0B0F14',
    muted: '#6B7280',
    border: '#E5E7EB',
    primary: '#B6901E',
    accent2: '#16A34A',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
  },
  radius: { xs: 10, sm: 14, md: 18, lg: 22, xl: 28 },
  spacing: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 },
};

type ThemeContextValue = {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  setTheme: (theme: Theme) => void;
};

const DEFAULT_CTX: ThemeContextValue = {
  theme: DARK_THEME,
  mode: 'dark',
  setMode: () => {},
  setTheme: () => {},
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CTX);

export function WRThemeProvider(props: { children: React.ReactNode; initialMode?: ThemeMode }) {
  const [mode, setMode] = useState<ThemeMode>(props.initialMode ?? "dark");

  const theme = useMemo<Theme>(() => {
    return mode === "dark" ? DARK_THEME : LIGHT_THEME;
  }, [mode]);

  // No-op for now (kept for back-compat)
  const setTheme = (_t: Theme) => {};

  const value = useMemo<ThemeContextValue>(() => ({ theme, mode, setMode, setTheme }), [theme, mode]);

  // NOTE: this file is .ts (not .tsx), so avoid JSX.
  return React.createElement(ThemeContext.Provider, { value }, props.children);
}

export function useWRTheme(): ThemeContextValue {
  return useContext(ThemeContext) || DEFAULT_CTX;
}

// Back-compat
export function useTheme(): ThemeContextValue {
  return useWRTheme();
}

export function buildNavTheme(t: Theme): NavigationTheme {
  const base = t.mode === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: t.mode === "dark",
    colors: {
      ...base.colors,
      primary: t.colors.primary,
      background: t.colors.bg,
      card: t.colors.card,
      text: t.colors.text,
      border: t.colors.border,
      notification: t.colors.accent2,
    },
  };
}

export function useNavTheme(): NavigationTheme {
  const { theme } = useWRTheme();
  return useMemo(() => buildNavTheme(theme), [theme]);
}

export const NAV_THEME: NavigationTheme = buildNavTheme(DARK_THEME);
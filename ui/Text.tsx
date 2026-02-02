import React from "react";
import { Text, TextStyle } from "react-native";
import { useWRTheme } from "../theme/theme";

type Props = {
  children: React.ReactNode;
  variant?: "h1" | "h2" | "body" | "muted";
  style?: TextStyle;
};

export default function WRText({ children, variant = "body", style }: Props) {
  const { theme } = useWRTheme();

  const base: TextStyle = { color: theme.colors.text };
  const variants: Record<string, TextStyle> = {
    h1: { fontSize: 28, fontWeight: "900" },
    h2: { fontSize: 18, fontWeight: "800" },
    body: { fontSize: 14, fontWeight: "600" },
    muted: { fontSize: 13, fontWeight: "600", color: theme.colors.muted },
  };

  return <Text style={[base, variants[variant], style]}>{children}</Text>;
}

import React from "react";
import { SafeAreaView, View, ViewStyle } from "react-native";
import { useWRTheme } from "../theme/theme";

type Props = {
  children: React.ReactNode;
  padded?: boolean;
  style?: ViewStyle;
};

export default function Screen({ children, padded = true, style }: Props) {
  const { theme } = useWRTheme();
  const pad = theme.spacing.lg;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View
        style={[
          { flex: 1, backgroundColor: theme.colors.bg, paddingHorizontal: padded ? pad : 0 },
          style,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

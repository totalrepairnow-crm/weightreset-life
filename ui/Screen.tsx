import React from 'react';
import { ScrollView, StyleSheet, ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Edge = 'top' | 'bottom' | 'left' | 'right';

type ScreenProps = ViewProps & {
  scroll?: boolean;
  /** When scroll=true, applies to ScrollView contentContainerStyle */
  contentContainerStyle?: any;
  /** Default true: adds horizontal padding */
  padded?: boolean;
  /** Default: ['top','bottom'] */
  safeEdges?: Edge[];
  children?: React.ReactNode;
};

export default function Screen({
  scroll,
  style,
  contentContainerStyle,
  padded = true,
  safeEdges = ['top', 'bottom'],
  children,
  ...rest
}: ScreenProps) {
  if (scroll) {
    return (
      <SafeAreaView edges={safeEdges} style={styles.flex}>
        <ScrollView
          {...rest}
          style={[styles.flex, style]}
          contentContainerStyle={[padded && styles.padded, contentContainerStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={safeEdges} style={[styles.flex, padded && styles.padded, style]} {...rest}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padded: { paddingHorizontal: 16 },
});

import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { useWRTheme } from '../theme/theme';
import Text from './Text';

type CardProps = ViewProps & {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export default function Card({ title, subtitle, style, children, ...rest }: CardProps) {
  const { theme } = useWRTheme();

  const colors = theme?.colors ?? {
    card: '#121826',
    text: '#FFFFFF',
    muted: '#9CA3AF',
    border: '#1F2937',
  };
  const radius = theme?.radius ?? { lg: 22 };
  const spacing = theme?.spacing ?? { md: 14 };

  return (
    <View
      {...rest}
      style={[
        styles.base,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.lg,
          padding: spacing.md,
        },
        style,
      ]}
    >
      {title ? <Text style={[styles.title, { color: colors.text }]}>{title}</Text> : null}
      {subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    width: '100%',
    alignSelf: 'stretch',
    borderWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    marginTop: 6,
    fontWeight: '600',
  },
});
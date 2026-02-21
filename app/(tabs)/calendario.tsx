import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { useWRTheme } from '../../theme/theme';
import Screen from '../../ui/Screen';
import WRText from '../../ui/Text';

export default function CalendarioScreen() {
  const { theme } = useWRTheme();
  const { colors, radius, spacing } = theme;

  return (
    <Screen style={{ backgroundColor: colors.bg }} padded={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl }}>

        {/* Icono con halo */}
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: colors.accent2 + '1A',
            borderWidth: 1.5,
            borderColor: colors.accent2 + '33',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
          }}
        >
          <Ionicons name="calendar" size={44} color={colors.accent2} />
        </View>

        {/* Título */}
        <WRText variant="h1" style={{ textAlign: 'center', marginBottom: spacing.sm }}>
          Calendario
        </WRText>

        {/* Mensaje motivador */}
        <WRText
          variant="body"
          style={{
            textAlign: 'center',
            color: colors.muted,
            lineHeight: 22,
            marginBottom: spacing.xl,
          }}
        >
          Cada día que registras es un ladrillo en tu transformación. Pronto podrás navegar tu historial completo y ver cuánto has avanzado.
        </WRText>

        {/* Badge "Próximamente" */}
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.xl,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <WRText variant="muted" style={{ fontSize: 12 }}>
            Próximamente
          </WRText>
        </View>

      </View>
    </Screen>
  );
}

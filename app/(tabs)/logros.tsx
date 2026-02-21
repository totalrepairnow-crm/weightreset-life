import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { useWRTheme } from '../../theme/theme';
import Screen from '../../ui/Screen';
import WRText from '../../ui/Text';

export default function LogrosScreen() {
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
            backgroundColor: colors.warning + '1A',
            borderWidth: 1.5,
            borderColor: colors.warning + '33',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
          }}
        >
          <Ionicons name="trophy" size={44} color={colors.warning} />
        </View>

        {/* Título */}
        <WRText variant="h1" style={{ textAlign: 'center', marginBottom: spacing.sm }}>
          Logros
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
          Sé constante y desbloquea badges que celebran cada meta alcanzada. Tu esfuerzo de hoy es el trofeo de mañana.
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

import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { useWRTheme } from '../theme/theme';
import Text from './Text';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
  disabled?: boolean;
};

function isLightHex(hex: string) {
  const h = (hex || '').trim();
  if (!h.startsWith('#')) return false;
  const clean = h.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62;
}

export default function Button({ label, onPress, variant, style, disabled }: Props) {
  const { theme } = useWRTheme();
  const colors = theme?.colors ?? {
    surface: '#0F141C',
    text: '#FFFFFF',
    border: '#1F2937',
    primary: '#E7C66B',
  };

  const isSecondary = variant === 'secondary';
  const bg = isSecondary ? colors.surface : colors.primary;
  const borderColor = isSecondary ? colors.border : 'transparent';
  const textColor = isSecondary ? colors.text : isLightHex(colors.primary) ? '#111111' : '#FFFFFF';

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 999,
          borderWidth: 1,
          borderColor,
          backgroundColor: bg,
          opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text style={{ fontWeight: '900', textAlign: 'center', color: textColor }}>{label}</Text>
    </Pressable>
  );
}
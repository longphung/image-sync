import { Pressable, Text } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';
import { colors } from '../theme/colors';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  /** `primary` = filled call-to-action, `secondary` = outlined/tinted, `text` = link-style. */
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  /** SF Symbol shown before the label (iOS only; Compose buttons stay text-only). */
  systemImage?: SFSymbol;
};

// Fallback (web) — iOS and Android use the platform-specific files next to this one. Plain RN
// because @expo/ui's web Button renders its outlined label nearly invisible.
export function ActionButton({ label, onPress, variant = 'primary', disabled }: ActionButtonProps) {
  const filled = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        alignSelf: 'stretch',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: filled ? colors.tint : 'transparent',
        borderWidth: variant === 'secondary' ? 1.5 : 0,
        borderColor: colors.tint,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: filled ? colors.onTint : colors.tint, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

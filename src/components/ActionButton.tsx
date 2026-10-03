import { Button, Host } from '@expo/ui';
import type { SFSymbol } from 'sf-symbols-typescript';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  /** `primary` = filled call-to-action, `secondary` = outlined/tinted, `text` = link-style. */
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  /** SF Symbol shown before the label (iOS only; Compose buttons stay text-only). */
  systemImage?: SFSymbol;
};

const variantMap = { primary: 'filled', secondary: 'outlined', text: 'text' } as const;

// Fallback (web) — iOS and Android use the platform-specific files next to this one.
export function ActionButton({ label, onPress, variant = 'primary', disabled }: ActionButtonProps) {
  return (
    <Host matchContents>
      <Button label={label} onPress={onPress} variant={variantMap[variant]} disabled={disabled} />
    </Host>
  );
}

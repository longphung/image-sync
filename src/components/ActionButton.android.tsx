import { Host } from '@expo/ui';
import { Button, OutlinedButton, Text, TextButton } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import type { ActionButtonProps } from './ActionButton';

// Material 3: filled for the primary action, outlined for secondary, text for tertiary.
const componentFor = { primary: Button, secondary: OutlinedButton, text: TextButton } as const;

export function ActionButton({ label, onPress, variant = 'primary', disabled }: ActionButtonProps) {
  const Component = componentFor[variant];
  return (
    <Host matchContents={{ vertical: true }}>
      <Component
        onClick={onPress}
        enabled={!disabled}
        modifiers={variant === 'text' ? [] : [fillMaxWidth()]}
      >
        <Text>{label}</Text>
      </Component>
    </Host>
  );
}

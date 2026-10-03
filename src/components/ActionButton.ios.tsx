import { Platform } from 'react-native';
import { Host } from '@expo/ui';
import { Button, Label, Text } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, disabled as disabledMod, frame } from '@expo/ui/swift-ui/modifiers';
import type { ActionButtonProps } from './ActionButton';

// Liquid glass button styles exist from iOS 26; older systems get the classic bordered styles
// (SwiftUI would otherwise silently fall back to a plain, unstyled button).
const supportsGlass = parseInt(String(Platform.Version), 10) >= 26;

const styleFor = {
  primary: supportsGlass ? 'glassProminent' : 'borderedProminent',
  secondary: supportsGlass ? 'glass' : 'bordered',
  text: 'borderless',
} as const;

export function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  systemImage,
}: ActionButtonProps) {
  // Stretch the label so the glass capsule spans the full row width, like the design.
  const fill = variant === 'text' ? [] : [frame({ maxWidth: Infinity })];
  return (
    <Host matchContents={{ vertical: true }}>
      <Button
        onPress={onPress}
        modifiers={[buttonStyle(styleFor[variant]), controlSize('large'), disabledMod(!!disabled)]}
      >
        {systemImage ? (
          <Label title={label} systemImage={systemImage} modifiers={fill} />
        ) : (
          <Text modifiers={fill}>{label}</Text>
        )}
      </Button>
    </Host>
  );
}

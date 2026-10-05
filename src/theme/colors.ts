import { Platform, type ColorValue } from 'react-native';
import { Color } from 'expo-router';

// Native semantic colors: UIKit system colors on iOS, Material 3 dynamic (wallpaper-based)
// colors on Android. Both adapt to light/dark mode on-device.
function pick(ios: ColorValue, android: ColorValue, fallback: string): ColorValue {
  return Platform.select({ ios, android, default: fallback })!;
}

export const colors = {
  background: pick(Color.ios.systemGroupedBackground, Color.android.dynamic.surface, '#f2f2f7'),
  card: pick(
    Color.ios.secondarySystemGroupedBackground,
    Color.android.dynamic.surfaceContainerLow,
    '#ffffff',
  ),
  label: pick(Color.ios.label, Color.android.dynamic.onSurface, '#000000'),
  secondaryLabel: pick(Color.ios.secondaryLabel, Color.android.dynamic.onSurfaceVariant, '#55555e'),
  separator: pick(Color.ios.separator, Color.android.dynamic.outlineVariant, '#c6c6c8'),
  fill: pick(Color.ios.tertiarySystemFill, Color.android.dynamic.surfaceContainerHighest, '#7676801f'),
  tint: pick(Color.ios.systemBlue, Color.android.dynamic.primary, '#0062cc'),
  onTint: pick('#ffffff', Color.android.dynamic.onPrimary, '#ffffff'),
  // Material 3 has no success role; a fixed green reads fine on both surface tones.
  success: pick(Color.ios.systemGreen, '#1e8e3e', '#34c759'),
  error: pick(Color.ios.systemRed, Color.android.dynamic.error, '#ff3b30'),
};

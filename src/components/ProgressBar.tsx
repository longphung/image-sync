import { View } from 'react-native';
import { colors } from '../theme/colors';

export type ProgressBarProps = {
  /** 0–1 */
  progress: number;
};

// Fallback (web) — iOS and Android use the native indicators in the platform files.
export function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.fill, overflow: 'hidden' }}>
      <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: colors.tint }} />
    </View>
  );
}

import { Host } from '@expo/ui';
import { LinearWavyProgressIndicator } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import type { ProgressBarProps } from './ProgressBar';

export function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <Host matchContents={{ vertical: true }}>
      <LinearWavyProgressIndicator progress={progress} modifiers={[fillMaxWidth()]} />
    </Host>
  );
}

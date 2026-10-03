import { Host } from '@expo/ui';
import { ProgressView } from '@expo/ui/swift-ui';
import type { ProgressBarProps } from './ProgressBar';

export function ProgressBar({ progress }: ProgressBarProps) {
  return (
    <Host matchContents={{ vertical: true }}>
      <ProgressView value={progress} />
    </Host>
  );
}

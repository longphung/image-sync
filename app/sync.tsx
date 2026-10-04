import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { Image } from 'expo-image';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ImageItem } from '../src/camera';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { ActionButton } from '../src/components/ActionButton';
import { Card } from '../src/components/Card';
import { ProgressBar } from '../src/components/ProgressBar';
import { downloadToPhotosDir } from '../src/fileSystem';
import { colors } from '../src/theme/colors';

type Counts = { downloaded: number; skipped: number; failed: number };

export default function SyncScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const { images } = useCameraConnection();
  // Snapshot so a list refresh mid-sync can't change what's being iterated.
  const [queue] = useState<ImageItem[]>(() => images);
  const [index, setIndex] = useState(0);
  const [current, setCurrent] = useState<ImageItem | null>(null);
  const [counts, setCounts] = useState<Counts>({ downloaded: 0, skipped: 0, failed: 0 });
  const [lastError, setLastError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  // Integer 0–100 for the file in flight; null until the first progress event (or size unknown).
  const [filePercent, setFilePercent] = useState<number | null>(null);
  // One controller per run, so a stale loop (e.g. a re-run effect) can never be revived,
  // and aborting it stops the in-flight download immediately.
  const runRef = useRef(new AbortController());

  useEffect(() => {
    const run = new AbortController();
    runRef.current = run;
    (async () => {
      for (let i = 0; i < queue.length; i++) {
        if (run.signal.aborted) break;
        const item = queue[i];
        setIndex(i);
        setCurrent(item);
        try {
          const wrote = await downloadToPhotosDir(item.url, item.filename, {
            signal: run.signal,
            onPercent: setFilePercent,
          });
          setCounts((c) => (wrote ? { ...c, downloaded: c.downloaded + 1 } : { ...c, skipped: c.skipped + 1 }));
        } catch (err) {
          if (run.signal.aborted) break; // the AbortError from Cancel isn't a failure
          console.log('[Sync] download error', { url: item.url, error: err });
          setCounts((c) => ({ ...c, failed: c.failed + 1 }));
          setLastError(err instanceof Error ? err.message : String(err));
        }
        setIndex(i + 1);
        setFilePercent(null);
      }
      if (run.signal.aborted) return;
      setCurrent(null);
      setRunning(false);
    })();
    return () => run.abort();
  }, [queue]);

  const handleCancel = useCallback(() => {
    runRef.current.abort();
    router.back();
  }, []);

  const total = queue.length;
  // Count the in-flight file's share so the bar keeps moving through a single large video.
  const progress = total === 0 ? 1 : (index + (filePercent ?? 0) / 100) / total;
  const percent = Math.round(progress * 100);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 20, flexGrow: 1 }}
    >
      <Stack.Screen options={{ headerBackVisible: false }} />

      <View style={{ gap: 4 }}>
        <Text style={{ color: colors.label, fontSize: 22, fontWeight: '700' }}>
          {running ? <Trans>Syncing photos…</Trans> : <Trans>Sync complete</Trans>}
        </Text>
        <Text style={{ color: colors.secondaryLabel, fontSize: 17 }}>
          <Trans>
            {index} of {total}
          </Trans>
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <ProgressBar progress={progress} />
        </View>
        <Text style={{ color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }}>{percent}%</Text>
      </View>

      {current && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Image
            source={{ uri: current.thumbnailUrl }}
            style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.fill }}
            contentFit="cover"
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: colors.label }} numberOfLines={1}>
              {current.filename}
            </Text>
            {filePercent !== null && (
              <Text style={{ color: colors.secondaryLabel, fontVariant: ['tabular-nums'] }}>
                {filePercent}%
              </Text>
            )}
          </View>
        </View>
      )}

      <Card style={{ flexDirection: 'row', gap: 0, paddingHorizontal: 0 }}>
        <Stat value={counts.downloaded} label={t`downloaded`} />
        <Stat value={counts.skipped} label={t`already on device`} divider />
        <Stat value={counts.failed} label={t`failed`} divider />
      </Card>

      {lastError && (
        <Text style={{ color: colors.error }} selectable>
          {lastError}
        </Text>
      )}

      <View style={{ flex: 1 }} />
      <ActionButton
        label={running ? t`Cancel` : t`Done`}
        variant={running ? 'secondary' : 'primary'}
        onPress={handleCancel}
      />
    </ScrollView>
  );
}

function Stat({ value, label, divider }: { value: number; label: string; divider?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: 16,
        gap: 2,
        borderLeftWidth: divider ? 0.5 : 0,
        borderLeftColor: colors.separator,
      }}
    >
      <Text style={{ color: colors.label, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
      <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { Image } from 'expo-image';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ImageItem } from '../src/camera';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { ActionButton } from '../src/components/ActionButton';
import { Card } from '../src/components/Card';
import { ProgressBar } from '../src/components/ProgressBar';
import { downloadToPhotosDir, saveAllToLibrary, saveToLibrary } from '../src/fileSystem';
import { runSync, type Download, type SyncCounts, type SyncFailure } from '../src/sync';
import { colors } from '../src/theme/colors';

const NO_COUNTS: SyncCounts = { downloaded: 0, skipped: 0, failed: 0 };
// A browser share needs a fresh tap each time, so the web build downloads everything first and
// saves it all with one "Save All" tap at the end.
const SAVE_AT_END = Platform.OS === 'web';
// Browsers only offer the share sheet (-> Save to Photos) over HTTPS; the hub serves plain http,
// where saveAllToLibrary falls back to one browser download (a zip), which lands in Downloads.
// That needs no tap, so it starts on its own when the sync finishes.
const CAN_SHARE = SAVE_AT_END && window.isSecureContext && 'share' in navigator;

export default function SyncScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const { images } = useCameraConnection();
  // Snapshot so a list refresh mid-sync can't change what's being iterated. "Retry Failed"
  // replaces it with just the failed items, which starts a new run.
  const [queue, setQueue] = useState<ImageItem[]>(() => images);
  const [index, setIndex] = useState(0);
  const [current, setCurrent] = useState<ImageItem | null>(null);
  const [counts, setCounts] = useState<SyncCounts>(NO_COUNTS);
  const [failures, setFailures] = useState<SyncFailure[]>([]);
  const [stoppedEarly, setStoppedEarly] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  // Integer 0–100 for the file in flight; null until the first progress event (or size unknown).
  const [filePercent, setFilePercent] = useState<number | null>(null);
  // One controller per run, so a stale loop (e.g. a re-run effect) can never be revived,
  // and aborting it stops the in-flight download immediately.
  const runRef = useRef(new AbortController());
  // Web only: files downloaded by this screen, waiting for "Save All".
  const [toSave, setToSave] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Web over http: the zip download has been started at least once (it can be started again).
  const [downloadedOnce, setDownloadedOnce] = useState(false);

  useEffect(() => {
    const run = new AbortController();
    runRef.current = run;
    setIndex(0);
    setCounts(NO_COUNTS);
    setFailures([]);
    setStoppedEarly(null);
    setRunning(true);
    // A file already in app storage was saved to Photos by the run that downloaded it, so only
    // new downloads go to the library; otherwise every re-sync would duplicate them there.
    const fresh: string[] = [];
    const download: Download = async (item, opts) => {
      const wrote = await downloadToPhotosDir(item.url, item.filename, opts);
      if (wrote && SAVE_AT_END) {
        fresh.push(item.filename);
        setToSave((prev) => [...prev, item.filename]);
      }
      else if (wrote) await saveToLibrary(item.filename, { onPercent: opts.onPercent });
      return wrote;
    };
    runSync(queue, download, run.signal, {
      onStart: (i, item) => {
        setIndex(i);
        setCurrent(item);
        setFilePercent(null);
      },
      onPercent: setFilePercent,
      onResult: (c, f) => {
        setCounts(c);
        setFailures(f);
      },
    })
      .then((result) => {
        if (run.signal.aborted) return;
        result.failures.forEach((f) => console.log('[Sync] failed', f.item.filename, f.message));
        setStoppedEarly(result.stoppedEarly);
        // A run that stopped early didn't get through the list; leave the bar where it stopped.
        if (!result.stoppedEarly) setIndex(queue.length);
        if (SAVE_AT_END && !CAN_SHARE && fresh.length > 0) {
          saveAllToLibrary(fresh)
            .then(() => setDownloadedOnce(true))
            .catch((err) => setSaveError(err instanceof Error ? err.message : String(err)));
        }
      })
      .catch((err) => {
        // runSync catches each download's errors; this is a bug, but don't leave the screen stuck.
        if (!run.signal.aborted) setStoppedEarly(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (run.signal.aborted) return;
        setCurrent(null);
        setFilePercent(null);
        setRunning(false);
      });
    return () => run.abort();
  }, [queue]);

  const retryable = failures.filter((f) => f.retryable).map((f) => f.item);
  const handleRetry = useCallback(() => setQueue(retryable), [retryable]);

  const handleSaveAll = useCallback(async () => {
    setSaveError(null);
    try {
      await saveAllToLibrary(toSave);
      // A browser download can't report whether it landed, so keep the button to start it again.
      if (CAN_SHARE) setToSave([]);
      else setDownloadedOnce(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [toSave]);

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
          {running ? (
            <Trans>Syncing photos…</Trans>
          ) : toSave.length > 0 && !downloadedOnce ? (
            <Trans>Downloaded, not saved yet</Trans>
          ) : stoppedEarly ? (
            <Trans>Sync stopped</Trans>
          ) : counts.failed > 0 ? (
            <Trans>Sync finished with errors</Trans>
          ) : (
            <Trans>Sync complete</Trans>
          )}
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

      {stoppedEarly && (
        <Text style={{ color: colors.error }} selectable>
          {stoppedEarly}
        </Text>
      )}

      {failures.length > 0 && (
        <Card style={{ gap: 8 }}>
          {failures.map((f, i) => (
            <View key={`${f.item.filename}-${i}`} style={{ gap: 2 }}>
              <Text style={{ color: colors.label }} numberOfLines={1}>
                {f.item.filename}
              </Text>
              <Text style={{ color: colors.error, fontSize: 13 }} selectable>
                {f.message}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {!running && toSave.length > 0 && (
        <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
          {CAN_SHARE ? (
            <Trans>Tap Save All, then choose Save to Photos. Leaving this screen discards them.</Trans>
          ) : downloadedOnce ? (
            <Trans>
              Saved as one zip in Downloads (the Files app on iPhone). Open it there, then save the
              photos to Photos. Nothing downloaded? Tap Download All.
            </Trans>
          ) : (
            <Trans>Tap Download All to save them as one zip. Leaving this screen discards them.</Trans>
          )}
        </Text>
      )}

      {SAVE_AT_END && !CAN_SHARE && !running && toSave.length > 0 && (
        <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
          <Trans>
            To save straight to Photos instead,{' '}
            <Text style={{ color: colors.tint }} onPress={() => Linking.openURL('/ca.crt')}>
              install this desktop's certificate
            </Text>
            , then{' '}
            <Text style={{ color: colors.tint }} onPress={() => Linking.openURL(`https://${location.host}/app/`)}>
              open the secure page
            </Text>{' '}
            and pair again. On iPhone, install it in Settings › Profile Downloaded, then turn it on in
            General › About › Certificate Trust Settings.
          </Trans>
        </Text>
      )}

      {saveError && (
        <Text style={{ color: colors.error }} selectable>
          {saveError}
        </Text>
      )}

      <View style={{ flex: 1 }} />
      {!running && toSave.length > 0 && (
        <ActionButton
          label={CAN_SHARE ? t`Save All (${toSave.length})` : t`Download All (${toSave.length})`}
          onPress={handleSaveAll}
        />
      )}
      {!running && retryable.length > 0 && (
        <ActionButton label={t`Retry Failed (${retryable.length})`} onPress={handleRetry} />
      )}
      <ActionButton
        label={running ? t`Cancel` : t`Done`}
        variant={running || retryable.length > 0 || (toSave.length > 0 && !downloadedOnce) ? 'secondary' : 'primary'}
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

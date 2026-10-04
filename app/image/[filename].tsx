import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SymbolView } from 'expo-symbols';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { File } from 'expo-file-system';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCameraConnection } from '../../src/CameraConnectionContext';
import { ActionButton } from '../../src/components/ActionButton';
import { downloadToPhotosDir, fileUriFor, isVideoFile } from '../../src/fileSystem';
import { convertToMp4, needsMp4Conversion } from '../../src/convertVideo';

type SaveState = 'idle' | 'saving' | 'converting' | 'done' | 'error';

export default function ImageDetailScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const { cameraName } = useCameraConnection();
  const { filename, title, url, thumbnailUrl } = useLocalSearchParams<{
    filename: string;
    title: string;
    url: string;
    thumbnailUrl: string;
  }>();

  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState<string | null>(null);
  // Starts idle even if Sync All already put the file in app storage — that copy isn't in
  // the Photos library yet. downloadToPhotosDir() skips the re-download in that case.
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  // Integer 0–100 while saving; null until the first progress event (or size unknown).
  const [savePercent, setSavePercent] = useState<number | null>(null);
  const isVideo = isVideoFile(filename);
  // The preview downloads (and converts) the video itself; Save waits for it so the two
  // never write the same .part file at once.
  const [videoReady, setVideoReady] = useState(false);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    setSaveErrorMessage(null);
    setSavePercent(null);
    try {
      const result = await downloadToPhotosDir(url, filename, { onPercent: setSavePercent });
      console.log('[ImageDetail] download finished', { result });
      const { status } = await requestPermissionsAsync(true); // add-only, no full-library read prompt
      if (status !== 'granted') {
        throw new Error(t`Photo library access is needed to save this file.`);
      }
      let saveUri = fileUriFor(filename);
      if (needsMp4Conversion(filename)) {
        setSaveState('converting');
        setSavePercent(null);
        saveUri = (await convertToMp4(new File(saveUri), setSavePercent)).uri;
      }
      await Asset.create(saveUri);
      setSaveState('done');
    } catch (err) {
      console.log('[ImageDetail] save error', err);
      setSaveState('error');
      setSaveErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [url, filename, t]);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ title: '' }} />

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {isVideo ? (
          <VideoPreview url={url} filename={filename} onReady={() => setVideoReady(true)} />
        ) : (
          <>
            <Image
              source={{ uri: url }}
              placeholder={{ uri: thumbnailUrl }}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
              onLoadStart={() => setImageLoading(true)}
              onLoadEnd={() => setImageLoading(false)}
              onError={(e) => {
                console.log('[ImageDetail] image load error', { url, error: e.error });
                setImageLoading(false);
                setImageError(t`Failed to load image`);
              }}
            />
            {imageLoading && (
              <ActivityIndicator style={{ position: 'absolute' }} size="large" color="#fff" />
            )}
          </>
        )}
      </View>

      <View style={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 12 }}>
        {imageError && <Text style={{ color: '#ff453a' }}>{imageError}</Text>}
        <View style={{ gap: 2 }}>
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600' }} numberOfLines={1}>
            {filename}
          </Text>
          <Text style={{ color: '#ffffff99', fontSize: 13 }} numberOfLines={1}>
            {cameraName ?? title}
          </Text>
        </View>

        {saveState === 'done' ? (
          <View
            style={{
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: '#ffffff22',
            }}
          >
            <SymbolView name={{ ios: 'checkmark', android: 'check_circle' }} size={14} tintColor="#fff" />
            <Text style={{ color: '#fff', fontSize: 13 }}>
              <Trans>Saved to Photos</Trans>
            </Text>
          </View>
        ) : (
          <ActionButton
            label={
              saveState === 'saving'
                ? savePercent !== null ? t`Saving… ${savePercent}%` : t`Saving…`
                : saveState === 'converting'
                  ? savePercent !== null ? t`Converting… ${savePercent}%` : t`Converting…`
                : saveState === 'error'
                  ? t`Retry Save`
                  : t`Save to Photos`
            }
            systemImage="square.and.arrow.down"
            onPress={handleSave}
            disabled={saveState === 'saving' || saveState === 'converting' || (isVideo && !videoReady)}
          />
        )}
        {saveErrorMessage && (
          <Text style={{ color: '#ff453a' }} selectable>
            {saveErrorMessage}
          </Text>
        )}
      </View>
    </View>
  );
}

// Plays a local copy: streaming from the camera fails for AVCHD (.MTS isn't decodable on iOS)
// and AVPlayer won't stream from servers without byte-range support. The download and the
// converted .mp4 both stay in camera-photos, so Save to Photos reuses them.
function VideoPreview({ url, filename, onReady }: { url: string; filename: string; onReady: () => void }) {
  const { t } = useLingui();
  const [stage, setStage] = useState<'downloading' | 'converting' | 'error'>('downloading');
  const [percent, setPercent] = useState<number | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        await downloadToPhotosDir(url, filename, { signal: controller.signal, onPercent: setPercent });
        let uri = fileUriFor(filename);
        if (needsMp4Conversion(filename)) {
          if (controller.signal.aborted) return;
          setStage('converting');
          setPercent(null);
          uri = (await convertToMp4(new File(uri), setPercent)).uri;
        }
        if (controller.signal.aborted) return;
        setLocalUri(uri);
        onReady();
      } catch (err) {
        if (controller.signal.aborted) return;
        console.log('[VideoPreview] prepare error', err);
        setStage('error');
      }
    })();
    return () => controller.abort();
    // onReady is an inline callback; re-running on it would restart the download.
  }, [url, filename]);

  if (localUri) return <LocalVideo uri={localUri} />;
  if (stage === 'error') {
    return <Text style={{ color: '#ffffffcc', padding: 24, textAlign: 'center' }}>{t`Couldn't load this video`}</Text>;
  }
  const label =
    stage === 'converting'
      ? percent !== null ? t`Converting… ${percent}%` : t`Converting…`
      : percent !== null ? t`Loading video… ${percent}%` : t`Loading video…`;
  return (
    <View style={{ alignItems: 'center', gap: 12 }}>
      <ActivityIndicator size="large" color="#fff" />
      <Text style={{ color: '#ffffffcc' }}>{label}</Text>
    </View>
  );
}

function LocalVideo({ uri }: { uri: string }) {
  const { t } = useLingui();
  const player = useVideoPlayer(uri, (p) => p.play());
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  if (status === 'error') {
    return <Text style={{ color: '#ffffffcc', padding: 24, textAlign: 'center' }}>{t`Can't play this video format`}</Text>;
  }
  return <VideoView player={player} nativeControls contentFit="contain" style={{ width: '100%', height: '100%' }} />;
}

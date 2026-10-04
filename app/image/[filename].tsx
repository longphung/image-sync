import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SymbolView } from 'expo-symbols';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { Trans, useLingui } from '@lingui/react/macro';
import { downloadImage } from 'image-sync-core';
import { useCameraConnection } from '../../src/CameraConnectionContext';
import { ActionButton } from '../../src/components/ActionButton';
import { destPathFor, fileUriFor, isVideoFile } from '../../src/fileSystem';

type SaveState = 'idle' | 'saving' | 'done' | 'error';

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
  // the Photos library yet. downloadImage() skips the re-download in that case.
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaveState('saving');
    setSaveErrorMessage(null);
    // downloadImage() blocks the JS thread — let the "Saving…" state paint first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const result = downloadImage(url, destPathFor(filename));
      console.log('[ImageDetail] download finished', { result });
      const { status } = await requestPermissionsAsync(true); // add-only, no full-library read prompt
      if (status !== 'granted') {
        throw new Error(t`Photo library access is needed to save this file.`);
      }
      await Asset.create(fileUriFor(filename));
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
        {isVideoFile(filename) ? (
          <VideoPreview url={url} />
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
                ? t`Saving…`
                : saveState === 'error'
                  ? t`Retry Save`
                  : t`Save to Photos`
            }
            systemImage="square.and.arrow.down"
            onPress={handleSave}
            disabled={saveState === 'saving'}
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

function VideoPreview({ url }: { url: string }) {
  const { t } = useLingui();
  // Streams straight from the camera over HTTP; nothing is downloaded until Save.
  const player = useVideoPlayer(url);
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  if (status === 'error') {
    // e.g. AVCHD .MTS, which AVPlayer can't decode.
    return <Text style={{ color: '#ffffffcc', padding: 24, textAlign: 'center' }}>{t`Can't play this video format`}</Text>;
  }
  return (
    <>
      <VideoView player={player} nativeControls contentFit="contain" style={{ width: '100%', height: '100%' }} />
      {status === 'loading' && (
        <ActivityIndicator style={{ position: 'absolute' }} size="large" color="#fff" />
      )}
    </>
  );
}

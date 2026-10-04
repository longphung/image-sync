import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Trans, useLingui } from '@lingui/react/macro';
import type { ImageItem } from '../src/camera';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { ActionButton } from '../src/components/ActionButton';
import { isVideoFile, listDownloadedFilenames } from '../src/fileSystem';
import { colors } from '../src/theme/colors';

const COLUMNS = 3;
// Half the visual gap — each tile pads itself, so neighbours add up to a 2pt gutter.
const TILE_INSET = 1;
const badgeShadow = { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 2, shadowOffset: { width: 0, height: 0 } };

export default function ImagesScreen() {
  const { t } = useLingui();
  const { api, host, cameraName, disconnect, images, imagesStatus, imagesError, refreshImages } =
    useCameraConnection();
  const insets = useSafeAreaInsets();
  const [downloaded, setDownloaded] = useState<Set<string>>(() => listDownloadedFilenames());

  // Only for a JS reload landing here with no connection; Disconnect navigates by itself.
  useEffect(() => {
    if (!api) router.replace('/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // List automatically on first open; the "Retry" button covers failures.
  useEffect(() => {
    if (api && imagesStatus === 'idle') refreshImages();
  }, [api, imagesStatus, refreshImages]);

  // Re-read on focus so badges update after returning from Sync All or the detail screen.
  useFocusEffect(
    useCallback(() => {
      setDownloaded(listDownloadedFilenames());
    }, []),
  );

  const handleOpenImage = useCallback((item: ImageItem) => {
    router.push({
      pathname: '/image/[filename]',
      params: {
        filename: item.filename,
        title: item.title,
        url: item.url,
        thumbnailUrl: item.thumbnailUrl,
      },
    });
  }, []);

  // Back to the tab the connection came from.
  const handleDisconnect = useCallback(() => {
    router.dismissTo(api?.kind === 'desktop' ? '/' : '/camera');
    disconnect();
  }, [api, disconnect]);

  if (!api) {
    return null;
  }

  const videoCount = images.filter((item) => isVideoFile(item.filename)).length;
  const photoCount = images.length - videoCount;
  const subtitle =
    imagesStatus === 'loaded'
      ? t`${photoCount} photos · ${videoCount} videos`
      : imagesStatus === 'loading'
        ? t`Loading…`
        : '';

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: cameraName ?? host, headerBackTitle: t`Connect` }} />
      <LegendList
        data={images}
        numColumns={COLUMNS}
        keyExtractor={(item) => item.filename}
        recycleItems
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            {subtitle.length > 0 && (
              <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{subtitle}</Text>
            )}
            {images.length > 0 && (
              <ActionButton
                label={t`Sync All (${images.length})`}
                systemImage="arrow.down.circle"
                onPress={() => router.push('/sync')}
              />
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center', gap: 12 }}>
            {imagesStatus === 'error' ? (
              <>
                <Text style={{ color: colors.error, textAlign: 'center' }} selectable>
                  {imagesError}
                </Text>
                <ActionButton label={t`Retry`} variant="secondary" onPress={refreshImages} />
              </>
            ) : imagesStatus === 'loaded' ? (
              <Text style={{ color: colors.secondaryLabel }}>
                {api.kind === 'desktop' ? (
                  <Trans>No photos or videos on this desktop yet.</Trans>
                ) : (
                  <Trans>No photos or videos on the camera.</Trans>
                )}
              </Text>
            ) : (
              <ActivityIndicator size="large" />
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isVideo = isVideoFile(item.filename);
          return (
            <Pressable
              onPress={() => handleOpenImage(item)}
              style={{ aspectRatio: 1, padding: TILE_INSET }}
              accessibilityRole={isVideo ? 'button' : 'imagebutton'}
              accessibilityLabel={item.filename}
            >
              {item.thumbnailUrl ? (
                <Image
                  source={{ uri: item.thumbnailUrl }}
                  style={{ flex: 1, backgroundColor: colors.fill }}
                  contentFit="cover"
                  recyclingKey={item.filename}
                  transition={150}
                />
              ) : (
                <View style={{ flex: 1, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }}>
                  <SymbolView
                    name={isVideo ? { ios: 'film', android: 'movie' } : { ios: 'photo', android: 'image' }}
                    size={28}
                    tintColor={colors.secondaryLabel}
                  />
                </View>
              )}
              {isVideo && (
                <View style={{ position: 'absolute', left: 6, bottom: 6 }} pointerEvents="none">
                  <SymbolView
                    name={{ ios: 'play.fill', android: 'play_arrow' }}
                    size={18}
                    tintColor="#fff"
                    style={badgeShadow}
                  />
                </View>
              )}
              {downloaded.has(item.filename) && (
                <View style={{ position: 'absolute', right: 6, bottom: 6 }} pointerEvents="none">
                  <SymbolView
                    name={{ ios: 'checkmark.circle.fill', android: 'check_circle' }}
                    size={20}
                    tintColor="#fff"
                    style={badgeShadow}
                  />
                </View>
              )}
            </Pressable>
          );
        }}
        ListFooterComponent={
          <View style={{ padding: 16, paddingBottom: 16 + insets.bottom }}>
            <ActionButton label={t`Disconnect`} variant="secondary" onPress={handleDisconnect} />
          </View>
        }
      />
    </View>
  );
}

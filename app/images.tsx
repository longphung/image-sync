import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { CameraApi, downloadImage, listImages, type ImageItem } from 'image-sync-core';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { destPathFor, listDownloadedFilenames } from '../src/fileSystem';

export default function ImagesScreen() {
  const { t } = useLingui();
  const { api, disconnect } = useCameraConnection();

  const [images, setImages] = useState<ImageItem[]>([]);
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0, current: '' });

  useEffect(() => {
    if (!api) {
      router.replace('/');
    }
  }, [api]);

  const handleListImages = useCallback(() => {
    if (!api) return;
    const endpoint = CameraApi.Dlna.instanceOf(api)
      ? { type: 'Dlna', controlUrl: api.inner.controlUrl, photoRoot: api.inner.photoRoot }
      : CameraApi.Scalar.instanceOf(api)
        ? { type: 'Scalar', baseUrl: api.inner.baseUrl }
        : null;
    console.log('[Images] listing images from endpoint', endpoint);
    try {
      const items = listImages(api);
      console.log(
        '[Images] listImages result',
        items.map((item) => ({ filename: item.filename, url: item.url, thumbnailUrl: item.thumbnailUrl })),
      );
      setImages(items);
    } catch (err) {
      console.log('[Images] listImages error', { endpoint, error: err });
      setSyncErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  const handleOpenImage = useCallback((item: ImageItem) => {
    console.log('[Images] opening image detail', item);
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

  const handleSyncAll = useCallback(async () => {
    setSyncing(true);
    setSyncErrorMessage(null);
    setSyncProgress({ done: 0, total: images.length, current: '' });
    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      setSyncProgress({ done: i, total: images.length, current: item.filename });
      // Yield to the JS event loop so React flushes the "current file" label
      // before the next *synchronous*, blocking downloadImage() call starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const destPath = destPathFor(item.filename);
      console.log('[Images] downloading', { url: item.url, destPath });
      try {
        const result = downloadImage(item.url, destPath);
        console.log('[Images] download result', { url: item.url, result });
      } catch (err) {
        console.log('[Images] download error', { url: item.url, destPath, error: err });
        setSyncErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }
    setSyncProgress({ done: images.length, total: images.length, current: '' });
    setSyncing(false);
  }, [images]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    router.replace('/');
  }, [disconnect]);

  if (!api) {
    return null;
  }

  const connectedLabel = CameraApi.Dlna.instanceOf(api)
    ? t`DLNA: ${api.inner.controlUrl}`
    : CameraApi.Scalar.instanceOf(api)
      ? t`Scalar: ${api.inner.baseUrl}`
      : null;

  const downloaded = listDownloadedFilenames();
  const totalToSync = syncProgress.total || images.length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      {connectedLabel && <Text style={styles.label}>{connectedLabel}</Text>}
      {syncErrorMessage && <Text style={styles.error}>{syncErrorMessage}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleListImages}>
        <Text style={styles.buttonText}>
          <Trans>List Images</Trans>
        </Text>
      </TouchableOpacity>

      {images.length > 0 && (
        <TouchableOpacity style={styles.button} onPress={handleSyncAll} disabled={syncing}>
          <Text style={styles.buttonText}>
            <Trans>
              Sync All ({syncProgress.done}/{totalToSync})
            </Trans>
          </Text>
        </TouchableOpacity>
      )}
      {syncing && <Text style={styles.label}>{syncProgress.current}</Text>}

      <LegendList
        style={styles.list}
        data={images}
        keyExtractor={(item) => item.filename}
        recycleItems
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => handleOpenImage(item)}>
            <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
            <View style={styles.rowText}>
              <Text numberOfLines={1}>{item.title}</Text>
              <Text style={styles.filename} numberOfLines={1}>
                {item.filename}
                {downloaded.has(item.filename) && <Trans> (on device)</Trans>}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
        <Text style={styles.buttonText}>
          <Trans>Disconnect</Trans>
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  label: {
    marginBottom: 4,
  },
  error: {
    color: 'red',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#2a6df4',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  disconnectButton: {
    backgroundColor: '#999',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    marginTop: 8,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 4,
    marginRight: 12,
    backgroundColor: '#eee',
  },
  rowText: {
    flex: 1,
  },
  filename: {
    color: '#666',
    fontSize: 12,
  },
});

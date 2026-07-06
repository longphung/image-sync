import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { CameraApi, downloadImage, listImages, type ImageItem } from 'image-sync-core';
import { useCameraConnection } from '../src/CameraConnectionContext';
import { destPathFor, listDownloadedFilenames } from '../src/fileSystem';

export default function ImagesScreen() {
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
    try {
      setImages(listImages(api));
    } catch (err) {
      setSyncErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

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
      try {
        downloadImage(item.url, destPathFor(item.filename));
      } catch (err) {
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
    ? `DLNA: ${api.inner.controlUrl}`
    : CameraApi.Scalar.instanceOf(api)
      ? `Scalar: ${api.inner.baseUrl}`
      : null;

  const downloaded = listDownloadedFilenames();

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      {connectedLabel && <Text style={styles.label}>{connectedLabel}</Text>}
      {syncErrorMessage && <Text style={styles.error}>{syncErrorMessage}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleListImages}>
        <Text style={styles.buttonText}>List Images</Text>
      </TouchableOpacity>

      {images.length > 0 && (
        <TouchableOpacity style={styles.button} onPress={handleSyncAll} disabled={syncing}>
          <Text style={styles.buttonText}>
            Sync All ({syncProgress.done}/{syncProgress.total || images.length})
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
          <View style={styles.row}>
            <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
            <View style={styles.rowText}>
              <Text numberOfLines={1}>{item.title}</Text>
              <Text style={styles.filename} numberOfLines={1}>
                {item.filename} {downloaded.has(item.filename) ? '(on device)' : ''}
              </Text>
            </View>
          </View>
        )}
      />

      <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
        <Text style={styles.buttonText}>Disconnect</Text>
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

import { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraApi, downloadImage, getCameraApi, listImages, type ImageItem } from 'image-sync-core';
import { destPathFor, listDownloadedFilenames } from './src/fileSystem';

type Status = 'idle' | 'connecting' | 'connected' | 'error';

export default function App() {
  const [host, setHost] = useState('192.168.122.1');
  const [status, setStatus] = useState<Status>('idle');
  const [api, setApi] = useState<CameraApi | null>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0, current: '' });

  const handleConnect = useCallback(() => {
    setStatus('connecting');
    setErrorMessage(null);
    setImages([]);
    try {
      const trimmed = host.trim();
      const resolved = getCameraApi(trimmed.length > 0 ? trimmed : undefined);
      setApi(resolved);
      setStatus('connected');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [host]);

  const handleListImages = useCallback(() => {
    if (!api) return;
    try {
      setImages(listImages(api));
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  const handleSyncAll = useCallback(async () => {
    setSyncing(true);
    setErrorMessage(null);
    const already = listDownloadedFilenames();
    setSyncProgress({ done: 0, total: images.length, current: '' });
    for (let i = 0; i < images.length; i++) {
      const item = images[i];
      setSyncProgress({ done: i, total: images.length, current: item.filename });
      // Yield to the JS event loop so React flushes the "current file" label
      // before the next *synchronous*, blocking downloadImage() call starts.
      await new Promise((resolve) => setTimeout(resolve, 0));
      try {
        // downloadImage() itself already skips existing files; `already` is
        // only used to render "on device" in the list without a wasted call.
        downloadImage(item.url, destPathFor(item.filename));
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }
    setSyncProgress({ done: images.length, total: images.length, current: '' });
    setSyncing(false);
  }, [images]);

  const connectedLabel = CameraApi.Dlna.instanceOf(api)
    ? `DLNA: ${api.inner.controlUrl}`
    : CameraApi.Scalar.instanceOf(api)
      ? `Scalar: ${api.inner.baseUrl}`
      : null;

  const downloaded = listDownloadedFilenames();

  return (
    <View style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Image Sync</Text>

      <Text style={styles.label}>Status: {status}</Text>
      {connectedLabel && <Text style={styles.label}>{connectedLabel}</Text>}
      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <TextInput
        value={host}
        onChangeText={setHost}
        placeholder="192.168.122.1"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <TouchableOpacity style={styles.button} onPress={handleConnect}>
        <Text style={styles.buttonText}>Connect</Text>
      </TouchableOpacity>

      {status === 'connected' && (
        <TouchableOpacity style={styles.button} onPress={handleListImages}>
          <Text style={styles.buttonText}>List Images</Text>
        </TouchableOpacity>
      )}

      {images.length > 0 && (
        <TouchableOpacity style={styles.button} onPress={handleSyncAll} disabled={syncing}>
          <Text style={styles.buttonText}>
            Sync All ({syncProgress.done}/{syncProgress.total || images.length})
          </Text>
        </TouchableOpacity>
      )}
      {syncing && <Text style={styles.label}>{syncProgress.current}</Text>}

      <FlatList
        style={styles.list}
        data={images}
        keyExtractor={(item) => item.filename}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  label: {
    marginBottom: 4,
  },
  error: {
    color: 'red',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#2a6df4',
    borderRadius: 6,
    padding: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    marginTop: 8,
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

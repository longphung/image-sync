import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { downloadImage } from 'image-sync-core';
import { destPathFor, listDownloadedFilenames } from '../../src/fileSystem';

type DownloadState = 'idle' | 'downloading' | 'done' | 'error';

export default function ImageDetailScreen() {
  const { t } = useLingui();
  const { filename, title, url, thumbnailUrl } = useLocalSearchParams<{
    filename: string;
    title: string;
    url: string;
    thumbnailUrl: string;
  }>();

  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<DownloadState>(() =>
    listDownloadedFilenames().has(filename) ? 'done' : 'idle',
  );
  const [downloadErrorMessage, setDownloadErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    console.log('[ImageDetail] params received', { filename, title, url, thumbnailUrl });
  }, [filename, title, url, thumbnailUrl]);

  const handleDownload = useCallback(() => {
    console.log('[ImageDetail] download start', { url, destPath: destPathFor(filename) });
    setDownloadState('downloading');
    setDownloadErrorMessage(null);
    try {
      const result = downloadImage(url, destPathFor(filename));
      console.log('[ImageDetail] download finished', { result });
      setDownloadState('done');
    } catch (err) {
      console.log('[ImageDetail] download error', err);
      setDownloadState('error');
      setDownloadErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [url, filename]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <Stack.Screen options={{ title }} />

      <View style={styles.imageContainer}>
        <Image
          source={{ uri: url }}
          style={styles.fullImage}
          resizeMode="contain"
          onLoadStart={() => {
            console.log('[ImageDetail] image load start', { url });
            setImageLoading(true);
          }}
          onLoad={(e) => {
            console.log('[ImageDetail] image load success', e.nativeEvent);
          }}
          onLoadEnd={() => {
            console.log('[ImageDetail] image load end', { url });
            setImageLoading(false);
          }}
          onError={(e) => {
            console.log('[ImageDetail] image load error', { url, error: e.nativeEvent.error });
            setImageLoading(false);
            setImageError(t`Failed to load image`);
          }}
        />
        {imageLoading && <ActivityIndicator style={styles.loadingIndicator} size="large" color="#fff" />}
      </View>

      {imageError && <Text style={styles.error}>{imageError}</Text>}

      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.filename} numberOfLines={1}>
        {filename}
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={handleDownload}
        disabled={downloadState === 'downloading'}
      >
        <Text style={styles.buttonText}>
          {downloadState === 'downloading' && <Trans>Downloading…</Trans>}
          {downloadState === 'done' && <Trans>Downloaded</Trans>}
          {downloadState === 'error' && <Trans>Retry Download</Trans>}
          {downloadState === 'idle' && <Trans>Download</Trans>}
        </Text>
      </TouchableOpacity>
      {downloadErrorMessage && <Text style={styles.error}>{downloadErrorMessage}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  imageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  loadingIndicator: {
    position: 'absolute',
  },
  error: {
    color: 'red',
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontWeight: '600',
    marginTop: 8,
  },
  filename: {
    color: '#999',
    fontSize: 12,
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
});

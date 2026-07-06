import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CameraConnectionProvider } from '../src/CameraConnectionContext';

export default function RootLayout() {
  return (
    <CameraConnectionProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Connect' }} />
        <Stack.Screen name="images" options={{ title: 'Images' }} />
      </Stack>
    </CameraConnectionProvider>
  );
}

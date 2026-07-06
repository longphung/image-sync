import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CameraConnectionProvider } from '../src/CameraConnectionContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <CameraConnectionProvider>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="index" options={{ title: 'Connect' }} />
            <Stack.Screen name="images" options={{ title: 'Images' }} />
          </Stack>
        </CameraConnectionProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

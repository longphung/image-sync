import '../src/i18n';
import { i18n } from '../src/i18n';
import { I18nProvider } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CameraConnectionProvider } from '../src/CameraConnectionContext';

function AppNavigator() {
  const { t } = useLingui();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t`Connect` }} />
      <Stack.Screen name="images" options={{ title: t`Images` }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <CameraConnectionProvider>
          <I18nProvider i18n={i18n}>
            <StatusBar style="auto" />
            <AppNavigator />
          </I18nProvider>
        </CameraConnectionProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useLingui } from '@lingui/react/macro';

// Desktop comes first, so it's the tab the app opens on.
export default function TabsLayout() {
  const { t } = useLingui();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="(desktops)">
        <NativeTabs.Trigger.Label>{t`Desktop`}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="desktopcomputer" md="computer" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="camera">
        <NativeTabs.Trigger.Label>{t`Camera`}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="camera" md="photo_camera" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

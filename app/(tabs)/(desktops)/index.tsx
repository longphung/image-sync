import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, Stack, useIsFocused } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Trans, useLingui } from '@lingui/react/macro';
import { firstReachable, listImagesDesktop, type PairedDesktop } from '../../../src/camera';
import { errorMessage as messageOf } from '../../../src/camera/http';
import { DESKTOP_TIMEOUT_MS, useCameraConnection } from '../../../src/CameraConnectionContext';
import { useDesktopDiscovery, type FoundDesktop } from '../../../src/desktopDiscovery';
import { ActionButton } from '../../../src/components/ActionButton';
import { Card } from '../../../src/components/Card';
import { colors } from '../../../src/theme/colors';

type Health = { state: 'checking' } | { state: 'online'; count: number } | { state: 'offline'; message: string };

// The address mDNS just found goes first: the stored LAN IP may have changed since pairing.
function withLanHost(desktop: PairedDesktop, lan: FoundDesktop | undefined): PairedDesktop {
  return lan ? { ...desktop, hosts: [lan.host, ...desktop.hosts.filter((h) => h !== lan.host)], port: lan.port } : desktop;
}

export default function DesktopsScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const { status, errorMessage, desktops, desktopId, connectDesktop, forgetDesktop } = useCameraConnection();
  const [scanKey, setScanKey] = useState(0);
  const found = useDesktopDiscovery(useIsFocused(), scanKey);
  const unpaired = Object.values(found).filter((f) => !desktops.some((d) => d.id === f.id));
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (status === 'connected' && desktopId) router.push('/images');
  }, [status, desktopId]);

  const checkAll = useCallback(async () => {
    setHealth(Object.fromEntries(desktops.map((d) => [d.id, { state: 'checking' } as Health])));
    await Promise.all(
      desktops.map(async (d) => {
        let h: Health;
        try {
          const { result } = await firstReachable(withLanHost(d, found[d.id]).hosts, d.port, (url) =>
            listImagesDesktop(url, d.token, DESKTOP_TIMEOUT_MS),
          );
          h = { state: 'online', count: result.length };
        } catch (err) {
          h = { state: 'offline', message: messageOf(err) };
        }
        setHealth((prev) => ({ ...prev, [d.id]: h }));
      }),
    );
    // `found` is read at call time on purpose: re-checking whenever mDNS answers would spam requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktops]);

  // Check once when the list first shows (and after pairing adds one); pull to refresh re-checks.
  useEffect(() => {
    checkAll();
  }, [checkAll]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setScanKey((k) => k + 1);
    await checkAll();
    setRefreshing(false);
  }, [checkAll]);

  // The web app has no camera to scan with, so it always pairs by code.
  const pairFound = useCallback(
    (f: FoundDesktop) => {
      const byCode = () =>
        router.push({ pathname: '/pair-code', params: { host: f.host, port: String(f.port), name: f.name } });
      if (Platform.OS === 'web') return byCode();
      Alert.alert(t`Pair with ${f.name}`, t`Scan the QR code on the desktop, or have it show a 6-digit code.`, [
        { text: t`Cancel`, style: 'cancel' },
        { text: t`Scan QR Code`, onPress: () => router.push('/scan-pairing') },
        { text: t`Use a Code`, onPress: byCode },
      ]);
    },
    [t],
  );

  const confirmRemove = useCallback(
    (d: PairedDesktop) => {
      Alert.alert(t`Remove ${d.name}?`, t`You'll need to pair with it again to see its photos.`, [
        { text: t`Cancel`, style: 'cancel' },
        { text: t`Remove`, style: 'destructive', onPress: () => forgetDesktop(d.id) },
      ]);
    },
    [t, forgetDesktop],
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <Stack.Screen options={{ title: t`Desktop` }} />
      <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>
        <Trans>Browse and download photos imported by the image-sync desktop app.</Trans>
      </Text>

      {desktops.length > 0 && (
        <Card>
          <Text style={{ color: colors.secondaryLabel, fontSize: 12, textTransform: 'uppercase' }}>
            <Trans>Paired</Trans>
          </Text>
          {desktops.map((d) => {
            const lan = found[d.id];
            const h = health[d.id];
            const active = desktopId === d.id;
            const connecting = active && status === 'connecting';
            const detail = active && errorMessage
              ? errorMessage
              : h?.state === 'offline'
                ? h.message
                : null;
            return (
              <View
                key={d.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.fill, borderRadius: 10, borderCurve: 'continuous' }}
              >
                <Pressable
                  onPress={() => connectDesktop(withLanHost(d, lan))}
                  disabled={status === 'connecting'}
                  accessibilityRole="button"
                  style={{ flex: 1, padding: 12, gap: 4 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor:
                          h?.state === 'online' ? colors.success : h?.state === 'offline' ? colors.error : colors.secondaryLabel,
                      }}
                    />
                    <Text style={{ flex: 1, color: colors.label, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
                      {d.name}
                    </Text>
                    {connecting || h?.state === 'checking' ? <ActivityIndicator /> : null}
                  </View>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13 }} numberOfLines={1}>
                    {h?.state === 'online'
                      ? t`${h.count} items` + (lan ? ` · ${t`On this network`}` : '')
                      : lan
                        ? t`On this network`
                        : d.hosts.join(' · ')}
                  </Text>
                  {detail ? (
                    <Text style={{ color: colors.error, fontSize: 13 }} numberOfLines={3} selectable>
                      {detail}
                    </Text>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => confirmRemove(d)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t`Remove ${d.name}`}
                  style={{ padding: 12 }}
                >
                  <SymbolView name={{ ios: 'trash', android: 'delete' }} size={20} tintColor={colors.error} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      {unpaired.length > 0 && (
        <Card>
          <Text style={{ color: colors.secondaryLabel, fontSize: 12, textTransform: 'uppercase' }}>
            <Trans>On this network</Trans>
          </Text>
          {unpaired.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => pairFound(f)}
              accessibilityRole="button"
              style={{ backgroundColor: colors.fill, borderRadius: 10, borderCurve: 'continuous', padding: 12, gap: 4 }}
            >
              <Text style={{ color: colors.label, fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
                {f.name}
              </Text>
              <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                <Trans>Not paired yet. Tap to pair.</Trans>
              </Text>
            </Pressable>
          ))}
        </Card>
      )}

      {desktops.length === 0 && unpaired.length === 0 && (
        <Text style={{ color: colors.secondaryLabel }}>
          <Trans>
            No desktops yet. Open the image-sync desktop app on your computer, then scan the pairing code in its
            Phone &amp; settings tab, or enter its address to pair with a code.
          </Trans>
        </Text>
      )}

      {Platform.OS !== 'web' && (
        <ActionButton
          label={t`Scan Pairing Code`}
          systemImage="qrcode.viewfinder"
          variant={desktops.length > 0 ? 'secondary' : 'primary'}
          onPress={() => router.push('/scan-pairing')}
        />
      )}
      <ActionButton
        label={t`Pair by Address and Code`}
        systemImage="number"
        variant="secondary"
        onPress={() => router.push('/pair-code')}
      />
    </ScrollView>
  );
}

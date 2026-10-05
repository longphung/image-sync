# image-sync

An iOS/Android app (Expo) that replaces Sony PlayMemories Mobile for pulling photos and videos off a
Sony RX100M3. It talks to the camera directly over its "Send to Smartphone" Wi-Fi access point, or to
the optional [desktop hub](desktop/README.md), which imports from the camera over USB and serves its
library to phones on the LAN.

The camera protocol (DLNA ContentDirectory, with a Scalar Web API fallback) is plain TypeScript in
`src/camera/`. No native code is involved.

## Features

- **Camera tab:** join the camera's `DIRECT-...` Wi-Fi from inside the app (or read the SSID/password
  off the camera's label with OCR), then auto-connect to the camera at `192.168.122.1`, with a manual IP
  override
- **Desktops tab:** pair with a desktop hub by scanning its QR code or typing the 6-digit code it pops
  up, find hubs on the LAN over mDNS (or enter an address), and pull to refresh
- **Web app:** the desktop hub serves a web build at `http://<hub>:8765/app` (Desktop tab only; a
  browser can't reach the camera)
- Browse photos and videos in a grid (newest first), showing which ones are already on the device
- Photo and video detail. AVCHD `.MTS` clips are converted to `.mp4` on the phone (FFmpegKit) so they
  play and can be saved
- Save to Photos, one item at a time or with Sync All (downloaded/skipped/failed counts, cancel)
- Downloads run natively off the JS thread, with progress and `.part` files so an interrupted download
  is never mistaken for a finished one
- English and Vietnamese UI (Lingui)

## Requirements

- Node + [pnpm](https://pnpm.io) (version pinned in `package.json`'s `packageManager`)
- Xcode (iOS) and/or Android Studio (Android)
- A development build. The app uses native modules, so Expo Go won't work

## Getting started

```sh
pnpm install

# Generate native projects and run
npx expo prebuild --clean
pnpm ios                # or: pnpm android
```

`ios/` and `android/` are generated. Re-run `npx expo prebuild --clean` after changing `app.json` or
adding a native dependency.

After changing UI strings, run `pnpm i18n:extract` and fill in the translations in `src/locales/`.

## Testing

```sh
pnpm test               # protocol parsing, desktop API client, Sync All rules (Node test runner)
npx tsc --noEmit
```

The tests use inline XML/JSON fixtures and need no camera. Real end-to-end testing needs a physical
RX100M3 in "Send to Smartphone" mode.

## iOS with a free Apple ID

Joining Wi-Fi from inside the app needs the Hotspot Configuration entitlement, which free
(Personal Team) Apple IDs can't get, so signing fails. Sideloading tools don't get around this. To test
anyway, leave the `react-native-wifi-reborn` plugin out of iOS builds and join the camera's Wi-Fi by hand
in Settings before opening the app. See the "iOS on a free (Personal Team) Apple ID" section of
[`AGENTS.md`](AGENTS.md) for details.

## Project layout

```
app/          expo-router screens: (tabs)/camera and (tabs)/(desktops), images grid, image detail,
              sync modal, join-wifi, read-label (OCR), scan-pairing (desktop QR), pair-code
src/camera/   protocol client: camera discovery, DLNA, Scalar, desktop hub API
src/          shared TS: connection context, Sync All loop, file system, video conversion,
              Wi-Fi, OCR, desktop pairing/discovery, components, theme, locales
desktop/      Tauri desktop hub (Rust + Svelte), see desktop/README.md
docs/         desktop-plan.md: desktop hub design and work items
```

[`AGENTS.md`](AGENTS.md) has the full architecture notes and protocol gotchas.

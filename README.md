# image-sync

An iOS/Android app (Expo) that replaces Sony PlayMemories Mobile for pulling photos off a Sony RX100M3
over its "Send to Smartphone" Wi-Fi access point. The camera protocol (DLNA ContentDirectory, with a
Scalar Web API fallback) is plain TypeScript in `src/camera/`.

## Features

- Join the camera's `DIRECT-...` Wi-Fi from inside the app (or read the SSID/password off the camera
  screen with OCR)
- Auto-discover the camera at `192.168.122.1`, with a manual IP override
- Browse photos in a grid, showing which ones are already on the device
- Batch sync with downloaded/skipped/failed counts and cancel
- Save individual photos to the system Photos library

## Requirements

- Node + [pnpm](https://pnpm.io) (version pinned in `package.json`'s `packageManager`)
- Xcode (iOS) and/or Android Studio (Android)
- A development build — the app uses native modules, so Expo Go won't work

## Getting started

```sh
pnpm install

# Generate native projects and run
npx expo prebuild --clean
pnpm ios                # or: pnpm android
```

## Testing

```sh
pnpm test               # camera protocol parsing (XML/JSON fixtures, no camera needed)
npx tsc --noEmit
```

Real end-to-end testing needs a physical RX100M3 in "Send to Smartphone" mode.

## iOS with a free Apple ID

Joining Wi-Fi from inside the app needs the Hotspot Configuration entitlement, which free
(Personal Team) Apple IDs can't get, so signing fails. Sideloading tools don't get around this. To test
anyway, leave the `react-native-wifi-reborn` plugin out of iOS builds and join the camera's Wi-Fi by hand
in Settings before opening the app. See the "iOS on a free (Personal Team) Apple ID" section of
[`AGENTS.md`](AGENTS.md) for details.

## Project layout

```
src/camera/   camera protocol client (discovery, DLNA, Scalar listing)
app/          expo-router screens
src/          shared TS: camera context, Wi-Fi, file system, OCR, components, theme
```

[`AGENTS.md`](AGENTS.md) has the full architecture notes and protocol gotchas.

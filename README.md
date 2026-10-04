# image-sync

An iOS/Android app (Expo) that replaces Sony PlayMemories Mobile for pulling photos off a Sony RX100M3
over its "Send to Smartphone" Wi-Fi access point. The camera protocol (DLNA ContentDirectory, with a
Scalar Web API fallback) is implemented in Rust and exposed to React Native via
[uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native).

## Features

- Join the camera's `DIRECT-...` Wi-Fi from inside the app (or read the SSID/password off the camera
  screen with OCR)
- Auto-discover the camera at `192.168.122.1`, with a manual IP override
- Browse photos in a grid, showing which ones are already on the device
- Batch sync with downloaded/skipped/failed counts and cancel
- Save individual photos to the system Photos library

## Requirements

- Node + [pnpm](https://pnpm.io) (version pinned in `package.json`'s `packageManager`)
- Rust toolchain with the iOS/Android targets
- Xcode (iOS) and/or Android Studio + NDK (Android)
- A development build — the app uses native modules, so Expo Go won't work

## Getting started

```sh
pnpm install

# Build the Rust core and regenerate the native bindings
cd modules/image-sync-core
npm run ubrn:ios        # and/or: npm run ubrn:android
cd ../..

# Generate native projects and run
npx expo prebuild --clean
pnpm ios                # or: pnpm android
```

If the Android build can't find the NDK, set
`export ANDROID_NDK_HOME=~/Library/Android/sdk/ndk/<version>` and retry.

After changing any Rust code, re-run the `ubrn:*` script **and** rebuild the native app. A stale native
binary paired with fresh JS bindings throws `ApiChecksumMismatch` at runtime.

## Testing

```sh
cargo test              # Rust protocol core (XML/JSON fixtures, no camera needed)
cargo clippy
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
rust/image-sync-core/      pure Rust protocol client (discovery, DLNA, Scalar, downloads)
rust/image-sync-ffi/       uniffi wrapper exposing the core to JS
modules/image-sync-core/   generated Expo native module (regenerable)
app/                       expo-router screens
src/                       shared TS: camera context, Wi-Fi, file system, OCR, components, theme
```

[`AGENTS.md`](AGENTS.md) has the full architecture notes, the FFI surface, and protocol gotchas.

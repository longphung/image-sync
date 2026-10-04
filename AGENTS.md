# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Project: image-sync

Cross-platform (iOS/Android, Expo) client that replaces Sony PlayMemories Mobile for pulling photos
off a Sony RX100M3 over its "Send to Smartphone" Wi-Fi access point. The camera exposes either a DLNA
ContentDirectory media server or a Scalar Web API (JSON-RPC), depending on mode; this app talks to
whichever one the camera presents.

Protocol reference: a working, hardware-validated Python CLI + daemon lives in a **sibling repo**,
`../HackMySony` (`sony_camera_client.py`, `sony_sync_daemon.py`). That repo's `docs/sonysync-design.md`
describes an earlier, different, never-built TypeScript/Expo architecture — **ignore it**; this repo
(`image-sync`) is the real, in-progress rewrite, and it uses Rust, not TypeScript, for the protocol
logic. Don't go looking in the sibling repo for current plans; everything current lives here.

## Architecture

```
rust/
  image-sync-core/    pure Rust protocol client — zero uniffi dependency, unit-testable in isolation
  image-sync-ffi/      thin #[uniffi::export] wrapper crate; mirrors core types with From/Into
modules/image-sync-core/  generated Expo native module (uniffi-bindgen-react-native scaffolding:
                          iOS/Android/C++/TS glue). Fully regenerable — see below.
src/fileSystem.ts     expo-file-system helpers (photos directory, path conversion for the FFI boundary)
src/theme/colors.ts   native semantic colors (UIKit system colors / Material 3 dynamic colors)
src/components/       ActionButton + ProgressBar have .ios.tsx (SwiftUI, liquid glass on iOS 26+) and
                      .android.tsx (Jetpack Compose, Material 3) variants via @expo/ui; the plain .tsx is
                      the web fallback and the shared props type
app/                  expo-router screens: index (2-step connect) -> join-wifi -> images (grid) -> sync
                      (progress modal) / image/[filename] (photo/video detail + Save to Photos); read-label (OCR modal)
```

Package manager is **pnpm** with `node-linker=hoisted` (`.npmrc`) — React Native autolinking and the
local `file:` module expect a flat `node_modules`. Add Expo packages with `npx expo install <pkg>`.

**Why two Rust crates instead of one:** `image-sync-core` deliberately has no `uniffi` dependency and
never calls `uniffi::setup_scaffolding!()`. Putting uniffi derives directly on core types would make it
a second UniFFI "component," and `ubrn build` would emit a *second* generated bindings module —
requiring manual edits to `modules/image-sync-core/src/index.tsx` and native registration code. Keeping
`image-sync-ffi` as the only uniffi-aware crate avoids that; it just defines mirror types
(`CameraApi`, `ImageItem`, `CameraError`) with `From`/`Into` conversions to/from the core crate's plain
types.

## Protocol logic (`rust/image-sync-core/src/`)

- `discovery.rs` — GET `http://<host>:64321/DmsDesc.xml` (default host `192.168.122.1` — camera is
  always the DHCP gateway once joined to its AP, so no SSDP/UDP discovery is implemented; a manual-IP
  override is the fallback path). Classifies the response as `CameraApi::Scalar` (if
  `X_ScalarWebAPI_ActionList_URL` present) or `CameraApi::Dlna` (falls back to the `ContentDirectory`
  service's `controlURL` + `photoRoot`, default `"0"`).
- `dlna.rs` — SOAP `Browse(BrowseDirectChildren)` client, recursive container walk, DIDL-Lite parsing,
  and resource selection (prefers the `<res>` with no `DLNA.ORG_PN=` — the original full-resolution
  file — falling back to the *first* converted resource in document order if no original exists; that
  fallback quirk is intentional, ported faithfully from the validated Python reference, not a bug).
- `scalar.rs` — Scalar Web API JSON-RPC client (`getSchemeList` -> `getSourceList` -> `getContentList`,
  paginated batch=50).
- `download.rs` — `download_image(url, dest_path)`: skip-if-exists semantics, creates parent dirs,
  streams the HTTP GET response to disk.
- `xml.rs` — namespace-agnostic parsing helpers (match on local name, ignoring `prefix:`) and the
  DIDL double-unescape (see Gotchas below).

All of this is unit-tested with inline XML/JSON fixtures (no live camera needed) — see `#[cfg(test)]`
blocks in each file, especially `dlna.rs`'s `parse_browse_response_handles_double_escaped_result`.

## FFI surface (`rust/image-sync-ffi/src/lib.rs`)

```rust
fn ping() -> String;
fn get_camera_info(host: Option<String>) -> Result<CameraInfo, CameraError>; // { api, name }
fn list_images(api: CameraApi) -> Result<Vec<ImageItem>, CameraError>;
fn download_image(url: String, dest_path: String) -> Result<bool, CameraError>;
```

All **synchronous** (no uniffi async/Future machinery) — a deliberate v1 tradeoff to avoid a bigger
scaffold change. This means calling these from JS blocks the JS thread for the duration of the network
call. `app/sync.tsx`'s loop works around this by `await`-ing a `setTimeout(0)` between iterations so
React actually flushes progress-label updates before the next blocking call starts (same trick in
`CameraConnectionContext`'s `connect()`/`refreshImages()` and `app/sync.tsx`). If real-device
testing shows this is unacceptably janky, converting to uniffi async exports is the natural follow-up —
not yet done.

Generated JS shapes (confirmed against actual generated output in
`modules/image-sync-core/src/generated/image_sync_ffi.ts`, re-exported from `image-sync-core`):
- `getCameraInfo(host: string | undefined): CameraInfo` — **always pass an argument**, `undefined` if no
  manual override; there's no default param. `CameraInfo` is `{ api: CameraApi, name: string | undefined }`
  where `name` is the device description's `friendlyName` (falling back to `modelName`).
- `listImages(api: CameraApi): Array<ImageItem>`
- `downloadImage(url: string, destPath: string): boolean` — `false` means "skipped, already exists",
  not an error.
- `CameraApi` is a tagged-union: `CameraApi.Dlna.instanceOf(api)` / `CameraApi.Scalar.instanceOf(api)`
  as type guards, then `api.inner.controlUrl` / `.photoRoot` / `.baseUrl` (camelCased).
- `ImageItem` is a plain object: `item.title`, `item.url`, `item.filename`, `item.thumbnailUrl`.
- `CameraError` (`#[uniffi(flat_error)]`) is a class extending JS `Error`; `err.message` is prefixed
  like `"CameraError.Http: HTTP request failed: ..."`.
- **Path handling gotcha**: `download_image` does `std::fs::File::create(dest_path)` on a plain
  filesystem path — `expo-file-system` URIs are always `file://...`, so `src/fileSystem.ts`'s
  `toFsPath()`/`destPathFor()` strip the scheme before crossing the FFI boundary. Don't pass a raw
  `File.uri` straight into `downloadImage`.

## Rebuilding after Rust changes

```
cd modules/image-sync-core
npm run ubrn:ios       # ubrn build ios --and-generate
npm run ubrn:android   # ubrn build android --and-generate
```
Both recompile the Rust crate per-target and regenerate everything under `modules/image-sync-core/{src/generated,ios,android,cpp}` — all gitignored, fully regenerable, safe to blow away. If Android fails on NDK resolution, `export ANDROID_NDK_HOME=~/Library/Android/sdk/ndk/<version>` (multiple versions may be installed side by side) and retry. After regenerating, re-run the native build (`expo run:ios`/`run:android`) — a stale native binary against fresh JS bindings throws `ApiChecksumMismatch` at runtime.

`ios/` and `android/` are gitignored/regenerable via `npx expo prebuild --clean` — safe to wipe.

## quick-xml gotchas hit while writing `dlna.rs`/`discovery.rs` (don't re-derive these from scratch)

The vendored `quick-xml` version (0.41.0) tokenizes entity/character references (`&amp;`, `&lt;`,
`&#60;`, ...) as **separate `GeneralRef` events**, not folded into `Text` — the common older-quick-xml
idiom of a single `BytesText::unescape()` call silently truncates any text containing `&`/`<`/`>`/`"`/
`'`. `xml.rs::read_element_text()` handles this correctly (accumulates `Text` + resolved `GeneralRef`
until the matching `End` event) — reuse it for any new leaf-text extraction, don't reach for a plain
`Event::Text` match. Also: `Attribute::unescape_value()` is deprecated in favor of
`normalized_value(XmlVersion)`; and `reader.config_mut().trim_text(true)` trims whitespace at the edges
of *each* Text fragment (not just at element boundaries) — this corrupts reconstructed text whenever an
entity splits a run into multiple fragments, so it's deliberately **not** set anywhere in this crate.

The camera's SOAP `<Result>` element is escaped *twice* on the wire (verified against the working
Python reference's `html.unescape()`-after-`ElementTree`-parse behavior) — `dlna.rs` does one unescape
via `read_element_text()` (undoes the outer SOAP envelope's escaping) then a second manual pass via
`xml.rs::unescape_xml_entities_once()` before parsing the recovered text as DIDL-Lite XML.

## Native config for a plain-`http://`, local-network-only camera

- iOS: `expo-dev-client`'s own config plugin already injects `NSAppTransportSecurity.NSAllowsLocalNetworking: true` into `Info.plist`, which covers HTTP loads to `192.168.122.1` — no ATS exception block needed as long as `expo-dev-client` stays a dependency. `app.json`'s `ios.infoPlist.NSLocalNetworkUsageDescription` is set for the iOS 14+ local-network permission prompt.
- Android: `expo-build-properties` plugin sets `usesCleartextTraffic: true` in `app.json`'s `plugins` array (this is *not* a core Expo `android.*` key — the plugin is the actual mechanism).
- Both require `npx expo prebuild --clean` to take effect (native projects are gitignored/regenerable).

## iOS on a free (Personal Team) Apple ID

The `react-native-wifi-reborn` config plugin adds the `com.apple.developer.networking.HotspotConfiguration`
entitlement (and possibly `com.apple.developer.networking.wifi-info`, not confirmed). Personal Teams can't
get the Hotspot entitlement, so signing fails without a paid Apple Developer Program membership. Sideloading
tools (AltStore, Sideloadly, etc.) re-sign with the same free profile and don't get around this; TrollStore
only works on iOS 14.0–17.0, and jailbreaking is the same story.

Workaround for testing without a paid account (not implemented, documented only):
1. Leave the `react-native-wifi-reborn` plugin out of iOS builds — e.g. convert `app.json` to
   `app.config.js` and filter it out of `plugins` when an env var like `FREE_TEAM=1` is set, then
   `FREE_TEAM=1 npx expo prebuild --clean`.
2. Join the camera's `DIRECT-...` Wi-Fi manually in iOS Settings, then open the app and connect. Only
   `joinNetwork()` (`NEHotspotConfiguration` via `connectToProtectedSSID`) needs the entitlement; discovery
   always targets `192.168.122.1`, so everything else works unchanged. `getCurrentSsid()` already fails
   quietly to `null`.
3. Optionally, on iOS, swap `app/join-wifi.tsx`'s Join action for a "join in Settings, then come back"
   step so the missing entitlement doesn't cause a runtime error.

## Current state / what's left

Done: Rust protocol core (fully unit-tested), FFI wrapper, bindings regenerated for iOS+Android, native
local-network config, `expo-file-system` integration, and the redesigned native UI (2-step connect home
with auto-connect after Wi-Fi join, join-wifi screen, 3-column photo grid with on-device badges, sync
progress modal with downloaded/skipped/failed counts + cancel, image detail with Save to Photos).
`cargo test`/`clippy` and `npx tsc --noEmit` all pass.

UI follow-ups not yet done: Diagnostics screen (design screen 10, deferred); `ReviewSheet` still uses
`@gorhom/bottom-sheet` (only re-themed) rather than `@expo/ui`'s native `BottomSheet`; the iOS-only
current-SSID readout needs location permission, so without it the home screen's Wi-Fi step only shows
the SSID that was just joined from inside the app.

Not yet done / needs a physical RX100M3 + its Wi-Fi AP to verify (no camera reachable from a dev
machine alone):
- Actual `run:ios`/`run:android` simulator/emulator build — was in progress, not confirmed complete.
- Real `listImages` data, a real thumbnail loading over HTTP, `downloadImage` writing a real file.
- Whether the synchronous-FFI-blocking tradeoff (see above) is actually noticeable in practice — decide
  whether to convert to async uniffi exports based on real usage, not preemptively.
- The camera-based OCR "read Wi-Fi label" feature (`src/ocr.ts`, `app/read-label.tsx`, `src/labelOcr/`,
  `src/LabelOcrContext.tsx`, "Read … from Label" buttons in `app/join-wifi.tsx`): OCR accuracy and
  the full capture→confirm→join flow need a physical device with a printed Wi-Fi label to verify —
  simulators have no real camera hardware. Camera permission plumbing and the reader's UI states
  (permission-denied, no-text-detected, etc.) can be exercised on simulator/emulator without one.
- Downloaded images (`app/image/[filename].tsx`'s Download button) are now saved into the phone's
  shared Photos library via `expo-media-library`'s `Asset.create()`, not just app-private storage —
  `downloadImage()` still writes to the app's private `camera-photos` directory first (the Rust FFI has
  no other option), then that local file is copied into the Photos library. Requests add-only/write-only
  permission (`requestPermissionsAsync(true)`) rather than full library read access. Unlike OCR accuracy,
  this *is* verifiable on simulator/emulator (both have a Photos/Gallery app) — no physical device
  needed to confirm the image actually lands in the library, not just that the button flips state.

- **Camera videos: partial, needs further implementation and verification.** The DLNA listing has no
  media-type filter, so videos (the reference repo pulled `.MP4`/`.MTS`) should already appear in
  `listImages`. The JS side classifies them by file extension only (`src/fileSystem.ts`'s `isVideoFile()`),
  shows a play badge in the grid, streams them with `expo-video` on the detail screen, and saves them
  with the same `downloadImage()` → `Asset.create()` path as photos. Still to do:
  - Listing: classify in Rust from the DIDL `upnp:class`/`protocolInfo` mime instead of the extension.
    `pick_original_res()` does pick the real video file. The Python reference, which uses the same logic,
    downloaded full `.MP4` (ISO media) and `.MTS` (M2TS) files from the camera. The Scalar path still requests only `type: ["still"]`.
  - Display: no real video has been listed, thumbnailed, or played from the camera yet. AVCHD `.MTS`
    won't play on iOS, so the detail screen shows "Can't play this video format".
  - Saving: `downloadImage()` is synchronous, so a large video blocks the JS thread for the whole
    download (detail Save and Sync All). That is a strong reason to do the async-uniffi conversion.
    `.MTS` can't be added to the iOS Photos library.
  - All of the above needs a physical RX100M3 with videos on the card.
- Status bar: driven per screen by react-native-screens (`statusBarStyle` in `app/_layout.tsx`) with
  `UIViewControllerBasedStatusBarAppearance: true`. `expo-status-bar` was removed after the bar went
  missing on both platforms. The fix hasn't been confirmed on a rebuilt app yet. If iOS still hides it,
  try `ios.enableSceneSupport: false` in `app.json` next.

Explicitly out of scope so far, not started: auto-polling/background sync, multi-camera support,
tap-to-view-full-res modal, Scalar Web API path is implemented but never exercised against real
hardware (RX100M3 in Send-to-Smartphone mode only uses the DLNA path, per prior recon).

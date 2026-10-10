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
(`image-sync`) is the real, in-progress rewrite. Don't go looking in the sibling repo for current plans;
everything current lives here.

## Architecture

```
src/camera/           camera protocol client in plain TypeScript (fetch + fast-xml-parser, no native code)
src/fileSystem.ts     expo-file-system helpers (photos directory, native async downloads with % progress)
src/theme/colors.ts   native semantic colors (UIKit system colors / Material 3 dynamic colors)
src/components/       ActionButton + ProgressBar have .ios.tsx (SwiftUI, liquid glass on iOS 26+) and
                      .android.tsx (Jetpack Compose, Material 3) variants via @expo/ui; the plain .tsx is
                      the web fallback and the shared props type
desktop/              Tauri v2 desktop hub (Rust + Svelte 5/Vite UI in desktop/ui, own package.json): USB card picker
                      + import, HTTP API for phones (also HTTPS on the same port via a local CA, src/tls.rs),
                      see docs/desktop-plan.md. Excluded from the root tsconfig
src/desktops.ts       paired desktop hubs, persisted as JSON in the documents directory
app/                  expo-router screens: (tabs) = native tabs, (desktops)/index (default: paired desktops,
                      pull to refresh) and camera/index (2-step connect) -> join-wifi; both -> images (grid)
                      -> sync (progress modal) / image/[filename] (photo/video detail + Save to Photos);
                      read-label (OCR modal); scan-pairing (desktop pairing QR modal); pair-code (6-digit
                      code pairing, from a discovered desktop or a typed host[:port])
*.web.ts(x)           web build, served by the desktop hub at /app (app.json experiments.baseUrl): Desktop
                      tab only, localStorage instead of desktops.json, /info instead of mDNS, in-memory
                      downloads saved via navigator.share (HTTPS only) or one zip download (src/zip.ts),
                      no MTS conversion
src/sync.ts           pure Sync All loop (skip / fail / stop-after-3 / duplicate-name rules), tested in Node
```

Package manager is **pnpm** with `node-linker=hoisted` (`.npmrc`) — React Native autolinking expects a
flat `node_modules`. Add Expo packages with `npx expo install <pkg>`.

The camera protocol used to live in Rust (uniffi + a generated native module). It was ported to
TypeScript because it's only network I/O plus XML/JSON parsing, and the Rust path required a ubrn
regeneration and a native rebuild for every change.

## Protocol logic (`src/camera/`)

Public API (`src/camera/index.ts`):

```ts
getCameraInfo(host?: string): Promise<CameraInfo>; // { api, name? }
listImages(api: CameraApi): Promise<ImageItem[]>;
type CameraApi = { kind: 'dlna'; controlUrl; photoRoot } | { kind: 'scalar'; baseUrl }
  | { kind: 'desktop'; baseUrl; token }; // desktop hub, see docs/desktop-plan.md
type ImageItem = { title; url; filename; thumbnailUrl };
```

Failures throw a plain `Error` whose `message` is shown to the user (`HTTP request failed: GET ...`,
`SOAP Browse error: Browse(<id>) failed: ...`, `Scalar JSON-RPC error: ...`). All requests go through
`http.ts`'s `fetchText()`, which adds a 30s timeout with a manual `AbortController` timer, because RN's
`AbortSignal` polyfill has no `AbortSignal.timeout()`. Plain `fetch` never blocks the JS thread.

- `discovery.ts`: GET `http://<host>:64321/DmsDesc.xml` (default host `192.168.122.1`). The camera is
  always the DHCP gateway once joined to its AP, so no SSDP/UDP discovery is implemented, and a
  manual IP override is the fallback. Classifies the response as `scalar` if
  `X_ScalarWebAPI_ActionList_URL` is present (it wins if both are), otherwise `dlna`, using the
  `ContentDirectory` service's `controlURL` joined onto the description's origin, plus `photoRoot`
  (default `"0"`). `name` is the first non-empty `friendlyName`, falling back to `modelName`.
- `dlna.ts`: SOAP `Browse(BrowseDirectChildren)` client. It paginates in batches of 50 and stops when
  `start >= TotalMatches` or a batch comes back empty. It walks containers recursively, depth-first,
  in document order, and parses DIDL-Lite. Resource selection (`pickOriginalRes`):
  1. Prefer a `<res>` with no `DLNA.ORG_PN=` (the original full-resolution file), the largest by
     `size` if there are several.
  2. Otherwise use the first `video/*` res, so a video whose only real file carries a DLNA profile
     doesn't resolve to its JPEG thumbnail.
  3. Otherwise use the *first* converted res in document order. This quirk is intentional, ported
     faithfully from the validated Python reference, and is not a bug.
  The thumbnail is the `JPEG_TN` res. The filename is the URL path's basename without the query
  string, falling back to the title.
- `scalar.ts`: Scalar Web API JSON-RPC client (`getSchemeList` -> `getSourceList` ->
  `getContentCount` + `getContentList`, paginated in batches of 50, `type: ["still"]`).
- `xml.ts`: `fast-xml-parser` configured with `preserveOrder` (keeps containers and items in document
  order) and `removeNSPrefix` (namespace-agnostic matching on local names), plus small tree helpers and
  the DIDL double-unescape (below).

**The SOAP `<Result>` is escaped twice on the wire.** This was verified against the Python reference's
`html.unescape()`-after-`ElementTree`-parse behavior. The XML parser undoes the outer SOAP envelope's
layer, then `unescapeXmlEntitiesOnce()` undoes the second layer before the text is parsed as DIDL-Lite.
That function replaces `&amp;` *last*, so `&amp;lt;` peels exactly one level to `&lt;`.
`fast-xml-parser` decodes entities in one left-to-right scan over the whole text node, so text
containing `&amp;` etc. is never split or truncated. (The old Rust parser had exactly that bug at first.)

Tests: `pnpm test` runs every `src/**/*.test.ts` with Node's built-in test runner (`desktop.test.ts` starts a local HTTP server). Node strips the TS
types itself, which is why `src/camera/` imports use explicit `.ts` extensions
(`allowImportingTsExtensions` in `tsconfig.json`; Metro resolves the exact path). They use inline
XML/JSON fixtures and need no live camera. See especially "parseBrowseResponse handles the
double-escaped Result" and the `pickOriginalRes` cases. Keep parsing functions pure and exported so
they stay testable without the network.

File downloads don't go through `src/camera/`. `src/fileSystem.ts`'s `downloadToPhotosDir(url, filename,
{ signal, onPercent })` uses `expo-file-system`'s native `File.downloadFileAsync`, which runs off the JS
thread, reports integer-percent progress, and is cancellable with an `AbortSignal`. It resolves `false`
when the file already exists ("skipped"). It downloads to `<filename>.part` and moves the file into
place only on success, because Android streams straight into the target and a partial file under the
final name would later be skipped as "already downloaded".

`ios/` and `android/` are gitignored/regenerable via `npx expo prebuild --clean` — safe to wipe.

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

Done: TypeScript protocol client in `src/camera/` (fully unit-tested), native
local-network config, `expo-file-system` integration, and the redesigned native UI (2-step connect home
with auto-connect after Wi-Fi join, join-wifi screen, 3-column photo grid with on-device badges, sync
progress modal with downloaded/skipped/failed counts + cancel, image detail with Save to Photos).
`pnpm test` and `npx tsc --noEmit` both pass.

UI follow-ups not yet done: Diagnostics screen (design screen 10, deferred); `ReviewSheet` still uses
`@gorhom/bottom-sheet` (only re-themed) rather than `@expo/ui`'s native `BottomSheet`; the iOS-only
current-SSID readout needs location permission, so without it the home screen's Wi-Fi step only shows
the SSID that was just joined from inside the app.

Not yet done / needs a physical RX100M3 + its Wi-Fi AP to verify (no camera reachable from a dev
machine alone):
- Actual `run:ios`/`run:android` simulator/emulator build since the Rust native module was removed
  (needs `npx expo prebuild --clean` first) — not confirmed yet.
- Real `listImages` data, a real thumbnail loading over HTTP, `downloadToPhotosDir` writing a real file,
  and its progress percentage (it stays hidden if the camera sends no `Content-Length`).
- The camera-based OCR "read Wi-Fi label" feature (`src/ocr.ts`, `app/read-label.tsx`, `src/labelOcr/`,
  `src/LabelOcrContext.tsx`, "Read … from Label" buttons in `app/join-wifi.tsx`): OCR accuracy and
  the full capture→confirm→join flow need a physical device with a printed Wi-Fi label to verify —
  simulators have no real camera hardware. Camera permission plumbing and the reader's UI states
  (permission-denied, no-text-detected, etc.) can be exercised on simulator/emulator without one.
- Downloaded images (`app/image/[filename].tsx`'s Download button) are now saved into the phone's
  shared Photos library via `expo-media-library`'s `Asset.create()`, not just app-private storage —
  `downloadToPhotosDir()` writes to the app's private `camera-photos` directory first, then `saveToLibrary()` copies that local file into the Photos library.
  Sync All does the same, but only for files it newly downloaded (a skipped file isn't re-added). Requests add-only/write-only
  permission (`requestPermissionsAsync(true)`) rather than full library read access. Unlike OCR accuracy,
  this *is* verifiable on simulator/emulator (both have a Photos/Gallery app) — no physical device
  needed to confirm the image actually lands in the library, not just that the button flips state.

- **Camera videos: partial, needs further implementation and verification.** The DLNA listing has no
  media-type filter, so videos (the reference repo pulled `.MP4`/`.MTS`) should already appear in
  `listImages`. The JS side classifies them by file extension only (`src/fileSystem.ts`'s `isVideoFile()`),
  shows a play badge in the grid, streams them with `expo-video` on the detail screen, and saves them
  with the same `downloadToPhotosDir()` → `Asset.create()` path as photos. Still to do:
  - Listing: classify in `src/camera/dlna.ts` from the DIDL `upnp:class`/`protocolInfo` mime instead of the extension.
    `pickOriginalRes()` does pick the real video file, and when a video's only real file carries a
    `DLNA.ORG_PN` profile it now prefers the first `video/*` res over the JPEG thumbnail fallback (suspected
    cause of MP4s showing up as photos, unconfirmed). The list is reversed in `CameraConnectionContext`
    so newest shows first (the camera returns oldest first). The Python reference, which uses the same logic,
    downloaded full `.MP4` (ISO media) and `.MTS` (M2TS) files from the camera. The Scalar path still requests only `type: ["still"]`.
  - Display: the detail screen no longer streams from the camera. It downloads the video into
    `camera-photos`, converts `.MTS` to `.mp4` (`convertToMp4`), then plays the local file, and keeps
    Save disabled until that finishes. Not yet verified on real camera videos.
  - Saving: downloads are native and async (see "Protocol logic"), so large videos no longer freeze the UI.
    Save to Photos converts `.MTS`/`.M2TS` (AVCHD) to MP4 first via `src/convertVideo.ts`
    (`@mtd1410/react-native-ffmpegkit`, the maintained LGPL fork of the retired ffmpeg-kit). Progressive
    clips get `-c:v copy` and AC-3 -> AAC. Interlaced 60i clips, which iOS can't play, get `bwdif` plus
    the hardware encoder (`h264_videotoolbox` / `h264_mediacodec`). The original stays in `camera-photos`
    and the `.mp4` is written next to it. `plugins/withFfmpegKitMin.js` selects the smaller `min` FFmpeg
    build (needs `prebuild --clean`). This is unverified on real AVCHD files, and `h264_mediacodec`
    encoding is the least certain part. Sync All converts too, via the same `saveToLibrary()`.
  - All of the above needs a physical RX100M3 with videos on the card.
- Status bar: driven per screen by react-native-screens (`statusBarStyle` in `app/_layout.tsx`) with
  `UIViewControllerBasedStatusBarAppearance: true`. `expo-status-bar` was removed after the bar went
  missing on both platforms. The fix hasn't been confirmed on a rebuilt app yet. If iOS still hides it,
  try `ios.enableSceneSupport: false` in `app.json` next.

Explicitly out of scope so far, not started: auto-polling/background sync, multi-camera support,
tap-to-view-full-res modal, Scalar Web API path is implemented but never exercised against real
hardware (RX100M3 in Send-to-Smartphone mode only uses the DLNA path, per prior recon).

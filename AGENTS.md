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
App.tsx               single-screen UI: connect -> list images -> sync all
```

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
fn get_camera_api(host: Option<String>) -> Result<CameraApi, CameraError>;
fn list_images(api: CameraApi) -> Result<Vec<ImageItem>, CameraError>;
fn download_image(url: String, dest_path: String) -> Result<bool, CameraError>;
```

All **synchronous** (no uniffi async/Future machinery) — a deliberate v1 tradeoff to avoid a bigger
scaffold change. This means calling these from JS blocks the JS thread for the duration of the network
call. `App.tsx`'s sync loop works around this by `await`-ing a `setTimeout(0)` between iterations so
React actually flushes progress-label updates before the next blocking call starts. If real-device
testing shows this is unacceptably janky, converting to uniffi async exports is the natural follow-up —
not yet done.

Generated JS shapes (confirmed against actual generated output in
`modules/image-sync-core/src/generated/image_sync_ffi.ts`, re-exported from `image-sync-core`):
- `getCameraApi(host: string | undefined): CameraApi` — **always pass an argument**, `undefined` if no
  manual override; there's no default param.
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

## Current state / what's left

Done: Rust protocol core (fully unit-tested), FFI wrapper, bindings regenerated for iOS+Android, native
local-network config, `expo-file-system` integration, and a working single-screen `App.tsx` (manual-IP
connect, list images with thumbnails, sync-all with progress, error display). `cargo test`/`clippy` and
`npx tsc --noEmit` all pass.

Not yet done / needs a physical RX100M3 + its Wi-Fi AP to verify (no camera reachable from a dev
machine alone):
- Actual `run:ios`/`run:android` simulator/emulator build — was in progress, not confirmed complete.
- Real `listImages` data, a real thumbnail loading over HTTP, `downloadImage` writing a real file.
- Whether the synchronous-FFI-blocking tradeoff (see above) is actually noticeable in practice — decide
  whether to convert to async uniffi exports based on real usage, not preemptively.

Explicitly out of scope so far, not started: auto-polling/background sync, multi-camera support,
tap-to-view-full-res modal, Scalar Web API path is implemented but never exercised against real
hardware (RX100M3 in Send-to-Smartphone mode only uses the DLNA path, per prior recon).

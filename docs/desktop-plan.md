# Desktop app plan

Status: desktop side built in `desktop/`, mobile side built (not verified yet). See "Work items" at the end.
Run with `cd desktop && pnpm install && pnpm tauri dev` (starts Vite for the Svelte UI in `desktop/ui/`,
then the Rust app), test with `cargo test`. Deviations from the plan below:

- Thumbnails are generated lazily on the first `/thumbs` request (then cached in a
  `.thumbs/` folder next to the file), not in a post-import pass.
- There's no auto-import. When a camera is mounted, the window lists every photo and video on it
  (newest first) with thumbnails, a full-size preview (photos and MP4; a card `.MTS` shows its
  thumbnail because WebKit can't play AVCHD, but once synced its converted `.mp4` plays in the
  Library tab), and "In library" badges. The user picks items and clicks
  "Sync selected" (shift-click selects a range). The window is Svelte 5 + Vite, and the grid is
  virtualized by row with `virtua`, so only on-screen rows exist in the DOM.
- The Library tab shows what's already synced (newest first) in the same grid and viewer, with
  "Open folder" (Finder / Explorer / `xdg-open`). The grid and viewer are shared (`ui/MediaGrid.svelte`).
- Thumbnails come from a `thumb://` URI scheme backed by `thumbs::Queue`. Card thumbnails are cached
  in the app cache dir by name + size; library ones share each folder's `.thumbs/` with the phone API. As soon as the card is listed, every item is pre-generated in the
  background (newest first, one worker per core: the full RX100M3 card, 663 items, takes ~36 s).
  Tiles on screen before their thumbnail exists jump the queue, newest request first. JPGs use the
  ~1616x1080 MPF preview Sony embeds (seek + ~400 KB read, ~100 ms each), falling back to the EXIF
  thumbnail, then a full decode. The main image's EXIF Orientation is applied.
- Full-size previews use Tauri's asset protocol, scoped at runtime to the camera volume. The viewer
  shows the blurred thumbnail at once and fades the full file in, with arrow-key browsing. Videos
  show their thumbnail as the poster and report the media error if WebKit can't play them.
- The pairing QR payload is JSON `{ v: 1, id, name, hosts: [lanIp, remoteHost?], port, token }`.
  `hosts` is tried in order. `remoteHost` comes from the optional "Remote address" setting.
  `token` is a **one-time pairing token**: the phone trades it for its own token with
  `POST /pair?t=<token>&name=<phone name>` -> `{ "token": "<phone token>" }`, and every other route
  needs that phone token. Each successful pair replaces the pairing token, so the QR in the window
  changes and an old photo of it is useless.
- Per-phone tokens: the Phone & settings tab lists paired phones (name, pairing date), each with
  "Unpair". "Unpair all phones" removes them all and replaces the pairing token. Start-at-login isn't built.
- Pairing by code (no camera needed, and the only way from the web app): `POST /pair/request?name=`
  -> `{ request }` stores one pending request (a new one replaces it) with a random 6-digit code, and
  shows and focuses the window, which pops up the code (`StatusView.pair_request`, polled every second).
  `POST /pair/code?request=&code=&name=` succeeds like `/pair`. A wrong code returns 401, and after 5 of
  them, after 2 minutes, or after "Deny", the request is gone (410). Both pair replies are
  `{ token, id, name, hosts, port }`, because the code flow has no QR payload.
- Web app: the hub serves the Expo web export at `/app` (`experiments.baseUrl`, so it doesn't clash
  with `/images`), plus `GET /info` -> `{ id, name }` so the page can name the hub that served it.
  Being the same origin means no CORS. See `desktop/README.md`.
- Library layout is `<library>/<YYYY-MM-DD>/<name>`, dated by the card file's modified time in local
  time, so Sony's wrapping `DSC00001.JPG` counter can't collide. Files synced before this, at the top
  level of the library, still count as imported and are still listed. Card selection and sync go by
  path, not name. In `/images`, `filename` is the path with `/` replaced by `_`
  (`2025-06-14_DSC00001.JPG`) because the phone saves by `filename`; `title` is the plain name.
- AVCHD `.MTS` clips are converted to `.mp4` after **all** picked files are copied (not right after
  each one), so the camera can be unplugged while conversion runs. Off macOS the 50i/60i path uses
  `libx264` (no guaranteed hardware encoder). A real 35.9 s 1080/50i clip converts in ~10 s on an
  Apple Silicon Mac with `h264_videotoolbox`, to 1080p50 H.264 + AAC.
- Default port 8765, default library `~/Pictures/image-sync`. Settings live in the Tauri app config
  dir as `settings.json`.

## Goal

A desktop app (macOS, Windows, Linux) that:

1. Imports photos and videos from the RX100M3 over a **USB cable**, for speed.
2. Serves its library to the mobile app, which browses and downloads from it exactly like it does
   from the camera today (same grid, same per-photo detail, same Save to Photos, same Sync All).

The desktop is a hub. Phones pull from it. It never pushes to phones, and nothing syncs back to the
camera or between desktops.

```
camera --(USB, Mass Storage)--> desktop --(HTTP + token, LAN or VPN)--> phone(s)
                                   ^ advertised via mDNS _image-sync._tcp on the LAN
```

## Camera -> desktop: USB Mass Storage

The RX100M3 has no Ethernet port. Its only wired link is micro-USB (USB 2.0 Hi-Speed).

- The user sets the camera's **USB Connection** menu to **Mass Storage**. The card then mounts as an
  ordinary drive on every OS with no driver. MTP is avoided because macOS has no built-in MTP
  support.
- Expected throughput is roughly 30 MB/s over USB, against roughly 2-5 MB/s over the camera's
  2.4 GHz 802.11n Wi-Fi AP. A UHS-I card reader (around 90 MB/s) is also a mounted volume, so it
  works with the same code for free.

### What gets imported

| Path on the volume | Content |
|---|---|
| `DCIM/**` | JPG / ARW stills |
| `PRIVATE/AVCHD/BDMV/STREAM/*.MTS` | AVCHD video |
| `MP_ROOT/**` | MP4 video (`100ANV01/MAH*.MP4`) |
| `PRIVATE/M4ROOT/CLIP/*.MP4` | XAVC S video |

### Import rules

- A mounted volume counts as a Sony camera/card when it has both `DCIM/` and `PRIVATE/` at its root.
- Detection polls mounted disks every few seconds (`sysinfo` crate, `Disks`). One cross-platform poll
  loop is simpler than three platform-specific mount watchers.
- The camera volume is only ever read. Nothing is written, renamed or deleted on it.
- Copy into the library folder as `<name>.part`, then rename on success. This is the same reason as
  `src/fileSystem.ts`: a partial file under the final name would later be skipped as already imported.
- Skip a file when the library already has one with the same name **and** size.
- Filename collisions (Sony's `DSC00001.JPG` counter wraps) are out of scope for a single camera.
  If they become a problem, store files in per-date folders.
- Importing only happens for the items the user picks in the window ("Sync selected").

### Post-import / during sync

- **Thumbnails**, generated once and cached next to the library:
  - JPG: downscale with the `image` crate.
  - ARW: extract the embedded JPEG preview, no raw decode.
  - Video: grab a frame with system `ffmpeg` if it's installed, otherwise no thumbnail (the phone grid
    already shows a play badge for videos).
- **AVCHD -> MP4** (built, see "Work items"): while syncing, if system `ffmpeg` is found, convert `.MTS` to `.mp4` next to the original
  using the same rules as `src/convertVideo.ts` (stream copy for progressive clips, AC-3 -> AAC,
  `bwdif` + a hardware encoder for 60i). Without `ffmpeg`, the `.MTS` is served as-is and the phone
  converts it, as it does today. Bundling an ffmpeg binary is deferred.

## Desktop -> phone: HTTP API

`axum` server (Tauri already runs a tokio runtime), listening on all interfaces on a fixed port that
can be changed in settings.

| Route | Response |
|---|---|
| `GET /images` | `ImageItem[]` JSON, the exact shape in `src/camera/types.ts` |
| `POST /pair?t=&name=` | Trades the one-time pairing token for `{ token, id, name, hosts, port }`, this phone's own token |
| `POST /pair/request?name=`, `POST /pair/code?request=&code=&name=` | Pairing by a 6-digit code shown in the window |
| `GET /info`, `GET /app/...` | Hub id and name, and the phone app's web build (no auth) |
| `GET /files/:date/:name` | File bytes, with HTTP Range support (`tower-http` `ServeFile`) so large videos resume |
| `GET /thumbs/:date/:name` | Cached JPEG thumbnail (in `<library>/<date>/.thumbs/`) |

- `/images` returns items **oldest first**, like the camera, because `CameraConnectionContext`
  reverses the list.
- When a converted `.mp4` exists, `/images` lists it instead of the `.MTS`.

### Auth

Every request needs the phone's own token (see `POST /pair`). The token is accepted as a `t=` query parameter, and
`/images` returns `url` / `thumbnailUrl` values that already include it. That way the phone's
existing image, video and download code works unchanged, with no per-request headers.

Trade-off: the token can end up in logs and URLs. That's acceptable on a LAN or inside a VPN tunnel.
It is **not** acceptable on a port forwarded to the open internet. Remote access must go through a
VPN (see below). If port forwarding is ever supported, add TLS and move the token into a header.

### Realtime library updates (planned)

While a phone has a desktop open, the desktop pushes library changes to it, so new imports and
finished AVCHD conversions appear in the phone's grid without a manual refresh.

- **Transport: WebSocket**, `GET /events?t=<phone token>` (axum's `ws` feature). Not SSE: React
  Native's `fetch` can't stream a response body, but RN ships a native `WebSocket`. Same token
  rule as every other route.
- **Messages** (JSON text frames, one per change batch):
  - `{ "type": "hello", "rev": 42 }` right after connecting.
  - `{ "type": "changed", "rev": 43, "added": ImageItem[], "removed": ["<filename>", ...] }`.
    `added` items have the same shape and token-carrying URLs as `/images`, built from the `Host`
    header seen at upgrade. An AVCHD conversion is one message: the `.MTS` removed, the `.mp4` added.
  - `rev` is a library revision counter (in memory, starts at 1 on each launch).
- **Where changes come from:** a `notify` crate watcher on the library folder (recursive,
  debounced ~1 s), which re-runs `library_files()` and diffs the result by `filename` against the
  last snapshot. One path covers the app's own imports and conversions and files the user adds or
  deletes in Finder / Explorer. `.part` files and `.thumbs/` are ignored (`library_files()` already
  skips them). The diff goes out through a `tokio::sync::broadcast` channel, one receiver per socket.
- **Liveness:** the desktop sends a WebSocket ping every 30 s and drops sockets that don't answer.
  "Unpair" / "Unpair all phones" close that phone's sockets with code `4401`.
- **Phone:**
  - While connected to a desktop and in the foreground, it keeps one socket open.
  - It merges each `changed` message into the grid: `added` goes on top (newest first) and `removed` is
    dropped by filename.
  - On close it reconnects with backoff (1, 2, 4 … 30 s) and refetches `/images` after every reconnect,
    so a missed message never leaves the list stale and `rev` gaps need no replay protocol.
  - It closes the socket when the app goes to the background and reopens it (plus a refetch) on
    return.
  - Close code `4401` shows "This phone was unpaired" instead of reconnecting.
  - Sync All keeps its snapshot, so items added mid-sync wait for the next Sync All.
  - Opening an item that was just removed fails with the usual 404 error.
- **Not covered:** telling the phone about changes while the app is closed or in the background.
  That needs APNs / FCM push and a relay server, which is out of scope (no cloud relay).
- **Tests:**
  - Desktop: a unit test for the snapshot diff, including the MTS -> MP4 swap and ignored `.part`
    files, plus an integration test that connects with `tokio-tungstenite` and sees a file copied
    into a temp library.
  - Phone: a pure `applyLibraryChange(items, message)` tested in Node, including a duplicate add
    and a remove for an unknown filename.

## Discovery and pairing

- **LAN:** the desktop advertises `_image-sync._tcp` with the `mdns-sd` crate (pure Rust). TXT
  records: `id=<desktop uuid>`, `v=1`, `name=<hostname>`. The phone browses with
  `react-native-zeroconf`.
- **Pairing:** the desktop window shows a QR code with `{ host, port, token, id }`. The phone scans it
  once and stores it. A phone that found the desktop over mDNS still needs the token, so it scans
  the QR the first time anyway, or types a short code shown in the window.
- **Remote (WAN):** mDNS is link-local multicast and never crosses networks. Remote access works when
  the desktop is reachable at a stable address through a VPN, for example Tailscale (MagicDNS name or
  tailnet IP) or a self-hosted WireGuard. The QR pairing stores that address as an extra `host`, and
  the phone tries the LAN address first, then the remote one. A commercial privacy VPN that only
  routes traffic out to the internet does not make the desktop reachable. Note that iOS allows only
  one active VPN at a time.
- Revoking a phone: the window lists paired phones, each with its own token, so removing one
  doesn't affect the others.

### Pairing without scanning the QR (planned)

mDNS already lets the phone find a desktop without the QR. The QR's only remaining job is
delivering the one-time token, which proves the phone's user can see the desktop's screen.
Approving on the desktop proves the same thing:

1. The phone lists a desktop found by mDNS and the user taps it. The phone calls
   `POST /pair/request?name=<phone name>` (no token), which returns `{ "id", "code" }`. `code` is
   6 random digits.
2. The desktop window (and a system notification if it's hidden in the tray) shows
   "<phone name> wants to pair, code 482 913: Allow / Deny". The phone shows the same code.
3. The phone long-polls `GET /pair/request/<id>` (holds up to 30 s, repeats). It gets `{ "token" }`
   after Allow, `403` after Deny, and `410` once the request expires (2 min).

Matching the code stops a second phone on the same Wi-Fi from getting the approval meant for
yours. At most 3 requests can be pending; more get `429`, so the window can't be flooded. The QR
stays as the fallback when multicast is blocked (AP isolation) and for remote pairing over a VPN.
Pairing with no approval at all is **not** an option: anyone on the same Wi-Fi (shared house,
café) would get the whole library.

## Desktop app shell (Tauri v2)

- Lives in `desktop/` in this repo. Only the `ImageItem` JSON contract is shared with the mobile app,
  so no shared JS package is needed.
- **Tray** (Tauri's `tray-icon` feature): Open / Quit. Closing the
  window hides it to the tray instead of quitting. Start-at-login is a setting.
- **Window:** current import status and progress, library folder (changeable), pairing QR, paired
  phones, and whether `ffmpeg` was found.
- **Settings** stored as a small JSON file in the app config dir: library folder, port,
  token.

## Mobile app changes

- `src/camera/types.ts`: add `{ kind: 'desktop'; baseUrl: string; token: string }` to `CameraApi`.
- `src/camera/index.ts`: `listImages()` gets a third branch that GETs `/images`, using
  `http.ts`'s `fetchText()` (same timeout and error style) and `JSON.parse`. Add a test in
  `camera.test.ts` with an inline JSON fixture.
- Home screen: next to the camera's 2-step connect, add a "Desktops" section listing mDNS results
  plus paired desktops, and a "Scan pairing QR" action (reuses `expo-camera`, already a dependency
  for read-label).
- The grid, detail screen, Sync All and Save to Photos stay unchanged.
- `app.json`: iOS `NSBonjourServices: ["_image-sync._tcp"]` (the existing
  `NSLocalNetworkUsageDescription` covers the permission prompt). `react-native-zeroconf` needs
  `npx expo prebuild --clean`.

## Work items

`[x]` means built. Each item says how far it has been verified: **verified** (by hand on the real
RX100M3 in the running app), **checked** (by script / curl / unit test, not by hand), or neither.

### Desktop: built

- [x] Tauri scaffold: tray menu (Open / Quit), hide-to-tray on close, Dock reopen on macOS, settings JSON.
- [x] Import with `.part` and same-name-and-size skip rules. Checked: unit test.
- [x] Card media paths: the RX100M3 card has `DCIM/100MSDCF` (JPG), `PRIVATE/AVCHD/BDMV/STREAM` (MTS),
      `MP_ROOT/100ANV01` (MP4) and `PRIVATE/M4ROOT/CLIP` (XAVC S MP4). Checked on the real card, which
      found and fixed the missing `MP_ROOT` source (the plan had guessed `MP4/`).
- [x] No auto-import: the user picks items in the Camera tab and clicks "Sync selected". **Verified**:
      synced JPG, MTS and XAVC S MP4 from the real camera into `~/Pictures/image-sync`.
- [x] Camera tab: virtualized grid (Svelte 5 + Vite + `virtua`), selection incl. shift-click range,
      "In library" badges, preview viewer. **Verified**: responsive scrolling over the full 663-item card,
      photo and video previews.
- [x] Library tab: synced items in the same grid and viewer, "Open folder". **Verified**: viewing synced items.
- [x] Thumbnail queue: background prefetch of the whole card plus on-screen-first requests; Sony MPF
      preview for JPGs; EXIF Orientation applied (JPG and ARW). Checked: unit tests for the TIFF/MPF
      parsing, all 663 card thumbnails generated in ~36 s at 320 px, and the 465 portrait results
      match the 465 photos with Orientation 6/8.
- [x] HTTP API + token auth. Checked with curl against real camera files: 401 without token, `/images`
      shape, thumbs, byte-identical downloads, Range 206, traversal 404.
- [x] mDNS advert + pairing QR.

### Desktop: to do

- [x] **Convert AVCHD `.MTS` to `.mp4` while syncing**, so it plays in the desktop viewer and on phones
      (WebKit / WebView2 can't play `.MTS`). Use system `ffmpeg` (`thumbs::ffmpeg()` already finds it)
      once the picked files are copied into the library (built as: after *all* of them, so the camera
      can be unplugged meanwhile), with the rules from `src/convertVideo.ts`:
      - Keep the audio: AC-3 -> AAC (`-c:a aac`), never drop the track.
      - Progressive clips: `-c:v copy`. Interlaced clips (this card's MTS are 1080 **50i**,
        `field_order=tt`): `bwdif` plus a hardware encoder (`h264_videotoolbox` on macOS).
      - Write `<name>.mp4.part` and rename on success, like imports. Keep the original `.MTS` in the
        library so the same-name-and-size skip rule still works on the next sync.
      - The Library tab and `GET /images` list the `.mp4` instead of the `.MTS` once it exists.
      - Show conversion progress in the import status; a failed conversion leaves the `.MTS` listed.
      - Without `ffmpeg`, the `.MTS` is served as-is and the phone converts it, as today.

      **Verified**: synced a real 1080/50i `.MTS` from the camera through the app; the converted
      `.mp4` plays with working audio. Also checked: a unit test converts a generated interlaced
      MPEG-2 + AC-3 clip to H.264 + AAC (skipped without ffmpeg), and the real `00000.MTS` (35.9 s)
      converts in ~10 s with `h264_videotoolbox`.
- [x] Verify XAVC S `C*.MP4` audio plays in the viewer and on phones. Its audio is `pcm_s16be`
      (uncompressed PCM), which may not be supported everywhere. If not, convert it to AAC on sync too.

### Desktop: still needs verifying

- [ ] Save settings, Unpair / Unpair all phones (`confirm()` dialogs), and the QR changing after a
      phone pairs.
- [ ] Per-date folders: a sync lands in `<library>/<YYYY-MM-DD>/`, older top-level files still show
      as "In library", and the date matches the camera's local date (not UTC).
- [ ] Tray: Open and Quit.
- [ ] mDNS advert is visible (`dns-sd -B _image-sync._tcp` on macOS), and across the actual router
      (some routers or "AP isolation" settings block multicast).
- [ ] Syncing items already in the library skips them.
- [ ] Real USB throughput.
- [ ] Thumbnails on real ARW files (the test card has none).
- [ ] Remote access over the chosen VPN, using the "Remote address" setting.

### Desktop: known gaps

- [ ] Background thumbnail prefetch competes with "Sync selected" for USB bandwidth while both run.
- [ ] Port changes need an app restart.
- [x] App icon (icons/ from the generated icon pack). No tray-specific (monochrome/template) icon yet.
- [ ] Start-at-login setting.
- [ ] Short typed pairing code as an alternative to scanning the QR.
- [ ] Packaging (`tauri build`) and testing on Windows and Linux.
- [ ] Existing top-level library files aren't moved into date folders.

### Mobile

- [x] `desktop` `CameraApi` kind (`{ kind: 'desktop'; baseUrl; token }`) and a `listImages()` branch
      for `GET /images` (`src/camera/desktop.ts`). Checked: unit tests for the `/images` and QR parsers.
      There's no manual-address entry: pairing needs the QR's one-time token anyway.
- [x] Pairing QR scan (`app/scan-pairing.tsx`, `expo-camera` with `barcodeScannerEnabled: true`, needs
      `prebuild --clean`), then `POST /pair?t=<QR token>&name=<Constants.deviceName>`. The desktop is
      stored with the **returned** token in `<documents>/desktops.json` (`src/desktops.ts`); re-pairing
      the same `id` replaces it. Pairing and connecting try `hosts` in order with a 5 s timeout each.
      Connecting lists `/images` once and seeds the grid with it.
- [x] mDNS browsing with `react-native-zeroconf` (`src/desktopDiscovery.ts`) while the home screen is
      focused, plus `NSBonjourServices: ["_image-sync._tcp"]` in `app.json` (needs `prebuild --clean`).
      Results are matched to paired desktops by TXT `id`; a match's resolved IPv4 address is tried
      before the stored `hosts`, so a changed LAN IP doesn't need re-pairing. Unpaired ones are listed
      with a tap-to-scan hint, since pairing still needs the QR.

### Optional

- [x] Per-date library folders, so Sony's `DSC00001.JPG` counter wrap can't cause filename collisions.
      Checked: unit tests.
- [x] Per-phone tokens and a paired-phones list. Not checked yet (`/pair` needs the running app).

## Out of scope

- Desktop pushing to phones, or phones uploading to the desktop.
- Desktop-to-desktop sync.
- Deleting anything from the camera.
- MTP / PTP / gphoto2.
- A cloud relay or account system.
- Bundled ffmpeg.

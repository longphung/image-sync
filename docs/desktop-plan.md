# Desktop app plan

Status: plan only, nothing built yet.

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
| `MP4/**` | MP4 video |
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
- Importing can start automatically when a camera volume appears (tray setting, default on), or
  manually with "Sync now".

### Post-import

- **Thumbnails**, generated once and cached next to the library:
  - JPG: downscale with the `image` crate.
  - ARW: extract the embedded JPEG preview, no raw decode.
  - Video: grab a frame with system `ffmpeg` if it's installed, otherwise no thumbnail (the phone grid
    already shows a play badge for videos).
- **AVCHD -> MP4**: if system `ffmpeg` is on `PATH`, convert `.MTS` to `.mp4` next to the original
  using the same rules as `src/convertVideo.ts` (stream copy for progressive clips, AC-3 -> AAC,
  `bwdif` + a hardware encoder for 60i). Without `ffmpeg`, the `.MTS` is served as-is and the phone
  converts it, as it does today. Bundling an ffmpeg binary is deferred.

## Desktop -> phone: HTTP API

`axum` server (Tauri already runs a tokio runtime), listening on all interfaces on a fixed port that
can be changed in settings.

| Route | Response |
|---|---|
| `GET /images` | `ImageItem[]` JSON, the exact shape in `src/camera/types.ts` |
| `GET /files/:name` | File bytes, with HTTP Range support (`tower-http` `ServeDir`) so large videos resume |
| `GET /thumbs/:name` | Cached JPEG thumbnail |

- `/images` returns items **oldest first**, like the camera, because `CameraConnectionContext`
  reverses the list.
- When a converted `.mp4` exists, `/images` lists it instead of the `.MTS`.

### Auth

Every request needs the pairing token. The token is accepted as a `t=` query parameter, and
`/images` returns `url` / `thumbnailUrl` values that already include it. That way the phone's
existing image, video and download code works unchanged, with no per-request headers.

Trade-off: the token can end up in logs and URLs. That's acceptable on a LAN or inside a VPN tunnel.
It is **not** acceptable on a port forwarded to the open internet. Remote access must go through a
VPN (see below). If port forwarding is ever supported, add TLS and move the token into a header.

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
- Revoking a phone: the window lists paired phones. Removing one rotates the token, so every other
  phone has to scan the QR again. Per-phone tokens are deferred until there's more than one or two
  phones.

## Desktop app shell (Tauri v2)

- Lives in `desktop/` in this repo. Only the `ImageItem` JSON contract is shared with the mobile app,
  so no shared JS package is needed.
- **Tray** (Tauri's `tray-icon` feature): Open / Sync now / Pause auto-import / Quit. Closing the
  window hides it to the tray instead of quitting. Start-at-login is a setting.
- **Window:** current import status and progress, library folder (changeable), pairing QR, paired
  phones, and whether `ffmpeg` was found.
- **Settings** stored as a small JSON file in the app config dir: library folder, port, auto-import,
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

## Build order

1. `desktop/` Tauri scaffold with tray, window hide-to-tray and settings.
2. USB volume detection + import with `.part` and skip rules.
3. Thumbnails.
4. HTTP API + token auth.
5. mDNS advert + pairing QR.
6. Mobile: `desktop` `CameraApi` kind + QR pairing, tested by entering the address manually first.
7. Mobile: mDNS browsing.
8. Optional: AVCHD conversion on the desktop with system `ffmpeg`.

## Needs real hardware to verify

- That the RX100M3 in Mass Storage mode exposes the paths listed above (especially the XAVC S and MP4
  folders, which depend on the recording format used).
- Real USB throughput.
- mDNS across the user's actual router (some routers or "AP isolation" settings block multicast).
- Remote access over the chosen VPN.

## Out of scope

- Desktop pushing to phones, or phones uploading to the desktop.
- Desktop-to-desktop sync.
- Deleting anything from the camera.
- MTP / PTP / gphoto2.
- A cloud relay or account system.
- Bundled ffmpeg.

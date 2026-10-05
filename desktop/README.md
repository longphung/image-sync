# image-sync desktop hub

A Tauri v2 desktop app (macOS, Windows, Linux) that imports photos and videos from a Sony RX100M3 over
USB and serves its library to the [image-sync mobile app](../README.md) over HTTP.

```
camera --(USB, Mass Storage)--> desktop --(HTTP + token, LAN or VPN)--> phone(s)
```

The desktop is a hub. Phones pull from it. It never writes to the camera and never pushes to phones.

## Features

- **Camera tab:** when a Sony card mounts (a volume with `DCIM/` and `PRIVATE/` at its root), lists every
  photo and video on it, newest first, in a virtualized grid with thumbnails and "In library" badges.
  Pick items (shift-click selects a range) and click "Sync selected"
- **Library tab:** what's already synced, in the same grid and viewer, plus "Open folder"
- Full-size viewer with arrow-key browsing for photos and MP4
- Files are copied to `<library>/<YYYY-MM-DD>/<name>` via `.part` files, and a file that's already there
  with the same name and size is skipped
- AVCHD `.MTS` clips are converted to `.mp4` with system `ffmpeg` once all picked files are copied, so
  the camera can be unplugged while conversion runs. Without `ffmpeg`, the `.MTS` is served as-is and
  the phone converts it
- **Phone & settings tab:** pairing QR code, paired phones with "Unpair", library folder, port, and an
  optional remote address (e.g. a Tailscale name) for access over a VPN
- Advertises itself over mDNS as `_image-sync._tcp`, so paired phones find it after a LAN IP change
- Closing the window hides it to the tray (Open / Quit)

Defaults: port `8765`, library `~/Pictures/image-sync`. Settings are stored as `settings.json` in the
Tauri app config dir.

## Requirements

- Rust toolchain
- Node + [pnpm](https://pnpm.io)
- The [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS
- Optional: `ffmpeg` on `PATH` (or in `/opt/homebrew/bin` / `/usr/local/bin`) for video thumbnails and
  AVCHD conversion

On the camera, set **USB Connection** to **Mass Storage** so the card mounts as an ordinary drive. A
card reader works too.

## Running

```sh
cd desktop
pnpm install
pnpm tauri dev          # starts Vite for the Svelte UI, then the Rust app
```

`pnpm tauri build` produces a release bundle (not tested yet on Windows or Linux).

## Testing

```sh
cd desktop
cargo test
```

The AVCHD conversion test is skipped when `ffmpeg` isn't installed.

## Pairing a phone

1. Open the **Phone & settings** tab. It shows a QR code.
2. In the mobile app, go to the **Desktops** tab and scan it.

The QR carries a one-time pairing token. The phone trades it for its own token (`POST /pair`), and the
QR then changes, so an old photo of it is useless. Each phone can be unpaired on its own.

**Or pair with a 6-digit code**, with no camera needed: in the mobile app, tap this computer under
"On this network" (or enter its address), or open `http://<this computer's LAN IP>:8765/app` in a phone
browser. The window pops up with a code. Type it on the phone. A code lasts 2 minutes and 5 wrong
tries, and only one request is pending at a time. "Deny" in the popup cancels it.

## Web app

The phone app's web build (`pnpm web:export` at the repo root, which writes `../dist`) is bundled as a
resource and served at `/app`, from the same origin as the API, so the browser needs no CORS. `tauri build`
exports it first. In `tauri dev`, `/app` serves whatever was in `../dist` when the Rust side was last built.
The web app only talks to this hub (it can't reach the camera). Saving uses the share sheet where the
browser allows it, which needs HTTPS, e.g. `tailscale serve`. Over plain LAN http, files download instead.

The token travels in the URL (`?t=`), which is fine on a LAN or inside a VPN. **Don't forward the port to
the open internet**: there's no TLS.

## HTTP API

| Route | Response |
|---|---|
| `POST /pair?t=<pairing token>&name=<phone name>` | `{ token, id, name, hosts, port }`: the phone's own token plus the desktop's details |
| `POST /pair/request?name=<phone name>` | `{ "request": "<id>" }`, and the window shows a 6-digit code |
| `POST /pair/code?request=<id>&code=<code>&name=<phone name>` | Same as `/pair`. 401 wrong code, 410 expired/denied/used up |
| `GET /info` | `{ id, name }`, unauthenticated, for the web app |
| `GET /app/...` | The phone app's web build |
| `GET /images?t=` | `ImageItem[]`, oldest first, the same shape the camera client returns |
| `GET /files/:date/:name?t=` | File bytes, with Range support |
| `GET /thumbs/:date/:name?t=` | Cached JPEG thumbnail |

## Layout

```
src/main.rs      Tauri app: tray, settings, card detection, Tauri commands
src/import.rs    card scanning, copy-with-.part, skip rules, AVCHD conversion
src/server.rs    axum HTTP API for phones, token auth, pairing
src/thumbs.rs    thumbnail queue (Sony MPF preview, EXIF thumbnail, ffmpeg frame grab)
ui/              Svelte 5 + Vite window (Camera, Library, Phone & settings tabs)
```

[`../docs/desktop-plan.md`](../docs/desktop-plan.md) has the design, the decisions behind it, and the
verification status of each work item.

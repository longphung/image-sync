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
  optional remote address (e.g. a Tailscale name) for access over a VPN, and an optional Cloudflare
  tunnel name (see [Public domain](#public-domain-cloudflare-tunnel))
- Advertises itself over mDNS as `_image-sync._tcp`, so paired phones find it after a LAN IP change
- Closing the window hides it to the tray (Open / Quit)

Defaults: port `8765` (`8000` in `tauri dev`), library `~/Pictures/image-sync`. Settings are stored as `settings.json` (`settings.dev.json` in dev, so dev and an installed release don't share pairings) in the
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
browser allows it, which needs HTTPS. Over plain http, Sync All downloads everything as one zip instead.

### HTTPS

The same port also speaks HTTPS (`src/tls.rs` tells the two apart by each connection's first byte), so
`https://<LAN IP>:8765/app` gives the web app the share sheet, i.e. "Save to Photos". A LAN IP can't get a
public certificate, so on first run the hub creates its own CA (`ca-key.pem` + `ca.crt` next to
`settings.json`) and signs a certificate for this machine's current addresses, `<hostname>.local`,
`localhost` and the remote address, re-signing it when they change. Install the CA on the phone once:

- **iPhone:** open `http://<LAN IP>:8765/ca.crt` in Safari and allow the download, then Settings ›
  Profile Downloaded › Install, then General › About › Certificate Trust Settings › turn it on.
- **Android:** download the same link, then Settings › Security › Encryption & credentials › Install a
  certificate › CA certificate. Chrome trusts user-installed CAs.

The CA is name-constrained to private IPv4/IPv6 ranges, CGNAT (`100.64.0.0/10`, Tailscale), `.local`,
`localhost` and `.ts.net`, so even a leaked `ca-key.pem` can't impersonate any other site to the phone.
A remote address outside those (a public domain or IP) won't validate. The `https` page is a different
origin from the `http` one, so the browser has to pair again there. The native app keeps using plain HTTP.

The token travels in the URL (`?t=`), which is fine on a LAN or inside a VPN. **Don't forward the port to
the open internet.** For access from anywhere, use a tunnel (below), which keeps it inside HTTPS.

### Public domain (Cloudflare Tunnel)

With a tunnel name set in Settings, the app runs `cloudflared tunnel run <name>` while it's open and
kills it on quit, so the domain only answers while the app runs (Cloudflare shows a 502 otherwise).
`cloudflared` connects to `https://localhost:<port>` and checks the hub's certificate against the local
CA (`ca.pem`, written next to `ca.crt`), so `/images` returns `https` links. Cloudflare serves a public
certificate, so phones need no CA install. One-time setup, with the domain's zone on Cloudflare:

```sh
brew install cloudflared
cloudflared tunnel login                                     # pick the zone in the browser
cloudflared tunnel create imagesync                          # credentials in ~/.cloudflared/<id>.json, keep secret
cloudflared tunnel route dns imagesync sony.example.com      # adds the CNAME
```

Then put `imagesync` in Settings › Cloudflare tunnel name and restart the app. Open
`https://sony.example.com/app/` and pair by code. Only the web app works this way: the native app still
uses plain HTTP on the hub port.

The hub is then reachable from the internet, so pairing by code is the lock: each code allows 5 guesses
and a new code can be requested only every 30 seconds. For a login in front of it, add a Cloudflare
Access application for the hostname.

## HTTP API

| Route | Response |
|---|---|
| `POST /pair?t=<pairing token>&name=<phone name>` | `{ token, id, name, hosts, port }`: the phone's own token plus the desktop's details |
| `POST /pair/request?name=<phone name>` | `{ "request": "<id>" }`, and the window shows a 6-digit code. 429 within 30 s of the last request |
| `POST /pair/code?request=<id>&code=<code>&name=<phone name>` | Same as `/pair`. 401 wrong code, 410 expired/denied/used up |
| `GET /info` | `{ id, name }`, unauthenticated, for the web app |
| `GET /ca.crt` | This hub's CA certificate (DER), unauthenticated, for the phone to install |
| `GET /app/...` | The phone app's web build |
| `GET /images?t=` | `ImageItem[]`, oldest first, the same shape the camera client returns |
| `GET /files/:date/:name?t=` | File bytes, with Range support |
| `GET /thumbs/:date/:name?t=` | Cached JPEG thumbnail |

## Layout

```
src/main.rs      Tauri app: tray, settings, card detection, Tauri commands
src/import.rs    card scanning, copy-with-.part, skip rules, AVCHD conversion
src/server.rs    axum HTTP API for phones, token auth, pairing
src/tls.rs       local CA, per-address server certificate, HTTP + HTTPS on one port
src/thumbs.rs    thumbnail queue (Sony MPF preview, EXIF thumbnail, ffmpeg frame grab)
ui/              Svelte 5 + Vite window (Camera, Library, Phone & settings tabs)
```

[`../docs/desktop-plan.md`](../docs/desktop-plan.md) has the design, the decisions behind it, and the
verification status of each work item.

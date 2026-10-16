# FilmClip

[![Build macOS DMG](https://github.com/noisyloop/FilmClip/actions/workflows/build-mac.yml/badge.svg?branch=main)](https://github.com/noisyloop/FilmClip/actions/workflows/build-mac.yml)
[![Release](https://img.shields.io/github/v/release/noisyloop/FilmClip?include_prereleases&label=release)](https://github.com/noisyloop/FilmClip/releases)
[![Downloads](https://img.shields.io/github/downloads/noisyloop/FilmClip/total)](https://github.com/noisyloop/FilmClip/releases)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS%20(Apple%20Silicon%20%7C%20Intel)-lightgrey)](#download)
[![License: MIT](https://img.shields.io/github/license/noisyloop/FilmClip)](LICENSE)

A free, offline desktop video editor for macOS with a familiar consumer-editor layout:
media library on the left, player in the middle, properties on the right, and a
multi-track timeline along the bottom. **No account, no login, no watermark, no
network access** — everything runs locally with a bundled ffmpeg.

> Status: early / under construction. PC version coming soon as well.

## Download

[**⬇ Download for Apple Silicon Macs (M1–M4)**](https://github.com/noisyloop/FilmClip/releases/download/v1.0.0/FilmClip-1.0.0-arm64.dmg)
&nbsp;·&nbsp;
[**⬇ Download for Intel Macs**](https://github.com/noisyloop/FilmClip/releases/download/v1.0.0/FilmClip-1.0.0-x64.dmg)

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means
Apple Silicon, "Processor: Intel…" means Intel. See [Install](#install-dmg) for the
first-launch step.

## Features

- **Import** video, photos and music (button, menu, or drag & drop from Finder). Each item shows its **file size**, resolution and length; the library shows the total.
- **Timeline** with a magnetic main video track, a titles track and a music track. Drag to reorder/move, drag edges to trim, split at playhead (`S` / `⌘B`), delete, undo/redo, zoom.
- **Right-click menu** on clips: cut, copy, paste, duplicate, delete, **split exactly where you clicked**, trim to the click point, **reverse**, **speed** (0.25×–8×), mute, reset position.
- **Move & resize in the player**: select a clip or title, drag it to move (snaps to the center lines), drag a corner to resize.
- **Reverse**: reversed clips play backwards in the preview and export (FilmClip builds a reversed copy of the video in the background the first time).
- **Effects**: brightness, contrast, saturation, blur, black & white, sepia, invert, vignette, flip, plus one-click presets (Vivid, Faded, Moody, Bright, Mirror…).
- **Transitions**: fade in/out, dip to white, quick fade.
- **Titles**: 8 presets (basic, subtitle, lower third, neon, …) with font, size, color, outline, glow, background box, position and fade.
- **Audio**: three audio tracks (**Music**, **Sound FX**, **Voice-over**) with **waveforms**; drag clips between them. Per-clip volume, mute, fades and speed (0.1×–8×).
- **Detach audio** from a video clip (right-click → Detach Audio, `⇧⌘D`) to move or trim the sound on its own.
- **Record voice-overs** from your microphone (`⇧⌘R` or the Record button): the video plays silently from the playhead while you talk, and the recording lands on the Voice-over track. Recordings are saved as `.m4a` in `~/Music/FilmClip Recordings`.
- **Export** to MP4, MOV, WebM, GIF or MP3 at 480p–4K, 24–60 fps. Pick Low/Medium/High quality or a **target file size in MB**; the dialog shows a live **estimated file size** and the actual size when done.
- Projects save as `.fcproj` files.

## Keyboard shortcuts

Press `?` or `⌘/` in the app to see this list.

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `J` / `K` / `L` | Play backward / pause / play forward (press `J` or `L` again for 2×, 4×, 8×) |
| `←` `→` (`⇧` for 1 s) | Previous / next frame |
| `↑` `↓` | Previous / next edit point |
| `Home` / `End` | Go to start / end |
| `⌘B` or `S` | Split at playhead |
| `⌘X` / `⌘C` / `⌘V` | Cut / copy / paste clip (pastes at the playhead) |
| `⌘D` | Duplicate clip |
| `⌫` / `⇧⌫` | Delete / ripple delete |
| `⌥[` / `⌥]` | Trim start / end to playhead |
| `⌘R` | Reverse clip |
| `⌘⇧>` / `⌘⇧<` | Speed up / slow down |
| `⌘⇧M` | Mute / unmute clip |
| `⌘⇧D` | Detach audio from a video clip |
| `⌘⇧R` | Record voice-over (`Space` stops) |
| `⌘T` | Add title at playhead |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘=` / `⌘-` / `⇧Z` | Zoom timeline in / out / fit |
| `⌘I` / `⌘E` | Import / export |
| `⌘N` / `⌘O` / `⌘S` | New / open / save project |

On Windows and Linux use `Ctrl` instead of `⌘` and `Alt` instead of `⌥`.

## Install (DMG)

Download `FilmClip-<version>-arm64.dmg` (Apple Silicon: M1/M2/M3/M4) or
`FilmClip-<version>-x64.dmg` (Intel) from the
[Releases page](https://github.com/noisyloop/FilmClip/releases), open it and drag
FilmClip to Applications.

The app is not signed with an Apple Developer ID, so the first time macOS will block it.
Right-click FilmClip in Applications → **Open** → **Open**, or run:

```sh
xattr -dr com.apple.quarantine /Applications/FilmClip.app
```

### Install from Terminal (with checks)

Set the version and your Mac's architecture (`arm64` for Apple Silicon, `x64` for Intel):

```sh
cd ~/Downloads
VERSION=1.0.0
ARCH=arm64
DMG="FilmClip-$VERSION-$ARCH.dmg"

# 1. Download from the release
curl -LO "https://github.com/noisyloop/FilmClip/releases/download/v$VERSION/$DMG"

# 2. Checksum: should match the sha256 shown next to the file on the release page
shasum -a 256 "$DMG"

# 3. Check the disk image isn't damaged
hdiutil verify "$DMG"

# 4. Mount it, copy the app to Applications, unmount
hdiutil attach "$DMG" -nobrowse -mountpoint /Volumes/FilmClip
ditto /Volumes/FilmClip/FilmClip.app /Applications/FilmClip.app
hdiutil detach /Volumes/FilmClip

# 5. Check it was built for your Mac (should say arm64 or x86_64)
file /Applications/FilmClip.app/Contents/MacOS/FilmClip
file /Applications/FilmClip.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg

# 6. Signature check: "not signed" or "adhoc" is expected for this app
codesign -dv /Applications/FilmClip.app 2>&1 | head -3

# 7. Let macOS open the unsigned app, then launch it
xattr -dr com.apple.quarantine /Applications/FilmClip.app
open /Applications/FilmClip.app
```

To see the app's log output (useful when reporting a bug), run it directly instead of `open`:

```sh
/Applications/FilmClip.app/Contents/MacOS/FilmClip
```

The checksum confirms the file you downloaded is the one GitHub stored for the
release. Because the app isn't signed with an Apple Developer ID, it doesn't prove
who built it.

## Develop

```sh
npm install
npm start          # run the app
npm test           # render every export format with the bundled ffmpeg
npm run dist:mac   # build a DMG (must run on macOS)
```

DMGs can only be built on macOS; the `Build macOS DMG` workflow builds arm64 and x64
DMGs on every push.

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

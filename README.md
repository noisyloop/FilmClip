# FilmClip

A free, offline desktop video editor for macOS with a familiar consumer-editor layout:
media library on the left, player in the middle, properties on the right, and a
multi-track timeline along the bottom. **No account, no login, no watermark, no
network access** — everything runs locally with a bundled ffmpeg.

> Status: early / under construction.

## Features

- **Import** video, photos and music (button, menu, or drag & drop from Finder). Each item shows its **file size**, resolution and length; the library shows the total.
- **Timeline** with a magnetic main video track, a titles track and a music track. Drag to reorder/move, drag edges to trim, split at playhead (`S` / `⌘B`), delete, undo/redo, zoom.
- **Effects**: brightness, contrast, saturation, blur, black & white, sepia, invert, vignette, flip, plus one-click presets (Vivid, Faded, Moody, Bright, Mirror…).
- **Transitions**: fade in/out, dip to white, quick fade.
- **Titles**: 8 presets (basic, subtitle, lower third, neon, …) with font, size, color, outline, glow, background box, position and fade.
- **Audio**: clip volume/mute, speed (0.25×–4×), music track with fades.
- **Export** to MP4, MOV, WebM, GIF or MP3 at 480p–4K, 24–60 fps. Pick Low/Medium/High quality or a **target file size in MB**; the dialog shows a live **estimated file size** and the actual size when done.
- Projects save as `.fcproj` files.

## Install (DMG)

Download `FilmClip-<version>-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel) from the
GitHub Actions run artifacts (or a release), open it and drag FilmClip to Applications.

The app is not signed with an Apple Developer ID, so the first time macOS will block it.
Right-click FilmClip in Applications → **Open** → **Open**, or run:

```sh
xattr -dr com.apple.quarantine /Applications/FilmClip.app
```

## Develop

```sh
npm install
npm start          # run the app
npm test           # render every export format with the bundled ffmpeg
npm run dist:mac   # build a DMG (must run on macOS)
```

DMGs can only be built on macOS; the `Build macOS DMG` workflow builds arm64 and x64
DMGs on every push.

# Security Policy

## Supported versions

FilmClip is in early development. Only the latest release (and the current
`main` branch) receives security fixes.

| Version | Supported |
|---|---|
| 1.x (latest) | ✅ |
| Older builds | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the problem, the FilmClip version and OS, and steps to reproduce.
   A sample project (`.fcproj`) or media file that triggers the issue is very
   helpful.

What to expect:

- An acknowledgement within **7 days**.
- An assessment and, if confirmed, a planned fix within **30 days**. Complex
  issues may take longer; we will keep you updated in the advisory.
- Credit in the advisory and release notes, unless you prefer to stay
  anonymous.

Please give us a reasonable chance to release a fix before disclosing the issue
publicly.

## Scope

FilmClip is an offline desktop app: it has no accounts, no servers and makes no
network requests. Its attack surface is the local files it opens. In scope:

- **Project files (`.fcproj`)**: a crafted project that makes FilmClip read,
  write or delete files outside what the user chose, or run code.
- **Media files**: crafted video, audio or image files that lead to code
  execution through the preview (Chromium) or the bundled ffmpeg.
- **The Electron app**: bypasses of context isolation, the preload API
  (`window.api`), the Content Security Policy, or the IPC handlers in
  `src/main/main.js` that let renderer content reach Node.js or the file system.
- **Command or argument injection** into the ffmpeg processes FilmClip spawns.
- **Build and release**: problems in the GitHub Actions workflow or packaging
  that could let someone tamper with published DMGs.

Out of scope:

- The app being **unsigned / not notarized** on macOS. This is a known
  limitation documented in the README.
- Vulnerabilities in **ffmpeg, Electron or Chromium** themselves that are
  already fixed upstream. Please report those upstream; do tell us if FilmClip
  ships an outdated version with a known issue.
- Issues that need an attacker who already controls the user's account or
  machine.
- Denial of service from very large or malformed media (for example, a
  slow or crashing export), unless it leads to one of the in-scope issues above.

## Using FilmClip safely

- Download builds only from this repository's Releases or Actions artifacts.
- Treat project files and media from untrusted sources with the same care as
  any other downloaded file.
- FilmClip stores preview proxies and reversed copies of your videos in the
  app's data folder (`~/Library/Application Support/FilmClip` on macOS). You can
  delete the `proxies` and `reversed` folders there at any time.

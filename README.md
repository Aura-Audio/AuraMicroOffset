# Microtone — Cluster Synthesizer PWA

An offline-capable, mobile-first micro-frequency cluster synthesizer built with the Web Audio API and AudioWorklet. Designed to survive aggressive mobile OS battery management through a three-pillar survival strategy.

## Features

- **Micro-frequency cluster synthesis** — Generate rich harmonic textures from 1–64 oscillators
- **Offline-first PWA** — Works without an internet connection once installed
- **Mobile survival strategy** — Media Session API, silent audio keep-alive, and wake lock
- **Band-limited wavetables** — Anti-aliased sine, triangle, square, and sawtooth waveforms
- **Real-time spectrum visualizer** — Canvas-based frequency analysis with eco mode
- **Full keyboard accessibility** — Keyboard shortcuts, ARIA labels, skip links, focus rings
- **Reduced motion support** — Respects `prefers-reduced-motion` for accessible animation
- **Cross-browser compatibility** — Graceful degradation on unsupported browsers

## Architecture

```
index.html          PWA shell + UI + iOS meta tags + silent audio hack
manifest.json       PWA manifest (icons, theme, shortcuts)
sw.js               Offline-first service worker (cache-first strategy)
css/style.css       Accessible, responsive, dark-mode-first styles
js/app.js           Main app: engine, visualizer, UI controller, PWA integration
js/cluster-synth-processor.js   AudioWorklet DSP processor
```

## Quick Start

### 1. Prerequisites

Generate two icon files and place them in the project root:

- `icon-192x192.png` — App icon (192×192 px)
- `icon-512x512.png` — Large icon / splash screen (512×512 px)

Optional but recommended:
- `screenshot-wide.png` — Store screenshot (1280×720)
- `screenshot-narrow.png` — Store screenshot (750×1334)

### 2. Deploy to Cloudflare Pages

1. Push this directory to a Git repository
2. Connect the repo to [Cloudflare Pages](https://pages.cloudflare.com/)
3. Build settings: **Build command** = empty, **Build output directory** = `/`
4. Deploy

Cloudflare Pages automatically serves assets over HTTPS with correct MIME types (`application/javascript` for `.js`, `application/manifest+json` for `.json`).

### 3. Install on Mobile

**Android (Chrome/Edge):**
1. Open the deployed URL in Chrome
2. Tap **Menu (⋮)** → **"Install app"**
3. Open from home screen for standalone experience with media controls

**iOS (Safari only):**
1. Open the deployed URL in **Safari**
2. Tap **Share (□↑)** → **"Add to Home Screen"**
3. Open from home screen — the silent audio keep-alive engages automatically

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `V` | Toggle visualizer |
| `↑` / `↓` | Nudge base frequency |
| `Esc` | Stop |

## Mobile Survival Strategy

### Pillar 1: Media Session API
Signals to the OS that this is a media app, granting:
- Lock-screen playback controls
- Notification shade controls
- Background audio priority on Android

### Pillar 2: Silent Audio Keep-Alive (iOS)
iOS Safari suspends Web Audio when the screen locks. A hidden, looping, silent `<audio>` element forces the hardware audio session to stay active, allowing the AudioWorklet to continue generating sound.

### Pillar 3: Screen Wake Lock
Prevents the screen from dimming or locking during active playback.

## Code Quality & Safety

### AudioWorklet Fixes
- **TDZ-safe `sampleRate`** — Avoids redeclaring the global `sampleRate` constant
- **Band-limited wavetables** — Prevents aliasing via additive synthesis with Nyquist-limited harmonics
- **DC blocking filter** — Prevents cumulative offset drift
- **Denormal protection** — Flushes subnormal floats to prevent CPU slowdown
- **Soft clipping** — `Math.tanh()` prevents hard digital distortion

### Error Handling
- AudioContext `interrupted` state recovery (iOS phone calls / Siri)
- Graceful fallback when Wake Lock or Media Session APIs are unavailable
- Non-blocking toast notifications instead of `alert()`
- Defensive null checks throughout

### Accessibility
- Skip-to-content link for keyboard users
- Full ARIA labeling on all controls
- Focus-visible indicators with high-contrast fallbacks
- `prefers-reduced-motion` support
- `prefers-contrast: more` support

## Browser Support

| Feature | Chrome Android | Safari iOS | Firefox Android | Desktop |
|---------|---------------|------------|-----------------|---------|
| Install | ✅ | ✅ (manual) | ❌ | ✅ |
| AudioWorklet | ✅ | ✅ 14.5+ | ✅ | ✅ |
| Media Session | ✅ | ✅ 15+ | ❌ | Partial |
| Wake Lock | ✅ | ❌ | ❌ | ✅ |
| Background Audio | ✅ | ✅* | ✅ | N/A |

\* Requires silent audio keep-alive trick on iOS.

## License

MIT — use freely, modify, and share.

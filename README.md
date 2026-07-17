# Micro-Cluster Synth

A micro-frequency cluster synthesizer PWA supporting up to 1000 oscillators. Built for mobile survival with offline-first architecture.

## Features

- **1–1000 oscillator clusters** with microtonal step control (0.00001 Hz)
- **Base frequency** 0.01 Hz – 22 kHz
- **Band-limited wavetables**: Sine, Triangle, Square, Sawtooth
- **Lowpass filter** with cutoff and resonance (Q)
- **Volume** 0% – 200%
- **Real-time spectrum visualizer**
- **Offline PWA** with Service Worker
- **Mobile survival**: Media Session API, iOS silent audio keep-alive, Screen Wake Lock

## Deploy

1. Add `icon-192x192.png` and `icon-512x512.png` to root
2. Deploy to Cloudflare Pages (HTTPS required)
3. Install on mobile home screen

## Controls

| Parameter | Range | UI |
|-----------|-------|-----|
| Base Freq | 0.01 – 22,000 Hz | Number input |
| Step Size | 0.00001 – 1 Hz | Slider |
| Cluster Size | 10, 50, 100, 150, 200, 250, 500, 1000 | Buttons |
| Waveform | Sine, Triangle, Square, Sawtooth | Buttons |
| Volume | 0 – 200% | Slider |
| Filter Cutoff | 20 Hz – 20 kHz | Slider |
| Resonance (Q) | 0.1 – 20 | Slider |
| Stereo Spread | 0 – 100% | Slider |
| Attack | 0.001 – 1 s | Slider |
| Release | 0.001 – 1 s | Slider |

## Keyboard

- `Space` — Play / Stop
- `↑` / `↓` — Nudge base frequency

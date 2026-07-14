# AuraMicroOffset

**An ultra‑precise, browser‑based microtonal cluster synthesizer built with the Web Audio API.**  
Create dense, slowly evolving sonic textures from hundreds of oscillators spaced only **0.00001 Hz** apart.

[![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)](#)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)](#)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)](#)
[![Web Audio API](https://img.shields.io/badge/Web%20Audio-API-blueviolet)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![Micro-Cluster Synth Screenshot](screenshot.png)  
*(Replace with an actual screenshot or GIF of the interface in action)*

---

## ✨ Overview

**Micro-Cluster Synth** generates dense, micro‑tonal tone clusters directly in the browser. By stacking up to **1000 sine, triangle, square or sawtooth oscillators** with a frequency increment of just `0.00001 Hz`, it produces rich, slowly shifting interference patterns and beating effects – perfect for drone music, sound design experiments, and exploring the psychoacoustic boundaries of human pitch perception.

The entire application is a **single, self‑contained HTML file** – no dependencies, no build process, no server required. It runs instantly on any modern browser.

---

## 🚀 Live Demo

👉 **[Try it online](https://your-username.github.io/micro-cluster-synth/)**  
*(Deploy the `index.html` to GitHub Pages or any static host to make it available.)*

---

## 🎧 Features

- **Extreme frequency precision**  
  Oscillators are spaced by `0.00001 Hz` – far below the just‑noticeable‑difference of human pitch, creating organic, evolving beating textures.

- **Configurable cluster sizes**  
  Choose from `10, 50, 100, 150, 200, 250, 500, 1000` concurrent oscillators.

- **Base frequency control**  
  Set the starting frequency anywhere between 20 Hz and 8 kHz.

- **Four classic waveforms**  
  Switch between **Sine, Triangle, Square and Sawtooth** waves on the fly.

- **Automatic amplitude normalisation**  
  The master gain is automatically reduced to `1 / clusterSize`, preventing clipping even with hundreds of oscillators. A volume slider (0–200%) gives you additional control.

- **Real‑time waveform visualiser**  
  See the combined output signal on a responsive canvas, making the complex interference patterns visible.

- **Efficient resource management**  
  All oscillators are properly stopped and disconnected when playback ends, minimising CPU and memory usage. The code uses modular, vanilla JavaScript – no frameworks, no heavy libraries.

- **Responsive & accessible**  
  Optimised for desktop and mobile browsers, with keyboard shortcut (spacebar) to toggle playback.

---

## 🧠 How It Works

Each oscillator `i` (from 1 to N) is tuned to:

```

frequency_i = baseFrequency + i × step

```

where `step = 0.00001 Hz`.  
For example, with `base = 250 Hz` and `N = 100`, the frequencies range from `250.00001 Hz` to `250.00100 Hz`. The resulting sound is a dense cluster of closely‑spaced tones that interfere continuously, causing the amplitude to rise and fall over seconds – a phenomenon known as **beating**.

The cluster’s overall loudness is normalised to prevent digital distortion, and an envelope fades the sound in/out smoothly to avoid clicks.

A built‑in `AnalyserNode` feeds the waveform visualiser, giving you real‑time insight into the complex signal.

---

## 📦 Getting Started

You can run the synth in three simple steps:

1. **Download** the repository or copy the raw `index.html` file.
2. **Open** `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).
3. **Click** the “Play Cluster” button (or press `Space`) and start exploring!

> ℹ️ **Note on audio autoplay:**  
> Modern browsers require a user interaction before playing audio. The first click/tap on the page will unlock the AudioContext. If the button is disabled, just tap anywhere and it will activate.

---

## 🎮 Usage

| Control          | Description                                                                 |
|------------------|-----------------------------------------------------------------------------|
| **Base Frequency** | Enter the starting frequency (20–8000 Hz).                                    |
| **Cluster Size**   | Select how many oscillators to stack. Larger clusters create denser textures. |
| **Waveform**       | Choose the oscillator shape: Sine, Triangle, Square or Sawtooth.             |
| **Volume**         | Adjust the master output (0–200%).                                            |
| **Play / Stop**    | Start or stop the cluster. Press `Space` for quick toggle.                    |

The **info bar** shows the exact frequency range, total spread, and number of tones in the current cluster.

---

## 🛠️ Customisation

The code is modular and well‑commented. You can easily tweak:

- **Step size** – change the `step` constant inside the `App` class (line ~520).  
- **Available cluster sizes** – edit the `clusterSizes` array.  
- **Waveform list** – add or remove waveform options.  
- **Visual style** – the CSS uses custom properties (`:root`) for easy colour scheme changes.

No build tools are required – just edit the HTML file directly.

---

## ⚡ Performance Notes

- **Up to 1000 oscillators** run smoothly on modern hardware, thanks to Web Audio’s native oscillator implementation.
- The **gain normalisation** (`1/N`) ensures the combined signal never exceeds the clipping threshold.
- When playback stops, all oscillators are **immediately disconnected** and their references released, keeping memory usage minimal.
- The visualiser runs at 60 fps using `requestAnimationFrame` and scales with the container, but it can be disabled if you need to save battery on mobile.

For extreme cluster sizes (>500) on low‑end devices, you may notice a slight load – the app remains fully functional but we recommend starting with smaller clusters and adjusting.

---

## 🧰 Technology Stack

- **HTML5** – semantic, accessible markup.
- **CSS3** – custom design system with CSS variables, responsive layout.
- **Vanilla JavaScript (ES6+)** – modular, object‑oriented code.
- **Web Audio API** – `OscillatorNode`, `GainNode`, `AnalyserNode`.
- **Canvas API** – real‑time waveform visualisation.

Zero external dependencies, no frameworks, no npm.

---

## 📄 License

This project is open‑source and available under the **MIT License**.  
See the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgements

Inspired by the pioneering work in microtonal and spectral music, and by the limitless possibilities of the Web Audio API.

---

**Enjoy the deep drones and happy sound designing!** 🎵  
Feel free to open issues or pull requests if you have ideas for improvements.

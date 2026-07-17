/**
 * Micro-Cluster Synth — Main Application
 */

// ============================================
// Toast Manager
// ============================================
class ToastManager {
  constructor(id = 'toast-container') {
    this.el = document.getElementById(id);
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = id;
      this.el.className = 'toast-container';
      document.body.appendChild(this.el);
    }
  }
  show(msg, type = 'info', dur = 4000) {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    t.textContent = `${icons[type] || 'ℹ'} ${msg}`;
    this.el.appendChild(t);
    setTimeout(() => t.remove(), dur);
  }
}

// ============================================
// Audio Engine
// ============================================
class MicrotoneEngine {
  constructor() {
    this.ctx = null;
    this.worklet = null;
    this.analyser = null;
    this.gainNode = null;
    this.filterNode = null;
    this.isInit = false;
    this.isPlaying = false;
  }

  async init() {
    if (this.isInit) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule('js/cluster-synth-processor.js');

    this.worklet = new AudioWorkletNode(this.ctx, 'cluster-synth', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
    });

    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 1.0;

    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = 20000;
    this.filterNode.Q.value = 0.1;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    // Chain: Worklet -> Gain -> Filter -> Analyser -> Destination
    this.worklet.connect(this.gainNode);
    this.gainNode.connect(this.filterNode);
    this.filterNode.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // iOS interrupted recovery
    this.ctx.onstatechange = () => {
      if (this.ctx.state === 'suspended' && this.isPlaying) {
        this.ctx.resume().catch(() => {});
      }
    };

    this.isInit = true;
  }

  start(params) {
    if (!this.isInit) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.worklet.port.postMessage({ type: 'start', ...params });
    this.isPlaying = true;
  }

  stop() {
    if (this.worklet) this.worklet.port.postMessage({ type: 'stop' });
    this.isPlaying = false;
  }

  update(params) {
    if (this.worklet) this.worklet.port.postMessage({ type: 'update', ...params });
  }

  panic() {
    if (this.worklet) this.worklet.port.postMessage({ type: 'panic' });
    this.isPlaying = false;
  }

  setVolume(v) { // 0.0 to 2.0
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.02);
    }
  }

  setFilter(freq, q) {
    if (this.filterNode) {
      const now = this.ctx.currentTime;
      this.filterNode.frequency.setTargetAtTime(Math.max(20, freq), now, 0.02);
      this.filterNode.Q.setTargetAtTime(Math.max(0.1, q), now, 0.02);
    }
  }

  getAnalyser() { return this.analyser; }

  async close() {
    if (this.ctx) { await this.ctx.close(); this.ctx = null; }
    this.worklet = null; this.analyser = null; this.gainNode = null;
    this.filterNode = null; this.isInit = false; this.isPlaying = false;
  }
}

// ============================================
// Visualizer
// ============================================
class Visualizer {
  constructor(id) {
    this.canvas = document.getElementById(id);
    this.ctx = this.canvas.getContext('2d');
    this.analyser = null;
    this.data = null;
    this.raf = null;
    this.running = false;
    this.visible = true;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      this.visible = !document.hidden;
      if (this.visible && this.running && !this.raf) this._draw();
    });
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.w = rect.width;
    this.h = rect.height;
  }

  start(analyser) {
    this.analyser = analyser;
    this.data = new Uint8Array(analyser.frequencyBinCount);
    this.running = true;
    this._draw();
  }

  stop() {
    this.running = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
    this.ctx.clearRect(0, 0, this.w, this.h);
  }

  _draw() {
    if (!this.running || !this.visible) return;
    this.analyser.getByteFrequencyData(this.data);
    this._render();
    this.raf = requestAnimationFrame(() => this._draw());
  }

  _render() {
    const c = this.ctx, w = this.w, h = this.h;
    const buf = this.data, len = buf.length;
    c.clearRect(0, 0, w, h);

    const bars = 80;
    const bw = w / bars;
    const step = Math.floor(len / bars);

    for (let i = 0; i < bars; i++) {
      const v = buf[i * step] || 0;
      const bh = (v / 255) * h * 0.92;
      const hue = 200 + (i / bars) * 60 + (v / 255) * 20;
      const grad = c.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, `hsla(${hue}, 80%, 45%, 0.85)`);
      grad.addColorStop(1, `hsla(${hue}, 80%, 65%, 0.3)`);
      c.fillStyle = grad;
      c.fillRect(i * bw + 0.5, h - bh, bw - 1, bh);
      c.fillStyle = `hsla(${hue}, 100%, 80%, 0.7)`;
      c.fillRect(i * bw + 0.5, h - bh, bw - 1, 1.5);
    }
  }
}

// ============================================
// Main App
// ============================================
class App {
  constructor() {
    this.engine = new MicrotoneEngine();
    this.visualizer = new Visualizer('visualizer');
    this.toast = new ToastManager();

    // State
    this.isPlaying = false;
    this.wakeLock = null;
    this.deferredPrompt = null;
    this._updateTimer = null;

    // Params
    this.baseFreq = 250;
    this.step = 0.001;
    this.clusterSize = 10;
    this.waveform = 'sine';
    this.stereoWidth = 0.5;
    this.attackTime = 0.01;
    this.releaseTime = 0.22;
    this.harmonicMode = 'linear';
    this.volume = 100;
    this.filterCutoff = 20000;
    this.resonance = 0.1;

    this.els = {};
    this._cacheEls();
    this.silentAudio = document.getElementById('ios-silence-loop');

    this._init();
  }

  _cacheEls() {
    const ids = [
      'play-btn', 'status-dot', 'status-badge',
      'base-freq', 'step-size', 'step-val',
      'stereo-width', 'stereo-val',
      'attack-time', 'attack-val', 'release-time', 'release-val',
      'volume', 'volume-val',
      'filter-cutoff', 'cutoff-val', 'resonance', 'resonance-val',
      'cluster-size-group', 'waveform-group',
      'status-bar', 'range-min', 'range-max', 'spread-val', 'tones-val',
      'ios-install-banner', 'pwa-install-banner',
      'install-pwa-btn', 'dismiss-ios-banner', 'dismiss-pwa-banner'
    ];
    ids.forEach(id => this.els[id] = document.getElementById(id));
  }

  async _init() {
    this._setupListeners();
    this._setupMediaSession();
    this._setupPWA();
    this._detectIOS();
    this._registerSW();
    this._updateStatusBar();

    document.addEventListener('keydown', (e) => this._onKey(e));
    document.addEventListener('visibilitychange', () => this._onVisibility());
    window.addEventListener('beforeunload', () => this._cleanup());
  }

  // ----------------------------------------
  // Event Listeners
  // ----------------------------------------
  _setupListeners() {
    // Play button
    this.els['play-btn']?.addEventListener('click', () => this._togglePlay());

    // Base freq number input
    this.els['base-freq']?.addEventListener('input', (e) => {
      this.baseFreq = parseFloat(e.target.value) || 250;
      this._debouncedUpdate();
      this._updateStatusBar();
    });

    // Sliders
    const sliders = [
      ['step-size', 'step-val', 'step', v => v, v => parseFloat(v)],
      ['stereo-width', 'stereo-val', 'stereoWidth', v => `${v}%`, v => parseInt(v) / 100],
      ['attack-time', 'attack-val', 'attackTime', v => `${v} s`, v => parseFloat(v)],
      ['release-time', 'release-val', 'releaseTime', v => `${v} s`, v => parseFloat(v)],
      ['volume', 'volume-val', 'volume', v => `${v}%`, v => parseInt(v)],
      ['filter-cutoff', 'cutoff-val', 'filterCutoff', v => v >= 1000 ? `${(v/1000).toFixed(1)} kHz` : `${v} Hz`, v => parseInt(v)],
      ['resonance', 'resonance-val', 'resonance', v => v, v => parseFloat(v)]
    ];

    sliders.forEach(([id, valId, param, fmt, parse]) => {
      const el = this.els[id];
      const readout = this.els[valId];
      if (!el) return;
      el.addEventListener('input', () => {
        const val = parse(el.value);
        this[param] = val;
        if (readout) readout.textContent = fmt(el.value);
        if (param === 'volume') this.engine.setVolume(val / 100);
        if (param === 'filterCutoff' || param === 'resonance') {
          this.engine.setFilter(this.filterCutoff, this.resonance);
        }
        if (this.isPlaying) this._debouncedUpdate();
        if (param === 'stereoWidth') this._updateStatusBar();
      });
    });

    // Button groups
    this._setupBtnGroup('cluster-size-group', 'clusterSize', (v) => {
      this.clusterSize = parseInt(v);
      this._updateStatusBar();
      if (this.isPlaying) this._debouncedUpdate();
    });

    this._setupBtnGroup('waveform-group', 'waveform', (v) => {
      this.waveform = v;
      if (this.isPlaying) this._debouncedUpdate();
    });

    // Install banners
    this.els['dismiss-ios-banner']?.addEventListener('click', () => {
      this.els['ios-install-banner'].hidden = true;
      localStorage.setItem('mcs-ios-dismissed', '1');
    });
    this.els['dismiss-pwa-banner']?.addEventListener('click', () => {
      this.els['pwa-install-banner'].hidden = true;
      localStorage.setItem('mcs-pwa-dismissed', '1');
    });
    this.els['install-pwa-btn']?.addEventListener('click', () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        this.deferredPrompt.userChoice.then((c) => {
          if (c.outcome === 'accepted') this.toast.show('Installed!', 'success');
          this.deferredPrompt = null;
          this.els['pwa-install-banner'].hidden = true;
        });
      }
    });
  }

  _setupBtnGroup(groupId, param, callback) {
    const group = this.els[groupId];
    if (!group) return;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.pill-btn');
      if (!btn) return;
      group.querySelectorAll('.pill-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-checked', 'true');
      callback(btn.dataset.value);
    });
  }

  _debouncedUpdate() {
    if (this._updateTimer) clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => {
      this.engine.update(this._getParams());
    }, 40);
  }

  _getParams() {
    return {
      baseFreq: this.baseFreq,
      step: this.step,
      clusterSize: this.clusterSize,
      waveform: this.waveform,
      stereoWidth: this.stereoWidth,
      attackTime: this.attackTime,
      releaseTime: this.releaseTime,
      harmonicMode: this.harmonicMode
    };
  }

  // ----------------------------------------
  // Status Bar
  // ----------------------------------------
  _updateStatusBar() {
    const base = this.baseFreq;
    const size = this.clusterSize;
    const step = this.step;
    let min, max;

    switch (this.harmonicMode) {
      case 'harmonic':
        min = base;
        max = base * size;
        break;
      case 'subharmonic':
        min = base / size;
        max = base;
        break;
      case 'just': {
        const ratios = [1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2];
        const lastIdx = (size - 1) % ratios.length;
        const octave = Math.floor((size - 1) / ratios.length);
        min = base;
        max = base * ratios[lastIdx] * (1 + octave);
        break;
      }
      case 'linear':
      default:
        min = base;
        max = base + ((size - 1) * step);
        break;
    }

    const spread = max - min;

    if (this.els['range-min']) this.els['range-min'].textContent = min.toFixed(3);
    if (this.els['range-max']) this.els['range-max'].textContent = max.toFixed(3);
    if (this.els['spread-val']) this.els['spread-val'].textContent = spread.toFixed(4);
    if (this.els['tones-val']) this.els['tones-val'].textContent = size;
  }

  // ----------------------------------------
  // Keyboard
  // ----------------------------------------
  _onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this._togglePlay();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._nudge('base-freq', 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this._nudge('base-freq', -1);
        break;
    }
  }

  _nudge(id, dir) {
    const el = this.els[id];
    if (!el) return;
    const step = parseFloat(el.step) || 1;
    el.value = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), parseFloat(el.value) + dir * step));
    el.dispatchEvent(new Event('input'));
  }

  // ----------------------------------------
  // Transport
  // ----------------------------------------
  async _togglePlay() {
    if (this.isPlaying) {
      this._stop();
    } else {
      await this._start();
    }
  }

  async _start() {
    try {
      if (!this.engine.isInit) await this.engine.init();
      if (this.engine.ctx.state === 'suspended') await this.engine.ctx.resume();
      if (this.engine.ctx.state !== 'running') {
        this.toast.show('Tap the page first to enable audio', 'warning');
        return;
      }

      // Apply current volume and filter
      this.engine.setVolume(this.volume / 100);
      this.engine.setFilter(this.filterCutoff, this.resonance);

      // iOS silent audio
      await this._triggerSilentAudio();
      // Wake lock
      await this._requestWakeLock();

      this.engine.start(this._getParams());
      const analyser = this.engine.getAnalyser();
      if (analyser) this.visualizer.start(analyser);

      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';

      this.isPlaying = true;
      this._updatePlayUI(true);

    } catch (err) {
      console.error(err);
      this.toast.show(`Start failed: ${err.message}`, 'error');
      this._releaseWakeLock();
    }
  }

  _stop() {
    this._releaseWakeLock();
    this._stopSilentAudio();
    this.engine.stop();
    this.visualizer.stop();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    this.isPlaying = false;
    this._updatePlayUI(false);
  }

  _updatePlayUI(playing) {
    const btn = this.els['play-btn'];
    const dot = this.els['status-dot'];
    const badge = this.els['status-badge'];

    if (btn) {
      btn.innerHTML = playing
        ? '<span class="play-icon">⏸</span><span>Stop Cluster</span>'
        : '<span class="play-icon">▶</span><span>Play Cluster</span>';
      btn.style.background = playing ? '#ff4757' : '';
      btn.style.boxShadow = playing ? '0 4px 20px rgba(255,71,87,0.25)' : '';
    }
    if (dot) {
      dot.classList.toggle('playing', playing);
      dot.classList.toggle('idle', !playing);
    }
    if (badge) badge.textContent = playing ? 'PLAYING' : 'IDLE';
  }

  // ----------------------------------------
  // iOS Silent Audio
  // ----------------------------------------
  async _triggerSilentAudio() {
    if (!this.silentAudio) return;
    try {
      this.silentAudio.volume = 0.001;
      this.silentAudio.muted = false;
      await this.silentAudio.play();
      setTimeout(() => { if (this.silentAudio) this.silentAudio.muted = true; }, 100);
    } catch (e) {}
  }

  _stopSilentAudio() {
    if (!this.silentAudio) return;
    try { this.silentAudio.pause(); this.silentAudio.currentTime = 0; this.silentAudio.muted = false; } catch (e) {}
  }

  // ----------------------------------------
  // Wake Lock
  // ----------------------------------------
  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
    } catch (e) {}
  }

  _releaseWakeLock() {
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
  }

  // ----------------------------------------
  // Media Session
  // ----------------------------------------
  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Micro-Cluster Synth',
      artist: 'Generative Audio',
      artwork: [
        { src: 'icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512x512.png', sizes: '512x512', type: 'image/png' }
      ]
    });
    navigator.mediaSession.setActionHandler('play', () => this._start());
    navigator.mediaSession.setActionHandler('pause', () => this._stop());
    navigator.mediaSession.setActionHandler('stop', () => this._stop());
  }

  // ----------------------------------------
  // PWA
  // ----------------------------------------
  _setupPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      if (!localStorage.getItem('mcs-pwa-dismissed') && this.els['pwa-install-banner']) {
        this.els['pwa-install-banner'].hidden = false;
      }
    });
  }

  _detectIOS() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    if (isIOS && isSafari && !localStorage.getItem('mcs-ios-dismissed') && this.els['ios-install-banner']) {
      setTimeout(() => { this.els['ios-install-banner'].hidden = false; }, 2500);
    }
  }

  async _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('sw.js');
    } catch (e) { console.warn('SW failed:', e); }
  }

  // ----------------------------------------
  // Lifecycle
  // ----------------------------------------
  _onVisibility() {
    if (document.hidden) {
      this.visualizer.stop();
      this._releaseWakeLock();
    } else {
      if (this.isPlaying) {
        this.visualizer.start(this.engine.getAnalyser());
        this._requestWakeLock();
        if (this.silentAudio?.paused) this._triggerSilentAudio();
        if (this.engine.ctx?.state === 'suspended') this.engine.ctx.resume();
      }
    }
  }

  _cleanup() {
    this._releaseWakeLock();
    this._stopSilentAudio();
    this.visualizer.stop();
    if (this.isPlaying) this.engine.panic();
  }
}

// Bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

/**
 * Microtone — Main Application Controller
 * 
 * Architecture:
 *  - MicrotoneEngine: Web Audio API + AudioWorklet management
 *  - Visualizer: Canvas frequency spectrum renderer
 *  - App: UI controller, event handling, PWA integration
 */

// ============================================
// Utility: Toast Notification System
// ============================================
class ToastManager {
  constructor(containerId = 'toast-container') {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      this.container.className = 'toast-container';
      this.container.setAttribute('aria-live', 'assertive');
      this.container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(this.container);
    }
  }

  show(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    // Icons
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
    toast.insertAdjacentText('afterbegin', `${icons[type] || 'ℹ'} `);

    this.container.appendChild(toast);

    // Auto-remove
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, duration);

    return toast;
  }
}

// ============================================
// Engine: Web Audio + AudioWorklet
// ============================================
class MicrotoneEngine {
  constructor() {
    this.ctx = null;
    this.workletNode = null;
    this.analyser = null;
    this.gainNode = null;
    this.isInitialized = false;
    this.isPlaying = false;
    this._interruptedHandler = null;
    this._stateChangeHandler = null;
  }

  async init() {
    if (this.isInitialized) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass({
        sampleRate: 48000, // Request native device rate; browser may override
        latencyHint: 'interactive'
      });

      // Load AudioWorklet processor
      await this.ctx.audioWorklet.addModule('js/cluster-synth-processor.js');

      // Create nodes
      this.workletNode = new AudioWorkletNode(this.ctx, 'cluster-synth', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 0.8;

      // Chain: Worklet -> Gain -> Analyser -> Destination
      this.workletNode.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      // iOS AudioContext interrupted state recovery
      this._setupInterruptedRecovery();

      this.isInitialized = true;

    } catch (err) {
      console.error('[Engine] Initialization failed:', err);
      throw new Error(`Audio engine failed to initialize: ${err.message}`);
    }
  }

  _setupInterruptedRecovery() {
    if (!this.ctx) return;

    this._stateChangeHandler = () => {
      console.log('[Engine] AudioContext state changed:', this.ctx.state);

      if (this.ctx.state === 'interrupted') {
        // iOS interrupted us — phone call, Siri, etc.
        console.warn('[Engine] AudioContext interrupted by OS');
      } else if (this.ctx.state === 'suspended' && this.isPlaying) {
        // Auto-resume if we were playing
        this.ctx.resume().then(() => {
          console.log('[Engine] Auto-resumed from suspended state');
        }).catch((err) => {
          console.warn('[Engine] Auto-resume failed:', err);
        });
      }
    };

    this.ctx.onstatechange = this._stateChangeHandler;
  }

  start(params) {
    if (!this.isInitialized || !this.workletNode) {
      throw new Error('Engine not initialized. Call init() first.');
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.workletNode.port.postMessage({ type: 'start', ...params });
    this.isPlaying = true;
  }

  stop() {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: 'stop' });
    this.isPlaying = false;
  }

  update(params) {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: 'update', ...params });
  }

  panic() {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({ type: 'panic' });
    this.isPlaying = false;
  }

  getAnalyser() {
    return this.analyser;
  }

  setGain(value) {
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
    }
  }

  async suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  async close() {
    if (this.ctx) {
      this.ctx.onstatechange = null;
      await this.ctx.close();
      this.ctx = null;
      this.workletNode = null;
      this.analyser = null;
      this.gainNode = null;
      this.isInitialized = false;
      this.isPlaying = false;
    }
  }
}

// ============================================
// Visualizer: Canvas Spectrum Renderer
// ============================================
class Visualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error(`Canvas #${canvasId} not found`);

    this.ctx = this.canvas.getContext('2d');
    this.analyser = null;
    this.dataArray = null;
    this.rafId = null;
    this.isRunning = false;
    this.isVisible = true;
    this.ecoMode = false;
    this.reducedMotion = false;

    this._resize();
    window.addEventListener('resize', () => this._resize());

    // Pause when tab hidden
    document.addEventListener('visibilitychange', () => {
      this.isVisible = !document.hidden;
      if (this.isVisible && this.isRunning && !this.rafId) {
        this._draw();
      }
    });
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  start(analyser) {
    if (!analyser) return;
    this.analyser = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    this.isRunning = true;
    this._draw();
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    // Clear canvas
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  pause() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume() {
    if (this.analyser && !this.isRunning) {
      this.isRunning = true;
      this._draw();
    }
  }

  setEcoMode(enabled) {
    this.ecoMode = enabled;
  }

  setReducedMotion(enabled) {
    this.reducedMotion = enabled;
  }

  _draw() {
    if (!this.isRunning || !this.isVisible) return;

    // Eco mode: throttle to 15fps instead of 60fps
    const interval = this.ecoMode ? 66 : 0;

    const frame = () => {
      if (!this.isRunning || !this.isVisible) return;

      this.analyser.getByteFrequencyData(this.dataArray);
      this._render();

      if (this.ecoMode) {
        setTimeout(() => {
          if (this.isRunning) this.rafId = requestAnimationFrame(frame);
        }, interval);
      } else {
        this.rafId = requestAnimationFrame(frame);
      }
    };

    this.rafId = requestAnimationFrame(frame);
  }

  _render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const data = this.dataArray;
    const bufferLength = data.length;

    ctx.clearRect(0, 0, w, h);

    if (this.reducedMotion) {
      // Static bar render for reduced motion
      this._renderStaticBars(ctx, w, h, data, bufferLength);
    } else {
      this._renderAnimated(ctx, w, h, data, bufferLength);
    }
  }

  _renderStaticBars(ctx, w, h, data, bufferLength) {
    const barCount = 32;
    const barWidth = w / barCount;
    const step = Math.floor(bufferLength / barCount);

    for (let i = 0; i < barCount; i++) {
      const value = data[i * step] || 0;
      const barHeight = (value / 255) * h * 0.9;
      const x = i * barWidth;
      const y = h - barHeight;

      ctx.fillStyle = `hsl(${160 + (i / barCount) * 60}, 80%, ${40 + (value / 255) * 30}%)`;
      ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
    }
  }

  _renderAnimated(ctx, w, h, data, bufferLength) {
    const barCount = 64;
    const barWidth = w / barCount;
    const step = Math.floor(bufferLength / barCount);

    for (let i = 0; i < barCount; i++) {
      const value = data[i * step] || 0;
      const barHeight = (value / 255) * h * 0.95;
      const x = i * barWidth;
      const y = h - barHeight;

      // Gradient bar
      const hue = 160 + (i / barCount) * 80 + (value / 255) * 20;
      const gradient = ctx.createLinearGradient(0, h, 0, y);
      gradient.addColorStop(0, `hsla(${hue}, 90%, 50%, 0.9)`);
      gradient.addColorStop(1, `hsla(${hue}, 90%, 70%, 0.4)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(x + 0.5, y, barWidth - 1, barHeight);

      // Top highlight
      ctx.fillStyle = `hsla(${hue}, 100%, 80%, 0.8)`;
      ctx.fillRect(x + 0.5, y, barWidth - 1, 2);
    }

    // Glow effect at bottom
    const glow = ctx.createLinearGradient(0, h - 20, 0, h);
    glow.addColorStop(0, 'rgba(0, 212, 170, 0)');
    glow.addColorStop(1, 'rgba(0, 212, 170, 0.15)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, h - 20, w, 20);
  }
}

// ============================================
// App: Main Controller
// ============================================
class App {
  constructor() {
    this.engine = new MicrotoneEngine();
    this.visualizer = new Visualizer('visualizer');
    this.toast = new ToastManager();

    // State
    this.isPlaying = false;
    this.visEnabled = true;
    this.wakeLock = null;
    this.deferredPrompt = null;

    // Parameters
    this.baseFreq = 440;
    this.step = 1.0;
    this.clusterSize = 8;
    this.waveform = 'sine';
    this.stereoWidth = 0.8;
    this.attackTime = 0.1;
    this.releaseTime = 2.0;
    this.harmonicMode = 'linear';

    // DOM refs
    this.els = {};
    this._cacheElements();

    // iOS silent audio
    this.silentAudio = document.getElementById('ios-silence-loop');

    // Bind methods
    this._handleKey = this._handleKey.bind(this);
    this._handleVisibility = this._handleVisibility.bind(this);
    this._handleBeforeUnload = this._handleBeforeUnload.bind(this);
    this._handleInstallPrompt = this._handleInstallPrompt.bind(this);

    this._init();
  }

  _cacheElements() {
    const ids = [
      'play-btn', 'stop-btn', 'base-freq', 'base-freq-val',
      'step-size', 'step-val', 'cluster-size', 'cluster-val',
      'stereo-width', 'stereo-val', 'attack-time', 'attack-val',
      'release-time', 'release-val', 'waveform', 'harmonic-mode',
      'eco-mode', 'reduced-motion', 'toggle-vis', 'audio-status',
      'battery-mode', 'ios-install-banner', 'pwa-install-banner',
      'install-pwa-btn', 'dismiss-ios-banner', 'dismiss-pwa-banner'
    ];
    ids.forEach(id => {
      this.els[id] = document.getElementById(id);
    });
  }

  async _init() {
    this._setupEventListeners();
    this._setupMediaSession();
    this._setupPWA();
    this._detectIOS();
    this._registerServiceWorker();

    // Keyboard shortcuts
    document.addEventListener('keydown', this._handleKey);

    // Lifecycle handlers
    document.addEventListener('visibilitychange', this._handleVisibility);
    window.addEventListener('beforeunload', this._handleBeforeUnload);

    this.toast.show('Microtone ready. Tap Play to start.', 'info', 3000);
  }

  // ----------------------------------------
  // Event Listeners
  // ----------------------------------------
  _setupEventListeners() {
    // Transport
    this.els['play-btn']?.addEventListener('click', () => this._togglePlay());
    this.els['stop-btn']?.addEventListener('click', () => this._stopCluster());

    // Sliders — live update with debounced engine update
    const sliders = [
      ['base-freq', 'base-freq-val', 'baseFreq', 1, v => `${v}`],
      ['step-size', 'step-val', 'step', 0.1, v => `${v}`],
      ['cluster-size', 'cluster-val', 'clusterSize', 1, v => `${v}`],
      ['stereo-width', 'stereo-val', 'stereoWidth', 0.01, v => `${Math.round(v * 100)}`],
      ['attack-time', 'attack-val', 'attackTime', 0.001, v => `${v}`],
      ['release-time', 'release-val', 'releaseTime', 0.01, v => `${v}`]
    ];

    sliders.forEach(([id, valId, param, scale, formatter]) => {
      const slider = this.els[id];
      const readout = this.els[valId];
      if (!slider) return;

      slider.addEventListener('input', () => {
        const val = parseFloat(slider.value);
        this[param] = val;
        if (readout) readout.textContent = formatter(val);

        // If playing, send update to worklet
        if (this.isPlaying) {
          this._debouncedUpdate();
        }
      });
    });

    // Selects
    this.els['waveform']?.addEventListener('change', (e) => {
      this.waveform = e.target.value;
      if (this.isPlaying) this._debouncedUpdate();
    });

    this.els['harmonic-mode']?.addEventListener('change', (e) => {
      this.harmonicMode = e.target.value;
      if (this.isPlaying) this._debouncedUpdate();
    });

    // Toggles
    this.els['eco-mode']?.addEventListener('change', (e) => {
      this.visualizer.setEcoMode(e.target.checked);
      const badge = this.els['battery-mode'];
      if (badge) badge.hidden = !e.target.checked;
    });

    this.els['reduced-motion']?.addEventListener('change', (e) => {
      this.visualizer.setReducedMotion(e.target.checked);
      document.documentElement.style.setProperty(
        '--transition', e.target.checked ? '0.01ms' : '0.2s ease'
      );
    });

    // Visualizer toggle
    this.els['toggle-vis']?.addEventListener('click', () => {
      this.visEnabled = !this.visEnabled;
      if (this.visEnabled) {
        const analyser = this.engine.getAnalyser();
        if (analyser && this.isPlaying) this.visualizer.start(analyser);
      } else {
        this.visualizer.stop();
      }
    });

    // Install banners
    this.els['dismiss-ios-banner']?.addEventListener('click', () => {
      this.els['ios-install-banner'].hidden = true;
      localStorage.setItem('microtone-ios-banner-dismissed', '1');
    });

    this.els['dismiss-pwa-banner']?.addEventListener('click', () => {
      this.els['pwa-install-banner'].hidden = true;
      localStorage.setItem('microtone-pwa-banner-dismissed', '1');
    });

    this.els['install-pwa-btn']?.addEventListener('click', () => {
      if (this.deferredPrompt) {
        this.deferredPrompt.prompt();
        this.deferredPrompt.userChoice.then((choice) => {
          if (choice.outcome === 'accepted') {
            this.toast.show('Microtone installed!', 'success');
          }
          this.deferredPrompt = null;
          this.els['pwa-install-banner'].hidden = true;
        });
      }
    });
  }

  _debouncedUpdate() {
    if (this._updateTimeout) clearTimeout(this._updateTimeout);
    this._updateTimeout = setTimeout(() => {
      this.engine.update(this._getParams());
    }, 50);
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
  // Keyboard Shortcuts
  // ----------------------------------------
  _handleKey(e) {
    // Ignore if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this._togglePlay();
        break;
      case 'KeyV':
        this.els['toggle-vis']?.click();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._nudgeParam('base-freq', 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        this._nudgeParam('base-freq', -1);
        break;
      case 'Escape':
        if (this.isPlaying) this._stopCluster();
        break;
    }
  }

  _nudgeParam(id, direction) {
    const el = this.els[id];
    if (!el) return;
    const step = parseFloat(el.step) || 1;
    const newVal = parseFloat(el.value) + (direction * step);
    el.value = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max), newVal));
    el.dispatchEvent(new Event('input'));
  }

  // ----------------------------------------
  // Transport Controls
  // ----------------------------------------
  async _togglePlay() {
    if (this.isPlaying) {
      this._stopCluster();
    } else {
      await this._startCluster();
    }
  }

  async _startCluster() {
    try {
      // Initialize engine if needed
      if (!this.engine.isInitialized) {
        await this.engine.init();
      }

      // Resume AudioContext
      if (this.engine.ctx.state === 'suspended') {
        await this.engine.ctx.resume();
      }

      if (this.engine.ctx.state !== 'running') {
        this.toast.show('Tap the page first to enable audio', 'warning');
        return;
      }

      // 1. Trigger iOS Silent Audio Keep-Alive
      await this._triggerSilentAudio();

      // 2. Request Screen Wake Lock
      await this._requestWakeLock();

      // 3. Start synthesis
      this.engine.start(this._getParams());

      // 4. Start visualizer
      if (this.visEnabled) {
        const analyser = this.engine.getAnalyser();
        if (analyser) this.visualizer.start(analyser);
      }

      // 5. Update Media Session
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }

      // 6. Update UI
      this.isPlaying = true;
      this._updatePlayStateUI(true);

    } catch (err) {
      console.error('[App] Start failed:', err);
      this.toast.show(`Failed to start: ${err.message}`, 'error');
      this._releaseWakeLock();
    }
  }

  _stopCluster() {
    // Release wake lock
    this._releaseWakeLock();

    // Stop silent audio
    this._stopSilentAudio();

    // Stop engine
    this.engine.stop();

    // Stop visualizer
    this.visualizer.stop();

    // Update Media Session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }

    // Update UI
    this.isPlaying = false;
    this._updatePlayStateUI(false);
  }

  _updatePlayStateUI(playing) {
    const playBtn = this.els['play-btn'];
    const stopBtn = this.els['stop-btn'];
    const status = this.els['audio-status'];

    if (playBtn) {
      playBtn.innerHTML = playing 
        ? '<span class="btn-icon" aria-hidden="true">⏸</span><span class="btn-text">Pause</span>'
        : '<span class="btn-icon" aria-hidden="true">▶</span><span class="btn-text">Play</span>';
    }

    if (stopBtn) stopBtn.disabled = !playing;

    if (status) {
      status.textContent = playing ? 'Audio: Playing' : 'Audio: Standby';
      status.classList.toggle('active', playing);
    }
  }

  // ----------------------------------------
  // iOS Silent Audio Keep-Alive
  // ----------------------------------------
  async _triggerSilentAudio() {
    if (!this.silentAudio) return;

    try {
      // Must be > 0 volume initially to engage iOS audio session
      this.silentAudio.volume = 0.001;
      this.silentAudio.muted = false;
      await this.silentAudio.play();

      // Immediately mute to prevent any audible artifacts
      // (iOS keeps session alive as long as element is playing)
      setTimeout(() => {
        if (this.silentAudio) this.silentAudio.muted = true;
      }, 100);

    } catch (e) {
      console.warn('[App] Silent audio failed:', e);
    }
  }

  _stopSilentAudio() {
    if (!this.silentAudio) return;
    try {
      this.silentAudio.pause();
      this.silentAudio.currentTime = 0;
      this.silentAudio.muted = false;
    } catch (e) {
      console.warn('[App] Stop silent audio failed:', e);
    }
  }

  // ----------------------------------------
  // Screen Wake Lock
  // ----------------------------------------
  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) return;

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        console.log('[App] Wake lock released');
        this.wakeLock = null;
      });
    } catch (err) {
      console.warn('[App] Wake lock request failed:', err);
    }
  }

  _releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  // ----------------------------------------
  // Media Session API
  // ----------------------------------------
  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Micro-Frequency Cluster',
      artist: 'Microtone Synth',
      album: 'Generative Audio',
      artwork: [
        { src: 'icon-192x192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512x512.png', sizes: '512x512', type: 'image/png' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => this._startCluster());
    navigator.mediaSession.setActionHandler('pause', () => this._stopCluster());
    navigator.mediaSession.setActionHandler('stop', () => this._stopCluster());
  }

  // ----------------------------------------
  // PWA / Install
  // ----------------------------------------
  _setupPWA() {
    window.addEventListener('beforeinstallprompt', this._handleInstallPrompt);

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      console.log('[App] Running in standalone mode');
    }
  }

  _handleInstallPrompt(e) {
    e.preventDefault();
    this.deferredPrompt = e;

    // Show install banner if not dismissed
    const dismissed = localStorage.getItem('microtone-pwa-banner-dismissed');
    if (!dismissed && this.els['pwa-install-banner']) {
      this.els['pwa-install-banner'].hidden = false;
    }
  }

  _detectIOS() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS && isSafari) {
      const dismissed = localStorage.getItem('microtone-ios-banner-dismissed');
      if (!dismissed && this.els['ios-install-banner']) {
        // Delay slightly so it doesn't flash on load
        setTimeout(() => {
          this.els['ios-install-banner'].hidden = false;
        }, 2000);
      }
    }
  }

  async _registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      console.log('[App] SW registered:', registration.scope);

      // Check for updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            this.toast.show('Update available! Refresh to update.', 'info', 8000);
          }
        });
      });

    } catch (err) {
      console.warn('[App] SW registration failed:', err);
    }
  }

  // ----------------------------------------
  // Lifecycle
  // ----------------------------------------
  _handleVisibility() {
    if (document.hidden) {
      // Tab hidden: pause visualizer to save GPU/CPU
      this.visualizer.pause();

      // Release wake lock (will be re-acquired when visible again if playing)
      this._releaseWakeLock();

    } else {
      // Tab visible again
      if (this.isPlaying) {
        this.visualizer.resume();
        this._requestWakeLock();

        // Re-trigger silent audio on iOS (may have been paused by OS)
        if (this.silentAudio && this.silentAudio.paused) {
          this._triggerSilentAudio();
        }

        // Ensure AudioContext is running
        if (this.engine.ctx?.state === 'suspended') {
          this.engine.ctx.resume();
        }
      }
    }
  }

  _handleBeforeUnload() {
    this._cleanup();
  }

  _cleanup() {
    this._releaseWakeLock();
    this._stopSilentAudio();
    this.visualizer.stop();
    if (this.isPlaying) this.engine.panic();
  }
}

// ============================================
// Bootstrap
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  window.microtoneApp = new App();
});

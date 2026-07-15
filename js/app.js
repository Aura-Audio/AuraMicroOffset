// ============================================
// 1. Preset Manager
// ============================================
class PresetManager {
    constructor() {
        this.storageKey = 'transparencyXClusterSynthPresets';
        this.presets = this._loadPresets();
    }

    _loadPresets() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    _savePresets() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.presets));
    }

    save(name, config) {
        const existingIndex = this.presets.findIndex(p => p.name === name);
        if (existingIndex >= 0) {
            this.presets[existingIndex] = { name, config };
        } else {
            this.presets.push({ name, config });
        }
        this._savePresets();
        return true;
    }

    load(name) {
        const preset = this.presets.find(p => p.name === name);
        return preset ? preset.config : null;
    }

    delete(name) {
        this.presets = this.presets.filter(p => p.name !== name);
        this._savePresets();
        return true;
    }

    list() {
        return this.presets.map(p => p.name);
    }
}

// ============================================
// 2. AudioEngine (Refined + AudioWorklet + Harmonic Mode)
// ============================================
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.workletNode = null;
        this.oscillators = []; // Fallback
        this.panners = []; // Fallback
        this.clusterGain = null;
        this.envelopeGain = null;
        this.masterGain = null;
        this.filterNode = null;
        this.compressor = null;
        this.volumeGain = null;
        this.analyser = null;
        this.isPlaying = false;
        this.isStopping = false;
        this.workletReady = false;
        this.useWorklet = true;
    }

    async init() {
        if (this.ctx && this.ctx.state === 'running') {
            if (!this.workletReady && this.useWorklet) {
                await this._initWorklet();
            }
            return;
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
            if (!this.workletReady && this.useWorklet) {
                await this._initWorklet();
            }
            return;
        }
        if (this.ctx && this.ctx.state === 'closed') {
            this.ctx = null;
        }

        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }

        this.clusterGain = this.ctx.createGain();
        this.envelopeGain = this.ctx.createGain();
        this.masterGain = this.ctx.createGain();
        this.filterNode = this.ctx.createBiquadFilter();
        this.filterNode.type = 'lowpass';
        this.filterNode.frequency.setValueAtTime(22050, this.ctx.currentTime); // Updated to 22050Hz
        this.filterNode.Q.setValueAtTime(0.1, this.ctx.currentTime);
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.setValueAtTime(-24, this.ctx.currentTime);
        this.compressor.knee.setValueAtTime(30, this.ctx.currentTime);
        this.compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
        this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
        this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);
        this.volumeGain = this.ctx.createGain();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.4;

        this.clusterGain.connect(this.envelopeGain);
        this.envelopeGain.connect(this.masterGain);
        this.masterGain.connect(this.filterNode);
        this.filterNode.connect(this.compressor);
        this.compressor.connect(this.volumeGain);
        this.volumeGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        this.envelopeGain.gain.setValueAtTime(0, this.ctx.currentTime);
        this.volumeGain.gain.setValueAtTime(1, this.ctx.currentTime);

        if (this.useWorklet) {
            await this._initWorklet();
        }
    }

    async _initWorklet() {
        if (this.workletReady) return;

        try {
            await this.ctx.audioWorklet.addModule('js/cluster-synth-processor.js');
            this.workletNode = new AudioWorkletNode(this.ctx, 'cluster-synth-processor');
            this.workletNode.connect(this.clusterGain);
            this.workletReady = true;
        } catch (err) {
            console.warn('AudioWorklet not supported, falling back to oscillators:', err);
            this.useWorklet = false;
            this.workletReady = false;
        }
    }

    start(baseFreq, step, clusterSize, waveform, stereoWidth, attackTime, releaseTime, harmonicMode = false) {
        if (!this.ctx || this.ctx.state !== 'running') {
            throw new Error('AudioContext not running');
        }
        if (this.isPlaying) this.stop(true);
        if (this.isStopping) {
            setTimeout(() => this.start(...arguments), 100);
            return;
        }

        this.isStopping = false;
        const now = this.ctx.currentTime;

        let waveComp = 1.0;
        if (waveform === 'square') waveComp = 0.6;
        if (waveform === 'sawtooth') waveComp = 0.7;
        if (waveform === 'triangle') waveComp = 0.9;
        const safeGain = waveComp / Math.sqrt(clusterSize);

        this.envelopeGain.gain.cancelScheduledValues(now);
        this.envelopeGain.gain.setValueAtTime(0, now);
        this.envelopeGain.gain.linearRampToValueAtTime(1, now + attackTime);

        this.clusterGain.gain.cancelScheduledValues(now);
        this.clusterGain.gain.setValueAtTime(safeGain, now);

        if (this.useWorklet && this.workletReady && this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'config',
                config: {
                    baseFreq,
                    step,
                    clusterSize,
                    stereoWidth,
                    waveform,
                    attackTime,
                    releaseTime,
                    harmonicMode
                }
            });
            this.workletNode.port.postMessage({ type: 'start' });
        } else {
            this._startWithOscillators(baseFreq, step, clusterSize, waveform, stereoWidth, attackTime, releaseTime, harmonicMode);
        }

        this.isPlaying = true;
    }

    _startWithOscillators(baseFreq, step, clusterSize, waveform, stereoWidth, attackTime, releaseTime, harmonicMode = false) {
        const now = this.ctx.currentTime;
        let waveComp = 1.0;
        if (waveform === 'square') waveComp = 0.6;
        if (waveform === 'sawtooth') waveComp = 0.7;
        if (waveform === 'triangle') waveComp = 0.9;
        const safeGain = waveComp / Math.sqrt(clusterSize);

        this.clusterGain.gain.cancelScheduledValues(now);
        this.clusterGain.gain.setValueAtTime(safeGain, now);

        this.envelopeGain.gain.cancelScheduledValues(now);
        this.envelopeGain.gain.setValueAtTime(0, now);
        this.envelopeGain.gain.linearRampToValueAtTime(1, now + attackTime);

        const oscs = [];
        const panners = [];

        for (let i = 1; i <= clusterSize; i++) {
            // NEW: Harmonic Series mode
            const freq = harmonicMode ?
                baseFreq * i :
                baseFreq + i * step;

            const osc = this.ctx.createOscillator();
            osc.type = waveform;
            osc.frequency.setValueAtTime(freq, now);

            const panner = this.ctx.createStereoPanner();
            const panAmount = (Math.random() * 2 - 1) * stereoWidth;
            panner.pan.setValueAtTime(panAmount, now);

            osc.connect(panner);
            panner.connect(this.clusterGain);

            osc.start(now);
            oscs.push(osc);
            panners.push(panner);
        }

        this.oscillators = oscs;
        this.panners = panners;
    }

    stop(instant = false) {
        if (!this.ctx || !this.isPlaying || this.isStopping) return;
        this.isStopping = true;
        this.isPlaying = false;

        const now = this.ctx.currentTime;
        const fadeTime = instant ? 0.01 : 0.5;

        this.envelopeGain.gain.cancelScheduledValues(now);
        this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
        this.envelopeGain.gain.linearRampToValueAtTime(0, now + fadeTime);

        if (this.useWorklet && this.workletReady && this.workletNode) {
            this.workletNode.port.postMessage({ type: 'stop' });
        }

        if (this.oscillators && this.oscillators.length > 0) {
            const stopTime = now + fadeTime + 0.01;
            for (const osc of this.oscillators) {
                osc.stop(stopTime);
                osc.onended = () => this._safeDisconnect(osc);
            }
        }

        const cleanupDelay = (fadeTime + 0.05) * 1000;
        setTimeout(() => this._cleanupNodes(), cleanupDelay);
    }

    _safeDisconnect(node) {
        try { node.disconnect(); } catch (e) {}
    }

    _cleanupNodes() {
        if (this.oscillators) {
            for (const osc of this.oscillators) this._safeDisconnect(osc);
        }
        if (this.panners) {
            for (const pan of this.panners) this._safeDisconnect(pan);
        }
        this.oscillators = [];
        this.panners = [];
        this.isStopping = false;
    }

    setVolume(normalizedValue) {
        if (!this.volumeGain || !this.ctx) return;
        const now = this.ctx.currentTime;
        this.volumeGain.gain.cancelScheduledValues(now);
        this.volumeGain.gain.setValueAtTime(normalizedValue, now);
    }

    setFilterCutoff(freq) {
        if (!this.filterNode || !this.ctx) return;
        const now = this.ctx.currentTime;
        this.filterNode.frequency.cancelScheduledValues(now);
        this.filterNode.frequency.exponentialRampToValueAtTime(freq, now + 0.05);
    }

    setFilterQ(q) {
        if (!this.filterNode || !this.ctx) return;
        const now = this.ctx.currentTime;
        this.filterNode.Q.cancelScheduledValues(now);
        this.filterNode.Q.linearRampToValueAtTime(q, now + 0.05);
    }

    setEnvelopeTimes(attack, release) {
        this.attackTime = attack;
        this.releaseTime = release;
    }

    getAnalyser() { return this.analyser; }
    getSampleRate() { return this.ctx ? this.ctx.sampleRate : 44100; }

    destroy() {
        this.stop(true);
        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
        }
        this.oscillators = [];
        this.panners = [];
        this.clusterGain = null;
        this.envelopeGain = null;
        this.masterGain = null;
        this.filterNode = null;
        this.compressor = null;
        this.volumeGain = null;
        this.analyser = null;
        this.isPlaying = false;
        this.isStopping = false;
        this.workletReady = false;
    }
}

// ============================================
// 3. Visualizer
// ============================================
class Visualizer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d');
        this.analyser = null;
        this.animFrameId = null;
        this.dataArray = null;
        this.isRunning = false;
        this.resizeObserver = null;
        this._setupResize();
    }

    _setupResize() {
        const container = this.canvas.parentElement;
        const resize = () => {
            const rect = container.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const w = rect.width;
            const h = rect.height;
            if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
                this.canvas.width = w * dpr;
                this.canvas.height = h * dpr;
                this.canvas.style.width = w + 'px';
                this.canvas.style.height = h + 'px';
                this.ctx2d.setTransform(1, 0, 0, 1, 0, 0);
                this.ctx2d.scale(dpr, dpr);
            }
        };
        this.resizeObserver = new ResizeObserver(resize);
        this.resizeObserver.observe(container);
        resize();
    }

    start(analyser) {
        this.analyser = analyser;
        this.dataArray = new Uint8Array(analyser.fftSize);
        this.isRunning = true;
        this._animate();
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) { cancelAnimationFrame(this.animFrameId); this.animFrameId = null; }
        this._clearCanvas();
    }

    _animate() {
        if (!this.isRunning) return;
        this._draw();
        this.animFrameId = requestAnimationFrame(() => this._animate());
    }

    _draw() {
        if (!this.analyser) return;
        const ctx = this.ctx2d;
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);

        this.analyser.getByteTimeDomainData(this.dataArray);

        ctx.clearRect(0, 0, w, h);

        ctx.strokeStyle = '#ffffff08';
        ctx.lineWidth = 0.5;
        const midY = h / 2;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(w, midY);
        ctx.stroke();

        const data = this.dataArray;
        const len = data.length;
        ctx.beginPath();
        ctx.strokeStyle = '#5b9cf5';
        ctx.lineWidth = 1.8;
        ctx.shadowColor = '#5b9cf580';
        ctx.shadowBlur = 6;
        ctx.lineJoin = 'round';

        const xStep = w / (len - 1);
        for (let i = 0; i < len; i++) {
            const x = i * xStep;
            const y = (data[i] / 255) * h;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    _clearCanvas() {
        const ctx = this.ctx2d;
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#ffffff06';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
    }

    destroy() {
        this.stop();
        if (this.resizeObserver) { this.resizeObserver.disconnect(); this.resizeObserver = null; }
    }
}

// ============================================
// 4. App (Integrated with All New Features)
// ============================================
class App {
    constructor() {
        this.engine = new AudioEngine();
        this.visualizer = null;
        this.presetManager = new PresetManager();

        // DOM Elements
        this.btnPlay = document.getElementById('btnPlay');
        this.statusDot = document.getElementById('statusDot');
        this.statusTag = document.getElementById('statusTag');
        this.baseFreqInput = document.getElementById('baseFreq');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.volPercent = document.getElementById('volPercent');
        this.infoRange = document.getElementById('infoRange');
        this.infoSpread = document.getElementById('infoSpread');
        this.infoCount = document.getElementById('infoCount');
        this.clusterButtonsContainer = document.getElementById('clusterButtons');
        this.waveformButtonsContainer = document.getElementById('waveformButtons');
        this.vizCanvas = document.getElementById('vizCanvas');
        this.presetNameInput = document.getElementById('presetName');
        this.btnSavePreset = document.getElementById('btnSavePreset');
        this.btnRandomize = document.getElementById('btnRandomize'); // NEW
        this.presetListContainer = document.getElementById('presetList');
        this.harmonicModeCheckbox = document.getElementById('harmonicMode'); // NEW

        // Slider Elements
        this.stepSizeSlider = document.getElementById('stepSize');
        this.stepValDisplay = document.getElementById('stepVal');
        this.filterCutoffSlider = document.getElementById('filterCutoff');
        this.cutoffValDisplay = document.getElementById('cutoffVal');
        this.filterQSlider = document.getElementById('filterQ');
        this.qValDisplay = document.getElementById('qVal');
        this.stereoSpreadSlider = document.getElementById('stereoSpread');
        this.spreadValDisplay = document.getElementById('spreadVal');
        this.attackTimeSlider = document.getElementById('attackTime');
        this.attackValDisplay = document.getElementById('attackVal');
        this.releaseTimeSlider = document.getElementById('releaseTime');
        this.releaseValDisplay = document.getElementById('releaseVal');

        // State
        this.clusterSize = 10;
        this.waveform = 'sine';
        this.baseFreq = 250;
        this.step = 0.01;
        this.volume = 1.0;
        this.stereoWidth = 0.5;
        this.attackTime = 0.15;
        this.releaseTime = 0.50;
        this.filterCutoff = 22050; // Updated to 22050Hz
        this.filterQ = 0.1;
        this.harmonicMode = false; // NEW: Harmonic Series mode

        // NEW: Extended cluster sizes (up to 5000)
        this.clusterSizes = [10, 50, 100, 150, 200, 250, 500, 1000, 2000, 5000];

        this._buildClusterButtons();
        this._bindEvents();
        this._updateInfo();
        this._updateVolumeDisplay();

        // Initialize sliders (step size default to 0.01Hz)
        this._updateStepSize(parseInt(this.stepSizeSlider.value));
        this._updateFilterCutoff(parseInt(this.filterCutoffSlider.value));
        this._updateFilterQ(parseInt(this.filterQSlider.value));
        this._updateStereoSpread(parseInt(this.stereoSpreadSlider.value));
        this._updateAttackTime(parseInt(this.attackTimeSlider.value));
        this._updateReleaseTime(parseInt(this.releaseTimeSlider.value));

        this.visualizer = new Visualizer(this.vizCanvas);
        this._initAudioContextOnInteraction();
        this._refreshPresetList();
    }

    _buildClusterButtons() {
        this.clusterButtonsContainer.innerHTML = '';
        this.clusterSizes.forEach(size => {
            const btn = document.createElement('button');
            btn.className = 'cluster-btn';
            if (size >= 500) btn.classList.add('large-cluster'); // Updated to include 2000/5000
            btn.textContent = size;
            btn.dataset.size = size;
            if (size === this.clusterSize) btn.classList.add('selected');
            btn.addEventListener('click', () => this._onClusterSizeChange(size));
            this.clusterButtonsContainer.appendChild(btn);
        });
    }

    _bindEvents() {
        this.btnPlay.addEventListener('click', () => this._togglePlay());
        this.btnSavePreset.addEventListener('click', () => this._savePreset());
        this.btnRandomize.addEventListener('click', () => this._randomizePreset()); // NEW
        this.harmonicModeCheckbox.addEventListener('change', () => {
            this.harmonicMode = this.harmonicModeCheckbox.checked;
            this._updateInfo();
            if (this.engine.isPlaying) this._restartCluster();
        });

        this.baseFreqInput.addEventListener('input', () => {
            const val = parseFloat(this.baseFreqInput.value);
            if (!isNaN(val) && val >= 0.001 && val <= 22050) {
                this.baseFreq = val;
                this._updateInfo();
                if (this.engine.isPlaying) this._restartCluster();
            }
        });
        this.baseFreqInput.addEventListener('change', () => {
            let val = parseFloat(this.baseFreqInput.value);
            if (isNaN(val) || val < 0.001) val = 0.001;
            if (val > 22050) val = 22050;
            this.baseFreqInput.value = val.toFixed(3);
            this.baseFreq = val;
            this._updateInfo();
            if (this.engine.isPlaying) this._restartCluster();
        });

        this.volumeSlider.addEventListener('input', () => {
            this.volume = parseInt(this.volumeSlider.value) / 100;
            this._updateVolumeDisplay();
            this.engine.setVolume(this.volume);
        });

        this.waveformButtonsContainer.querySelectorAll('.wave-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wave = btn.dataset.wave;
                if (wave === this.waveform && this.engine.isPlaying) return;
                this.waveform = wave;
                this._updateWaveformButtons();
                if (this.engine.isPlaying) this._restartCluster();
            });
        });

        this.stepSizeSlider.addEventListener('input', (e) => this._updateStepSize(parseInt(e.target.value)));
        this.filterCutoffSlider.addEventListener('input', (e) => this._updateFilterCutoff(parseInt(e.target.value)));
        this.filterQSlider.addEventListener('input', (e) => this._updateFilterQ(parseInt(e.target.value)));
        this.stereoSpreadSlider.addEventListener('input', (e) => this._updateStereoSpread(parseInt(e.target.value)));
        this.attackTimeSlider.addEventListener('input', (e) => this._updateAttackTime(parseInt(e.target.value)));
        this.releaseTimeSlider.addEventListener('input', (e) => this._updateReleaseTime(parseInt(e.target.value)));

        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                this._togglePlay();
            }
        });

        window.addEventListener('beforeunload', () => this.engine.destroy());
    }

    _initAudioContextOnInteraction() {
        const initFn = async () => {
            try {
                await this.engine.init();
                this.btnPlay.disabled = false;
                this.btnPlay.textContent = '▶ Play Cluster';
            } catch (err) {
                console.warn('Audio init failed:', err);
                this.btnPlay.disabled = true;
                this.btnPlay.textContent = 'Audio Unavailable';
            }
        };

        initFn();

        const resumeOnInteraction = async () => {
            if (this.engine.ctx && this.engine.ctx.state === 'suspended') await this.engine.ctx.resume();
            if (!this.engine.ctx) await initFn();
            if (this.engine.ctx && this.engine.ctx.state === 'running') this.btnPlay.disabled = false;
        };

        ['click', 'touchstart', 'keydown'].forEach(evt => {
            document.addEventListener(evt, resumeOnInteraction, { once: true });
        });
    }

    // ==================== NEW: Preset Randomizer ====================
    _randomizePreset() {
        // Base frequency: 0.001 to 22050 (log scale)
        this.baseFreq = 0.001 * Math.pow(22050 / 0.001, Math.random());
        this.baseFreq = Math.max(0.001, Math.min(22050, this.baseFreq));

        // Step size: 0.00001 to 50 (log scale)
        this.step = 0.00001 * Math.pow(50 / 0.00001, Math.random());
        this.step = Math.max(0.00001, Math.min(50, this.step));

        // Cluster size: random from clusterSizes
        this.clusterSize = this.clusterSizes[Math.floor(Math.random() * this.clusterSizes.length)];

        // Waveform: random from options
        const waveforms = ['sine', 'triangle', 'square', 'sawtooth'];
        this.waveform = waveforms[Math.floor(Math.random() * waveforms.length)];

        // Volume: 0 to 2 (0% to 200%)
        this.volume = Math.random() * 2;

        // Stereo width: 0 to 1
        this.stereoWidth = Math.random();

        // Attack: 0.005 to 5.0 (log scale)
        this.attackTime = 0.005 * Math.pow(5.0 / 0.005, Math.random());
        this.attackTime = Math.max(0.005, Math.min(5.0, this.attackTime));

        // Release: 0.01 to 5.0 (log scale)
        this.releaseTime = 0.01 * Math.pow(5.0 / 0.01, Math.random());
        this.releaseTime = Math.max(0.01, Math.min(5.0, this.releaseTime));

        // Filter cutoff: 20 to 22050 (log scale)
        this.filterCutoff = 20 * Math.pow(22050 / 20, Math.random());
        this.filterCutoff = Math.max(20, Math.min(22050, this.filterCutoff));

        // Filter Q: 0.1 to 20 (linear)
        this.filterQ = 0.1 + Math.random() * 19.9;

        // Harmonic mode: random boolean
        this.harmonicMode = Math.random() > 0.5;
        this.harmonicModeCheckbox.checked = this.harmonicMode;

        // Update UI
        this.baseFreqInput.value = this.baseFreq.toFixed(3);
        this._updateStepSizeSliderFromValue(this.step);
        this._selectClusterSize(this.clusterSize);
        this._selectWaveform(this.waveform);
        this.volumeSlider.value = Math.round(this.volume * 100);
        this._updateVolumeDisplay();
        this.stereoSpreadSlider.value = Math.round(this.stereoWidth * 100);
        this._updateStereoSpreadDisplay();
        this._updateAttackTimeSliderFromValue(this.attackTime);
        this._updateReleaseTimeSliderFromValue(this.releaseTime);
       

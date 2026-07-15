/**
 * AudioEngine - Manages the Web Audio API graph and AudioWorklet
 * 
 * Features:
 * - AudioWorklet-based cluster synthesis (with oscillator fallback)
 * - Full audio graph: oscillators -> panners -> gain -> filter -> compressor -> output
 * - Envelope generator (attack/release)
 * - Stereo panning
 * - Volume, filter, and resonance control
 * - Visualizer support via AnalyserNode
 */

class AudioEngine {
    constructor() {
        // Audio context and nodes
        this.ctx = null;
        this.workletNode = null;
        this.clusterGain = null;
        this.envelopeGain = null;
        this.masterGain = null;
        this.filterNode = null;
        this.compressor = null;
        this.volumeGain = null;
        this.analyser = null;
        
        // Fallback for browsers without AudioWorklet
        this.oscillators = [];
        this.panners = [];
        
        // State
        this.isPlaying = false;
        this.isStopping = false;
        this.workletReady = false;
        this.useWorklet = true;
        this.attackTime = 0.15;
        this.releaseTime = 0.50;
    }
    
    /**
     * Initialize the audio context and worklet
     */
    async init() {
        // Already initialized and running
        if (this.ctx && this.ctx.state === 'running') {
            if (!this.workletReady && this.useWorklet) {
                await this._initWorklet();
            }
            return;
        }
        
        // Resume if suspended
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume();
            if (!this.workletReady && this.useWorklet) {
                await this._initWorklet();
            }
            return;
        }
        
        // Reset if closed
        if (this.ctx && this.ctx.state === 'closed') {
            this.ctx = null;
        }
        
        // Create new context
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        
        // Create and connect nodes
        this._createAudioGraph();
        
        // Initialize worklet if supported
        if (this.useWorklet) {
            await this._initWorklet();
        }
    }
    
    /**
     * Create the audio processing graph
     */
    _createAudioGraph() {
        // Create nodes
        this.clusterGain = this.ctx.createGain();
        this.envelopeGain = this.ctx.createGain();
        this.masterGain = this.ctx.createGain();
        this.filterNode = this.ctx.createBiquadFilter();
        this.filterNode.type = 'lowpass';
        this.filterNode.frequency.setValueAtTime(20000, this.ctx.currentTime);
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
        
        // Connect audio graph:
        // ClusterGain -> EnvelopeGain -> MasterGain -> Filter -> Compressor -> VolumeGain -> Analyser -> Destination
        this.clusterGain.connect(this.envelopeGain);
        this.envelopeGain.connect(this.masterGain);
        this.masterGain.connect(this.filterNode);
        this.filterNode.connect(this.compressor);
        this.compressor.connect(this.volumeGain);
        this.volumeGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        
        // Initialize gains
        this.envelopeGain.gain.setValueAtTime(0, this.ctx.currentTime);
        this.volumeGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
    
    /**
     * Initialize the AudioWorklet module
     */
    async _initWorklet() {
        if (this.workletReady) return;
        
        try {
            // The processor is already registered via script tag in index.html
            // Just create the node and connect it
            this.workletNode = new AudioWorkletNode(this.ctx, 'cluster-synth-processor');
            this.workletNode.connect(this.clusterGain);
            this.workletReady = true;
        } catch (err) {
            console.warn('AudioWorklet not supported, falling back to oscillators:', err);
            this.useWorklet = false;
            this.workletReady = false;
        }
    }
    
    /**
     * Start the cluster synthesis
     * @param {number} baseFreq - Base frequency in Hz
     * @param {number} step - Frequency step between oscillators
     * @param {number} clusterSize - Number of oscillators in the cluster
     * @param {string} waveform - Waveform type (sine, triangle, square, sawtooth)
     * @param {number} stereoWidth - Stereo spread (0 to 1)
     * @param {number} attackTime - Attack time in seconds
     * @param {number} releaseTime - Release time in seconds
     */
    start(baseFreq, step, clusterSize, waveform, stereoWidth, attackTime, releaseTime) {
        if (!this.ctx || this.ctx.state !== 'running') {
            throw new Error('AudioContext not running');
        }
        
        // Stop if already playing
        if (this.isPlaying) this.stop(true);
        
        // If stopping, wait and retry
        if (this.isStopping) {
            setTimeout(() => this.start(...arguments), 100);
            return;
        }
        
        this.isStopping = false;
        const now = this.ctx.currentTime;
        
        // Waveform compensation for volume
        let waveComp = 1.0;
        if (waveform === 'square') waveComp = 0.6;
        if (waveform === 'sawtooth') waveComp = 0.7;
        if (waveform === 'triangle') waveComp = 0.9;
        const safeGain = waveComp / Math.sqrt(clusterSize);
        
        // Reset envelope
        this.envelopeGain.gain.cancelScheduledValues(now);
        this.envelopeGain.gain.setValueAtTime(0, now);
        this.envelopeGain.gain.linearRampToValueAtTime(1, now + attackTime);
        
        // Set cluster gain
        this.clusterGain.gain.cancelScheduledValues(now);
        this.clusterGain.gain.setValueAtTime(safeGain, now);
        
        // Use AudioWorklet if available
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
                    releaseTime
                }
            });
            this.workletNode.port.postMessage({ type: 'start' });
        } else {
            // Fallback to oscillators
            this._startWithOscillators(baseFreq, step, clusterSize, waveform, stereoWidth, attackTime, releaseTime);
        }
        
        this.isPlaying = true;
    }
    
    /**
     * Start synthesis using individual oscillators (fallback)
     */
    _startWithOscillators(baseFreq, step, clusterSize, waveform, stereoWidth, attackTime, releaseTime) {
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
            const freq = baseFreq + i * step;
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
    
    /**
     * Stop the cluster synthesis
     * @param {boolean} instant - If true, stop immediately; otherwise, fade out
     */
    stop(instant = false) {
        if (!this.ctx || !this.isPlaying || this.isStopping) return;
        
        this.isStopping = true;
        this.isPlaying = false;
        
        const now = this.ctx.currentTime;
        const fadeTime = instant ? 0.01 : 0.5;
        
        // Fade out envelope
        this.envelopeGain.gain.cancelScheduledValues(now);
        this.envelopeGain.gain.setValueAtTime(this.envelopeGain.gain.value, now);
        this.envelopeGain.gain.linearRampToValueAtTime(0, now + fadeTime);
        
        // Stop worklet
        if (this.useWorklet && this.workletReady && this.workletNode) {
            this.workletNode.port.postMessage({ type: 'stop' });
        }
        
        // Stop oscillators (fallback)
        if (this.oscillators && this.oscillators.length > 0) {
            const stopTime = now + fadeTime + 0.01;
            for (const osc of this.oscillators) {
                osc.stop(stopTime);
                osc.onended = () => this._safeDisconnect(osc);
            }
        }
        
        // Schedule cleanup
        const cleanupDelay = (fadeTime + 0.05) * 1000;
        setTimeout(() => this._cleanupNodes(), cleanupDelay);
    }
    
    /**
     * Safely disconnect an audio node
     * @param {AudioNode} node - The node to disconnect
     */
    _safeDisconnect(node) {
        try { node.disconnect(); } catch (e) {}
    }
    
    /**
     * Clean up all audio nodes
     */
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
    
    /**
     * Set the master volume
     * @param {number} normalizedValue - Volume (0 to 2.0)
     */
    setVolume(normalizedValue) {
        if (!this.volumeGain || !this.ctx) return;
        const now = this.ctx.currentTime;
        this.volumeGain.gain.cancelScheduledValues(now);
        this.volumeGain.gain.setValueAtTime(normalizedValue, now);
    }
    
    /**
     * Set the filter cutoff frequency
     * @param {number} freq - Cutoff frequency in Hz
     */
    setFilterCutoff(freq) {
        if (!this.filterNode || !this.ctx) return;
        const now = this.ctx.currentTime;
        this.filterNode.frequency.cancelScheduledValues(now);
        this.filterNode.frequency.exponentialRampToValueAtTime(freq, now + 0.05);
    }
    
    /**
     * Set the filter resonance (Q)
     * @param {number} q - Resonance value (0.1 to 20)
     */
    setFilterQ(q) {
        if (!this.filterNode || !this.ctx) return;
        const now = this.ctx.currentTime;
        this.filterNode.Q.cancelScheduledValues(now);
        this.filterNode.Q.linearRampToValueAtTime(q, now + 0.05);
    }
    
    /**
     * Set envelope times
     * @param {number} attack - Attack time in seconds
     * @param {number} release - Release time in seconds
     */
    setEnvelopeTimes(attack, release) {
        this.attackTime = attack;
        this.releaseTime = release;
        
        // For worklet, send updated envelope times
        if (this.useWorklet && this.workletReady && this.workletNode) {
            this.workletNode.port.postMessage({
                type: 'config',
                config: {
                    baseFreq: this.baseFreq || 250,
                    step: this.step || 0.01,
                    clusterSize: this.clusterSize || 10,
                    stereoWidth: this.stereoWidth || 0.5,
                    waveform: this.waveform || 'sine',
                    attackTime: attack,
                    releaseTime: release
                }
            });
        }
    }
    
    /**
     * Get the analyser node for visualization
     * @returns {AnalyserNode} The analyser node
     */
    getAnalyser() {
        return this.analyser;
    }
    
    /**
     * Get the sample rate
     * @returns {number} Sample rate in Hz
     */
    getSampleRate() {
        return this.ctx ? this.ctx.sampleRate : 44100;
    }
    
    /**
     * Destroy all audio resources
     */
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

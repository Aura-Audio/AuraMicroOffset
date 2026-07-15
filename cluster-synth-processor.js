/**
 * ClusterSynthProcessor - AudioWorklet Processor for Micro-Cluster Synth
 * 
 * This processor generates a cluster of oscillators with configurable:
 * - Base frequency and step size
 * - Cluster size (number of oscillators)
 * - Waveform (sine, triangle, square, sawtooth)
 * - Stereo panning
 * - ADSR envelope (attack/release)
 * 
 * Uses precomputed waveform tables and linear interpolation for efficiency.
 */

class ClusterSynthProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Phase state for each oscillator in the cluster
        this.phase = [];
        
        // Frequency and panning for each oscillator
        this.frequencies = [];
        this.panValues = [];
        
        // Global state
        this.time = 0;                // Global sample counter
        this.isPlaying = false;       // Playback state
        this.sampleRate = 44100;      // Updated in process()
        
        // Envelope state
        this.attackSamples = 0;       // Attack duration in samples
        this.releaseSamples = 0;      // Release duration in samples
        this.stage = 0;               // 0=attack, 1=sustain, 2=release, 3=done
        this.stageSamples = 0;       // Counter for current stage
        
        // Waveform tables (4096 samples per waveform)
        this.tableSize = 4096;
        this.waveformTables = {
            sine: new Float32Array(this.tableSize),
            triangle: new Float32Array(this.tableSize),
            square: new Float32Array(this.tableSize),
            sawtooth: new Float32Array(this.tableSize)
        };
        
        // Initialize waveform tables
        this._initWaveformTables();
        
        // Message port for communication with main thread
        this.port.onmessage = (e) => {
            if (e.data.type === 'config') {
                this._configure(e.data.config);
            } else if (e.data.type === 'start') {
                this._start();
            } else if (e.data.type === 'stop') {
                this._stop();
            }
        };
    }
    
    /**
     * Initialize waveform lookup tables
     * Each table contains 4096 samples (one full cycle)
     */
    _initWaveformTables() {
        for (let i = 0; i < this.tableSize; i++) {
            const phase = (i / this.tableSize) * Math.PI * 2;
            
            // Sine: Standard sine wave
            this.waveformTables.sine[i] = Math.sin(phase);
            
            // Triangle: Bandlimited approximation using asin(sin)
            this.waveformTables.triangle[i] = (2 / Math.PI) * Math.asin(Math.sin(phase));
            
            // Square: ±0.8 (reduced amplitude to avoid clipping)
            this.waveformTables.square[i] = Math.sin(phase) > 0 ? 0.8 : -0.8;
            
            // Sawtooth: Linear ramp (-0.5 to +0.5)
            this.waveformTables.sawtooth[i] = 2 * ((phase / (Math.PI * 2)) - 0.5);
        }
    }
    
    /**
     * Configure the processor with new parameters
     * @param {Object} config - Configuration object
     */
    _configure(config) {
        // Store parameters
        this.baseFreq = config.baseFreq;
        this.step = config.step;
        this.clusterSize = config.clusterSize;
        this.stereoWidth = config.stereoWidth;
        this.waveform = config.waveform;
        this.attackTime = config.attackTime;
        this.releaseTime = config.releaseTime;
        
        // Rebuild oscillator data
        this.frequencies = [];
        this.panValues = [];
        this.phase = [];
        
        for (let i = 1; i <= this.clusterSize; i++) {
            // Calculate frequency for this oscillator
            this.frequencies[i-1] = this.baseFreq + i * this.step;
            
            // Random stereo pan position
            this.panValues[i-1] = (Math.random() * 2 - 1) * this.stereoWidth;
            
            // Random initial phase to avoid phase coherence
            this.phase[i-1] = Math.random() * Math.PI * 2;
        }
    }
    
    /**
     * Start playback
     */
    _start() {
        this.isPlaying = true;
        this.time = 0;
        this.stage = 0; // Enter attack stage
        this.stageSamples = 0;
        
        // Convert times to sample counts
        this.attackSamples = Math.max(1, Math.floor(this.attackTime * this.sampleRate));
        this.releaseSamples = Math.max(1, Math.floor(this.releaseTime * this.sampleRate));
    }
    
    /**
     * Stop playback (enter release stage)
     */
    _stop() {
        this.isPlaying = false;
        this.stage = 2; // Enter release stage
        this.stageSamples = 0;
    }
    
    /**
     * Main audio processing loop
     * Called by the audio engine for each render quantum
     */
    process(inputs, outputs) {
        const output = outputs[0];          // Output buffer (2 channels: L/R)
        const sampleRate = sampleRate;     // Current sample rate (e.g., 44100)
        this.sampleRate = sampleRate;
        const channelCount = output.length; // 2 (stereo)
        const blockSize = output[0].length; // Render quantum size (e.g., 128)
        
        // If not playing and not in release, output silence
        if (!this.isPlaying && this.stage !== 2) {
            for (let i = 0; i < channelCount; i++) {
                output[i].fill(0);
            }
            return true;
        }
        
        // Select waveform table and compensation gain
        const waveformTable = this.waveformTables[this.waveform];
        const waveComp = { 
            sine: 1.0, 
            triangle: 0.9, 
            square: 0.6, 
            sawtooth: 0.7 
        }[this.waveform];
        
        // Normalize gain by sqrt(clusterSize) to prevent clipping
        const safeGain = waveComp / Math.sqrt(this.clusterSize);
        
        // Process each sample in the block
        for (let sample = 0; sample < blockSize; sample++) {
            this.time++;
            this.stageSamples++;
            
            // Calculate envelope
            let envelope = 1.0;
            if (this.stage === 0) { // Attack
                envelope = this.stageSamples / this.attackSamples;
                if (this.stageSamples >= this.attackSamples) {
                    this.stage = 1; // Sustain
                    this.stageSamples = 0;
                }
            } else if (this.stage === 2) { // Release
                envelope = 1 - (this.stageSamples / this.releaseSamples);
                if (this.stageSamples >= this.releaseSamples) {
                    this.stage = 3; // Done
                    envelope = 0;
                }
            }
            
            // Process each channel (L/R)
            for (let channel = 0; channel < channelCount; channel++) {
                let sum = 0;
                
                // Sum all oscillators
                for (let i = 0; i < this.clusterSize; i++) {
                    const freq = this.frequencies[i];
                    const pan = this.panValues[i];
                    
                    // Update phase (sample-accurate)
                    const phaseIncrement = (freq / sampleRate) * Math.PI * 2;
                    this.phase[i] += phaseIncrement;
                    if (this.phase[i] >= Math.PI * 2) {
                        this.phase[i] -= Math.PI * 2; // Wrap phase
                    }
                    
                    // Look up waveform sample (linear interpolation)
                    const tableIndex = (this.phase[i] / (Math.PI * 2)) * this.tableSize;
                    const intIndex = Math.floor(tableIndex) % this.tableSize;
                    const frac = tableIndex - intIndex;
                    const sampleValue = waveformTable[intIndex] * (1 - frac) +
                                        waveformTable[(intIndex + 1) % this.tableSize] * frac;
                    
                    // Apply stereo panning (equal power law)
                    let panFactor;
                    if (channel === 0) { // Left channel
                        panFactor = pan <= 0 ? 1 : 1 - pan;
                    } else { // Right channel
                        panFactor = pan >= 0 ? 1 : 1 + pan;
                    }
                    
                    sum += sampleValue * panFactor;
                }
                
                // Apply gain and envelope
                output[channel][sample] = sum * safeGain * envelope;
            }
        }
        
        // Reset state if release is done
        if (this.stage === 3) {
            this.isPlaying = false;
            this.stage = 0;
        }
        
        return true; // Keep the node alive
    }
}

// Register the processor with the AudioWorklet
registerProcessor('cluster-synth-processor', ClusterSynthProcessor);

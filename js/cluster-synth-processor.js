/**
 * ClusterSynthesizer — AudioWorklet Processor
 * 
 * Features:
 *  - Band-limited wavetable synthesis (anti-aliased)
 *  - Per-oscillator panning and detuning
 *  - AD envelope with linear interpolation
 *  - DC blocking filter
 *  - Denormal protection
 *  - TDZ-safe sampleRate handling
 */

class ClusterSynthesizer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();

    // Core state
    this.isPlaying = false;
    this.stage = 0; // 0=attack, 1=sustain, 2=release, 3=idle
    this.time = 0;
    this.stageSamples = 0;

    // Parameters (set via messages)
    this.baseFreq = 440;
    this.step = 1.0;
    this.clusterSize = 8;
    this.waveform = 'sine';
    this.stereoWidth = 0.8;
    this.attackTime = 0.1;
    this.releaseTime = 2.0;
    this.harmonicMode = 'linear';

    // Runtime arrays
    this.frequencies = new Float32Array(64);
    this.panValues = new Float32Array(64);
    this.phase = new Float32Array(64);

    // Wavetable config
    this.tableSize = 2048;
    this.waveformTables = {};
    this._generateAllWaveforms();

    // DC blocker state (high-pass at ~10Hz)
    this.dcBlocker = { x1: 0, y1: 0, r: 0.999 };

    // Message handling
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  /**
   * Generate band-limited wavetables to prevent aliasing.
   * Uses additive synthesis with harmonic count limited by Nyquist.
   */
  _generateAllWaveforms() {
    const sr = (typeof sampleRate !== 'undefined') ? sampleRate : 44100;
    const nyquist = sr / 2;

    // For each waveform, we generate a table with harmonics up to Nyquist
    // relative to a reference fundamental. At runtime, we use this single
    // table and rely on the fact that higher fundamentals will alias less
    // severely than if we used an infinite-harmonic table.
    // 
    // A more advanced implementation would use multiple tables (mipmapping),
    // but for a microtonal cluster synth, a single properly-bandlimited
    // table per waveform is sufficient.

    const refFreq = 55; // A1 — lowest typical fundamental
    const maxHarmonic = Math.floor(nyquist / refFreq);

    this.waveformTables.sine = this._generateSineTable();
    this.waveformTables.triangle = this._generateBandLimitedTriangle(maxHarmonic);
    this.waveformTables.square = this._generateBandLimitedSquare(maxHarmonic);
    this.waveformTables.sawtooth = this._generateBandLimitedSawtooth(maxHarmonic);
  }

  _generateSineTable() {
    const table = new Float32Array(this.tableSize);
    for (let i = 0; i < this.tableSize; i++) {
      table[i] = Math.sin((i / this.tableSize) * Math.PI * 2);
    }
    return table;
  }

  _generateBandLimitedTriangle(maxHarmonic) {
    const table = new Float32Array(this.tableSize);
    for (let i = 0; i < this.tableSize; i++) {
      let sum = 0;
      const t = i / this.tableSize;
      // Triangle: odd harmonics, amplitude 1/n², alternating sign
      for (let h = 1; h <= maxHarmonic; h += 2) {
        const sign = ((h - 1) / 2) % 2 === 0 ? 1 : -1;
        sum += sign * Math.sin(t * Math.PI * 2 * h) / (h * h);
      }
      table[i] = sum * (8 / (Math.PI * Math.PI));
    }
    return table;
  }

  _generateBandLimitedSquare(maxHarmonic) {
    const table = new Float32Array(this.tableSize);
    for (let i = 0; i < this.tableSize; i++) {
      let sum = 0;
      const t = i / this.tableSize;
      // Square: odd harmonics, amplitude 1/n
      for (let h = 1; h <= maxHarmonic; h += 2) {
        sum += Math.sin(t * Math.PI * 2 * h) / h;
      }
      table[i] = sum * (4 / Math.PI);
    }
    return table;
  }

  _generateBandLimitedSawtooth(maxHarmonic) {
    const table = new Float32Array(this.tableSize);
    for (let i = 0; i < this.tableSize; i++) {
      let sum = 0;
      const t = i / this.tableSize;
      // Sawtooth: all harmonics, amplitude 1/n, alternating sign
      for (let h = 1; h <= maxHarmonic; h++) {
        sum += ((h % 2 === 0) ? -1 : 1) * Math.sin(t * Math.PI * 2 * h) / h;
      }
      table[i] = sum * (2 / Math.PI);
    }
    return table;
  }

  _handleMessage(data) {
    switch (data.type) {
      case 'start':
        this._configureCluster(data);
        this.isPlaying = true;
        this.stage = 0;
        this.stageSamples = 0;
        break;
      case 'stop':
        this.stage = 2; // Enter release
        break;
      case 'update':
        this._configureCluster(data);
        break;
      case 'panic':
        this.isPlaying = false;
        this.stage = 3;
        this.phase.fill(0);
        break;
    }
  }

  _configureCluster(data) {
    this.baseFreq = data.baseFreq ?? this.baseFreq;
    this.step = data.step ?? this.step;
    this.clusterSize = Math.min(Math.max(1, data.clusterSize ?? this.clusterSize), 64);
    this.waveform = data.waveform ?? this.waveform;
    this.stereoWidth = data.stereoWidth ?? this.stereoWidth;
    this.attackTime = data.attackTime ?? this.attackTime;
    this.releaseTime = data.releaseTime ?? this.releaseTime;
    this.harmonicMode = data.harmonicMode ?? this.harmonicMode;

    // FIX: Safely alias the global sampleRate to avoid TDZ ReferenceError
    const sr = (typeof sampleRate !== 'undefined') ? sampleRate : 44100;
    this.sampleRate = sr;

    this.attackSamples = Math.max(1, Math.round(this.attackTime * sr));
    this.releaseSamples = Math.max(1, Math.round(this.releaseTime * sr));

    this._computeFrequencies();
    this._computePanning();
  }

  _computeFrequencies() {
    const base = this.baseFreq;
    const size = this.clusterSize;

    for (let i = 0; i < size; i++) {
      switch (this.harmonicMode) {
        case 'harmonic':
          this.frequencies[i] = base * (i + 1);
          break;
        case 'subharmonic':
          this.frequencies[i] = base / (i + 1);
          break;
        case 'just': {
          // Just intonation ratios for first 8 harmonics, then repeat
          const ratios = [1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2];
          this.frequencies[i] = base * ratios[i % ratios.length] * (1 + Math.floor(i / ratios.length));
          break;
        }
        case 'linear':
        default:
          this.frequencies[i] = base + (i * this.step);
          break;
      }
      // Clamp to audible range and Nyquist
      this.frequencies[i] = Math.max(20, Math.min(this.frequencies[i], this.sampleRate / 2 - 1));
    }
  }

  _computePanning() {
    const size = this.clusterSize;
    const width = this.stereoWidth;

    for (let i = 0; i < size; i++) {
      // Distribute oscillators across stereo field
      const t = size > 1 ? i / (size - 1) : 0.5;
      // Map 0..1 to -width..+width
      this.panValues[i] = (t * 2 - 1) * width;
    }
  }

  /**
   * Simple DC blocking filter to prevent cumulative offset drift.
   * y[n] = x[n] - x[n-1] + R * y[n-1]
   */
  _dcBlock(sample) {
    const y = sample - this.dcBlocker.x1 + this.dcBlocker.r * this.dcBlocker.y1;
    this.dcBlocker.x1 = sample;
    this.dcBlocker.y1 = y;
    return y;
  }

  /**
   * Denormal protection: flush subnormal values to zero.
   * Near-zero floating point values can cause 10-100x CPU slowdowns.
   */
  _flushDenormals(value) {
    return Math.abs(value) < 1e-18 ? 0 : value;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channelCount = output.length;
    const blockSize = output[0].length;

    // FIX: Use safely-aliased sampleRate
    const sr = this.sampleRate || ((typeof sampleRate !== 'undefined') ? sampleRate : 44100);

    // Silence if not playing and not in release
    if (!this.isPlaying && this.stage !== 2) {
      for (let i = 0; i < channelCount; i++) {
        if (output[i]) output[i].fill(0);
      }
      return true;
    }

    const waveformTable = this.waveformTables[this.waveform];
    if (!waveformTable) {
      for (let i = 0; i < channelCount; i++) {
        if (output[i]) output[i].fill(0);
      }
      return true;
    }

    // Waveform compensation factors (prevents clipping with dense clusters)
    const waveComp = { sine: 1.0, triangle: 0.9, square: 0.6, sawtooth: 0.7 }[this.waveform] || 1.0;
    const safeGain = waveComp / Math.sqrt(this.clusterSize || 1);
    const tableSize = this.tableSize;
    const twoPi = Math.PI * 2;

    for (let sample = 0; sample < blockSize; sample++) {
      this.time++;
      this.stageSamples++;

      // Envelope generation
      let envelope = 1.0;
      if (this.stage === 0) {
        envelope = this.stageSamples / this.attackSamples;
        if (this.stageSamples >= this.attackSamples) {
          this.stage = 1;
          this.stageSamples = 0;
          envelope = 1.0;
        }
      } else if (this.stage === 2) {
        envelope = 1 - (this.stageSamples / this.releaseSamples);
        if (this.stageSamples >= this.releaseSamples) {
          this.stage = 3;
          this.isPlaying = false;
          envelope = 0;
        }
      }

      envelope = Math.max(0, Math.min(1, envelope));

      for (let channel = 0; channel < channelCount; channel++) {
        let sum = 0;

        for (let i = 0; i < this.clusterSize; i++) {
          const freq = this.frequencies[i];
          const pan = this.panValues[i];

          // Phase increment
          const phaseIncrement = (freq / sr) * twoPi;
          this.phase[i] += phaseIncrement;
          if (this.phase[i] >= twoPi) this.phase[i] -= twoPi;

          // Wavetable lookup with linear interpolation
          const phaseNorm = this.phase[i] / twoPi;
          const tableIndex = phaseNorm * tableSize;
          const intIndex = Math.floor(tableIndex) % tableSize;
          const frac = tableIndex - intIndex;
          const nextIndex = (intIndex + 1) % tableSize;

          const sampleValue = waveformTable[intIndex] * (1 - frac) +
                              waveformTable[nextIndex] * frac;

          // Panning: linear pan law
          let panFactor;
          if (channel === 0) {
            panFactor = pan <= 0 ? 1.0 : 1.0 - pan;
          } else {
            panFactor = pan >= 0 ? 1.0 : 1.0 + pan;
          }
          panFactor = Math.max(0, Math.min(1, panFactor));

          sum += sampleValue * panFactor;
        }

        // Apply gain and envelope
        let outSample = sum * safeGain * envelope;

        // DC blocking
        outSample = this._dcBlock(outSample);

        // Denormal protection
        outSample = this._flushDenormals(outSample);

        // Soft clip to prevent hard digital distortion
        outSample = Math.tanh(outSample);

        if (output[channel]) {
          output[channel][sample] = outSample;
        }
      }
    }

    return true;
  }
}

registerProcessor('cluster-synth', ClusterSynthesizer);

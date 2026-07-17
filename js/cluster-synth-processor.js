/**
 * ClusterSynthesizer — AudioWorklet Processor
 * Supports up to 1000 oscillators with band-limited wavetables.
 */

class ClusterSynthesizer extends AudioWorkletProcessor {
  constructor() {
    super();

    this.isPlaying = false;
    this.stage = 0; // 0=attack, 1=sustain, 2=release, 3=idle
    this.time = 0;
    this.stageSamples = 0;

    // Parameters
    this.baseFreq = 250;
    this.step = 0.001;
    this.clusterSize = 10;
    this.waveform = 'sine';
    this.stereoWidth = 0.5;
    this.attackTime = 0.01;
    this.releaseTime = 0.22;
    this.harmonicMode = 'linear';

    // Max 1000 oscillators
    this.MAX_OSC = 1000;
    this.frequencies = new Float32Array(this.MAX_OSC);
    this.panValues = new Float32Array(this.MAX_OSC);
    this.panLeft = new Float32Array(this.MAX_OSC);
    this.panRight = new Float32Array(this.MAX_OSC);
    this.phase = new Float32Array(this.MAX_OSC);

    // Wavetable
    this.tableSize = 2048;
    this.waveformTables = {};
    this._generateAllWaveforms();

    // DC blocker
    this.dcBlockerL = { x1: 0, y1: 0, r: 0.999 };
    this.dcBlockerR = { x1: 0, y1: 0, r: 0.999 };

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _generateAllWaveforms() {
    const sr = (typeof sampleRate !== 'undefined') ? sampleRate : 48000;
    const nyquist = sr / 2;
    const refFreq = 55;
    const maxHarmonic = Math.floor(nyquist / refFreq);

    this.waveformTables.sine = this._generateSineTable();
    this.waveformTables.triangle = this._generateBandLimitedTriangle(maxHarmonic);
    this.waveformTables.square = this._generateBandLimitedSquare(maxHarmonic);
    this.waveformTables.sawtooth = this._generateBandLimitedSawtooth(maxHarmonic);
  }

  _generateSineTable() {
    const t = new Float32Array(this.tableSize);
    const s = 2 * Math.PI / this.tableSize;
    for (let i = 0; i < this.tableSize; i++) t[i] = Math.sin(i * s);
    return t;
  }

  _generateBandLimitedTriangle(maxH) {
    const t = new Float32Array(this.tableSize);
    for (let i = 0; i < this.tableSize; i++) {
      let sum = 0;
      const phase = (i / this.tableSize) * 2 * Math.PI;
      for (let h = 1; h <= maxH; h += 2) {
        const sign = ((h - 1) / 2) % 2 === 0 ? 1 : -1;
        sum += sign * Math.sin(phase * h) / (h * h);
      }
      t[i] = sum * (8 / (Math.PI * Math.PI));
    }
    return t;
  }

  _generateBandLimitedSquare(maxH) {
    const t = new Float32Array(this.tableSize);
    for (let i = 0; i < this.tableSize; i++) {
      let sum = 0;
      const phase = (i / this.tableSize) * 2 * Math.PI;
      for (let h = 1; h <= maxH; h += 2) {
        sum += Math.sin(phase * h) / h;
      }
      t[i] = sum * (4 / Math.PI);
    }
    return t;
  }

  _generateBandLimitedSawtooth(maxH) {
    const t = new Float32Array(this.tableSize);
    for (let i = 0; i < this.tableSize; i++) {
      let sum = 0;
      const phase = (i / this.tableSize) * 2 * Math.PI;
      for (let h = 1; h <= maxH; h++) {
        sum += ((h % 2 === 0) ? -1 : 1) * Math.sin(phase * h) / h;
      }
      t[i] = sum * (2 / Math.PI);
    }
    return t;
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
        this.stage = 2;
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
    this.clusterSize = Math.min(Math.max(1, data.clusterSize ?? this.clusterSize), this.MAX_OSC);
    this.waveform = data.waveform ?? this.waveform;
    this.stereoWidth = data.stereoWidth ?? this.stereoWidth;
    this.attackTime = data.attackTime ?? this.attackTime;
    this.releaseTime = data.releaseTime ?? this.releaseTime;
    this.harmonicMode = data.harmonicMode ?? this.harmonicMode;

    const sr = (typeof sampleRate !== 'undefined') ? sampleRate : 48000;
    this.sampleRate = sr;
    this.attackSamples = Math.max(1, Math.round(this.attackTime * sr));
    this.releaseSamples = Math.max(1, Math.round(this.releaseTime * sr));

    this._computeFrequencies();
    this._computePanning();
  }

  _computeFrequencies() {
    const base = this.baseFreq;
    const size = this.clusterSize;
    const nyquist = this.sampleRate / 2 - 1;

    for (let i = 0; i < size; i++) {
      switch (this.harmonicMode) {
        case 'harmonic':
          this.frequencies[i] = base * (i + 1);
          break;
        case 'subharmonic':
          this.frequencies[i] = base / (i + 1);
          break;
        case 'just': {
          const ratios = [1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2];
          this.frequencies[i] = base * ratios[i % ratios.length] * (1 + Math.floor(i / ratios.length));
          break;
        }
        case 'linear':
        default:
          this.frequencies[i] = base + (i * this.step);
          break;
      }
      this.frequencies[i] = Math.max(0.01, Math.min(this.frequencies[i], nyquist));
    }
  }

  _computePanning() {
    const size = this.clusterSize;
    const width = this.stereoWidth;

    for (let i = 0; i < size; i++) {
      const t = size > 1 ? i / (size - 1) : 0.5;
      const pan = (t * 2 - 1) * width;
      this.panValues[i] = pan;
      // Pre-compute pan factors
      this.panLeft[i] = pan <= 0 ? 1.0 : 1.0 - pan;
      this.panRight[i] = pan >= 0 ? 1.0 : 1.0 + pan;
    }
  }

  _dcBlock(sample, state) {
    const y = sample - state.x1 + state.r * state.y1;
    state.x1 = sample;
    state.y1 = y;
    return y;
  }

  _flushDenormals(v) {
    return Math.abs(v) < 1e-18 ? 0 : v;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const chL = output[0];
    const chR = output[1] || chL;
    const blockSize = chL.length;
    const sr = this.sampleRate || ((typeof sampleRate !== 'undefined') ? sampleRate : 48000);

    if (!this.isPlaying && this.stage !== 2) {
      chL.fill(0);
      if (chR !== chL) chR.fill(0);
      return true;
    }

    const table = this.waveformTables[this.waveform];
    if (!table) {
      chL.fill(0);
      if (chR !== chL) chR.fill(0);
      return true;
    }

    const waveComp = { sine: 1.0, triangle: 0.9, square: 0.6, sawtooth: 0.7 }[this.waveform] || 1.0;
    const safeGain = waveComp / Math.sqrt(this.clusterSize || 1);
    const tSize = this.tableSize;
    const twoPi = Math.PI * 2;
    const size = this.clusterSize;

    for (let s = 0; s < blockSize; s++) {
      this.time++;
      this.stageSamples++;

      let env = 1.0;
      if (this.stage === 0) {
        env = this.stageSamples / this.attackSamples;
        if (this.stageSamples >= this.attackSamples) {
          this.stage = 1;
          this.stageSamples = 0;
          env = 1.0;
        }
      } else if (this.stage === 2) {
        env = 1 - (this.stageSamples / this.releaseSamples);
        if (this.stageSamples >= this.releaseSamples) {
          this.stage = 3;
          this.isPlaying = false;
          env = 0;
        }
      }
      env = Math.max(0, Math.min(1, env));

      let sumL = 0, sumR = 0;

      for (let i = 0; i < size; i++) {
        const freq = this.frequencies[i];
        const inc = (freq / sr) * twoPi;
        this.phase[i] += inc;
        if (this.phase[i] >= twoPi) this.phase[i] -= twoPi;

        const pNorm = this.phase[i] / twoPi;
        const tIdx = pNorm * tSize;
        const iIdx = Math.floor(tIdx) % tSize;
        const frac = tIdx - iIdx;
        const nIdx = (iIdx + 1) % tSize;

        const samp = table[iIdx] * (1 - frac) + table[nIdx] * frac;

        sumL += samp * this.panLeft[i];
        sumR += samp * this.panRight[i];
      }

      let outL = sumL * safeGain * env;
      let outR = sumR * safeGain * env;

      outL = this._dcBlock(outL, this.dcBlockerL);
      outR = this._dcBlock(outR, this.dcBlockerR);

      outL = this._flushDenormals(outL);
      outR = this._flushDenormals(outR);

      outL = Math.tanh(outL);
      outR = Math.tanh(outR);

      chL[s] = outL;
      chR[s] = outR;
    }

    return true;
  }
}

registerProcessor('cluster-synth', ClusterSynthesizer);

/**
 * Visualizer - Real-time audio waveform visualization
 * 
 * Uses AnalyserNode to display the time-domain waveform
 * of the audio output.
 */

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
    
    /**
     * Set up resize observer to handle canvas resizing
     */
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
    
    /**
     * Start visualization with an analyser node
     * @param {AnalyserNode} analyser - Web Audio AnalyserNode
     */
    start(analyser) {
        this.analyser = analyser;
        this.dataArray = new Uint8Array(analyser.fftSize);
        this.isRunning = true;
        this._animate();
    }
    
    /**
     * Stop visualization
     */
    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this._clearCanvas();
    }
    
    /**
     * Animation loop
     */
    _animate() {
        if (!this.isRunning) return;
        this._draw();
        this.animFrameId = requestAnimationFrame(() => this._animate());
    }
    
    /**
     * Draw the current waveform
     */
    _draw() {
        if (!this.analyser) return;
        const ctx = this.ctx2d;
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        
        // Get time-domain data
        this.analyser.getByteTimeDomainData(this.dataArray);
        
        // Clear canvas
        ctx.clearRect(0, 0, w, h);
        
        // Draw center line
        ctx.strokeStyle = '#ffffff08';
        ctx.lineWidth = 0.5;
        const midY = h / 2;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(w, midY);
        ctx.stroke();
        
        // Draw waveform
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
    
    /**
     * Clear the canvas
     */
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
    
    /**
     * Clean up resources
     */
    destroy() {
        this.stop();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }
    }

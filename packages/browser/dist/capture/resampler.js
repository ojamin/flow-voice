/** Streaming windowed-sinc low-pass resampler. History is retained across render quanta. */
export class PcmResampler {
    inputRate;
    outputRate;
    samples = Array(32).fill(0);
    position = 32;
    frame = [];
    ratio;
    cutoff;
    constructor(inputRate, outputRate) {
        this.inputRate = inputRate;
        this.outputRate = outputRate;
        if (!(inputRate > 0 && outputRate > 0))
            throw new RangeError('Invalid sample rate');
        this.ratio = inputRate / outputRate;
        this.cutoff = Math.min(1, outputRate / inputRate) * 0.94;
    }
    push(input) {
        for (const sample of input)
            this.samples.push(sample);
        const frames = [];
        while (this.position + 32 < this.samples.length) {
            const center = Math.floor(this.position);
            let value = 0;
            let weight = 0;
            for (let i = center - 31; i <= center + 32; i++) {
                const distance = i - this.position;
                const x = Math.PI * distance * this.cutoff;
                const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x;
                const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / 32);
                const coefficient = sinc * window * this.cutoff;
                value += (this.samples[i] ?? 0) * coefficient;
                weight += coefficient;
            }
            this.frame.push(Math.max(-1, Math.min(1, value / weight)));
            this.position += this.ratio;
            if (this.frame.length === Math.round(this.outputRate * 0.08))
                frames.push(this.emit());
        }
        const consumed = Math.max(0, Math.floor(this.position) - 32);
        this.samples.splice(0, consumed);
        this.position -= consumed;
        return frames;
    }
    flush() {
        const frames = this.push(new Float32Array(32));
        if (this.frame.length)
            frames.push(this.emit());
        return frames;
    }
    emit() {
        const audio = new Uint8Array(this.frame.length * 2);
        const view = new DataView(audio.buffer);
        let energy = 0;
        this.frame.forEach((sample, index) => {
            energy += sample * sample;
            view.setInt16(index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
        });
        const rms = Math.sqrt(energy / this.frame.length);
        this.frame = [];
        return { audio, rms };
    }
}
//# sourceMappingURL=resampler.js.map
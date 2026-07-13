export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export class Equalizer {
    public input: GainNode;
    public output: DynamicsCompressorNode;
    private bands: BiquadFilterNode[] = [];
    private ctx: AudioContext;
    private preamp: GainNode;

    constructor(ctx: AudioContext) {
        this.ctx = ctx;
        this.input = ctx.createGain();
        this.preamp = ctx.createGain();
        this.input.connect(this.preamp);
        
        let prevNode: AudioNode = this.preamp;

        // Create 10 bands
        for (const freq of EQ_FREQUENCIES) {
            const filter = ctx.createBiquadFilter();
            filter.type = "peaking";
            filter.frequency.value = freq;
            filter.Q.value = 1.4; // constant Q for 1 octave
            filter.gain.value = 0;
            
            this.bands.push(filter);
            prevNode.connect(filter);
            prevNode = filter;
        }

        // Safety compressor at the end to prevent clipping
        this.output = ctx.createDynamicsCompressor();
        this.output.threshold.value = -3;
        this.output.knee.value = 10;
        this.output.ratio.value = 4;
        this.output.attack.value = 0.005;
        this.output.release.value = 0.05;

        prevNode.connect(this.output);
    }

    public setGains(gains: number[], preampDb: number = 0) {
        if (gains.length !== this.bands.length) return;
        
        const now = this.ctx.currentTime;
        
        // Convert dB to linear gain for preamp
        const linearGain = Math.pow(10, preampDb / 20);
        this.preamp.gain.setTargetAtTime(linearGain, now, 0.05);

        for (let i = 0; i < this.bands.length; i++) {
            this.bands[i].gain.setTargetAtTime(gains[i], now, 0.05);
        }
    }

    public getFrequencyResponse(freqs: Float32Array): Float32Array {
        const response = new Float32Array(freqs.length);
        const phase = new Float32Array(freqs.length);
        const totalMag = new Float32Array(freqs.length);
        totalMag.fill(1.0); // start with linear gain 1

        // Preamp gain factor
        const currentPreamp = this.preamp.gain.value;
        for (let j = 0; j < totalMag.length; j++) {
            totalMag[j] *= currentPreamp;
        }

        for (const band of this.bands) {
            const mag = new Float32Array(freqs.length);
            band.getFrequencyResponse(freqs as any, mag as any, phase as any);
            for (let i = 0; i < freqs.length; i++) {
                totalMag[i] *= mag[i]; // Cascade multiply
            }
        }

        // Convert back to dB
        for (let i = 0; i < totalMag.length; i++) {
            response[i] = 20 * Math.log10(Math.max(totalMag[i], 1e-10));
        }

        return response;
    }
}

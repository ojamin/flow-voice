/** Streaming windowed-sinc low-pass resampler. History is retained across render quanta. */
export declare class PcmResampler {
    readonly inputRate: number;
    readonly outputRate: number;
    private samples;
    private position;
    private frame;
    private readonly ratio;
    private readonly cutoff;
    constructor(inputRate: number, outputRate: number);
    push(input: Float32Array): {
        audio: Uint8Array;
        rms: number;
    }[];
    flush(): {
        audio: Uint8Array;
        rms: number;
    }[];
    private emit;
}

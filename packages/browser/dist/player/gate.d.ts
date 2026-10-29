/** Shared half-duplex gate. Acquire before requesting the microphone; release after capture stops. */
export interface PlaybackGate {
    isMicrophoneActive(): boolean;
    acquireMicrophone(): () => void;
    subscribe(listener: () => void): () => void;
}
export declare function createPlaybackGate(): PlaybackGate;

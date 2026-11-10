export function createCallSession(options) {
    const { player } = options;
    const media = options.mediaSession === undefined
        ? globalThis.navigator?.mediaSession : options.mediaSession;
    let dictation = options.dictation;
    let snapshot = { status: 'idle', muted: false, failed: false };
    let disposed = false;
    let generation = 0;
    let starting = false;
    let reachedListening = false;
    let failures = 0;
    let restoreVoice;
    /** Dictation was on when the call started, so hanging up leaves it on. */
    let restoreDictation = false;
    let setMetadata = false;
    let latest;
    let previous;
    const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const rememberPlayback = () => {
        const state = player.getSnapshot();
        if (snapshot.status !== 'active' || state.status !== 'playing' || !state.sectionText)
            return;
        if (latest?.messageId === state.messageId && latest?.ordinal === state.sectionOrdinal)
            return;
        previous = latest;
        latest = { messageId: state.messageId, ordinal: state.sectionOrdinal, text: normalize(state.sectionText) };
    };
    const listeners = new Set();
    const publish = (patch) => {
        snapshot = { ...snapshot, ...patch };
        listeners.forEach((listener) => listener());
    };
    const microphone = () => {
        try {
            media?.setMicrophoneActive?.(snapshot.status === 'active' && !snapshot.muted);
        }
        catch { /* Optional browser capability. */ }
    };
    const playback = () => {
        rememberPlayback();
        if (media && snapshot.status === 'active')
            media.playbackState = player.getSnapshot().status === 'playing' ? 'playing' : 'paused';
    };
    const handlers = {
        play: () => { void player.resume(); },
        pause: () => player.pause(),
        nexttrack: () => player.skipSection(),
        hangup: () => session.end(),
        togglemicrophone: () => session.setMuted(!snapshot.muted),
    };
    const actions = (enabled) => {
        for (const action of Object.keys(handlers)) {
            try {
                media?.setActionHandler(action, enabled ? handlers[action] : null);
            }
            catch { /* Browsers can reject individual unsupported actions. */ }
        }
    };
    // A request can resolve after hide/end, or after a new call has acquired another lock.
    let wakeOwner;
    const releaseWakeLock = () => {
        const previous = wakeOwner;
        wakeOwner = undefined;
        void previous?.sentinel?.release().catch(() => { });
    };
    const visibility = () => {
        if (snapshot.status !== 'active' || globalThis.document?.visibilityState !== 'visible') {
            releaseWakeLock();
            return;
        }
        if (wakeOwner || !globalThis.navigator?.wakeLock)
            return;
        const owner = {};
        wakeOwner = owner;
        void globalThis.navigator.wakeLock.request('screen').then((sentinel) => {
            if (wakeOwner !== owner)
                void sentinel.release().catch(() => { });
            else
                owner.sentinel = sentinel;
        }).catch(() => {
            if (wakeOwner === owner)
                wakeOwner = undefined;
        });
    };
    const shouldListen = () => snapshot.status === 'active' && !snapshot.muted && !disposed;
    const stopped = () => !dictation || ['idle', 'error'].includes(dictation.getSnapshot().status);
    async function listen() {
        const target = dictation;
        if (!target || !shouldListen() || starting || !stopped())
            return;
        starting = true;
        reachedListening = false;
        const attempt = generation;
        try {
            await target.start();
            if (attempt !== generation || target !== dictation || !shouldListen())
                return;
            if (reachedListening || target.getSnapshot().status === 'listening')
                failures = 0;
            else
                failures++;
        }
        catch {
            if (attempt === generation && target === dictation && shouldListen())
                failures++;
        }
        finally {
            starting = false;
            if (shouldListen() && dictation) {
                if (failures >= (options.maxFailures ?? 3))
                    finish(true);
                else if (stopped())
                    queueMicrotask(() => { void listen(); });
            }
        }
    }
    const onDictation = () => {
        const failure = dictation?.getSnapshot().submissionFailure;
        if (failure && snapshot.status === 'active') {
            session.failSubmission(failure);
            return;
        }
        if (dictation?.getSnapshot().status === 'listening') {
            reachedListening = true;
            failures = 0;
        }
        if (shouldListen() && !starting && stopped())
            queueMicrotask(() => { if (stopped())
                void listen(); });
    };
    let unsubscribeDictation = dictation?.subscribe(onDictation);
    const unsubscribePlayer = player.subscribe(playback);
    function finish(failed, submissionFailure = snapshot.submissionFailure) {
        if (snapshot.status === 'idle')
            return;
        generation++;
        latest = previous = undefined;
        releaseWakeLock();
        globalThis.document?.removeEventListener('visibilitychange', visibility);
        publish({ status: 'idle', muted: false, failed, submissionFailure });
        if (restoreDictation && !failed) {
            if (dictation && stopped())
                void dictation.start().catch(() => { });
        }
        else
            void dictation?.cancel();
        void player.setBackgroundAudio(false);
        actions(false);
        microphone();
        if (media) {
            media.playbackState = 'none';
            if (setMetadata)
                media.metadata = null;
        }
        setMetadata = false;
        const restore = restoreVoice;
        restoreVoice = undefined;
        restore?.();
    }
    const session = {
        filterRecognition(input, hypothesis) {
            if (!shouldListen() || input !== dictation)
                return hypothesis;
            const text = normalize([hypothesis.committed, hypothesis.tentative].filter(Boolean).join(' '));
            if (!text)
                return hypothesis;
            // Whole-hypothesis token runs only, not incidental overlap or fuzzy speaker detection.
            // Join adjacent sections of the same reply; never invent a span between unrelated messages.
            const reference = previous && latest && previous.messageId === latest.messageId &&
                previous.ordinal !== null && latest.ordinal === previous.ordinal + 1
                ? `${previous.text} ${latest.text}` : undefined;
            if ([latest?.text, previous?.text, reference].some((spoken) => spoken && ` ${spoken} `.includes(` ${text} `)))
                return { committed: '', tentative: '' };
            // Genuine speech never stops playback: the user can listen while talking (BUG-2774 overrule; BUG-2815 adds the setting).
            return hypothesis;
        },
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        async start() {
            if (disposed || snapshot.status === 'active')
                return;
            generation++;
            failures = 0;
            const status = dictation?.getSnapshot().status;
            restoreDictation = status === 'connecting' || status === 'listening';
            publish({ status: 'active', muted: false, failed: false, submissionFailure: undefined });
            rememberPlayback();
            globalThis.document?.addEventListener('visibilitychange', visibility);
            visibility();
            // All three calls happen in the gesture, before the first await.
            const capture = listen();
            const unlock = player.unlock();
            const background = player.setBackgroundAudio(true);
            restoreVoice = options.onVoiceChange?.();
            if (media && options.metadata && typeof MediaMetadata !== 'undefined') {
                media.metadata = new MediaMetadata(options.metadata);
                setMetadata = true;
            }
            actions(true);
            microphone();
            playback();
            await Promise.all([capture, unlock, background]);
        },
        setMuted(muted) {
            if (snapshot.status !== 'active' || snapshot.muted === muted)
                return;
            generation++;
            publish({ muted });
            microphone();
            if (muted)
                void dictation?.cancel();
            else
                void listen();
        },
        setDictation(next) {
            if (next === dictation)
                return;
            unsubscribeDictation?.();
            latest = previous = undefined;
            dictation = next;
            unsubscribeDictation = next?.subscribe(onDictation);
            if (shouldListen())
                void listen();
        },
        end: () => finish(false),
        failSubmission(failure) {
            if (snapshot.status !== 'active')
                return;
            // Capture the outcome before finish cancels a controller or the host unmounts its draft.
            finish(true, failure);
        },
        dispose() {
            finish(false);
            disposed = true;
            unsubscribeDictation?.();
            unsubscribePlayer();
            listeners.clear();
        },
    };
    return session;
}
//# sourceMappingURL=call-session.js.map
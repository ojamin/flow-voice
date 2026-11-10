# Browser dictation host integration

## Microphone and worklet

`createAudioCapture` requests mono audio with echo cancellation, noise suppression,
and automatic gain control. A standalone worklet downmixes render quanta. A streaming
64-tap windowed-sinc low-pass resampler produces the selected PCM16LE rate (including
16kHz and 24kHz) in 80ms frames, with an RMS value per frame. No audio is stored.
`stop()` is idempotent, flushes the last frame, disconnects nodes, closes the audio
context and releases tracks. Aborting or `pagehide` releases tracks too, including
tracks returned by an outstanding permission prompt after cancellation.

Build the browser package before consuming its asset. The npm export
`@flow-voice/browser/worklet` points to `dist/capture/worklet.js`, a standalone ES
module with no imports. **Serve it from the host's origin** with a JavaScript MIME
type. Do not fetch it from a provider or put credentials in its URL.

Vite can own asset emission explicitly (recommended when dependency prebundling):

```ts
import workletUrl from '@flow-voice/browser/worklet?url';
const dictation = createDictationController({ ...options, workletUrl });
```

Alternatively copy that exported asset into your host source's voice directory and
let Vite emit it with a static relative URL:

```ts
const workletUrl = new URL('./flow-voice-worklet.js', import.meta.url);
const dictation = createDictationController({ ...options, workletUrl });
```

The capture default itself uses `new URL('./worklet.js', import.meta.url)`; hosts
whose bundler preserves that module-relative asset can use the default. Verify the
emitted URL returns JavaScript, not the SPA index. Microphone access requires HTTPS
(or localhost), and a `Permissions-Policy` that admits the host's microphone.

Use a same-origin asset with `script-src 'self'`. Hosts may explicitly provide
`inlineWorklet: { source, cspAllowsBlob: true }` to `createAudioCapture` if their
`script-src` admits `blob:`. This fallback is attempted only after module loading
fails and the host has opted in; its temporary Blob URL is always revoked. A custom
`capture` factory can supply this option to a controller. No eval fallback exists.
Permission denial maps to `unauthorized`, missing microphone/insecure context to
`unsupported`, with safe actionable messages rather than device diagnostics.

## Controller and transport

`createDictationController({ composer, transport, audio, capture?, autoSend?, stopAfterSend?,
language?, workletUrl?, playbackGate?, beforeCapture?, maxSessionMs?,
connectionTimeoutMs?, finalizationMs? })` owns one active session. Its stable
`getSnapshot`/`subscribe` store reports idle, connecting, listening, finalizing and
error states, transcript, RMS, countdown and a structured error. Call `dispose()`
on owner teardown. `cancel()` removes tentative words only; failure keeps the
visible partial. `finish()` flushes audio, waits for the complete final/ended and
rejects on finalization failure so normal Send cannot read an incomplete draft.
Default session duration is unlimited; connection/finalization limits are 10s/10s.

Call bindings filter each complete recognized hypothesis before composer updates or
keyword admission. Accepted nonempty speech does NOT stop or pause a playing/loading
reply: the user can keep listening while talking (BUG-2774; a pause/stop setting
follows in BUG-2815); existing dictation pause/finalization admission sends the
preserved utterance. RMS alone does not interrupt.
Independent call inputs must wire `filterRecognition: text => call.filterRecognition(input, text)`.
Ordinary dictation has no filter by default.

The call rejects normalized whole-token contiguous runs of the latest or immediately
previous actually played section, including their boundary only for consecutive ordinals
of the same reply. There is no minimum run length: the entire hypothesis must match;
incidental shared words in a distinct phrase do not suffice. References survive stop,
completion and dictation restart, and clear on call end/dispose/input rebind. Loading
text is not recorded as emitted. This deterministic text guard can suppress deliberate
verbatim repetition (including short phrases); it is not acoustic speaker detection
and does not cover arbitrary ASR substitutions, noncontiguous words or older echo.

`stopAfterSend` defaults to true. Set it to false to listen into a new empty draft
after successful Send; release the submission binding only after clearing that draft.
Invalidation still stops capture, and submission failure retains the finalized text.

`playbackGate: { stop, isPlaying }` is injected: stop is awaited before microphone
acquisition and acquisition is refused if playback still reports playing. Existing
hosts can retain the synchronous `beforeCapture()` seam. The player must separately
call/await dictation.finish or cancel before playback starts (half duplex).

`createWebSocketDictationTransport({ url, protocols?, maxBufferedBytes? })` sends
core-codec JSON controls and raw binary PCM. It validates incoming protocol
messages and fails rather than dropping frames when the bounded socket buffer is
full (320kB default). Authentication belongs to the host, e.g. same-origin session
cookies; no provider API key reaches this helper. Custom transports (socket.io,
WebTransport, etc.) implement the seam's `DictationTransport`: connect installs
callbacks and honors the abort signal; send resolves on admission/backpressure;
close detaches listeners and releases the connection. **Reuse must not deliver old
session events to the next connect.** The controller also bounds pending PCM to
320kB and aborts failed or timed-out sessions.

## Composer safety, Send and navigation

The composer owns a single insertion transaction captured at begin, NOT the latest
caret. `update({ committed, tentative })` replaces only that owned insertion;
wire finals are complete-session text, never append deltas. Ignore programmatic
transcript writes when reporting user activity. The controller ignores stale
revisioned partials and late events from closed sessions.

`createTextareaComposerAdapter({ element, canSubmit, submit, onValueChange? })` is a
reference implementation for native textareas. It maps edits before/after the
insertion and preserves the current selection. An edit inside speech-owned text
transfers that rendered prefix to the user; subsequent words are appended without
replacing the correction. The original selected text is restored if cancelled
before any committed words. For rich editors, use their native mapped ranges and
implement the same transaction boundary instead of modifying DOM directly.

`createEditorComposerAdapter(port)` shares the range/submission ownership rules.
An optional `setTentative({ draft, at, text } | null)` renders interim words outside
the document; only committed words then enter the draft. Draft change callbacks
may supply `{ edits, replaced? }`: edits are sequential, each in its own pre-edit
text coordinates. Report whole replacements explicitly, even if text is identical.
Call `dispose()` to detach the port subscription and clear tentative presentation.
For TipTap, use `createTiptapComposerAdapter` from `@flow-voice/browser/tiptap`:
it supplies mapped text offsets and decoration widgets without altering history.

Route **manual Send** through `adapter.submit()` (or your own normal submit owner
that awaits `SubmissionBinding.finish()`). It reads the draft only after final
transcription, then follows the ordinary host submit path. The callback supplied
to the textarea adapter must be the underlying submit, not adapter.submit itself.
`canSubmit` must include all normal host disabled/upload/pending/permission checks.
The SDK adapters honor the optional admission guard returned by
`SubmissionBinding.finish()`. Custom submit owners must retain that result through
all editor/host settling and call it **synchronously immediately before** starting
the underlying host request. For example, within the existing bound submit owner:

```ts
const admit = await pending.finish();
await editorSettled(); // all settling/preparation awaits belong before admission
if (admit && !admit()) return; // retired attempt: no request, release, or failure
await normalHostSubmit(); // start directly; do not finish dictation again here
pending.release();
```

A missing guard preserves legacy bindings. A false guard is a normal retirement,
not a submission failure. It lets interrupted automatic finalization return to the
controller's existing capture/rearm path; manual Send can still take over. Once a
guard admits a request, later activity does not revoke it. A custom composer that
ignores the guard cannot guarantee postponement during its asynchronous preparation.
`finishSubmission()` performs the SDK editor's settling/admission for external Send
buttons; start the request directly after its true result, with no further settling.

Use `release()` after successful manual submission. Call `invalidate()` **before**
replacing the draft, switching conversation or navigating; it stops without touching
the replacement draft. Dispose the textarea adapter when its element is removed.

Auto-send defaults off. Enable with `{ enabled: true, silenceMs, keyword? }`.
Pause-send waits the full `silenceMs` since the last frame with RMS above 0.025.
Actual capture frames update its countdown and trigger sending; absent frames alone
never send. Stale/repeated transcript text and short breaths do not force sending;
steady speech/noise defers it. Nonempty text shows a cancellable countdown; on expiry
the controller finishes, rechecks canSubmit, and submits once. Rejection (or lost
submission admission after finalization) retains the draft and publishes a terminal
`submissionFailure: { transcript, error }`; a bound call ends without recapturing.
Custom send flows must reject failures or explicitly report them to
`call.failSubmission({ transcript, error })`, not silently resolve an early return. A trailing committed
keyword uses the core normalization/strip helper and finishes immediately; a
keyword-only transcript never submits. Typing, any composer keydown, manual Send,
`notifyUserActivity()` or `cancelAutoSend()` cancels auto-send for that session,
including during finalization. Custom composer adapters should implement
`subscribeUserActivity`, or hosts MUST call `notifyUserActivity` on input/keypress.
Never synthesize Enter or bypass the host's normal submission owner.

## React

`useDictation(controller)` uses `useSyncExternalStore`; it does not own/dispose the
controller or acquire audio on mount. `MicButton` is unstyled and uses a native
button, aria-pressed, a polite live status, disabled finalization state, optional
labelled level meter and a visible native countdown-cancel button. `className`,
`statusClassName`, snapshot children and `renderStatus` let hosts apply existing
primitives/tokens. Native controls retain keyboard/focus behavior; hosts must not
remove visible focus or make state text inaccessible. There is no animation and
no reduced-motion exception is required.

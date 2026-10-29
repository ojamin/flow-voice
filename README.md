# flow-voice

Provider-independent live speech-to-text and streaming text-to-speech primitives
for Node and browser applications. No browser speech engine, recording storage or
provider credentials in the browser. MIT licensed; see LICENSE and NOTICE.

## Packages

| Package | Responsibilities |
| --- | --- |
| `@flow-voice/core` | Types, validated binary/JSON protocol, markdown speech projection, section extraction and auto-send decisions |
| `@flow-voice/server` | Native fetch/WebSocket provider adapters, bounded transcription runner, incremental synthesis and cancellation |
| `@flow-voice/browser` | Microphone capture/worklet, dictation, composer binding, playback and future-message auto-reader |
| `@flow-voice/react` | Store hooks and unstyled accessible dictation/playback controls |

## Providers and capabilities

| Provider id | Live transcription | Streaming synthesis |
| --- | --- | --- |
| `openai` | Yes, mono PCM16 24kHz | Yes, PCM16 24kHz mono, MP3, Ogg Opus |
| `deepgram` | Yes | Yes |
| `elevenlabs` | Yes | Yes |
| `assemblyai` | Yes | No |
| `cartesia` | No | Yes |
| `moss-compat` | Yes, mono PCM16 16kHz | Yes, PCM16 48kHz stereo |

Use `createAdapters({ provider, apiKey })` on the server, optionally setting
`baseUrl` and `model`. Resolve
one endpoint per speech kind and inspect the returned adapter's `capabilities`
for supported formats/options. Unknown provider ids fail closed; unsupported kinds
are absent, never silently substituted. Custom HTTP(S) base URLs preserve their
path prefix. `@flow-voice/server/testing` provides in-memory fixtures only.

OpenAI defaults to `gpt-live-transcribe` and `gpt-4o-mini-tts`. Cartesia defaults to `sonic-3` and ElevenLabs
synthesis to `eleven_flash_v2_5` when no model is given. Committed-turn STT
models may emit deltas only after stop. The HTTP speech models are currently
marked deprecated by OpenAI, with shutdown January 6, 2027; migrate explicitly
before then. Provider/model availability can change independently of this library.

### Voice discovery

- **OpenAI:** the official endpoint has no catalog API. `tts-1`/`tts-1-hd`
  list nine supported voices; `gpt-4o-mini-tts` and unknown/newer models list
  all thirteen. `alloy` remains the default (OpenAI recommends `marin`/`cedar`
  for best quality on supported models). Synthesis validates this model-specific list.
  Custom endpoints try `GET {baseUrl}/audio/voices` with a four-second timeout,
  accepting a bare array or `{voices: [...]}` of strings or objects with
  `id`, `name` or `voice`. Discovery failure returns the built-in suggestions;
  custom voice ids always pass through to synthesis without local rejection.
- **Deepgram:** `GET /v1/models` lists live `tts` entries by `canonical_name`.
  The configured Aura model is the default, otherwise `aura-2-thalia-en`;
  an explicit synthesis voice overrides it. Discovery errors propagate as
  normalized provider errors, never a partial built-in catalog.
- **ElevenLabs:** lists the account's live `/v1/voices` catalog.
- **Cartesia:** lists the live `/voices` catalog with bounded pagination.
- **MOSS-compat:** discovers voices and the default from `/health`.
- **AssemblyAI:** transcription only; no synthesis voice catalog.

All discovery paths preserve the endpoint prefix. Lists mark at most one
`isDefault`. Hosts own catalog caching and can use `resolveVoice` from
`@flow-voice/server`: it selects a listed requested id, then a listed configured
id, then `isDefault`, then the first entry. With an empty list it passes through
the requested/configured id (or returns `undefined`). For custom endpoints whose
catalog is only suggestions, hosts may instead pass an explicit id directly.

### OpenAI-compatible REST dictation

Set `options: { sttTransport: 'rest' }` for services offering
`POST /audio/transcriptions` but not realtime WebSockets. Both transports accept
raw PCM16 mono at 24 kHz. REST sends a WAV multipart `file`, configured `model`,
optional session `language`, and `response_format=json`, preserving the `baseUrl`
path prefix (for example `https://speech.example/api/v1`). Select a transcription
model supported by your service; REST defaults to `whisper-1` if model is empty.

The default remains `sttTransport: 'realtime'` for compatibility. A realtime
handshake rejected with HTTP 404, 405 or 426 automatically switches to REST,
but only before protocol readiness and before any audio is sent upstream. Other
failures do not retry or switch transports. Specify REST explicitly for known
REST-only endpoints to avoid the failed handshake. REST capabilities report
`interim: false` (also after a fallback); it does not generate tentative words.

REST splits at 600 ms of quiet after speech (20 ms RMS windows, threshold 500
in PCM16 amplitude units), or at 12 seconds, and flushes on `end()`. Results
commit in order, with one space between chunks unless the next text starts with
punctuation. Each completed chunk updates the full committed/empty-tentative
partial through the server runner. One request runs at a time, with at most
36 seconds of accepted PCM buffered including the active request. Overflow fails
closed rather than dropping speech. Responses are limited to 64 KiB and total
transcript length to 32000 UTF-16 units. `options.sttRequestTimeoutMs` defaults
to 10000 (integer range 1–120000); cancellation aborts the request. The server
runner additionally caps total stop finalization at ten seconds, including any
queued chunks. Longer request timeouts are useful only with a direct adapter host
that supplies its own bounded finalization lifecycle.

MOSS-compat speaks the author's speech gateway protocol: WebSocket
`/v1/realtime/transcriptions`, voice discovery at `/health`, and streaming TTS at
`/v1/audio/speech/stream`. Its default model is `moss-tts-local-v1.5-q8_0-vulkan`;
TTS supports speed 1 and at most 2000 UTF-16 code units per request. Split longer
prose at section boundaries. See NOTICE for provenance.

## Install prebuilt v0.3.0

Use Node >=22 and pnpm 12.3.4. Tagged releases contain committed ESM, declarations
and the worklet: no registry publication or install-time build is required.

```json
{
  "dependencies": {
    "@flow-voice/core": "github:ojamin/flow-voice#v0.3.0&path:/packages/core",
    "@flow-voice/browser": "github:ojamin/flow-voice#v0.3.0&path:/packages/browser",
    "@flow-voice/server": "github:ojamin/flow-voice#v0.3.0&path:/packages/server",
    "@flow-voice/react": "github:ojamin/flow-voice#v0.3.0&path:/packages/react",
    "react": "^19.0.0"
  }
}
```

List **all needed @flow-voice packages directly**, including sibling peers:
browser and server require core; react requires browser and therefore core, plus
React 19. Server is unnecessary for browser-only consumers. Sibling requirements
are exact Git **peer** dependencies: pnpm's default `blockExoticSubdeps: true`
rejects transitive Git dependencies. Keep that supply-chain policy enabled; no
consumer `allowBuilds` exception is needed. Commit the consumer lockfile and use
`pnpm install --frozen-lockfile` thereafter. Normal imports resolve to `dist`.

## Host integration

Hosts own authentication, authorization, origin and endpoint policy, credentials,
transport, quotas, durable configuration and message/draft lifecycle. Keep API
keys server-side. Authenticate before admitting a socket and keep authorization
valid through terminal delivery. Cancel active sessions on disconnect/sign-out.
Speech frames are ephemeral: do not persist or replay them.

### Plain WebSocket host

Mount a `ws` socket after your application's authenticated upgrade and origin
checks. The browser connects with
`createWebSocketDictationTransport({ url: 'wss://app.example/speech' })`.
Controls are version-1 JSON; audio is raw mono PCM16 binary, not WAV or base64.

```ts
import { decodeSttClientMessage } from '@flow-voice/core';
import { createLiveTranscriptionSession } from '@flow-voice/server';

// Called only after authentication, policy checks and admission.
function admittedSocket(ws, adapter, authorizationSignal) {
  const abort = new AbortController();
  const session = createLiveTranscriptionSession({
    adapter,
    signal: AbortSignal.any([authorizationSignal, abort.signal]),
    send: (message) => new Promise((resolve, reject) => {
      ws.send(JSON.stringify(message), (error) => error ? reject(error) : resolve());
    }),
  });
  ws.on('message', (bytes, binary) => {
    try {
      const input = binary ? new Uint8Array(bytes) : bytes.toString();
      void session.receive(decodeSttClientMessage(input)).catch(() => session.cancel());
    } catch {
      void session.cancel();
    }
  });
  ws.once('close', () => abort.abort());
  ws.once('error', () => abort.abort());
  return session.done;
}
```

`receive` resolves on bounded admission, not recognition; await backpressure.
`done` settles after terminal delivery and upstream cleanup. Host sends must
settle even on transport failure. `partial` replaces the full committed/tentative
pair; `final.text` is the complete transcript and `ended` terminates the session.

### Browser and React

Bind a selection-safe composer transaction and route manual Send through its
submission binding. `finish()` waits for final transcription; `invalidate()` must
run before replacing a draft or navigating. Dispose controllers on teardown.
See [the dictation guide](packages/browser/src/dictation/README.md) in the source
tree for textarea binding, transport and capture options.

```tsx
import { useDictation, MicButton } from '@flow-voice/react';

// The host creates and disposes the controller; mounting does not acquire audio.
export function Dictation({ controller }) {
  const state = useDictation(controller);
  return <section>
    <MicButton controller={controller} />
    <p>{state.committed}{state.tentative}</p>
  </section>;
}
```

Serve `@flow-voice/browser/worklet` as a JavaScript asset and pass its URL as
`workletUrl`; do not import it into the page's main realm. Microphone capture
requires a secure context and microphone permission. Serve the worklet same-origin
under a matching CSP. Capture and playback may run together: capture requests echo
cancellation, and `playbackGate`/`gate` remain available for hosts that want half
duplex. Auto-send and auto-read default off. `autoSend.afterPause: false` sends only on
the keyword, with no silence countdown.

`player.setBackgroundAudio(true)`, called inside a user gesture, plays PCM through one
continuously running media element. Mobile browsers then treat the page like a call
or media player: it keeps running with the screen off or another app in front, and the
host's Media Session metadata and actions appear in the system controls. Seed an auto-reader with
existing messages, admit only future non-own live messages, and stop it on navigation.

## Speech markup: only `<tts>`

`displayMarkdown` unwraps valid `<tts>…</tts>` tags while keeping **all text
visible**. `speechSections` reads only tagged spans when present, otherwise
speech-safe markdown. No other speech tag is interpreted. Code remains literal.
Malformed, nested or unclosed tags reject interpretation for the whole document
and remain literal in display. Streaming extraction emits only closed tagged
sections before final; untagged prose waits for final. A malformed later suffix
cannot retract audio already played: stop playback on malformed input.

## Limits and security

Dictation has no session limit and messages are read whole: the player queues every
section by default. Hosts may still set `maxSessionMs`, `maxTextChars` (section
extraction) and `maxQueuedSections`. Each synthesis request is limited to 4000 text
characters; sections stay far below it. Text limits count UTF-16 code units. Controller connection and
finalization timeouts default to ten seconds. Bounded audio queues fail rather
than silently dropping accepted samples. Duration limits flush before ending;
finalization timeout aborts upstream. Synthesis cancellation aborts the request.

Fetch and WebSocket redirects are refused: credentials and audio never follow
redirects. **Hosts own URL policy**, including allowed destinations, schemes,
metadata addresses and network egress restrictions. These adapters do **not** pin
DNS resolution or prevent DNS rebinding. Apply policy at the host/network boundary.
Catalog responses are bounded (1 MiB, 1000 voices, ten Cartesia pages; gateway
discovery 64 KiB). There are no automatic retries; only the pre-audio OpenAI
handshake fallback described above. Avoid logging
credentials, transcripts, audio or sensitive endpoint URLs.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
node --test scripts/release.test.mjs
```

Builds run dependency-first and emit ESM/declarations with tsc-rs. Workspace tests
and checking select sources using `flow-voice:source`; release exports omit that
condition. Normal consumers need no custom condition. Tests use deterministic
fixtures and loopback servers, not paid provider requests.

Optional billable smoke tests are explicit: after building, run
`node packages/server/dist/smoke.js`. Supply `OPENAI_API_KEY`, or
`FLOW_VOICE_SMOKE_API_KEY` with `FLOW_VOICE_SMOKE_PROVIDER=openai|moss-compat`.
Optional settings are `FLOW_VOICE_SMOKE_BASE_URL`, `FLOW_VOICE_SMOKE_TTS_MODEL`,
`FLOW_VOICE_SMOKE_STT_MODEL`, `FLOW_VOICE_SMOKE_VOICE` and `FLOW_VOICE_SMOKE_PCM`
(a raw mono PCM16 fixture at the provider rate). No key means skipped.

## Prepare a release

From a clean, verified source commit:

```sh
node scripts/release.mjs ../flow-voice-v0.3.0-tree
```

The script cleans/builds all packages and writes a new external directory, refusing
existing output. It copies README, MIT LICENSE, NOTICE, release manifests and
`dist` (including the worklet); every package includes LICENSE and NOTICE. Scripts,
devDependencies and source exports are omitted. Repeated builds using the same
source/toolchain produce identical trees with no generated timestamps.

Create a release commit whose parent is the source commit and whose tree is exactly
that output, with subject `Release v0.3.0`. Tag it with annotated tag `v0.3.0` and
message `flow-voice v0.3.0`. Keep main on the source commit and the release branch
on the prebuilt commit. Before publishing, install all four packages into a fresh
consumer with default pnpm supply-chain policy, check dist imports and load the
worklet in an AudioWorklet context. Never move a published tag; use a new version.

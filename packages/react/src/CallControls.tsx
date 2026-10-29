import { useEffect, useRef, useState } from 'react';
import type { CallSession } from '@flow-voice/browser';
import { useCallSession } from './voice.js';
import type { SpeechControlAppearance } from './controls.js';
export interface CallControlsProps extends SpeechControlAppearance {
  call: CallSession;
  disabled?: boolean;
  labels?: { call?: string; mute?: string; unmute?: string; end?: string };
}
export function CallControls({ call, disabled, labels, slots, className }: CallControlsProps) {
  const state = useCallSession(call);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const starting = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    starting.current = false;
    setPending(false);
    setError('');
    return () => {
      generation.current++;
    };
  }, [call]);
  const Button = slots?.Button ?? 'button';
  return (
    <div
      className={className}
      data-flow-voice-call=""
      aria-busy={pending}
      role="group"
      aria-label="Call controls"
    >
      <Button
        data-flow-voice-action="call"
        type="button"
        disabled={disabled || pending || state.status === 'active'}
        aria-pressed={state.status === 'active'}
        onClick={() => {
          if (starting.current) return;
          starting.current = true;
          setPending(true);
          setError('');
          const attempt = ++generation.current;
          void (async () => {
            try {
              await call.start();
            } catch {
              if (attempt === generation.current) {
                call.end();
                setError(
                  'Could not start the call. Check microphone and audio access, then try again.',
                );
              }
            } finally {
              if (attempt === generation.current) {
                starting.current = false;
                setPending(false);
              }
            }
          })();
        }}
      >
        {pending ? 'Starting call…' : (labels?.call ?? 'Call')}
      </Button>
      {state.status === 'active' && (
        <>
          <Button
            data-flow-voice-action={state.muted ? 'unmute' : 'mute'}
            type="button"
            disabled={pending || (disabled && state.muted)}
            aria-pressed={state.muted}
            onClick={() => call.setMuted(!state.muted)}
          >
            {state.muted ? (labels?.unmute ?? 'Unmute') : (labels?.mute ?? 'Mute')}
          </Button>
          <Button
            data-flow-voice-action="end-call"
            type="button"
            disabled={false}
            onClick={() => {
              generation.current++;
              starting.current = false;
              setPending(false);
              call.end();
              setError('');
            }}
          >
            {labels?.end ?? 'End call'}
          </Button>
        </>
      )}
      {(error || state.failed) && (
        <span role="alert">
          {error ||
            'The call ended after repeated microphone or speech service failures. Try again.'}
        </span>
      )}
    </div>
  );
}

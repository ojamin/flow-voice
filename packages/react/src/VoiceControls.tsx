import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { SpeechPlayer, VoiceMode } from '@flow-voice/browser';
import { useVoiceMode } from './voice.js';
import { errorMessage } from './controls.js';
import type { SpeechControlAppearance } from './controls.js';
import { VoiceSelect } from './VoiceSelect.js';
import type { VoiceSelectProps } from './VoiceSelect.js';
export interface VoiceControlsProps extends SpeechControlAppearance {
  mode: VoiceMode;
  player: SpeechPlayer;
  conversation: string | null;
  voice: VoiceSelectProps;
  disabled?: boolean;
  labels?: { voice?: string; options?: string; oneChat?: string; onScreen?: string };
  renderOptions?(props: {
    triggerProps: ButtonHTMLAttributes<HTMLButtonElement>;
    content: ReactNode;
    open: boolean;
    onOpenChange(open: boolean): void;
  }): ReactNode;
}
export function VoiceControls({
  mode,
  player,
  conversation,
  voice,
  disabled,
  labels,
  slots,
  className,
  renderOptions,
}: VoiceControlsProps) {
  const state = useVoiceMode(mode);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setOpen(false);
    setError('');
    return () => {
      generation.current++;
    };
  }, [conversation, mode, player]);
  const Button = slots?.Button ?? 'button';
  const Input = slots?.Input ?? 'input';
  const unavailable = disabled || conversation === null;
  const on = state.enabled && (state.scope === 'on-screen' || state.chatId === conversation);
  const content = (
    <div id={id} data-flow-voice-options="">
      <fieldset disabled={unavailable}>
        <legend>Voice scope</legend>
        {(['one-chat', 'on-screen'] as const).map((scope) => (
          <label key={scope}>
            <Input
              type="radio"
              name={`${id}-scope`}
              value={scope}
              checked={state.scope === scope}
              onChange={() => mode.setScope(scope)}
            />
            {scope === 'one-chat'
              ? (labels?.oneChat ?? 'One chat')
              : (labels?.onScreen ?? 'Chat on screen')}
          </label>
        ))}
      </fieldset>
      <VoiceSelect
        {...voice}
        slots={voice.slots ?? slots}
        disabled={unavailable || voice.disabled}
        defaultLabel={voice.defaultLabel ?? 'Account default'}
      />
    </div>
  );
  const triggerProps: ButtonHTMLAttributes<HTMLButtonElement> & {
    'data-flow-voice-action': string;
  } = {
    'data-flow-voice-action': 'voice-options',
    type: 'button',
    disabled: unavailable,
    'aria-label': labels?.options ?? 'Voice options',
    'aria-expanded': open,
    'aria-controls': id,
    onClick: () => setOpen(!open),
    children: labels?.options ?? 'Voice options',
  };
  return (
    <div className={className} data-flow-voice-controls="" data-flow-voice-active={on}>
      <Button
        data-flow-voice-action="voice"
        type="button"
        disabled={unavailable}
        aria-pressed={on}
        onClick={() => {
          if (conversation === null) return;
          setError('');
          const attempt = ++generation.current;
          void player.unlock().catch((error) => {
            if (attempt === generation.current) setError(errorMessage(error));
          });
          mode.toggle(conversation);
        }}
      >
        {labels?.voice ?? 'Voice'}
      </Button>
      {renderOptions ? (
        renderOptions({ triggerProps, content, open, onOpenChange: setOpen })
      ) : (
        <>
          <Button {...triggerProps} ref={trigger} />
          {open && (
            <div
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  trigger.current?.focus();
                }
              }}
            >
              {content}
            </div>
          )}
        </>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

import { useId } from 'react';
import { Field } from './controls.js';
import type { SpeechControlAppearance } from './controls.js';
import { voiceOptions } from './voice-options.js';
import type { VoiceChoiceState } from './voice-options.js';
export type { VoiceChoiceState } from './voice-options.js';
export interface VoiceSelectProps extends SpeechControlAppearance {
  value?: string;
  onChange(voice: string | undefined): void;
  choices: VoiceChoiceState;
  disabled?: boolean;
  defaultLabel?: string;
  label?: string;
}
export function VoiceSelect({
  value,
  onChange,
  choices,
  disabled,
  defaultLabel = 'Provider default',
  label = 'Voice',
  slots,
  className,
}: VoiceSelectProps) {
  const id = useId();
  const Select = slots?.Select ?? 'select';
  const Button = slots?.Button ?? 'button';
  const Wrapper = slots?.Field ?? Field;
  return (
    <div className={className} data-flow-voice-select="">
      <Wrapper id={id} label={label}>
        <Select
          id={id}
          value={value ?? ''}
          disabled={disabled}
          aria-describedby={`${id}-status`}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          {voiceOptions(value, choices, defaultLabel).map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
      </Wrapper>
      <span id={`${id}-status`} role="status">
        {choices.status === 'loading'
          ? 'Loading voices…'
          : choices.status === 'error'
            ? 'Could not load voices.'
            : choices.voices.length === 0
              ? 'No voices available.'
              : ''}
      </span>
      {choices.status === 'error' && choices.retry && (
        <Button
          type="button"
          data-flow-voice-action="retry-voices"
          disabled={disabled}
          onClick={choices.retry}
        >
          Retry voices
        </Button>
      )}
    </div>
  );
}

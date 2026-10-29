import type { SpeechPlayer, SpeechPlayerSnapshot } from '@flow-voice/browser';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { SpeechControlSlots } from './controls.js';
export type { SpeechControlSlots, SpeechControlAppearance } from './controls.js';
export { VoiceSelect, type VoiceSelectProps, type VoiceChoiceState } from './VoiceSelect.js';
export { VoiceControls, type VoiceControlsProps } from './VoiceControls.js';
export { CallControls, type CallControlsProps } from './CallControls.js';
export { SpeechPreferencesForm, type SpeechPreferencesFormProps } from './SpeechPreferencesForm.js';
export { SpeechEndpointForm, type SpeechEndpointFormProps } from './SpeechEndpointForm.js';
/** Hooks subscribe to host-owned stores; controller/player lifecycle is owned by the host. */
export { useSpeechPlayer, useAutoRead, PlayerControls, ReadAloudButton } from './playback.js';
export { useDictation } from './dictation.js';
export { useComposerSpeech } from './composer-speech.js';
export { useCallSession, useDictationPreference, useVoiceMode, useVoicePreference } from './voice.js';
export { MicButton, type MicButtonProps } from './MicButton.js';
export interface PlayerControlsProps {
  player: SpeechPlayer;
  className?: string;
  slots?: SpeechControlSlots;
  hideWhenIdle?: boolean;
  disabled?: boolean;
  labels?: { pause?: string; resume?: string; skipSection?: string; skipReply?: string; stop?: string; enableAudio?: string };
  /** Advanced compatibility escape hatch. Prefer slots to retain derived behavior. */
  children?(snapshot: SpeechPlayerSnapshot, player: SpeechPlayer): ReactNode;
}
export interface ReadAloudButtonProps {
  onRead(): void;
  player?: SpeechPlayer;
  messageId?: string;
  render?(state: {
    playing: boolean;
    buttonProps: ButtonHTMLAttributes<HTMLButtonElement>;
  }): ReactNode;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}

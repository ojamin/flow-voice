import { useSyncExternalStore } from 'react';
import type { CallSession, CallSessionSnapshot, VoiceMode, VoiceModeSnapshot } from '@flow-voice/browser';

export function useCallSession(session: CallSession): CallSessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
export function useVoiceMode(mode: VoiceMode): VoiceModeSnapshot {
  return useSyncExternalStore(mode.subscribe, mode.getSnapshot, mode.getSnapshot);
}

import { useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { DictationController, DictationSnapshot } from '@flow-voice/browser';
import { useDictation } from './dictation.js';

const sendingIn = (seconds: number) =>
  `Sending in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;

export interface MicButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'onClick'
> {
  controller: DictationController;
  children?: ReactNode | ((snapshot: DictationSnapshot) => ReactNode);
  renderStatus?(snapshot: DictationSnapshot): ReactNode;
  showLevel?: boolean;
  statusClassName?: string;
}

/** Unstyled native controls: hosts supply their button/focus/disabled visual language. */
export function MicButton({
  controller,
  children,
  renderStatus,
  showLevel = false,
  statusClassName,
  disabled,
  ...props
}: MicButtonProps): ReactNode {
  const snapshot = useDictation(controller);
  const id = useId();
  const active = snapshot.status === 'listening' || snapshot.status === 'connecting';
  const busy = snapshot.status === 'connecting' || snapshot.status === 'finalizing';
  const label =
    snapshot.status === 'listening'
      ? 'Stop dictation'
      : snapshot.status === 'connecting'
        ? 'Cancel dictation'
        : snapshot.status === 'finalizing'
          ? 'Finishing dictation'
          : 'Start dictation';
  const status =
    snapshot.error?.message ??
    (snapshot.status === 'listening'
      ? 'Listening'
      : snapshot.status === 'connecting'
        ? 'Connecting microphone'
        : snapshot.status === 'finalizing'
          ? 'Finishing transcription'
          : 'Microphone off');
  const activate = () => {
    const action =
      snapshot.status === 'connecting'
        ? controller.cancel()
        : snapshot.status === 'listening'
          ? controller.finish()
          : controller.start();
    void action.catch(() => {}); // The external store exposes the accessible error state.
  };
  return (
    <>
      <button
        {...props}
        type="button"
        aria-label={props['aria-label'] ?? label}
        aria-pressed={active}
        aria-busy={busy}
        aria-describedby={[props['aria-describedby'], id].filter(Boolean).join(' ')}
        disabled={disabled || snapshot.status === 'finalizing'}
        onClick={activate}
      >
        {typeof children === 'function' ? children(snapshot) : (children ?? label)}
      </button>
      <span id={id} role="status" aria-live="polite" className={statusClassName}>
        {renderStatus ? renderStatus(snapshot) : status}
      </span>
      {showLevel && snapshot.status === 'listening' && (
        <meter min={0} max={1} value={snapshot.rms} aria-label="Microphone level" />
      )}
      {snapshot.countdownMs !== null && (
        <span className={statusClassName}>
          <span role="status" aria-live="polite">
            {sendingIn(Math.ceil(snapshot.countdownMs / 1000))}
          </span>{' '}
          <button type="button" onClick={() => controller.cancelAutoSend()}>
            Cancel automatic send
          </button>
        </span>
      )}
    </>
  );
}

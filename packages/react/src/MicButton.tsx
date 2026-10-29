import { useId } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { DictationController, DictationSnapshot } from '@flow-voice/browser';
import { useDictation } from './dictation.js';
import type { SpeechControlSlots } from './controls.js';

const sendingIn = (seconds: number) =>
  `Sending in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;

export interface MicButtonProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'onClick'
> {
  controller: DictationController;
  children?: ReactNode | ((snapshot: DictationSnapshot) => ReactNode);
  renderStatus?(snapshot: DictationSnapshot): ReactNode;
  showLevel?: boolean;
  statusClassName?: string;
  slots?: SpeechControlSlots;
  labels?: { idle?: string; listening?: string; connecting?: string; finalizing?: string };
}

/** Unstyled native controls: hosts supply their button/focus/disabled visual language. */
export function MicButton({
  controller,
  children,
  renderStatus,
  showLevel = false,
  statusClassName,
  disabled,
  slots,
  labels,
  ...props
}: MicButtonProps): ReactNode {
  const snapshot = useDictation(controller);
  const Button = slots?.Button ?? 'button';
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
      ? labels?.listening ?? 'Listening…'
      : snapshot.status === 'connecting'
        ? labels?.connecting ?? 'Connecting microphone…'
        : snapshot.status === 'finalizing'
          ? labels?.finalizing ?? 'Finishing…'
          : labels?.idle ?? '');
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
      <Button
        {...props}
        data-flow-voice-mic=""
        data-flow-voice-action="mic"
        data-flow-voice-state={snapshot.status}
        type="button"
        aria-label={props['aria-label'] ?? label}
        aria-pressed={active}
        aria-busy={busy}
        aria-describedby={[props['aria-describedby'], id].filter(Boolean).join(' ')}
        disabled={disabled || snapshot.status === 'finalizing'}
        onClick={activate}
      >
        {typeof children === 'function' ? children(snapshot) : (children ?? label)}
      </Button>
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
          <Button type="button" data-flow-voice-action="cancel-auto-send" disabled={disabled} onClick={() => controller.cancelAutoSend()}>
            Cancel automatic send
          </Button>
        </span>
      )}
    </>
  );
}

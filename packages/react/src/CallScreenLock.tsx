import { useEffect, useRef, useState } from 'react';
import type { CallSession } from '@flow-voice/browser';
import { useCallSession } from './voice.js';

export interface CallScreenLockProps {
  call: CallSession;
  /** Applied to the entry button, not the modal viewport. */
  className?: string;
}

/** Pocket-safe screen cover, not an OS lock or a guarantee of background recording.
 * Native modal dialog supplies focus containment and makes the rest of the document inert. */
export function CallScreenLock({ call, className }: CallScreenLockProps) {
  const state = useCallSession(call);
  const [locked, setLocked] = useState(false);
  const drag = useRef<{
    id: number; start: number; distance: number; travel: number; thumb: HTMLButtonElement;
  } | null>(null);
  const resetDrag = () => {
    const previous = drag.current;
    drag.current = null;
    if (!previous) return;
    previous.thumb.style.transform = '';
    if (previous.thumb.hasPointerCapture?.(previous.id)) previous.thumb.releasePointerCapture(previous.id);
  };
  useEffect(() => {
    setLocked(false);
    resetDrag();
  }, [call, state.status]);
  if (state.status !== 'active') return null;
  return <>
    <button type="button" className={className} data-flow-voice-action="lock-call-screen"
      onClick={() => setLocked(true)}>Lock call screen</button>
    {locked && <dialog
      aria-label="Call screen locked"
      aria-modal="true"
      data-flow-voice-call-lock=""
      ref={(dialog) => {
        if (!dialog) return;
        dialog.showModal();
        return () => { resetDrag(); dialog.close(); };
      }}
      onCancel={(event) => event.preventDefault()}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDownCapture={(event) => {
        if (!event.isPrimary) resetDrag();
      }}
      style={{
        position: 'fixed', inset: 0, margin: 0, padding: 0, border: 0,
        width: '100vw', height: '100dvh', maxWidth: 'none', maxHeight: 'none',
        background: '#000', color: '#fff', touchAction: 'none', userSelect: 'none',
      }}
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <p>Call continues. Slide to unlock.</p>
        <div style={{ width: 'min(320px, 80vw)', height: 56, borderRadius: 28, background: '#333' }}>
          <button type="button" aria-label="Unlock call screen" autoFocus
            style={{ width: 56, height: 56, borderRadius: '50%', touchAction: 'none' }}
            onPointerDown={(event) => {
              if (!event.isPrimary || event.button !== 0 || drag.current) return;
              event.preventDefault();
              const thumb = event.currentTarget;
              const distance = thumb.parentElement!.getBoundingClientRect().width - thumb.getBoundingClientRect().width;
              if (distance <= 0) return;
              drag.current = { id: event.pointerId, start: event.clientX, distance, travel: 0, thumb };
              thumb.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.id !== event.pointerId) return;
              event.preventDefault();
              const travel = Math.max(0, Math.min(current.distance, event.clientX - current.start));
              current.travel = Math.max(current.travel, travel);
              current.thumb.style.transform = `translateX(${travel}px)`;
            }}
            onPointerUp={(event) => {
              const current = drag.current;
              if (!current || current.id !== event.pointerId) return;
              event.preventDefault();
              const unlock = current.travel >= current.distance * 0.9 &&
                event.clientX - current.start >= current.distance * 0.9;
              resetDrag();
              if (unlock) setLocked(false);
            }}
            onPointerCancel={resetDrag}
            onLostPointerCapture={resetDrag}
            onClick={(event) => {
              // Keyboard and assistive technology activate with detail=0; pointer taps never unlock.
              if (event.detail === 0) setLocked(false);
            }}
          >→</button>
        </div>
        <p>Keyboard or assistive technology: activate “Unlock call screen”.</p>
      </div>
    </dialog>}
  </>;
}

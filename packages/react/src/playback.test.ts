import { describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { SpeechPlayer, SpeechPlayerSnapshot } from '@flow-voice/browser';
import { PlayerControls, ReadAloudButton } from './playback.js';
vi.mock('react', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
function store(status: SpeechPlayerSnapshot['status']): SpeechPlayer {
  return {
    getSnapshot: () => ({
      status,
      messageId: status === 'idle' ? null : 'message',
      sectionOrdinal: 1,
      queuedMessages: status === 'idle' ? 0 : 2,
      error:
        status === 'error' ? { code: 'provider_error', message: 'Speech playback failed' } : null,
    }),
    subscribe: () => () => {},
    setBackgroundAudio: vi.fn(async () => {}),
    unlock: vi.fn(async () => {}),
    enqueue: vi.fn(),
    append: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(async () => {}),
    skipSection: vi.fn(),
    skipToEnd: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
}
type Props = {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  role?: string;
  type?: string;
};
function flatten(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...flatten(node.props.children)];
}
describe('playback controls', () => {
  it('renders labelled native controls with observable progress and wires every action', () => {
    const player = store('playing');
    const elements = flatten(PlayerControls({ player }));
    const buttons = elements.filter((element) => element.type === 'button');
    expect(buttons.map((button) => button.props['aria-label'])).toEqual([
      'Pause speech',
      'Skip section',
      'Skip to end of message',
      'Stop speech',
    ]);
    expect(elements.find((element) => element.props.role === 'status')?.props.children).toContain(
      'section 2',
    );
    buttons.forEach((button) => {
      expect(button.props.type).toBe('button');
      button.props.onClick?.();
    });
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.skipSection).toHaveBeenCalledOnce();
    expect(player.skipToEnd).toHaveBeenCalledOnce();
    expect(player.stop).toHaveBeenCalledOnce();
  });
  it('exposes unlock, resume, disabled empty state, and announced errors', () => {
    const blocked = store('blocked');
    const controls = flatten(PlayerControls({ player: blocked }));
    controls.find((element) => element.props['aria-label'] === 'Enable audio')?.props.onClick?.();
    expect(blocked.unlock).toHaveBeenCalledOnce();
    const paused = store('paused');
    flatten(PlayerControls({ player: paused }))
      .find((element) => element.props['aria-label'] === 'Resume speech')
      ?.props.onClick?.();
    expect(paused.resume).toHaveBeenCalledOnce();
    expect(
      flatten(PlayerControls({ player: store('idle') }))
        .filter((element) => element.type === 'button')
        .every((element) => element.props.disabled),
    ).toBe(true);
    expect(
      flatten(PlayerControls({ player: store('error') })).find(
        (element) => element.props.role === 'alert',
      )?.props.children,
    ).toBe('Speech playback failed');
    const status = flatten(PlayerControls({ player: store('error') })).find(
      (element) => element.props.role === 'status',
    )?.props.children;
    expect(String(status)).toMatch(/^Speech stopped\./);
    expect(String(status)).not.toContain('Reading aloud');
  });
  it('provides a host render path without adding product chrome', () => {
    const children = vi.fn(() => 'host controls');
    const player = store('playing');
    expect(PlayerControls({ player, className: 'host', children })?.props.className).toBe('host');
    expect(children).toHaveBeenCalledWith(player.getSnapshot(), player);
  });
  it('toggles per-message reading to stop and preserves the legacy onRead callback', () => {
    const onRead = vi.fn();
    const player = store('playing');
    const subscribed = ReadAloudButton({ player, messageId: 'message', onRead }) as ReactElement<
      Record<string, unknown>
    >;
    const Component = subscribed.type as (props: unknown) => ReactElement<Props>;
    const button = Component(subscribed.props);
    expect(button.props['aria-pressed']).toBe(true);
    button.props.onClick?.();
    expect(player.stop).toHaveBeenCalledOnce();
    const legacy = ReadAloudButton({ onRead }) as ReactElement<Props>;
    legacy.props.onClick?.();
    expect(onRead).toHaveBeenCalledOnce();
  });
});

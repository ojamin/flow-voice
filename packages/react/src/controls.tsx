import type * as React from 'react';

/** Adapters must forward every native prop and ref to the corresponding DOM element. */
export interface SpeechControlSlots {
  Button?: React.ComponentType<React.ComponentPropsWithRef<'button'>>;
  Input?: React.ComponentType<React.ComponentPropsWithRef<'input'>>;
  Select?: React.ComponentType<React.ComponentPropsWithRef<'select'>>;
  Field?: React.ComponentType<{
    id: string;
    label: string;
    description?: string;
    error?: string;
    children: React.ReactNode;
  }>;
}
export interface SpeechControlAppearance {
  className?: string;
  slots?: SpeechControlSlots;
}
export function Field({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-flow-voice-field="">
      <label htmlFor={id}>{label}</label>
      {children}
      {description && <span id={`${id}-description`}>{description}</span>}
      {error && (
        <span id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.';

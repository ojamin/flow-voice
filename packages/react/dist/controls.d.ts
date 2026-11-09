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
export declare function Field({ id, label, description, error, children, }: {
    id: string;
    label: string;
    description?: string;
    error?: string;
    children: React.ReactNode;
}): React.JSX.Element;
export declare const errorMessage: (error: unknown) => string;

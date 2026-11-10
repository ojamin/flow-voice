export function voiceOptions(value, choices, defaultLabel) {
    const options = [
        { value: '', label: defaultLabel, disabled: false },
        ...choices.voices.map((voice) => ({ value: voice.id, label: voice.name, disabled: false })),
    ];
    if (value && !options.some((option) => option.value === value)) {
        const unavailable = choices.status === 'ready' && choices.voices.length > 0;
        options.push({
            value,
            label: `${value} (${unavailable ? 'not available' : 'saved'})`,
            disabled: unavailable,
        });
    }
    return options;
}
//# sourceMappingURL=voice-options.js.map
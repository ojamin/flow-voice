import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Field({ id, label, description, error, children, }) {
    return (_jsxs("div", { "data-flow-voice-field": "", children: [_jsx("label", { htmlFor: id, children: label }), children, description && _jsx("span", { id: `${id}-description`, children: description }), error && (_jsx("span", { id: `${id}-error`, role: "alert", children: error }))] }));
}
export const errorMessage = (error) => error instanceof Error ? error.message : 'Something went wrong. Try again.';
//# sourceMappingURL=controls.js.map
import MarkdownIt from 'markdown-it';
const markdown = new MarkdownIt({ html: true });
/** Mask block/inline code before recognising tags. Offsets always refer to original markdown. */
function codeMask(source) {
    const chars = source.split('');
    const lines = source.split('\n');
    const offsets = [0];
    for (const line of lines)
        offsets.push(offsets[offsets.length - 1] + line.length + 1);
    for (const token of markdown.parse(source, {})) {
        if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
            for (let i = offsets[token.map[0]]; i < Math.min(source.length, offsets[token.map[1]]); i++)
                chars[i] = ' ';
        }
    }
    let mask = chars.join('');
    const ticks = /`+/g;
    let match;
    while ((match = ticks.exec(mask))) {
        if (isEscaped(source, match.index))
            continue;
        const delimiter = match[0];
        const rest = mask.slice(ticks.lastIndex);
        const close = new RegExp('(?<!`)' + delimiter + '(?!`)', 'g').exec(rest);
        if (!close || /\n\s*\n/.test(rest.slice(0, close.index)))
            continue;
        const end = ticks.lastIndex + close.index + delimiter.length;
        for (let i = match.index; i < end; i++)
            chars[i] = ' ';
        ticks.lastIndex = end;
    }
    mask = chars.join('');
    return mask;
}
function isEscaped(source, index) {
    let slashes = 0;
    while (index > 0 && source[--index] === '\\')
        slashes++;
    return slashes % 2 === 1;
}
/** Exact <tts> grammar, case-sensitive. Nested, unmatched or malformed tts
 * tags reject the whole document's tag interpretation: display remains literal markdown. */
export function parseTts(source) {
    const mask = codeMask(source);
    const tags = /<\/?tts\b[^>]*(?:>|$)/g;
    const spans = [];
    let open;
    for (const tag of mask.matchAll(tags)) {
        if (isEscaped(source, tag.index))
            continue;
        const value = tag[0];
        if (value === '<tts>') {
            if (open)
                return { spans: [], malformed: true };
            open = {
                start: tag.index,
                contentStart: tag.index + value.length,
            };
        }
        else if (value === '</tts>' && open) {
            spans.push({
                ...open,
                contentEnd: tag.index,
                end: tag.index + value.length,
                text: source.slice(open.contentStart, tag.index),
            });
            open = undefined;
        }
        else
            return { spans: [], malformed: true };
    }
    return open ? { spans: [], malformed: true } : { spans, malformed: false };
}
export function displayMarkdown(source) {
    const { spans } = parseTts(source);
    let result = '', position = 0;
    for (const span of spans) {
        result += source.slice(position, span.start) + span.text;
        position = span.end;
    }
    return result + source.slice(position);
}
/** Speech excludes code, images, HTML blocks and tables; link labels and emoji remain. */
export function markdownToSpeech(source) {
    const tokens = markdown.parse(source, {});
    let result = '', tableDepth = 0;
    for (const token of tokens) {
        if (token.type === 'table_open')
            tableDepth++;
        if (token.type === 'table_close') {
            tableDepth--;
            continue;
        }
        if (tableDepth)
            continue;
        if (token.type === 'inline') {
            for (const child of token.children ?? []) {
                if (child.type === 'text')
                    result += child.content;
                if (child.type === 'softbreak' || child.type === 'hardbreak')
                    result += ' ';
            }
        }
        if (token.block && token.nesting === -1)
            result += '\n';
    }
    return result
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ *\n+ */g, '\n')
        .trim();
}
function sectionTexts(texts, options) {
    const cap = options.maxTextChars ?? 4000;
    const size = options.maxSectionChars ?? 500;
    if (!Number.isInteger(cap) || cap < 1 || !Number.isInteger(size) || size < 1)
        throw new RangeError('Section limits must be positive integers');
    let remaining = cap;
    const sections = [];
    for (const text of texts) {
        for (const sentence of text.split(/(?<=[.!?。！？])\s+|\n+/u)) {
            let rest = sentence.trim();
            while (rest && remaining > 0) {
                let end = Math.min(rest.length, size, remaining);
                if (end < rest.length) {
                    const space = rest.lastIndexOf(' ', end);
                    if (space > 0)
                        end = space;
                }
                // Do not split a surrogate pair at a UTF-16 cap/section boundary.
                if (end < rest.length && /[\uD800-\uDBFF]/u.test(rest[end - 1]))
                    end--;
                if (end === 0)
                    break;
                const part = rest.slice(0, end).trim();
                if (part) {
                    sections.push({ ordinal: sections.length, text: part });
                    remaining -= part.length;
                }
                rest = rest.slice(end).trimStart();
            }
        }
    }
    return sections;
}
export function speechSections(source, options = {}) {
    const { spans } = parseTts(source);
    return sectionTexts(spans.length ? spans.map((span) => markdownToSpeech(span.text)) : [markdownToSpeech(source)], options);
}
export function speechText(source, options = {}) {
    return speechSections(source, options)
        .map((section) => section.text)
        .join('\n');
}
export function createStreamingSpeechExtractor(options = {}) {
    let previous = '', emitted = 0, done = false, malformed = false;
    return {
        get malformed() {
            return malformed;
        },
        push(source, final = false) {
            if (done || !source.startsWith(previous))
                throw new Error('Speech source must be append-only and not finalized');
            previous = source;
            let parseSource = source;
            if (!final) {
                const mask = codeMask(source);
                const end = mask.lastIndexOf('</tts>');
                if (end < 0)
                    return [];
                parseSource = source.slice(0, end + 6);
            }
            const parsed = parseTts(parseSource);
            malformed = parsed.malformed;
            if (malformed) {
                done = final;
                return [];
            }
            const all = speechSections(parseSource, options);
            const fresh = all.slice(emitted);
            emitted = all.length;
            done = final;
            return fresh;
        },
    };
}
//# sourceMappingURL=markdown.js.map
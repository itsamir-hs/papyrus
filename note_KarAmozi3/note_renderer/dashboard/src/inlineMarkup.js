// Converts inline Markdown into display HTML for the visual editor and back.
//
// Editing happens on rendered HTML (so the operator never has to type Markdown
// markers) while the document model keeps Markdown as the source of truth.
// Inline LaTeX is replaced by a placeholder token before parsing so `marked`
// can never reinterpret characters such as `_` or `*` inside a formula.

import { marked } from "marked";

// Private-use characters survive marked untouched and cannot occur in notes.
const MATH_TOKEN_START = "\uE000";
const MATH_TOKEN_END = "\uE001";
const INLINE_MATH_PATTERN = /\$[^$\n]+?\$/g;
const MATH_TOKEN_PATTERN = new RegExp(`${MATH_TOKEN_START}(\\d+)${MATH_TOKEN_END}`, "g");

export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/**
 * Render inline Markdown to HTML the operator can edit directly.
 * @param {string} inlineMarkdown
 * @returns {string}
 */
export function renderInlineForEditing(inlineMarkdown) {
    const source = String(inlineMarkdown ?? "");
    const mathSources = [];

    const protectedSource = source.replace(INLINE_MATH_PATTERN, (match) => {
        const tokenIndex = mathSources.length;
        mathSources.push(match);
        return `${MATH_TOKEN_START}${tokenIndex}${MATH_TOKEN_END}`;
    });

    let html;
    try {
        html = marked.parseInline(protectedSource);
    } catch {
        // Never lose content: fall back to escaped plain text.
        html = escapeHtml(protectedSource);
    }

    html = html.replace(MATH_TOKEN_PATTERN, (_, tokenIndex) => {
        const mathSource = mathSources[Number(tokenIndex)] ?? "";
        return `<span class="inlineMathSource">${escapeHtml(mathSource)}</span>`;
    });

    return html;
}

function serializeElementNode(element) {
    const tagName = element.tagName;

    if (tagName === "BR") return "\n";

    if (tagName === "SPAN" && element.classList.contains("inlineMathSource")) {
        return element.textContent;
    }

    const innerContent = serializeChildren(element);

    switch (tagName) {
        case "STRONG":
        case "B":
            return `**${innerContent}**`;
        case "EM":
        case "I":
            return `*${innerContent}*`;
        case "DEL":
        case "S":
            return `~~${innerContent}~~`;
        case "CODE":
            return `\`${innerContent}\``;
        case "A": {
            const href = element.getAttribute("href") || "";
            return `[${innerContent}](${href})`;
        }
        case "IMG": {
            const alt = element.getAttribute("alt") || "";
            const src = element.getAttribute("src") || "";
            return `![${alt}](${src})`;
        }
        case "DIV":
        case "P":
            // Block-level nodes created by pasting become line breaks; their
            // content is kept as inline Markdown so nothing is dropped.
            return `${innerContent}\n`;
        default:
            // Unknown elements (raw HTML from the generator, sup/sub, spans…)
            // are preserved verbatim rather than being flattened away.
            return element.outerHTML;
    }
}

function serializeChildren(element) {
    return Array.from(element.childNodes)
        .map((childNode) => serializeNode(childNode))
        .join("");
}

function serializeNode(node) {
    if (node.nodeType === 3) return node.nodeValue; // TEXT_NODE
    if (node.nodeType === 1) return serializeElementNode(node); // ELEMENT_NODE
    return "";
}

/**
 * Convert an edited contenteditable element back into inline Markdown.
 * @param {Element} container
 * @returns {string}
 */
export function serializeInlineHtml(container) {
    if (!container) return "";
    return serializeChildren(container).replace(/\u00a0/g, " ").trim();
}

/** Plain text of an inline Markdown fragment (used by outline/search labels). */
export function inlineToPlainText(inlineMarkdown) {
    return renderInlineForEditing(inlineMarkdown)
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();
}

/** Extract the inline LaTeX fragments of a text block (for math checks). */
export function extractInlineMath(inlineMarkdown) {
    const source = String(inlineMarkdown ?? "");
    const matches = [];
    let match;

    const pattern = new RegExp(INLINE_MATH_PATTERN.source, "g");
    while ((match = pattern.exec(source)) !== null) {
        matches.push(match[0]);
    }

    return matches;
}


// Switches the editing pane between the visual editor and the raw Markdown
// source of the whole note, keeping the two synchronised safely.

import {
    parseDocument,
    serializeDocument
} from "/dashboard/src/documentModel.js";

import { state } from "./state.js";
import { on, emit } from "./bus.js";
import { currentMarkdown, replaceDocumentFromMarkdown } from "./documentController.js";
import { toast, reportError } from "./ui.js";

let editorSurface = null;
let rawWrap = null;
let rawSource = null;
let toggleLabel = null;

function showSourceView(show) {
    if (rawWrap) rawWrap.hidden = !show;
    if (editorSurface) editorSurface.hidden = show;

    if (toggleLabel) {
        toggleLabel.textContent = show ? "Visual editor" : "Markdown source";
    }
}

/** Switch between the visual editor and the Markdown source view. */
export function setEditorMode(mode) {
    if (mode === state.editorMode) return true;
    if (!rawSource || !editorSurface) return false;

    if (mode === "source") {
        state.editorMode = "source";
        rawSource.value = currentMarkdown();
        showSourceView(true);
        rawSource.focus();
        emit("mode:changed", { mode });
        return true;
    }

    const source = rawSource.value;

    try {
        const parsed = parseDocument(source);
        const roundTrip = serializeDocument(parsed);

        replaceDocumentFromMarkdown(source);

        if (roundTrip !== source) {
            toast(
                "Source applied. Some Markdown was re-serialised while parsing — check the preview.",
                "info"
            );
        }
    } catch (error) {
        reportError(error, "The Markdown could not be parsed:");
        return false;
    }

    state.editorMode = "visual";
    showSourceView(false);
    emit("mode:changed", { mode: "visual" });
    return true;
}

export function toggleEditorMode() {
    return setEditorMode(state.editorMode === "visual" ? "source" : "visual");
}

export function initSourceMode() {
    editorSurface = document.getElementById("editorSurface");
    rawWrap = document.getElementById("rawSourceWrap");
    rawSource = document.getElementById("rawSource");
    toggleLabel = document.getElementById("modeToggleLabel");

    const toggleButton = document.getElementById("modeToggle");
    if (toggleButton) {
        toggleButton.addEventListener("click", () => toggleEditorMode());
    }

    // Undo/redo rewrites the document; keep the source view honest.
    on("document:restored", () => {
        if (state.editorMode === "source" && rawSource) {
            rawSource.value = currentMarkdown();
        }
    });
}

// Find & replace: searches the whole document through the model (so it also
// reaches table cells, list items and box titles) and can replace matches.

import {
    searchDocument,
    replaceMatch,
    replaceAllInDocument
} from "/dashboard/src/documentModel.js";
import { state } from "./state.js";
import { commitChange } from "./documentController.js";
import { navigateToBlock } from "./editorView.js";
import { toast } from "./ui.js";

let dialog = null;
let findInput = null;
let replaceInput = null;
let caseCheckbox = null;
let countElement = null;

let matches = [];
let matchIndex = -1;

function searchOptions() {
    return { caseSensitive: Boolean(caseCheckbox && caseCheckbox.checked) };
}

function updateCount() {
    if (!countElement) return;

    if (!findInput.value) {
        countElement.textContent = "0 results";
        return;
    }

    countElement.textContent =
        matches.length === 0
            ? "No results"
            : `${matchIndex + 1} of ${matches.length}`;
}

function highlightMatch(match) {
    navigateToBlock(match.blockId);
    highlightTextInBlock(match.blockId, findInput.value, searchOptions().caseSensitive);
}

/**
 * Best-effort visible highlight: select the matching text inside the block so
 * the operator can see exactly where the match sits.
 */
function highlightTextInBlock(blockId, query, caseSensitive) {
    if (!query) return;

    const shell = document.querySelector(`.docBlock[data-block-id="${blockId}"]`);
    if (!shell) return;

    const needle = caseSensitive ? query : query.toLowerCase();
    const walker = document.createTreeWalker(shell, NodeFilter.SHOW_TEXT);

    let node;
    while ((node = walker.nextNode())) {
        const haystack = caseSensitive ? node.nodeValue : node.nodeValue.toLowerCase();
        const start = haystack.indexOf(needle);
        if (start === -1) continue;

        try {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + query.length);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        } catch {
            // Selection is cosmetic; navigation already happened.
        }
        return;
    }
}

function runSearch() {
    if (!state.document) return;

    const query = findInput.value;
    matches = query ? searchDocument(state.document, query, searchOptions()) : [];
    matchIndex = matches.length > 0 ? 0 : -1;

    updateCount();

    if (matchIndex >= 0) highlightMatch(matches[matchIndex]);
}

function stepMatch(delta) {
    if (matches.length === 0) {
        runSearch();
        if (matches.length === 0) {
            toast("Nothing found.");
            return;
        }
        return;
    }

    matchIndex = (matchIndex + delta + matches.length) % matches.length;
    updateCount();
    highlightMatch(matches[matchIndex]);
}

function replaceCurrent() {
    if (matchIndex < 0 || matches.length === 0) {
        toast("Nothing to replace.");
        return;
    }

    const match = matches[matchIndex];
    const changed = replaceMatch(state.document, match, replaceInput.value);

    if (changed) {
        commitChange({ immediate: true });
        toast("Replaced 1 match.");
    }

    runSearch();
    updateCount();
}

function replaceEverything() {
    const query = findInput.value;
    if (!query) return;

    const count = replaceAllInDocument(
        state.document,
        query,
        replaceInput.value,
        searchOptions()
    );

    if (count === 0) {
        toast("Nothing found.");
        return;
    }

    commitChange({ immediate: true });
    runSearch();
    updateCount();
    toast(`Replaced ${count} match${count === 1 ? "" : "es"}.`, "success");
}

/** Open the find dialog (optionally with the replace field focused). */
export function openFindDialog(showReplace = false) {
    if (!dialog) return;

    if (!dialog.open) dialog.showModal();

    findInput.focus();
    findInput.select();

    if (showReplace) replaceInput.focus();

    if (findInput.value) runSearch();
}

export function initFindReplaceView() {
    dialog = document.getElementById("findDialog");
    findInput = document.getElementById("findInput");
    replaceInput = document.getElementById("replaceInput");
    caseCheckbox = document.getElementById("findCaseSensitive");
    countElement = document.getElementById("findCount");

    if (!dialog) return;

    document.getElementById("findNextButton").addEventListener("click", () => stepMatch(1));
    document.getElementById("findPreviousButton").addEventListener("click", () => stepMatch(-1));
    document.getElementById("replaceButton").addEventListener("click", replaceCurrent);
    document.getElementById("replaceAllButton").addEventListener("click", replaceEverything);

    findInput.addEventListener("input", runSearch);
    caseCheckbox.addEventListener("change", runSearch);

    document.getElementById("findForm").addEventListener("submit", () => {
        dialog.close();
    });

    findInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) stepMatch(-1);
            else stepMatch(1);
        }
    });
}

// Window/layout manager: lets the operator choose which windows are open.
//
// Three panes can be opened or minimized independently:
//   * the left sidebar (Outline · Images · Review · Issues panels)
//   * the document editor
//   * the live preview
//
// Rules enforced here:
//   * At least one window stays open — minimizing the last open pane is
//     refused with a toast instead of leaving an empty workspace.
//   * Exactly one editing mode is active at a time: the visual editor and the
//     Markdown source replace each other in the same window (modeToggle in the
//     toolbar and the status-bar switcher both drive it).
//   * Pane visibility is remembered in localStorage for the session.

import { toast } from "./ui.js";
import { setEditorMode, getEditorMode } from "./sourceMode.js";
import { on } from "./bus.js";

void on;

const STORAGE_KEY = "dashLayout";

let menu = null;
let layoutButton = null;

const paneConfig = [
    { name: "sidebar", checkboxId: "layoutSidebar", bodyClass: "sidebar_hidden" },
    { name: "editor", checkboxId: "layoutEditor", bodyClass: "editor_hidden" },
    { name: "preview", checkboxId: "layoutPreview", bodyClass: "preview_hidden" }
];

function readStoredLayout() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return null;
        return parsed;
    } catch {
        return null;
    }
}

function persistLayout(visibility) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
    } catch {
        // localStorage can be unavailable (private mode); the layout simply
        // won't be remembered.
    }
}

function openWindows(visibility) {
    return paneConfig.filter((pane) => visibility[pane.name]).map((pane) => pane.name);
}

function applyLayout(visibility) {
    for (const pane of paneConfig) {
        const isOpen = Boolean(visibility[pane.name]);
        document.body.classList.toggle(pane.bodyClass, !isOpen);

        const checkbox = document.getElementById(pane.checkboxId);
        if (checkbox) checkbox.checked = isOpen;
    }
}

function setPane(paneName, isOpen) {
    const visibility = getLayout();
    const currentlyOpen = openWindows(visibility);

    if (!isOpen && currentlyOpen.length <= 1) {
        toast("At least one window must stay open.");
        syncCheckboxes(visibility);
        return false;
    }

    // Minimizing the editor while source mode is active keeps the mode; the
    // sourceMode module keeps its state independent of visibility.
    visibility[paneName] = Boolean(isOpen);
    persistLayout(visibility);
    applyLayout(visibility);
    emitLayoutChanged(visibility);
    return true;
}

function syncCheckboxes(visibility) {
    for (const pane of paneConfig) {
        const checkbox = document.getElementById(pane.checkboxId);
        if (checkbox) checkbox.checked = Boolean(visibility[pane.name]);
    }
}

function emitLayoutChanged(visibility) {
    document.dispatchEvent(
        new CustomEvent("dashboard:layoutChanged", { detail: { visibility } })
    );
}

/** Current pane visibility as { sidebar, editor, preview } booleans. */
export function getLayout() {
    const stored = readStoredLayout();
    return {
        sidebar: stored ? stored.sidebar !== false : true,
        editor: stored ? stored.editor !== false : true,
        preview: stored ? stored.preview === true : false
    };
}

/** Open or minimize one pane ("sidebar" | "editor" | "preview"). */
export function setPaneVisibility(paneName, isOpen) {
    return setPane(paneName, isOpen);
}

/** Restore every pane to its default (sidebar + editor open, preview closed). */
export function resetLayout() {
    const visibility = { sidebar: true, editor: true, preview: false };
    persistLayout(visibility);
    applyLayout(visibility);
    syncCheckboxes(visibility);
    emitLayoutChanged(visibility);
}

/** Toggle between the visual editor and the Markdown source. */
export function toggleEditingMode() {
    return setEditorMode(getEditorMode() === "visual" ? "source" : "visual");
}

export function initLayoutManager() {
    menu = document.getElementById("layoutMenu");
    layoutButton = document.getElementById("layoutButton");

    // Apply the remembered layout before first paint of the panes.
    applyLayout(getLayout());

    if (layoutButton && menu) {
        layoutButton.addEventListener("click", () => {
            const willOpen = menu.hidden;
            menu.hidden = !willOpen;
            layoutButton.setAttribute("aria-expanded", String(willOpen));
        });

        document.addEventListener("click", (event) => {
            if (menu.hidden) return;
            if (menu.contains(event.target) || layoutButton.contains(event.target)) return;
            menu.hidden = true;
            layoutButton.setAttribute("aria-expanded", "false");
        });
    }

    for (const pane of paneConfig) {
        const checkbox = document.getElementById(pane.checkboxId);
        if (!checkbox) continue;
        checkbox.addEventListener("change", () => {
            setPane(pane.name, checkbox.checked);
        });
    }

    // Pane header buttons: toggle their window open/minimized. A minimized
    // pane's button is hidden together with the pane, so toggling never
    // accidentally closes a window the operator meant to open.
    for (const toggle of document.querySelectorAll(".paneToggleButton")) {
        const paneName = toggle.dataset.pane;
        if (!paneName) continue;
        toggle.addEventListener("click", () => setPane(paneName, !getLayout()[paneName]));
    }

    // Floating restore chips for minimized windows.
    for (const chip of document.querySelectorAll(".restoreChip")) {
        chip.addEventListener("click", () => setPane(chip.dataset.pane, true));
    }

    // Mode switcher in the status bar mirrors the toolbar toggle.
    const visualButton = document.getElementById("modeVisualButton");
    const sourceButton = document.getElementById("modeSourceButton");

    const paintModeButtons = () => {
        const mode = getEditorMode();
        if (visualButton) {
            visualButton.classList.toggle("is_active", mode === "visual");
            visualButton.setAttribute("aria-pressed", String(mode === "visual"));
        }
        if (sourceButton) {
            sourceButton.classList.toggle("is_active", mode === "source");
            sourceButton.setAttribute("aria-pressed", String(mode === "source"));
        }
    };

    if (visualButton) {
        visualButton.addEventListener("click", () => {
            setEditorMode("visual");
            paintModeButtons();
        });
    }
    if (sourceButton) {
        sourceButton.addEventListener("click", () => {
            setEditorMode("source");
            paintModeButtons();
        });
    }
    on("mode:changed", paintModeButtons);

    paintModeButtons();
}

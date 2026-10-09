// Boots the real dashboard front-end (the same modules the browser loads)
// inside jsdom, against the real server, and exercises the main interactions.
//
// Run with: npm test   (from Bashligh/note_renderer/dashboard)

import { JSDOM, VirtualConsole } from "jsdom";
import { readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDirectory = path.join(dashboardRoot, "tests", "fixtures");
const fixturePath = "Bashligh/note_renderer/dashboard/tests/fixtures/completeNote.md";

const port = 4613;
const baseUrl = `http://127.0.0.1:${port}`;

let passedTests = 0;

function check(condition, label) {
    if (!condition) {
        throw new Error(`Smoke test failed: ${label}`);
    }
    passedTests += 1;
    console.log(`\u2713 ${label}`);
}

async function waitForServer(attempts = 60) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await fetch(`${baseUrl}/api/health`);
            if (response.ok) return true;
        } catch {
            // not up yet
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs = 8000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) return true;
        await delay(50);
    }
    return predicate();
}

function installBrowserGlobals(window) {
    const names = [
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "Node",
        "NodeFilter",
        "HTMLElement",
        "HTMLInputElement",
        "HTMLTextAreaElement",
        "HTMLSelectElement",
        "Event",
        "CustomEvent",
        "Range",
        "DocumentFragment",
        "FileReader"
    ];

    for (const name of names) {
        try {
            Object.defineProperty(globalThis, name, {
                value: window[name],
                writable: true,
                configurable: true
            });
        } catch {
            // Some hosts expose non-configurable globals; the DOM still works.
        }
    }

    // jsdom does not implement these, and the dashboard only calls them from
    // user interaction — a no-op keeps the smoke test faithful but quiet.
    if (!window.Element.prototype.scrollIntoView) {
        window.Element.prototype.scrollIntoView = () => {};
    }
    if (!window.document.execCommand) {
        window.document.execCommand = () => true;
    }

    const dialogPrototype = window.HTMLDialogElement && window.HTMLDialogElement.prototype;
    if (dialogPrototype && typeof dialogPrototype.showModal !== "function") {
        dialogPrototype.showModal = function showModal() {
            this.setAttribute("open", "");
        };
        dialogPrototype.close = function close() {
            this.removeAttribute("open");
            this.dispatchEvent(new window.Event("close"));
        };
    }
}

async function main() {
    console.log("Running dashboard DOM smoke test...\n");

    const server = spawn(process.execPath, ["server.js"], {
        cwd: dashboardRoot,
        env: { ...process.env, DASHBOARD_PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"]
    });

    let serverLog = "";
    server.stdout.on("data", (chunk) => {
        serverLog += chunk;
    });
    server.stderr.on("data", (chunk) => {
        serverLog += chunk;
    });

    const browserErrors = [];

    try {
        const healthy = await waitForServer();
        check(healthy, "server is ready for the browser test");

        const html = await readFile(path.join(dashboardRoot, "public", "index.html"), "utf8");

        const virtualConsole = new VirtualConsole();
        virtualConsole.on("jsdomError", (error) => {
            const message = String(error && error.message ? error.message : error);
            // Resource loading noise is expected: jsdom does not fetch iframes.
            if (!/Could not load|not implemented/i.test(message)) browserErrors.push(message);
        });

        const dom = new JSDOM(html, {
            url: `${baseUrl}/`,
            pretendToBeVisual: true,
            virtualConsole
        });

        const { window } = dom;
        installBrowserGlobals(window);

        window.addEventListener("error", (event) => {
            browserErrors.push(String(event.message));
        });
        process.on("unhandledRejection", (reason) => {
            browserErrors.push(String(reason));
        });

        // Auto-open the fixture note, exactly like a returning operator.
        window.localStorage.setItem("noteEditingDashboard:lastNote", fixturePath);

        // The dashboard calls fetch with root-relative URLs, which Node needs
        // absolute URLs for.
        const nativeFetch = globalThis.fetch;
        globalThis.fetch = (input, init) =>
            nativeFetch(
                typeof input === "string" && input.startsWith("/")
                    ? `${baseUrl}${input}`
                    : input,
                init
            );

        await import("../public/js/app.js");

        const { state } = await import("../public/js/state.js");
        const { serializeDocument, collectSections } = await import(
            "/dashboard/src/documentModel.js"
        );

        check(
            await waitFor(() => state.document && state.document.blocks.length > 0),
            "the note opens and the document model is built"
        );

        const document = window.document;

        const renderedBlocks = document.querySelectorAll("#editorSurface .docBlock");
        check(
            renderedBlocks.length > 15,
            `the editor renders every block (${renderedBlocks.length} blocks)`
        );

        check(
            document.querySelectorAll("#outlineList .outlineItem").length ===
                collectSections(state.document).length,
            "the outline lists all sections"
        );

        check(
            document.querySelectorAll("#assetList .assetItem").length > 0,
            "the images panel lists the note assets"
        );

        check(
            document.querySelectorAll("#reviewList .reviewItem").length >= 2,
            "the review panel shows the generator's markers"
        );

        check(
            document.getElementById("saveStatus").textContent.includes("saved"),
            "the save status reports a clean document"
        );

        check(
            document.getElementById("statusCounts").textContent.includes("words"),
            "the status bar shows document counts"
        );

        const previewFrame = document.getElementById("previewFrame");
        check(
            await waitFor(() =>
                String(previewFrame.src).includes(`/preview/${state.noteId}.html`)
            ),
            "the live preview points at the Bashligh preview document"
        );

        // Typing updates the Markdown underneath.
        const paragraph = state.document.blocks.find(
            (block) =>
                block.type === "paragraph" &&
                typeof block.text === "string" &&
                block.text.includes("Opening paragraph")
        );
        const shell = document.querySelector(`.docBlock[data-block-id="${paragraph.id}"]`);
        check(Boolean(shell), "the opening paragraph has a block element");

        const editable = shell.querySelector('[contenteditable="true"]');
        editable.innerHTML = "Smoke test edited text";
        editable.dispatchEvent(new window.Event("input", { bubbles: true }));

        check(
            serializeDocument(state.document).includes("Smoke test edited text"),
            "typing in the editor updates the Markdown"
        );

        // Enter splits the paragraph at the caret.
        const blocksBeforeEnter = state.document.blocks.length;
        const textNode = editable.firstChild;
        check(Boolean(textNode), "the paragraph has editable text");

        const splitRange = document.createRange();
        splitRange.setStart(textNode, Math.min(6, textNode.data.length));
        splitRange.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(splitRange);

        editable.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );

        check(
            state.document.blocks.length > blocksBeforeEnter,
            "Enter splits the block into two"
        );

        // Tables render an editable grid, typing in a cell updates the
        // Markdown, and the row/column menu restructures the table.
        const tableBlock = state.document.blocks.find(
            (block) => block.type === "table" && block.rows.length > 0
        );
        check(Boolean(tableBlock), "the fixture contains a table block");

        const tableShell = document.querySelector(
            `.docBlock[data-block-id="${tableBlock.id}"]`
        );
        check(Boolean(tableShell), "the table block has a block element");
        check(
            Boolean(tableShell.querySelector("table.blockTable")),
            "the table editor shows the editable table grid"
        );
        check(
            tableShell.querySelectorAll("tbody td[contenteditable='true']").length ===
                tableBlock.rows.length * tableBlock.header.length,
            "every table cell is editable"
        );

        const firstCell = tableShell.querySelector("tbody td[contenteditable='true']");
        const cellText = "سلول آزمون دود";
        firstCell.textContent = cellText;
        firstCell.dispatchEvent(new window.Event("input", { bubbles: true }));
        check(
            serializeDocument(state.document).includes(cellText),
            "typing into a table cell updates the Markdown"
        );

        // Structural ops target the cell that was last focused.
        firstCell.dispatchEvent(new window.FocusEvent("focus", { bubbles: false }));
        const rowsBeforeInsert = tableBlock.rows.length;
        tableShell.querySelector(".tableMenu .tableMenuButton, .tableMenu .dashButton").click();
        check(
            tableShell.querySelector(".tableMenu .tableMenuBody").hidden === false,
            "the table row/column menu opens"
        );
        const insertRowItem = [...tableShell.querySelectorAll(".tableMenuItem")].find(
            (item) => item.textContent === "Insert row below"
        );
        insertRowItem.click();
        check(
            tableBlock.rows.length === rowsBeforeInsert + 1,
            "the table menu inserts a row at the focused cell"
        );
        // The structural op re-renders the editor synchronously, so the
        // fresh DOM (not the detached shell reference) shows the new row.
        const reRenderedShell = document.querySelector(
            `.docBlock[data-block-id="${tableBlock.id}"]`
        );
        check(
            reRenderedShell &&
                reRenderedShell.querySelectorAll("tbody tr").length ===
                    tableBlock.rows.length,
            "the table re-renders with the new row"
        );

        // Markdown source mode round-trips the whole document.
        document.getElementById("modeToggle").click();
        check(
            document.getElementById("rawSourceWrap").hidden === false &&
                document.getElementById("editorSurface").hidden === true,
            "source mode shows the Markdown source"
        );
        check(
            document.getElementById("rawSource").value.includes("test edited text"),
            "source mode contains the current Markdown"
        );

        document.getElementById("modeToggle").click();
        check(
            document.getElementById("rawSourceWrap").hidden === true &&
                document.getElementById("editorSurface").hidden === false,
            "switching back restores the visual editor"
        );

        // Toolbar insertion.
        const blocksBefore = state.document.blocks.length;
        document.querySelector('.toolButton[data-command="callout"]').click();
        check(
            state.document.blocks.length > blocksBefore,
            "the toolbar inserts an information box"
        );
        check(
            serializeDocument(state.document).includes("[BOX:IMPORTANT]"),
            "the inserted box uses the renderer's [BOX:] syntax"
        );

        // Undo restores the previous document state. The fixture itself has a
        // [BOX:IMPORTANT] block, so undo is asserted via the inserted box's
        // unique placeholder text.
        document.getElementById("undoButton").click();
        check(
            !serializeDocument(state.document).includes("متن جعبه را اینجا بنویسید."),
            "undo removes the freshly inserted box again"
        );

        // Panel switching.
        document.getElementById("tab-assets").click();
        check(
            document.getElementById("panel-assets").hidden === false,
            "switching sidebar panels works"
        );

        // Layout manager: minimize and restore windows.
        document.getElementById("layoutPreview").checked = true;
        document.getElementById("layoutPreview").dispatchEvent(new window.Event("change", { bubbles: true }));
        check(
            document.body.classList.contains("preview_hidden") === false,
            "the preview window can be opened from the layout menu"
        );

        document.getElementById("layoutEditor").checked = false;
        document.getElementById("layoutEditor").dispatchEvent(new window.Event("change", { bubbles: true }));
        check(
            document.body.classList.contains("editor_hidden") === true,
            "the document editor can be minimized"
        );
        check(
            document.getElementById("restoreEditorChip") &&
                document.getElementById("restoreEditorChip").getClientRects().length >= 0,
            "a restore chip exists for the minimized editor"
        );

        document.getElementById("restoreEditorChip").click();
        check(
            document.body.classList.contains("editor_hidden") === false,
            "the minimized editor is restored via its chip"
        );

        // Minimizing the last open window is refused. First minimize the
        // preview again, then try to minimize the two remaining windows.
        document.getElementById("layoutPreview").checked = false;
        document.getElementById("layoutPreview").dispatchEvent(new window.Event("change", { bubbles: true }));
        document.getElementById("layoutSidebar").checked = false;
        document.getElementById("layoutSidebar").dispatchEvent(new window.Event("change", { bubbles: true }));
        document.getElementById("layoutEditor").checked = false;
        document.getElementById("layoutEditor").dispatchEvent(new window.Event("change", { bubbles: true }));
        check(
            document.body.classList.contains("editor_hidden") === false,
            "minimizing the last open window is refused"
        );

        // The status-bar mode switcher drives exactly one editor at a time.
        document.getElementById("modeSourceButton").click();
        check(
            document.getElementById("rawSourceWrap").hidden === false &&
                document.getElementById("modeSourceButton").classList.contains("is_active"),
            "the status bar switches to Markdown source mode"
        );
        document.getElementById("modeVisualButton").click();
        check(
            document.getElementById("rawSourceWrap").hidden === true &&
                document.getElementById("modeVisualButton").classList.contains("is_active"),
            "the status bar switches back to the visual editor"
        );

        // Open dialog.
        document.getElementById("openButton").click();
        check(document.getElementById("openDialog").open === true, "the open dialog appears");
        document.getElementById("openDialog").close();

        check(
            browserErrors.length === 0,
            `no uncaught front-end errors (${browserErrors.slice(0, 3).join(" | ")})`
        );
    } finally {
        server.kill("SIGTERM");
        await rm(path.join(fixturesDirectory, "edited"), { recursive: true, force: true });
    }

    if (browserErrors.length > 0) {
        console.error(browserErrors.join("\n"));
    }

    console.log(`\n${passedTests} smoke tests passed.`);
    process.exit(0);
}

main().catch(async (error) => {
    console.error(`\n${error.stack || error.message}`);
    await rm(path.join(fixturesDirectory, "edited"), { recursive: true, force: true });
    process.exit(1);
});

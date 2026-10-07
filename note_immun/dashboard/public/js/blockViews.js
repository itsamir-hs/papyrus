// Renders one document block as an editable DOM element.
//
// Every view reads and writes the shared document model, so what the operator
// sees in the editor and what the Bashligh renderer receives are always the
// same Markdown.

import { editBlock, CALLOUT_TYPES } from "/dashboard/src/documentModel.js";
// Bashligh's shared callout module, served from the renderer's src/ folder.
import { getCalloutLabel } from "/src/callouts.js";

import { state } from "./state.js";
import { emit } from "./bus.js";
import {
    commitChange,
    mutate,
    selectBlock,
    requestFocus
} from "./documentController.js";
import { renderInline, readInline } from "./inlineEditor.js";
import { api } from "./api.js";
import { toast, confirmAction, reportError } from "./ui.js";
import { refreshAssets } from "./assetsController.js";
import { openAssetPicker } from "./assetPicker.js";

const TYPE_LABELS = {
    heading: "Heading",
    paragraph: "Text",
    blockquote: "Box",
    list: "List",
    table: "Table",
    code: "Code",
    hr: "Rule",
    html: "Raw",
    unknown: "Raw"
};

function el(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(label, action, title) {
    const node = el("button", "blockActionButton", label);
    node.type = "button";
    node.dataset.action = action;
    if (title) {
        node.title = title;
        node.setAttribute("aria-label", title);
    }
    return node;
}

/* =========================================================
   Shared block chrome
   ========================================================= */

function createShell(block) {
    const shell = el("div", "docBlock");
    shell.dataset.blockId = block.id;
    shell.dataset.blockType = block.type;
    if (block.variant) shell.dataset.blockVariant = block.variant;

    const gutter = el("div", "blockGutter");
    const dragHandle = button("\u2801", "drag", "Drag to move this block");
    dragHandle.classList.add("dragHandle");
    dragHandle.draggable = true;
    gutter.appendChild(dragHandle);

    const body = el("div", "blockBody");

    const actions = el("div", "blockActions");
    const chip = el(
        "span",
        "blockTypeChip",
        block.type === "heading"
            ? `H${block.depth}`
            : block.type === "blockquote"
              ? block.kind === "callout"
                  ? getCalloutLabel(block.calloutType)
                  : block.kind === "definition"
                    ? "Definition"
                    : "Quotation"
              : block.type === "paragraph"
                ? TYPE_LABELS[block.variant] || TYPE_LABELS.paragraph
                : TYPE_LABELS[block.type] || block.type
    );

    actions.appendChild(chip);
    actions.appendChild(button("\u2191", "moveUp", "Move block up"));
    actions.appendChild(button("\u2193", "moveDown", "Move block down"));
    actions.appendChild(button("\u29c9", "duplicate", "Duplicate block"));
    actions.appendChild(button("</>", "source", "Edit this block as Markdown"));
    actions.appendChild(button("\u2715", "delete", "Delete block"));

    shell.append(gutter, body, actions);

    shell.addEventListener("pointerdown", () => selectBlock(block.id));

    return { shell, body, actions };
}

function makeEditable(className, placeholder, ariaLabel) {
    const node = el("div", className);
    // Set both the property and the attribute: the attribute is what CSS,
    // selectors and serialization rely on.
    node.setAttribute("contenteditable", "true");
    node.contentEditable = "true";
    node.spellcheck = true;
    node.setAttribute("role", "textbox");
    node.setAttribute("aria-multiline", "true");
    node.setAttribute("aria-label", ariaLabel);
    node.dataset.placeholder = placeholder || "";
    return node;
}

function commitText(block, patch) {
    editBlock(block, patch);
    commitChange({ immediate: false });
}

function commitStructure(mutator) {
    mutate(mutator, { structural: true });
}

/* =========================================================
   Asset resolution
   ========================================================= */

export function findAssetByPath(reference) {
    const normalized = String(reference || "");
    const baseName = normalized.split("/").pop();

    return (
        state.assets.find(
            (asset) =>
                asset.markdownPath === normalized ||
                asset.name === normalized ||
                asset.fileName === baseName
        ) || null
    );
}

export function assetUrlFor(reference) {
    const asset = findAssetByPath(reference);
    return asset ? asset.url : null;
}

function placeholderTarget(block) {
    const imageId = String(block.imageId);
    const manifestEntry = state.manifestImages.find(
        (image) => String(image.id) === imageId
    );

    if (manifestEntry) {
        const asset = findAssetByPath(manifestEntry.relativePath);
        if (asset) return { asset, manifestEntry };
        return { asset: null, manifestEntry };
    }

    const guess = findAssetByPath(`image${imageId}.png`);
    return { asset: guess, manifestEntry: null };
}

const CAPTION_PATTERN = /^\*[^*]+\*$/;

function findCaptionBlock(block) {
    const index = state.document.blocks.findIndex((candidate) => candidate.id === block.id);
    for (let offset = 1; offset <= 2; offset++) {
        const candidate = state.document.blocks[index + offset];
        if (!candidate) break;
        if (candidate.type === "space") continue;
        if (
            candidate.type === "paragraph" &&
            candidate.variant === "text" &&
            CAPTION_PATTERN.test(candidate.text.trim())
        ) {
            return candidate;
        }
        break;
    }
    return null;
}

/* =========================================================
   Block views
   ========================================================= */

function viewHeading(block, shell, body) {
    const editable = makeEditable(
        "blockEditable blockHeading",
        "Section title",
        `Heading level ${block.depth}`
    );
    editable.dataset.depth = String(block.depth);
    renderInline(editable, block.text);

    editable.addEventListener("input", () =>
        commitText(block, { text: readInline(editable) })
    );

    body.appendChild(editable);
}

function viewParagraph(block, shell, body) {
    if (block.variant === "formula") return viewFormula(block, body);
    if (block.variant === "image") return viewImage(block, body);
    if (block.variant === "placeholder") return viewImage(block, body);
    if (block.variant === "metadata") return viewMetadata(block, body);

    const editable = makeEditable(
        "blockEditable blockParagraph",
        "Write a paragraph…",
        "Paragraph"
    );
    renderInline(editable, block.text);

    editable.addEventListener("input", () =>
        commitText(block, { text: readInline(editable) })
    );

    body.appendChild(editable);
}

function viewMetadata(block, body) {
    const row = el("div", "blockMetaRow");

    const label = el("input", "blockMetaLabel");
    label.type = "text";
    label.value = block.label;
    label.setAttribute("aria-label", "Metadata label");
    label.addEventListener("input", () => commitText(block, { label: label.value.trim() }));

    const value = el("input", "blockMetaValue");
    value.type = "text";
    value.value = block.value;
    value.setAttribute("aria-label", "Metadata value");
    value.addEventListener("input", () => commitText(block, { value: value.value }));

    row.append(label, value);
    body.appendChild(row);
}

function viewFormula(block, body) {
    const wrap = el("div", "blockFormula");

    const textarea = el("textarea");
    textarea.value = block.latex;
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "LaTeX formula");
    textarea.rows = 3;

    const preview = el("div", "formulaPreview");

    const renderPreview = () => {
        if (!window.katex) {
            preview.textContent = "";
            return;
        }
        try {
            window.katex.render(textarea.value.trim(), preview, {
                displayMode: true,
                throwOnError: false
            });
        } catch {
            preview.textContent = textarea.value;
        }
    };

    textarea.addEventListener("input", () => {
        commitText(block, { latex: textarea.value });
        renderPreview();
    });

    wrap.append(textarea, preview);
    body.appendChild(wrap);
    renderPreview();
}

function viewImage(block, body) {
    const isPlaceholder = block.variant === "placeholder";
    const reference = isPlaceholder
        ? placeholderTarget(block)
        : { asset: findAssetByPath(block.src), manifestEntry: null };

    const url = reference.asset ? reference.asset.url : null;
    const sourceLabel = isPlaceholder
        ? `[IMAGE_${block.imageId}]`
        : String(block.src || "").split("/").pop();

    const card = el("div", "blockImage");
    if (!url) card.classList.add("is_missing");

    const image = document.createElement("img");
    image.alt = isPlaceholder ? `Image ${block.imageId}` : block.alt || "";
    if (url) image.src = url;
    card.appendChild(image);

    const missing = el(
        "div",
        "imageMissing",
        `Image "${sourceLabel}" cannot be found in the note's assets.`
    );
    card.appendChild(missing);

    const fields = el("div", "imageFields");

    const altLabel = el("label", "", "Alt text");
    const altInput = el("input");
    altInput.type = "text";
    altInput.value = isPlaceholder ? `Image ${block.imageId}` : block.alt;
    altInput.setAttribute("aria-label", "Image alternative text");
    altInput.addEventListener("input", () => {
        if (block.variant === "image") commitText(block, { alt: altInput.value });
    });
    fields.append(altLabel, altInput);

    const captionBlock = findCaptionBlock(block);
    if (captionBlock) {
        const captionLabel = el("label", "", "Caption");
        const captionInput = el("input");
        captionInput.type = "text";
        captionInput.value = captionBlock.text.trim().slice(1, -1);
        captionInput.setAttribute("aria-label", "Image caption");
        captionInput.addEventListener("input", () =>
            commitText(captionBlock, { text: `*${captionInput.value}` })
        );
        fields.append(captionLabel, captionInput);
    }

    card.appendChild(fields);

    const actions = el("div", "imageActions");

    const replaceButton = el("button", "dashButton dashButtonSmall", "Replace image");
    replaceButton.type = "button";
    replaceButton.addEventListener("click", () => promptImageReplacement(block));
    actions.appendChild(replaceButton);

    const fromLibrary = el("button", "dashButton dashButtonSmall", "Choose from assets");
    fromLibrary.type = "button";
    fromLibrary.addEventListener("click", () => {
        openAssetPicker(block.id);
        toast("Pick an image in the Images panel to use here.");
    });
    actions.appendChild(fromLibrary);

    const removeButton = el("button", "dashButton dashButtonSmall", "Remove from note");
    removeButton.type = "button";
    removeButton.addEventListener("click", () => {
        commitStructure((document) => {
            const index = document.blocks.findIndex((candidate) => candidate.id === block.id);
            if (index !== -1) document.blocks.splice(index, 1);
        });
        toast("Image removed from the note (the file is still in assets). Use Undo to restore.");
    });
    actions.appendChild(removeButton);

    if (reference.asset) {
        const deleteButton = el("button", "dashButton dashButtonSmall", "Delete asset file");
        deleteButton.type = "button";
        deleteButton.addEventListener("click", () => deleteAssetFile(reference.asset));
        actions.appendChild(deleteButton);
    }

    card.appendChild(actions);
    body.appendChild(card);
}

function promptImageReplacement(block) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";

    input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;

        try {
            const dataUrl = await readFileAsDataUrl(file);
            const base64 = dataUrl.split(",")[1];
            const result = await api.uploadAsset(state.noteId, file.name, base64);

            commitStructure(() => {
                if (block.variant === "placeholder") {
                    editBlock(block, {
                        variant: "image",
                        alt: block.alt || `Image ${block.imageId}`,
                        src: result.markdownPath,
                        title: ""
                    });
                    delete block.imageId;
                } else {
                    editBlock(block, { src: result.markdownPath });
                }
            });

            await refreshAssets();
            toast("Image replaced. Position and caption kept.", "success");
        } catch (error) {
            reportError(error, "Image could not be inserted.");
        }
    });

    input.click();
}

function deleteAssetFile(asset) {
    confirmAction({
        title: "Delete the asset file?",
        message: `"${asset.name}" will be permanently removed from the assets folder. Images that reference it will show a warning.`,
        confirmLabel: "Delete file"
    }).then(async (confirmed) => {
        if (!confirmed) return;
        try {
            await api.deleteAsset(state.noteId, asset.fileName);
            await refreshAssets();
            emit("render:required", {});
            toast(`Deleted ${asset.name}.`, "success");
        } catch (error) {
            reportError(error, "The file could not be deleted.");
        }
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The file could not be read."));
        reader.readAsDataURL(file);
    });
}

function viewBlockquote(block, body) {
    const box = el("div", "blockCallout");
    box.dataset.type = block.kind === "callout" ? block.calloutType : block.kind === "definition" ? "definition" : "custom";

    const header = el("div", "calloutHeader");

    if (block.kind === "callout") {
        const select = el("select", "calloutTypeSelect");
        select.setAttribute("aria-label", "Box type");
        for (const type of CALLOUT_TYPES) {
            const option = el("option", "", getCalloutLabel(type));
            option.value = type;
            if (type === block.calloutType) option.selected = true;
            select.appendChild(option);
        }

        select.addEventListener("change", () => {
            const nextType = select.value;
            commitStructure(() => {
                editBlock(block, {
                    calloutType: nextType,
                    marker: nextType.toUpperCase()
                });
            });
        });

        header.appendChild(select);
    } else {
        header.appendChild(
            el("span", "blockTypeChip", block.kind === "definition" ? "Definition" : "Quotation")
        );
    }

    const titleInput = el("input", "calloutTitleInput");
    titleInput.type = "text";
    titleInput.value =
        block.kind === "definition" ? block.title.replace(/^\*\*|\*\*$/g, "") : block.title;
    titleInput.placeholder = block.kind === "quote" ? "" : "Box title";
    titleInput.setAttribute("aria-label", "Box title");
    titleInput.addEventListener("input", () => {
        if (block.kind === "definition") {
            commitText(block, { title: `**${titleInput.value}**` });
        } else if (block.kind === "callout") {
            commitText(block, { title: titleInput.value });
        }
    });
    header.appendChild(titleInput);

    const editable = makeEditable("calloutBody", "Box content…", "Box content");
    renderInline(editable, block.lines.join("\n"));

    editable.addEventListener("input", () =>
        commitText(block, { lines: readInline(editable).split("\n") })
    );

    box.append(header, editable);
    body.appendChild(box);
}

function viewList(block, body) {
    const wrap = el("div", "blockList");
    const list = document.createElement(block.ordered ? "ol" : "ul");
    list.setAttribute("aria-label", block.ordered ? "Numbered list" : "Bullet list");

    block.items.forEach((item, itemIndex) => {
        const listItem = document.createElement("li");

        const row = el("div", "listItemRow");

        const editable = makeEditable("blockEditable", "List item", "List item");
        editable.style.flex = "1";
        renderInline(editable, item.text);

        editable.addEventListener("input", () =>
            commitText(block, { __itemIndex: itemIndex, text: readInline(editable) })
        );

        const itemActions = el("div", "listItemActions");
        const addItem = button("+", "addItem", "Add item below");
        addItem.addEventListener("click", () => {
            commitStructure((document) => {
                block.items.splice(itemIndex + 1, 0, {
                    raw: "",
                    originalText: "",
                    text: "",
                    task: false,
                    checked: null,
                    dirty: true
                });
                editBlock(block, {});
            });
            requestFocus(block.id, `item:${itemIndex + 1}`);
        });

        const removeItem = button("\u2715", "removeItem", "Remove this item");
        removeItem.addEventListener("click", () => {
            if (block.items.length === 1) {
                commitStructure((document) => {
                    const index = document.blocks.findIndex((candidate) => candidate.id === block.id);
                    if (index !== -1) document.blocks.splice(index, 1);
                });
                return;
            }
            commitStructure(() => {
                block.items.splice(itemIndex, 1);
                editBlock(block, {});
            });
        });

        itemActions.append(addItem, removeItem);
        row.append(editable, itemActions);
        listItem.appendChild(row);
        list.appendChild(listItem);
    });

    wrap.appendChild(list);

    const addRow = el("div", "tableActions");
    const addListItem = el("button", "dashButton dashButtonSmall", "+ Add item");
    addListItem.type = "button";
    addListItem.addEventListener("click", () => {
        commitStructure(() => {
            block.items.push({
                raw: "",
                originalText: "",
                text: "",
                task: false,
                checked: null,
                dirty: true
            });
            editBlock(block, {});
        });
        requestFocus(block.id, `item:${block.items.length - 1}`);
    });
    addRow.appendChild(addListItem);
    wrap.appendChild(addRow);

    body.appendChild(wrap);
}

function viewTable(block, body) {
    const wrap = el("div", "blockTableWrap");
    const table = el("table", "blockTable");

    let activeCell = { row: 0, column: 0 };

    const headerRow = el("tr");
    block.header.forEach((cell, columnIndex) => {
        const th = el("th", "", cell.text);
        th.setAttribute("contenteditable", "true");
        th.contentEditable = "true";
        th.setAttribute("role", "columnheader");
        th.setAttribute("aria-label", `Column ${columnIndex + 1} header`);
        th.addEventListener("input", () => {
            block.header[columnIndex].text = th.textContent;
            editBlock(block, {});
            commitChange({ immediate: false });
        });
        th.addEventListener("focus", () => {
            activeCell = { row: -1, column: columnIndex };
        });
        attachTablePaste(th, block, () => activeCell, () => {
            editBlock(block, {});
            commitChange({ immediate: true });
        });
        headerRow.appendChild(th);
    });

    const thead = document.createElement("thead");
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    block.rows.forEach((row, rowIndex) => {
        const tr = el("tr");
        row.forEach((cellText, columnIndex) => {
            const td = el("td", "", cellText);
            td.setAttribute("contenteditable", "true");
            td.contentEditable = "true";
            td.setAttribute("aria-label", `Row ${rowIndex + 1} column ${columnIndex + 1}`);
            td.addEventListener("input", () => {
                block.rows[rowIndex][columnIndex] = td.textContent;
                editBlock(block, {});
                commitChange({ immediate: false });
            });
            td.addEventListener("focus", () => {
                activeCell = { row: rowIndex, column: columnIndex };
            });
            attachTablePaste(td, block, () => activeCell, () => {
                editBlock(block, {});
                commitChange({ immediate: true });
            });
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);

    const actions = el("div", "tableActions");

    const addRowButton = el("button", "dashButton dashButtonSmall", "+ Row");
    addRowButton.type = "button";
    addRowButton.addEventListener("click", () => {
        commitStructure(() => {
            block.rows.push(block.header.map(() => ""));
            editBlock(block, {});
        });
    });

    const addColumnButton = el("button", "dashButton dashButtonSmall", "+ Column");
    addColumnButton.type = "button";
    addColumnButton.addEventListener("click", () => {
        commitStructure(() => {
            block.header.push({ text: "Column", align: "" });
            block.rows.forEach((row) => row.push(""));
            editBlock(block, {});
        });
    });

    const removeRowButton = el("button", "dashButton dashButtonSmall", "− Row");
    removeRowButton.type = "button";
    removeRowButton.addEventListener("click", () => {
        if (block.rows.length <= 1) {
            toast("A table needs at least one body row.");
            return;
        }
        commitStructure(() => {
            const index = Math.max(activeCell.row, 0);
            block.rows.splice(index, 1);
            editBlock(block, {});
        });
    });

    const removeColumnButton = el("button", "dashButton dashButtonSmall", "− Column");
    removeColumnButton.type = "button";
    removeColumnButton.addEventListener("click", () => {
        if (block.header.length <= 1) {
            toast("A table needs at least one column.");
            return;
        }
        commitStructure(() => {
            const index = Math.max(activeCell.column, 0);
            block.header.splice(index, 1);
            block.rows.forEach((row) => row.splice(index, 1));
            editBlock(block, {});
        });
    });

    const alignButton = el("button", "dashButton dashButtonSmall", "Align column");
    alignButton.type = "button";
    alignButton.title = "Cycle the column alignment (left, right, centre, none)";
    alignButton.addEventListener("click", () => {
        commitStructure(() => {
            const index = Math.max(activeCell.column, 0);
            const order = ["", "left", "right", "center"];
            const cell = block.header[index];
            const current = order.indexOf(cell.align || "");
            cell.align = order[(current + 1) % order.length];
            editBlock(block, {});
        });
    });

    const deleteTableButton = el("button", "dashButton dashButtonSmall", "Delete table");
    deleteTableButton.type = "button";
    deleteTableButton.addEventListener("click", () => {
        commitStructure((document) => {
            const index = document.blocks.findIndex((candidate) => candidate.id === block.id);
            if (index !== -1) document.blocks.splice(index, 1);
        });
        toast("Table deleted. Use Undo to restore it.");
    });

    actions.append(
        addRowButton,
        addColumnButton,
        removeRowButton,
        removeColumnButton,
        alignButton,
        deleteTableButton
    );

    body.append(actions);
}

/**
 * Pasting tab-separated data fills several cells at once, which is how
 * operators usually move tables out of spreadsheets and slides.
 */
function attachTablePaste(cellElement, block, getActiveCell, onDone) {
    cellElement.addEventListener("paste", (event) => {
        const text = event.clipboardData && event.clipboardData.getData("text/plain");
        if (!text || (!text.includes("\t") && !text.includes("\n"))) return;

        event.preventDefault();

        const grid = text
            .replace(/\r/g, "")
            .split("\n")
            .filter((line, index, all) => !(index === all.length - 1 && line === ""))
            .map((line) => line.split("\t"));

        const active = getActiveCell();
        const startRow = Math.max(active.row, 0);
        const startColumn = Math.max(active.column, 0);

        const requiredRows = startRow + grid.length;
        const requiredColumns =
            startColumn + Math.max(...grid.map((row) => row.length));

        while (block.header.length < requiredColumns) block.header.push({ text: "Column", align: "" });
        while (block.rows.length < requiredRows) block.rows.push(block.header.map(() => ""));

        grid.forEach((row, rowIndex) => {
            row.forEach((value, columnIndex) => {
                const targetRow = startRow + rowIndex;
                const targetColumn = startColumn + columnIndex;
                if (targetRow === -1) {
                    block.header[targetColumn].text = value;
                } else if (block.rows[targetRow]) {
                    block.rows[targetRow][targetColumn] = value;
                }
            });
        });

        editBlock(block, {});
        onDone();
        emit("render:required", {});
        toast("Pasted table data.", "success");
    });
}

function viewCode(block, body) {
    const wrap = el("div", "blockCode");

    const languageInput = el("input", "blockMetaLabel");
    languageInput.type = "text";
    languageInput.value = block.lang;
    languageInput.placeholder = "language";
    languageInput.setAttribute("aria-label", "Code language");
    languageInput.style.marginBottom = "6px";
    languageInput.addEventListener("input", () =>
        commitText(block, { lang: languageInput.value.trim() })
    );

    const textarea = el("textarea");
    textarea.value = block.text;
    textarea.spellcheck = false;
    textarea.rows = Math.min(16, Math.max(3, block.text.split("\n").length + 1));
    textarea.setAttribute("aria-label", "Code");
    textarea.addEventListener("input", () => commitText(block, { text: textarea.value }));

    wrap.append(languageInput, textarea);
    body.appendChild(wrap);
}

function viewRawBlock(block, body) {
    const banner = el(
        "div",
        "rawBanner",
        block.type === "html"
            ? "Raw HTML block — kept exactly as written and sanitized by the renderer."
            : "Unsupported Markdown block — shown as source so nothing is lost."
    );
    body.appendChild(banner);

    const textarea = el("textarea", "blockRaw");
    textarea.value = block.raw;
    textarea.rows = Math.min(12, Math.max(2, block.raw.split("\n").length));
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "Raw block source");
    textarea.addEventListener("input", () => {
        block.raw = textarea.value;
        block.dirty = block.raw !== block.originalRaw;
        commitChange({ immediate: false });
    });

    body.appendChild(textarea);
}

function viewRule(block, body) {
    body.appendChild(el("div", "blockDivider", "horizontal rule"));
    void block;
}

/** Toggle a block's single-block Markdown source editor. */
function viewBlockSource(block, body) {
    const banner = el(
        "div",
        "rawBanner",
        "Markdown source for this block. Apply to parse it back, or cancel to keep the current content."
    );

    const textarea = el("textarea", "blockRaw");
    textarea.value = block.raw;
    textarea.spellcheck = false;
    textarea.rows = Math.max(3, block.raw.split("\n").length + 1);
    textarea.setAttribute("aria-label", "Block Markdown source");

    const actions = el("div", "tableActions");

    const applyButton = el("button", "dashButton dashButtonPrimary dashButtonSmall", "Apply");
    applyButton.type = "button";
    applyButton.addEventListener("click", () => {
        emit("block:applySource", { blockId: block.id, source: textarea.value });
    });

    const cancelButton = el("button", "dashButton dashButtonSmall", "Cancel");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => {
        block.sourceEdit = false;
        emit("render:required", {});
    });

    actions.append(applyButton, cancelButton);
    body.append(banner, textarea, actions);
}

/**
 * Create the DOM element for one block.
 * @param {Object} block
 * @returns {HTMLElement}
 */
export function createBlockElement(block) {
    const { shell, body } = createShell(block);

    if (block.sourceEdit) {
        viewBlockSource(block, body);
        return shell;
    }

    switch (block.type) {
        case "heading":
            viewHeading(block, shell, body);
            break;
        case "paragraph":
            viewParagraph(block, shell, body);
            break;
        case "blockquote":
            viewBlockquote(block, body);
            break;
        case "list":
            viewList(block, body);
            break;
        case "table":
            viewTable(block, body);
            break;
        case "code":
            viewCode(block, body);
            break;
        case "hr":
            viewRule(block, body);
            break;
        case "html":
        case "unknown":
        case "def":
            viewRawBlock(block, body);
            break;
        default:
            viewRawBlock(block, body);
    }

    return shell;
}

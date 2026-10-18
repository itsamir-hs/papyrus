#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = __dirname;
const notes = [];

// Title comes from <noteFolder>/data/input/note.md, from the line like:
//   **مبحث:** ایمونولوژی - جلسه اول
function readTitleFromMarkdown(folderPath) {
    const mdPath = path.join(folderPath, "data", "input", "note.md");
    if (!fs.existsSync(mdPath)) return null;

    const md = fs.readFileSync(mdPath, "utf8").replace(/^\uFEFF/, "");
    const match = md.match(/\*\*\s*مبحث\s*:?\s*\*\*\s*:?[ \t]*(.+)/);
    if (!match) return null;

    const title = match[1].trim();
    return title || null;
}

// Fallback: the <title> of the generated page, then the folder name
function readTitleFromHtml(indexPath) {
    const html = fs.readFileSync(indexPath, "utf8");
    const match = html.match(/<title>(.*?)<\/title>/s);
    return match ? match[1].trim() : null;
}

function readNote(folderPath, relativeFolder, category) {
    const indexPath = path.join(folderPath, "output", "index.html");
    if (!fs.existsSync(indexPath)) return;

    let title = readTitleFromMarkdown(folderPath);
    if (!title) {
        title = readTitleFromHtml(indexPath) || path.basename(folderPath);
        console.warn(`! no "**مبحث:**" title in ${relativeFolder}/data/input/note.md, using fallback: ${title}`);
    }

    const note = {
        path: `${relativeFolder}/output/index.html`,
        title,
    };
    if (category) note.category = category;

    notes.push(note);
}

// "cat_Clinical_Lab" -> "Clinical Lab"
function categoryDisplayName(folderName) {
    return folderName.slice("cat_".length).replace(/_/g, " ").trim();
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    // Uncategorized notes: note_*/output/index.html
    if (entry.name.startsWith("note_")) {
        readNote(path.join(root, entry.name), entry.name, null);
        continue;
    }

    // Categorized notes: cat_*/<any note folder>/output/index.html
    if (entry.name.startsWith("cat_")) {
        const category = categoryDisplayName(entry.name) || entry.name;
        const categoryPath = path.join(root, entry.name);

        for (const sub of fs.readdirSync(categoryPath, { withFileTypes: true })) {
            if (!sub.isDirectory()) continue;
            readNote(
                path.join(categoryPath, sub.name),
                `${entry.name}/${sub.name}`,
                category
            );
        }
    }
}

// Categories first (alphabetical), uncategorized last; titles sorted inside each group
notes.sort((a, b) => {
    const ca = a.category || "";
    const cb = b.category || "";
    if (ca !== cb) {
        if (!ca) return 1;
        if (!cb) return -1;
        return ca.localeCompare(cb, "fa");
    }
    return a.title.localeCompare(b.title, "fa");
});

fs.writeFileSync(
    path.join(root, "notes.json"),
    JSON.stringify({ notes }, null, 2) + "\n"
);

const categoryCount = new Set(notes.map((n) => n.category).filter(Boolean)).size;
console.log(
    `notes.json updated with ${notes.length} note(s) in ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}`
);

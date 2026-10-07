#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = __dirname;
const notes = [];

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("note_")) continue;

    const indexPath = path.join(root, entry.name, "output", "index.html");
    if (!fs.existsSync(indexPath)) continue;

    const html = fs.readFileSync(indexPath, "utf8");
    const match = html.match(/<title>(.*?)<\/title>/s);
    const title = match ? match[1].trim() : entry.name;

    notes.push({
        path: `${entry.name}/output/index.html`,
        title,
    });
}

notes.sort((a, b) => a.title.localeCompare(b.title, "fa"));

fs.writeFileSync(
    path.join(root, "notes.json"),
    JSON.stringify({ notes }, null, 2) + "\n"
);

console.log(`notes.json updated with ${notes.length} note(s)`);

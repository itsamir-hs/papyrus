const themeSwitcher = document.querySelector(".themeSwitcher");
const themeToggle = document.querySelector(".themeToggle");
const themeButtons = document.querySelectorAll(".themeButton");
const searchInput = document.getElementById("searchInput");
const notesGrid = document.getElementById("notesGrid");
const emptyState = document.getElementById("emptyState");

const themeStorageKey = "noteTheme";

let notes = [];

function setTheme(themeName) {
    document.documentElement.dataset.theme = themeName;

    themeButtons.forEach((button) => {
        const isActive = button.dataset.theme === themeName;
        button.setAttribute("aria-pressed", String(isActive));
    });

    localStorage.setItem(themeStorageKey, themeName);
}

function toggleThemeOptions() {
    const isOpen = themeSwitcher.classList.toggle("isOpen");
    themeToggle.setAttribute("aria-expanded", String(isOpen));
}

function closeThemeOptions() {
    themeSwitcher.classList.remove("isOpen");
    themeToggle.setAttribute("aria-expanded", "false");
}

themeToggle.addEventListener("click", toggleThemeOptions);

themeButtons.forEach((button) => {
    button.addEventListener("click", () => {
        setTheme(button.dataset.theme);
        closeThemeOptions();
    });
});

document.addEventListener("click", (event) => {
    if (!themeSwitcher.contains(event.target)) {
        closeThemeOptions();
    }
});

const savedTheme = localStorage.getItem(themeStorageKey);
setTheme(savedTheme || document.documentElement.dataset.theme || "light");

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(
        new RegExp(`(${escapedQuery})`, "gi"),
        "<mark>$1</mark>"
    );
}

function renderNotes(query = "") {
    const q = query.trim().toLowerCase();
    const filtered = q
        ? notes.filter((n) => n.title.toLowerCase().includes(q))
        : notes;

    notesGrid.innerHTML = "";

    if (filtered.length === 0) {
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;

    filtered.forEach((note) => {
        const card = document.createElement("a");
        card.className = "noteCard";
        card.href = note.path;
        card.innerHTML = `
            <span class="noteCardTitle">${highlightText(note.title, q)}</span>
            <span class="noteCardPath">${escapeHtml(note.path)}</span>
        `;
        notesGrid.appendChild(card);
    });
}

searchInput.addEventListener("input", (e) => {
    renderNotes(e.target.value);
});

fetch("notes.json")
    .then((res) => res.json())
    .then((data) => {
        notes = data.notes || [];
        renderNotes();
    })
    .catch(() => {
        notes = [];
        renderNotes();
    });

lucide.createIcons();

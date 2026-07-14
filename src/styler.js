/**
 * Design-Editor ("Styler"): passt das Aussehen bereits fertiger
 * All-in-one-HTML-Dateien und HTML5-Pakete (.zip) nachträglich an.
 *
 * Ablauf:
 *  1. POST /session       – Datei hochladen, wird in ein Temp-Verzeichnis
 *                           entpackt/kopiert und für die Vorschau bereitgestellt.
 *  2. GET  /files/<id>/…  – liefert die Dateien der Sitzung aus (Live-Vorschau
 *                           im iframe des Editors, same-origin).
 *  3. POST /export        – injiziert den CSS-Block in die (index-)HTML-Datei
 *                           und liefert das Ergebnis als Download zurück.
 *
 * Der injizierte Block ist durch Marker-Kommentare begrenzt und enthält die
 * Editor-Einstellungen als JSON. Dadurch kann eine bereits angepasste Datei
 * erneut geladen und weiterbearbeitet werden (der alte Block wird ersetzt).
 */
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promises: fs } = require('fs');
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');

const SESSIONS_ROOT = path.join(os.tmpdir(), 'h5p-styler-sessions');
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 Stunden
const MARKER_START = '<!-- H5P-STYLER-START -->';
const MARKER_END = '<!-- H5P-STYLER-END -->';
const MARKER_RE = /<!-- H5P-STYLER-START -->[\s\S]*?<!-- H5P-STYLER-END -->\s*/g;
const SETTINGS_RE =
    /<script id="h5p-styler-settings"[^>]*>([\s\S]*?)<\/script>/;

/**
 * Läuft in der exportierten Datei: kopiert das Theme-CSS fortlaufend in alle
 * gleichoriginigen iframes (HTML5-Pakete rendern den H5P-Inhalt in einem
 * iframe, das erst nach dem Laden entsteht und neu erzeugt werden kann).
 */
const INJECT_SCRIPT = `(function () {
    function themeCss() {
        var el = document.getElementById('h5p-styler-theme');
        return el ? el.textContent : '';
    }
    function apply(doc) {
        if (!doc || !doc.documentElement) return;
        var el = doc.getElementById('h5p-styler-theme-copy');
        if (!el) {
            el = doc.createElement('style');
            el.id = 'h5p-styler-theme-copy';
            (doc.head || doc.documentElement).appendChild(el);
        }
        var css = themeCss();
        if (el.textContent !== css) el.textContent = css;
    }
    function walk(win) {
        for (var i = 0; i < win.frames.length; i++) {
            try {
                apply(win.frames[i].document);
                walk(win.frames[i]);
            } catch (e) { /* fremde Origin – ignorieren */ }
        }
    }
    setInterval(function () { walk(window); }, 800);
})();`;

const upload = multer({
    dest: path.join(os.tmpdir(), 'h5p-styler-uploads'),
    limits: { fileSize: 500 * 1024 * 1024 } // 500 MB
});

const router = express.Router();
router.use(express.json({ limit: '2mb' }));

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function sessionDir(id) {
    return path.join(SESSIONS_ROOT, id);
}

function contentDir(id) {
    return path.join(sessionDir(id), 'content');
}

async function readMeta(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    try {
        const raw = await fs.readFile(
            path.join(sessionDir(id), 'meta.json'),
            'utf8'
        );
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** Findet die "Haupt"-HTML-Datei: index.html in geringster Tiefe,
 *  sonst die flachste .html/.htm-Datei. Pfad relativ zu dir (mit "/"). */
async function findEntryHtml(dir) {
    const found = [];
    async function walk(current, depth, relPrefix) {
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(path.join(current, entry.name), depth + 1, rel);
            } else if (/\.html?$/i.test(entry.name)) {
                found.push({ rel, depth, isIndex: /^index\.html?$/i.test(entry.name) });
            }
        }
    }
    await walk(dir, 0, '');
    found.sort(
        (a, b) => (b.isIndex - a.isIndex) || (a.depth - b.depth)
    );
    return found.length ? found[0].rel : null;
}

/** Entfernt einen früher injizierten Styler-Block und liest dessen
 *  gespeicherte Einstellungen aus. */
function stripExistingBlock(html) {
    let settings = null;
    const m = html.match(SETTINGS_RE);
    if (m) {
        try {
            settings = JSON.parse(m[1]);
        } catch {
            settings = null;
        }
    }
    return { html: html.replace(MARKER_RE, ''), settings };
}

/** "</style>"-/"</script>"-Ausbruch aus CSS-Text verhindern. */
function sanitizeCss(css, maxLength = 300 * 1024) {
    if (typeof css !== 'string') return '';
    return css.replace(/<\//g, '<\\/').substring(0, maxLength);
}

function buildStylerBlock(layoutCss, themeCss, settings) {
    const settingsJson = JSON.stringify(settings || {}).replace(
        /</g,
        '\\u003c'
    );
    return [
        MARKER_START,
        `<style id="h5p-styler-layout">\n${sanitizeCss(layoutCss)}\n</style>`,
        `<style id="h5p-styler-theme">\n${sanitizeCss(themeCss)}\n</style>`,
        `<script id="h5p-styler-settings" type="application/json">${settingsJson}</script>`,
        `<script id="h5p-styler-inject">${INJECT_SCRIPT}</script>`,
        MARKER_END
    ].join('\n');
}

/** Fügt den Block vor </head> ein (Fallback: vor </body>, sonst ans Ende). */
function injectBlock(html, block) {
    const cleaned = html.replace(MARKER_RE, '');
    const headEnd = cleaned.search(/<\/head\s*>/i);
    if (headEnd !== -1) {
        return (
            cleaned.slice(0, headEnd) + block + '\n' + cleaned.slice(headEnd)
        );
    }
    const bodyEnd = cleaned.search(/<\/body\s*>/i);
    if (bodyEnd !== -1) {
        return (
            cleaned.slice(0, bodyEnd) + block + '\n' + cleaned.slice(bodyEnd)
        );
    }
    return cleaned + '\n' + block + '\n';
}

function contentDisposition(filename) {
    const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function safeName(name) {
    return (
        String(name)
            .replace(/[\\/:*?"<>|]/g, '_')
            .trim() || 'inhalt'
    );
}

/* ------------------------------------------------------------------ */
/* Aufräumen alter Sitzungen                                           */
/* ------------------------------------------------------------------ */

async function cleanupSessions() {
    let entries;
    try {
        entries = await fs.readdir(SESSIONS_ROOT, { withFileTypes: true });
    } catch {
        return;
    }
    const now = Date.now();
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(SESSIONS_ROOT, entry.name);
        try {
            const stat = await fs.stat(dir);
            if (now - stat.mtimeMs > SESSION_MAX_AGE_MS) {
                await fs.rm(dir, { recursive: true, force: true });
            }
        } catch {
            /* ignorieren */
        }
    }
}
setInterval(cleanupSessions, 30 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Endpunkte                                                           */
/* ------------------------------------------------------------------ */

router.post('/session', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }
    const originalName = req.file.originalname || 'datei';
    const lower = originalName.toLowerCase();
    const isHtml = /\.html?$/.test(lower);
    const isZip = /\.zip$/.test(lower);
    try {
        if (!isHtml && !isZip) {
            throw new Error(
                'Bitte eine .html-Datei oder ein HTML5-Paket (.zip) hochladen.'
            );
        }
        const id = crypto.randomUUID();
        const cDir = contentDir(id);
        await fs.mkdir(cDir, { recursive: true });

        let entry;
        if (isZip) {
            const zip = new AdmZip(req.file.path);
            zip.extractAllTo(cDir, true);
            entry = await findEntryHtml(cDir);
            if (!entry) {
                await fs.rm(sessionDir(id), { recursive: true, force: true });
                throw new Error(
                    'Im ZIP-Paket wurde keine HTML-Datei gefunden.'
                );
            }
        } else {
            entry = safeName(originalName);
            await fs.copyFile(req.file.path, path.join(cDir, entry));
        }

        // Früher injizierten Styler-Block entfernen und Einstellungen lesen
        const entryPath = path.join(cDir, ...entry.split('/'));
        const rawHtml = await fs.readFile(entryPath, 'utf8');
        const { html, settings } = stripExistingBlock(rawHtml);
        if (html !== rawHtml) await fs.writeFile(entryPath, html, 'utf8');

        const meta = {
            type: isZip ? 'zip' : 'html',
            entry,
            originalName,
            created: Date.now()
        };
        await fs.writeFile(
            path.join(sessionDir(id), 'meta.json'),
            JSON.stringify(meta),
            'utf8'
        );
        res.json({ id, type: meta.type, entry, name: originalName, settings });
    } catch (error) {
        console.error('Styler-Upload fehlgeschlagen:', error);
        res.status(422).json({ error: error.message });
    } finally {
        fs.rm(req.file.path, { force: true }).catch(() => {});
    }
});

// Vorschau-Dateien ausliefern: /files/<session-id>/<pfad/innerhalb/der/sitzung>
router.use('/files', async (req, res) => {
    const m = req.path.match(/^\/([0-9a-f-]{36})\/(.+)$/);
    if (!m) return res.status(404).end();
    const meta = await readMeta(m[1]);
    if (!meta) {
        return res
            .status(404)
            .send('Sitzung abgelaufen. Bitte die Datei erneut laden.');
    }
    let rel;
    try {
        rel = m[2]
            .split('/')
            .map((s) => decodeURIComponent(s))
            .join(path.sep);
    } catch {
        return res.status(400).end();
    }
    const base = contentDir(m[1]);
    const filePath = path.normalize(path.join(base, rel));
    if (!filePath.startsWith(base + path.sep)) {
        return res.status(403).end();
    }
    res.sendFile(filePath, { cacheControl: false }, (err) => {
        if (err && !res.headersSent) res.status(404).end();
    });
});

router.post('/export', async (req, res) => {
    const { id, layoutCss, themeCss, settings } = req.body || {};
    const meta = await readMeta(String(id || ''));
    if (!meta) {
        return res.status(404).json({
            error: 'Sitzung abgelaufen. Bitte die Datei erneut laden.'
        });
    }
    try {
        const cDir = contentDir(id);
        const entryPath = path.join(cDir, ...meta.entry.split('/'));
        const html = await fs.readFile(entryPath, 'utf8');
        const block = buildStylerBlock(layoutCss, themeCss, settings);
        const injected = injectBlock(html, block);
        await fs.writeFile(entryPath, injected, 'utf8');

        const base = safeName(meta.originalName.replace(/\.(html?|zip)$/i, ''));
        if (meta.type === 'html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                contentDisposition(`${base}-angepasst.html`)
            );
            res.send(injected);
        } else {
            const out = new AdmZip();
            out.addLocalFolder(cDir);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader(
                'Content-Disposition',
                contentDisposition(`${base}-angepasst.zip`)
            );
            res.send(out.toBuffer());
        }
    } catch (error) {
        console.error('Styler-Export fehlgeschlagen:', error);
        res.status(422).json({ error: error.message });
    }
});

module.exports = router;

/**
 * Kernlogik: wandelt .h5p-Dateien um in
 *  1. eine All-in-one-HTML-Datei (alles eingebettet, läuft offline per Doppelklick)
 *  2. ein HTML5-Paket (.zip mit index.html + h5p-standalone-Player, für Webserver/LMS)
 *
 * Fehlen in der .h5p-Datei die benötigten Bibliotheken (z. B. bei Exporten aus
 * Moodle ohne "Bibliotheken einbeziehen"), werden sie automatisch vom
 * offiziellen H5P-Hub nachinstalliert.
 */
const path = require('path');
const os = require('os');
const { promises: fs, createWriteStream } = require('fs');
const AdmZip = require('adm-zip');
const H5P = require('@lumieducation/h5p-server');
const HtmlExporter = require('@lumieducation/h5p-html-exporter').default;

const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
const CORE_PATH = path.join(VENDOR_DIR, 'h5p-core');
const EDITOR_PATH = path.join(VENDOR_DIR, 'h5p-editor');
const STANDALONE_DIST = path.join(
    __dirname,
    '..',
    'node_modules',
    'h5p-standalone',
    'dist'
);

const USER = {
    email: 'converter@local',
    id: 'converter',
    name: 'H5P Converter',
    type: 'local'
};

/* ------------------------------------------------------------------ *
 *  Gestaltungsoptionen (Ränder, Breite, Schrift, Farben, eigenes CSS)
 * ------------------------------------------------------------------ */

/** Elemente, auf die Schrift-/Textfarbwahl wirken soll (bewusst ohne
 *  span/div/button, damit H5P-Icon-Fonts nicht zerstört werden). */
const TEXT_SELECTORS =
    'body, .h5p-content, p, h1, h2, h3, h4, h5, h6, li, ul, ol, td, th, ' +
    'dd, dt, label, legend, figcaption, blockquote, input, select, textarea';

function sanitizeCssValue(value, maxLength = 120) {
    return String(value)
        .replace(/[;{}<>]/g, '')
        .trim()
        .substring(0, maxLength);
}

function parsePx(value) {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) return null;
    return Math.min(Math.max(n, 0), 2000);
}

function parseWidth(value) {
    if (value === undefined || value === null || value === '') return null;
    const m = String(value)
        .trim()
        .match(/^(\d{1,4})\s*(px|%)?$/);
    if (!m) return null;
    const n = Number.parseInt(m[1], 10);
    const unit = m[2] || 'px';
    if (unit === '%' && (n < 5 || n > 100)) return null;
    if (unit === 'px' && (n < 100 || n > 4000)) return null;
    return `${n}${unit}`;
}

function parseColor(value) {
    if (!value) return null;
    const v = String(value).trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

/**
 * Bereinigt/validiert die vom Aufrufer übergebenen Gestaltungsoptionen.
 * Unbekannte oder ungültige Werte werden verworfen.
 */
function normalizeStyleOptions(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const o = {
        marginTop: parsePx(raw.marginTop),
        marginRight: parsePx(raw.marginRight),
        marginBottom: parsePx(raw.marginBottom),
        marginLeft: parsePx(raw.marginLeft),
        width: parseWidth(raw.width),
        font: raw.font ? sanitizeCssValue(raw.font) : null,
        colorPage: parseColor(raw.colorPage),
        colorContent: parseColor(raw.colorContent),
        colorText: parseColor(raw.colorText),
        colorAccent: parseColor(raw.colorAccent),
        customCss:
            typeof raw.customCss === 'string' && raw.customCss.trim()
                ? // "</style>"-Ausbruch verhindern; 200-KB-Limit
                  raw.customCss.replace(/<\//g, '<\\/').substring(0, 200 * 1024)
                : null
    };
    const hasAny = Object.values(o).some((v) => v !== null);
    return hasAny ? o : null;
}

/**
 * CSS für das Seitenlayout (Ränder, Breite, Seitenhintergrund).
 * Wirkt auf die äußere Seite (bei HTML5-Paketen: die index.html,
 * nicht das H5P-iframe).
 */
function buildLayoutCss(o) {
    if (!o) return '';
    const rules = [];
    const margins = [o.marginTop, o.marginRight, o.marginBottom, o.marginLeft];
    if (margins.some((m) => m !== null)) {
        const [t, r, b, l] = margins.map((m) => `${m ?? 0}px`);
        rules.push(
            `body { margin: 0 !important; padding: ${t} ${r} ${b} ${l} !important; box-sizing: border-box; }`
        );
        // Standard-Innenabstand des Paket-Wrappers neutralisieren
        rules.push('.wrapper { padding: 0 !important; }');
    }
    if (o.width) {
        rules.push(
            `.h5p-content, #h5p-container { width: ${o.width} !important; max-width: 100% !important; ` +
                'margin-left: auto !important; margin-right: auto !important; }'
        );
        rules.push('.wrapper { max-width: none !important; }');
    }
    if (o.colorPage) {
        rules.push(`html, body { background: ${o.colorPage} !important; }`);
    }
    return rules.join('\n');
}

/**
 * CSS für den Inhalt selbst (Schrift, Farben, eigenes CSS).
 * Muss bei HTML5-Paketen ins H5P-iframe geladen werden (customCss),
 * bei All-in-one-HTML einfach in den <head>.
 */
function buildThemeCss(o) {
    if (!o) return '';
    const rules = [];
    if (o.font) {
        rules.push(
            `${TEXT_SELECTORS} { font-family: ${o.font}, sans-serif !important; }`
        );
    }
    if (o.colorText) {
        rules.push(`${TEXT_SELECTORS} { color: ${o.colorText} !important; }`);
    }
    if (o.colorContent) {
        rules.push(
            `.h5p-content { background: ${o.colorContent} !important; }`
        );
    }
    if (o.colorAccent) {
        rules.push(
            `.h5p-joubelui-button { background-color: ${o.colorAccent} !important; border-color: ${o.colorAccent} !important; background-image: none !important; }`,
            `.h5p-joubelui-button:hover, .h5p-joubelui-button:focus { filter: brightness(0.9); }`,
            `a { color: ${o.colorAccent} !important; }`,
            `.h5p-joubelui-progressbar-background,` +
                ` .h5p-progressbar .h5p-progressbar-part-show,` +
                ` .h5p-progressbar .h5p-progressbar-part-selected` +
                ` { background-color: ${o.colorAccent} !important; background-image: none !important; }`
        );
    }
    if (o.customCss) {
        rules.push('/* Eigenes CSS */', o.customCss);
    }
    return rules.join('\n');
}

/**
 * Eigenes Seiten-Template für den HTML-Exporter: identisch zum
 * Standard-Template, ergänzt um einen Style-Block mit den
 * Benutzeranpassungen (nach dem H5P-CSS, damit sie Vorrang haben).
 */
function buildExporterTemplate(customCss) {
    return (integration, scriptsBundle, stylesBundle, contentId) => `<!doctype html>
<html class="h5p-iframe">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script>H5PIntegration = ${JSON.stringify({
        ...integration,
        baseUrl: '.',
        url: '.',
        ajax: { setFinished: '', contentUserData: '' },
        saveFreq: false,
        libraryUrl: ''
    })};
    ${scriptsBundle}</script>
    <style>${stylesBundle}</style>
    <style>/* Benutzeranpassungen (H5P Converter) */
${customCss}</style>
</head>
<body>
    <div class="h5p-content lag" data-content-id="${contentId}"></div>
</body>
</html>`;
}

async function assertSetupDone() {
    try {
        await fs.access(path.join(CORE_PATH, 'js'));
        await fs.access(path.join(EDITOR_PATH, 'scripts'));
    } catch {
        throw new Error(
            'H5P-Core-Dateien fehlen. Bitte einmalig "npm run setup" ausführen.'
        );
    }
}

/**
 * Baut eine temporäre H5P-Server-Umgebung auf (Bibliotheks-/Inhaltsspeicher im
 * Temp-Verzeichnis), führt callback aus und räumt danach wieder auf.
 */
async function withH5PEnvironment(callback) {
    await assertSetupDone();
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h5p-conv-'));
    try {
        const librariesPath = path.join(workDir, 'libraries');
        const contentPath = path.join(workDir, 'content');
        const temporaryPath = path.join(workDir, 'tmp');
        await Promise.all(
            [librariesPath, contentPath, temporaryPath].map((dir) =>
                fs.mkdir(dir, { recursive: true })
            )
        );
        const config = new H5P.H5PConfig(
            new H5P.fsImplementations.InMemoryStorage(),
            { baseUrl: '' }
        );
        const h5pEditor = H5P.fs(
            config,
            librariesPath,
            temporaryPath,
            contentPath
        );
        return await callback(h5pEditor, config, workDir);
    } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Liest die fehlenden Bibliotheken aus einem "install-missing-libraries"-Fehler.
 * @returns {string[]} Ubernames wie "H5P.CoursePresentation-1.26" (leer, wenn
 * es ein anderer Fehler ist)
 */
function getMissingLibraries(error) {
    if (!error || error.errorId !== 'install-missing-libraries') return [];
    const libs = error.replacements && error.replacements.libraries;
    if (Array.isArray(libs)) return libs;
    if (typeof libs === 'string') {
        return libs
            .split(',')
            .map((l) => l.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * Versucht, fehlende Inhaltstypen vom offiziellen H5P-Hub zu installieren.
 * Der Hub liefert immer die aktuellste Version eines Inhaltstyps inklusive
 * aller Abhängigkeiten.
 */
async function installMissingFromHub(h5pEditor, missingUbernames) {
    await h5pEditor.contentTypeCache.updateIfNecessary();
    const machineNames = [
        ...new Set(
            missingUbernames.map((u) => u.substring(0, u.lastIndexOf('-')))
        )
    ];
    for (const machineName of machineNames) {
        try {
            const result = await h5pEditor.installLibraryFromHub(
                machineName,
                USER
            );
            console.log(
                `Vom H5P-Hub installiert: ${machineName} (${result.length} Bibliotheken)`
            );
        } catch (error) {
            // Nicht jede fehlende Bibliothek ist ein eigenständiger
            // Hub-Inhaltstyp – Abhängigkeiten kommen mit dem Hauptpaket mit.
            console.warn(
                `Hub-Installation von ${machineName} nicht möglich: ${error.message}`
            );
        }
    }
}

/**
 * Importiert eine .h5p-Datei. Fehlen Bibliotheken, wird einmalig versucht,
 * sie vom H5P-Hub nachzuladen, danach wird der Import wiederholt.
 */
async function importPackage(h5pEditor, buffer) {
    try {
        return await h5pEditor.uploadPackage(buffer, USER);
    } catch (error) {
        const missing = getMissingLibraries(error);
        if (missing.length === 0) throw error;
        console.log(
            `Datei enthält benötigte Bibliotheken nicht (${missing.join(', ')}) – lade vom H5P-Hub nach ...`
        );
        await installMissingFromHub(h5pEditor, missing);
        try {
            return await h5pEditor.uploadPackage(buffer, USER);
        } catch (retryError) {
            const stillMissing = getMissingLibraries(retryError);
            if (stillMissing.length > 0) {
                throw new Error(
                    `Diese H5P-Datei wurde ohne die benötigten Bibliotheken exportiert, ` +
                        `und folgende Versionen sind auch über den H5P-Hub nicht (mehr) erhältlich: ` +
                        `${stillMissing.join(', ')}. Lösungen: (1) Den Inhalt auf der Ursprungs-` +
                        `plattform MIT Bibliotheken exportieren (Moodle: Website-Administration → ` +
                        `H5P → "Bibliotheken in Export einbeziehen"; Lumi und h5p.org machen das ` +
                        `automatisch) oder (2) den Inhalt dort zuerst auf die neueste Version des ` +
                        `Inhaltstyps aktualisieren und erneut exportieren.`
                );
            }
            throw retryError;
        }
    }
}

/**
 * Importiert die Datei und speichert den Inhalt im temporären Speicher.
 * @returns {Promise<{contentId: string, metadata: object}>}
 */
async function importAndSave(h5pEditor, inputPath) {
    const buffer = await fs.readFile(inputPath);
    const { metadata, parameters } = await importPackage(h5pEditor, buffer);
    if (!metadata || !parameters) {
        throw new Error(
            'Die Datei enthält keinen abspielbaren Inhalt (nur Bibliotheken?).'
        );
    }
    const mainDependency = (metadata.preloadedDependencies || []).find(
        (dep) => dep.machineName === metadata.mainLibrary
    );
    if (!mainDependency) {
        throw new Error(
            'Hauptbibliothek konnte in h5p.json nicht ermittelt werden.'
        );
    }
    const ubername = `${mainDependency.machineName} ${mainDependency.majorVersion}.${mainDependency.minorVersion}`;
    const contentId = await h5pEditor.saveOrUpdateContent(
        undefined,
        parameters.params ?? parameters,
        metadata,
        ubername,
        USER
    );
    return { contentId, metadata };
}

/**
 * Erzeugt eine einzelne HTML-Datei, in der alle Skripte, Styles und Medien
 * eingebettet sind. Nutzt den Lumi-HTML-Exporter (gleiche Technik wie die
 * Lumi-Desktop-App).
 * @param {string} inputPath Pfad zur .h5p-Datei
 * @param {object} [rawStyleOptions] optionale Gestaltungsoptionen
 * @returns {Promise<{html: string, title: string}>}
 */
async function convertToAllInOneHtml(inputPath, rawStyleOptions) {
    const styleOptions = normalizeStyleOptions(rawStyleOptions);
    return withH5PEnvironment(async (h5pEditor, config) => {
        const { contentId, metadata } = await importAndSave(
            h5pEditor,
            inputPath
        );
        const customCss = styleOptions
            ? `${buildLayoutCss(styleOptions)}\n${buildThemeCss(styleOptions)}`
            : '';
        const exporter = new HtmlExporter(
            h5pEditor.libraryStorage,
            h5pEditor.contentStorage,
            config,
            CORE_PATH,
            EDITOR_PATH,
            customCss.trim() ? buildExporterTemplate(customCss) : undefined
        );
        const html = await exporter.createSingleBundle(contentId, USER, {
            language: metadata.defaultLanguage || 'de',
            showFrame: false,
            showLicenseButton: false
        });
        return {
            html,
            title: metadata.title || path.parse(inputPath).name
        };
    });
}

/**
 * Erzeugt ein HTML5-Paket: entpackte H5P-Inhalte + h5p-standalone-Player +
 * generierte index.html, verpackt als Zip. Der Inhalt wird vorher importiert
 * und als vollständiges Paket (inkl. aller – ggf. vom Hub nachgeladener –
 * Bibliotheken) neu exportiert. Muss über einen Webserver ausgeliefert werden
 * (file:// funktioniert wegen Browser-Sicherheitsregeln nicht).
 * @param {string} inputPath Pfad zur .h5p-Datei
 * @param {object} [rawStyleOptions] optionale Gestaltungsoptionen
 * @returns {Promise<{zip: Buffer, title: string}>}
 */
async function convertToHtml5Package(inputPath, rawStyleOptions) {
    const styleOptions = normalizeStyleOptions(rawStyleOptions);
    return withH5PEnvironment(async (h5pEditor, config, workDir) => {
        const { contentId, metadata } = await importAndSave(
            h5pEditor,
            inputPath
        );
        // Vollständiges .h5p exportieren – enthält garantiert alle Bibliotheken
        const packageExporter = new H5P.PackageExporter(
            h5pEditor.libraryManager,
            h5pEditor.contentStorage,
            {
                exportMaxContentPathLength:
                    config.exportMaxContentPathLength || 255,
                permissionSystem: new H5P.LaissezFairePermissionSystem()
            }
        );
        const completePath = path.join(workDir, 'complete.h5p');
        await new Promise((resolve, reject) => {
            const out = createWriteStream(completePath);
            out.on('finish', resolve);
            out.on('error', reject);
            packageExporter
                .createPackage(contentId, out, USER)
                .catch(reject);
        });
        const title = metadata.title || path.parse(inputPath).name;
        const zip = await buildStandaloneZip(
            await fs.readFile(completePath),
            title,
            styleOptions
        );
        return { zip, title };
    });
}

/**
 * Baut aus einem vollständigen .h5p-Puffer das HTML5-Paket-Zip
 * (h5p-content/ + assets/ + index.html + LIESMICH.txt).
 */
async function buildStandaloneZip(h5pBuffer, title, styleOptions) {
    const source = new AdmZip(h5pBuffer);
    const out = new AdmZip();

    // Entpackte H5P-Inhalte unter h5p-content/ ablegen
    for (const entry of source.getEntries()) {
        if (entry.isDirectory) continue;
        out.addFile(`h5p-content/${entry.entryName}`, entry.getData());
    }

    // h5p-standalone-Player unter assets/ ablegen
    await addDirToZip(out, STANDALONE_DIST, 'assets');

    // Schrift/Farben/eigenes CSS müssen ins H5P-iframe geladen werden
    // (per customCss-Option von h5p-standalone), Layout wirkt auf die Seite.
    const themeCss = buildThemeCss(styleOptions);
    if (themeCss.trim()) {
        out.addFile('custom.css', Buffer.from(themeCss, 'utf8'));
    }
    out.addFile(
        'index.html',
        Buffer.from(
            buildPackageIndexHtml(
                title,
                buildLayoutCss(styleOptions),
                themeCss.trim() ? 'custom.css' : null
            ),
            'utf8'
        )
    );
    out.addFile('LIESMICH.txt', Buffer.from(buildPackageReadme(title), 'utf8'));
    return out.toBuffer();
}

async function addDirToZip(zip, dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
            await addDirToZip(zip, full, rel);
        } else {
            zip.addFile(rel, await fs.readFile(full));
        }
    }
}

function buildPackageIndexHtml(title, layoutCss = '', customCssFile = null) {
    return `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <script src="assets/main.bundle.js" charset="UTF-8"></script>
    <style>
        body { margin: 0; font-family: sans-serif; background: #f5f5f5; }
        .wrapper { max-width: 1080px; margin: 0 auto; padding: 16px; }
        #file-protocol-hint { display: none; background: #fff3cd; border: 1px solid #ffe08a;
            border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
    </style>
    <style>/* Benutzeranpassungen (H5P Converter) */
${layoutCss}</style>
</head>
<body>
    <div class="wrapper">
        <div id="file-protocol-hint">
            <strong>Hinweis:</strong> Diese Seite wurde direkt aus dem Dateisystem geöffnet
            (file://). H5P-Inhalte benötigen einen Webserver. Bitte das Paket auf einen
            Webserver hochladen oder lokal z.&nbsp;B. mit
            <code>npx http-server</code> in diesem Ordner starten.
        </div>
        <div id="h5p-container"></div>
    </div>
    <script>
        if (window.location.protocol === 'file:') {
            document.getElementById('file-protocol-hint').style.display = 'block';
        }
        // Absolute URLs relativ zum Ordner der index.html bilden – h5p-standalone
        // setzt rein relative Pfade nicht zuverlässig zusammen.
        var base = window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
        var options = {
            h5pJsonPath: base + 'h5p-content',
            librariesPath: base + 'h5p-content',
            frameJs: base + 'assets/frame.bundle.js',
            frameCss: base + 'assets/styles/h5p.css',
            frame: false,
            copyright: false,
            export: false,
            fullScreen: true
        };
        ${customCssFile ? `options.customCss = [base + '${customCssFile}'];` : ''}
        new H5PStandalone.H5P(document.getElementById('h5p-container'), options).catch(function (error) {
            console.error('H5P konnte nicht geladen werden:', error);
        });
    </script>
</body>
</html>
`;
}

function buildPackageReadme(title) {
    return `HTML5-Paket: ${title}
=====================================

Dieses Paket wurde aus einer H5P-Datei erzeugt und enthält:
  - index.html      Startseite (öffnet den Inhalt)
  - h5p-content/    die entpackten H5P-Inhalte und Bibliotheken
  - assets/         der h5p-standalone-Player (Version 3.x)

WICHTIG: Der Inhalt muss über einen Webserver (http:// oder https://)
aufgerufen werden. Ein Doppelklick auf index.html (file://) funktioniert
nicht, weil Browser aus Sicherheitsgründen die dafür nötigen Datei-
zugriffe blockieren.

Möglichkeiten:
  1. Kompletten Ordner auf einen Webserver / in ein CMS hochladen und
     index.html aufrufen.
  2. Lokal testen: In diesem Ordner eine Konsole öffnen und
        npx http-server
     ausführen, dann http://localhost:8080 im Browser öffnen.
  3. Für Offline-Nutzung per Doppelklick stattdessen die
     All-in-one-HTML-Variante des Converters verwenden.
`;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Dateinamen-sicheren Titel erzeugen */
function safeFileName(title) {
    return (
        String(title)
            .replace(/[^\p{L}\p{N} _.-]/gu, '')
            .trim()
            .replace(/\s+/g, '-') || 'h5p-inhalt'
    );
}

module.exports = {
    convertToAllInOneHtml,
    convertToHtml5Package,
    safeFileName
};

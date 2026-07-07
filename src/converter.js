/**
 * Kernlogik: wandelt .h5p-Dateien um in
 *  1. eine All-in-one-HTML-Datei (alles eingebettet, läuft offline per Doppelklick)
 *  2. ein HTML5-Paket (.zip mit index.html + h5p-standalone-Player, für Webserver/LMS)
 */
const path = require('path');
const os = require('os');
const { promises: fs, createReadStream } = require('fs');
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
 * Erzeugt eine einzelne HTML-Datei, in der alle Skripte, Styles und Medien
 * eingebettet sind. Nutzt den Lumi-HTML-Exporter (gleiche Technik wie die
 * Lumi-Desktop-App).
 * @param {string} inputPath Pfad zur .h5p-Datei
 * @returns {Promise<{html: string, title: string}>}
 */
async function convertToAllInOneHtml(inputPath) {
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

        const buffer = await fs.readFile(inputPath);
        const { metadata, parameters } = await h5pEditor.uploadPackage(
            buffer,
            USER
        );
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

        const exporter = new HtmlExporter(
            h5pEditor.libraryStorage,
            h5pEditor.contentStorage,
            config,
            CORE_PATH,
            EDITOR_PATH
        );
        const html = await exporter.createSingleBundle(contentId, USER, {
            language: metadata.defaultLanguage || 'de',
            showFrame: false,
            showLicenseButton: false
        });
        return { html, title: metadata.title || path.parse(inputPath).name };
    } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Erzeugt ein HTML5-Paket: entpackte H5P-Inhalte + h5p-standalone-Player +
 * generierte index.html, verpackt als Zip. Muss über einen Webserver
 * ausgeliefert werden (file:// funktioniert wegen Browser-Sicherheitsregeln nicht).
 * @param {string} inputPath Pfad zur .h5p-Datei
 * @returns {Promise<{zip: Buffer, title: string}>}
 */
async function convertToHtml5Package(inputPath) {
    const source = new AdmZip(await fs.readFile(inputPath));
    const h5pJsonEntry = source.getEntry('h5p.json');
    if (!h5pJsonEntry) {
        throw new Error('Keine gültige H5P-Datei: h5p.json fehlt im Archiv.');
    }
    const h5pJson = JSON.parse(h5pJsonEntry.getData().toString('utf8'));
    const title = h5pJson.title || path.parse(inputPath).name;

    const out = new AdmZip();

    // Entpackte H5P-Inhalte unter h5p-content/ ablegen
    for (const entry of source.getEntries()) {
        if (entry.isDirectory) continue;
        out.addFile(`h5p-content/${entry.entryName}`, entry.getData());
    }

    // h5p-standalone-Player unter assets/ ablegen
    await addDirToZip(out, STANDALONE_DIST, 'assets');

    out.addFile('index.html', Buffer.from(buildPackageIndexHtml(title), 'utf8'));
    out.addFile('LIESMICH.txt', Buffer.from(buildPackageReadme(title), 'utf8'));

    return { zip: out.toBuffer(), title };
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

function buildPackageIndexHtml(title) {
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
        new H5PStandalone.H5P(document.getElementById('h5p-container'), {
            h5pJsonPath: base + 'h5p-content',
            librariesPath: base + 'h5p-content',
            frameJs: base + 'assets/frame.bundle.js',
            frameCss: base + 'assets/styles/h5p.css',
            frame: false,
            copyright: false,
            export: false,
            fullScreen: true
        }).catch(function (error) {
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

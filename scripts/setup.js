/**
 * Einmaliges Setup: lädt die H5P-Core- und Editor-Dateien (Client-Assets)
 * von GitHub herunter und entpackt sie nach vendor/h5p-core bzw. vendor/h5p-editor.
 * Diese Dateien braucht der HTML-Exporter, um das All-in-one-Bundle zu bauen.
 */
const path = require('path');
const { promises: fs } = require('fs');
const AdmZip = require('adm-zip');

// Commit-Stände, die von der Lumi H5P-Nodejs-library (v10) verwendet und
// getestet werden (siehe scripts/install.sh im Lumi-Repo).
const CORE_COMMIT = '2aeb0b83fa603e331381b3a6b8bf42c3773ba140';
const EDITOR_COMMIT = 'ab2daa18bd61b19e7f8729e22eec88f3b637a868';
const TARGETS = [
    {
        name: 'H5P Core',
        url: `https://github.com/h5p/h5p-php-library/archive/${CORE_COMMIT}.zip`,
        dest: path.join(__dirname, '..', 'vendor', 'h5p-core')
    },
    {
        name: 'H5P Editor',
        url: `https://github.com/h5p/h5p-editor-php-library/archive/${EDITOR_COMMIT}.zip`,
        dest: path.join(__dirname, '..', 'vendor', 'h5p-editor')
    }
];

async function download(url) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

async function setupTarget({ name, url, dest }) {
    try {
        await fs.access(path.join(dest, '.complete'));
        console.log(`${name}: bereits vorhanden, überspringe.`);
        return;
    } catch {
        /* noch nicht vorhanden */
    }
    console.log(`${name}: lade ${url} ...`);
    const buffer = await download(url);
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    // GitHub-Archive haben einen Top-Level-Ordner (z. B. h5p-php-library-1.27.0/),
    // der beim Entpacken entfernt wird.
    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const relative = entry.entryName.split('/').slice(1).join('/');
        if (!relative) continue;
        const target = path.join(dest, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, entry.getData());
    }
    await fs.writeFile(path.join(dest, '.complete'), new Date().toISOString());
    console.log(`${name}: entpackt nach ${dest}`);
}

(async () => {
    for (const target of TARGETS) {
        await setupTarget(target);
    }
    console.log('Setup abgeschlossen.');
})().catch((error) => {
    console.error('Setup fehlgeschlagen:', error.message);
    process.exit(1);
});

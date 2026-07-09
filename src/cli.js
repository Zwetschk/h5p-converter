#!/usr/bin/env node
/**
 * Kommandozeilen-Interface:
 *   node src/cli.js <datei.h5p> [weitere.h5p ...] [--format html|package|both] [--out <ordner>]
 */
const path = require('path');
const { promises: fs } = require('fs');
const {
    convertToAllInOneHtml,
    convertToHtml5Package,
    safeFileName
} = require('./converter');

function printUsage() {
    console.log(`H5P Converter – wandelt .h5p in ausführbares HTML um

Verwendung:
  node src/cli.js <datei.h5p> [weitere.h5p ...] [Optionen]

Optionen:
  --format html      All-in-one-HTML-Datei (Standard; läuft offline per Doppelklick)
  --format package   HTML5-Paket (.zip) für Webserver/LMS
  --format both      beide Varianten erzeugen
  --out <ordner>     Zielordner (Standard: Ordner der Eingabedatei)
  --help             diese Hilfe anzeigen

Gestaltung (alle optional):
  --rand <o,r,u,l>       Ränder in px, z. B. --rand 24,16,24,16 (leer = 0, z. B. 24,,24,)
  --breite <wert>        Breite, z. B. --breite 800px oder --breite 90%
  --schrift <name>       Schriftart, z. B. --schrift "Georgia"
  --farbe-seite <#hex>   Seitenhintergrund, z. B. --farbe-seite "#222222"
  --farbe-inhalt <#hex>  Hintergrund des Inhalts
  --farbe-text <#hex>    Textfarbe
  --farbe-akzent <#hex>  Akzentfarbe (Buttons & Links)
  --css <datei.css>      eigene CSS-Datei, wird zusätzlich angewendet`);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help')) {
        printUsage();
        process.exit(args.length === 0 ? 1 : 0);
    }

    const inputs = [];
    let format = 'html';
    let outDir = null;
    const style = {};
    let cssFile = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--format') {
            format = args[++i];
        } else if (args[i] === '--out') {
            outDir = args[++i];
        } else if (args[i] === '--rand') {
            const [t, r, b, l] = (args[++i] || '').split(',');
            style.marginTop = t || null;
            style.marginRight = r || null;
            style.marginBottom = b || null;
            style.marginLeft = l || null;
        } else if (args[i] === '--breite') {
            style.width = args[++i];
        } else if (args[i] === '--schrift') {
            style.font = args[++i];
        } else if (args[i] === '--farbe-seite') {
            style.colorPage = args[++i];
        } else if (args[i] === '--farbe-inhalt') {
            style.colorContent = args[++i];
        } else if (args[i] === '--farbe-text') {
            style.colorText = args[++i];
        } else if (args[i] === '--farbe-akzent') {
            style.colorAccent = args[++i];
        } else if (args[i] === '--css') {
            cssFile = args[++i];
        } else {
            inputs.push(args[i]);
        }
    }
    if (cssFile) {
        try {
            style.customCss = await fs.readFile(path.resolve(cssFile), 'utf8');
        } catch {
            console.error(`CSS-Datei nicht lesbar: ${cssFile}`);
            process.exit(1);
        }
    }
    const styleOptions = Object.keys(style).length > 0 ? style : null;
    if (!['html', 'package', 'both'].includes(format)) {
        console.error(`Unbekanntes Format: ${format}`);
        process.exit(1);
    }
    if (inputs.length === 0) {
        console.error('Keine Eingabedatei angegeben.');
        process.exit(1);
    }

    let failures = 0;
    for (const input of inputs) {
        const inputPath = path.resolve(input);
        try {
            await fs.access(inputPath);
        } catch {
            console.error(`Datei nicht gefunden: ${inputPath}`);
            failures++;
            continue;
        }
        const targetDir = outDir
            ? path.resolve(outDir)
            : path.dirname(inputPath);
        await fs.mkdir(targetDir, { recursive: true });

        try {
            if (format === 'html' || format === 'both') {
                console.log(`Konvertiere (All-in-one-HTML): ${inputPath}`);
                const { html, title } = await convertToAllInOneHtml(
                    inputPath,
                    styleOptions
                );
                const target = path.join(
                    targetDir,
                    `${safeFileName(title)}.html`
                );
                await fs.writeFile(target, html, 'utf8');
                console.log(`  -> ${target}`);
            }
            if (format === 'package' || format === 'both') {
                console.log(`Konvertiere (HTML5-Paket): ${inputPath}`);
                const { zip, title } = await convertToHtml5Package(
                    inputPath,
                    styleOptions
                );
                const target = path.join(
                    targetDir,
                    `${safeFileName(title)}-html5-paket.zip`
                );
                await fs.writeFile(target, zip);
                console.log(`  -> ${target}`);
            }
        } catch (error) {
            console.error(`  Fehler bei ${input}: ${error.message}`);
            failures++;
        }
    }
    process.exit(failures > 0 ? 1 : 0);
}

main();

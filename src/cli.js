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
  --help             diese Hilfe anzeigen`);
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
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--format') {
            format = args[++i];
        } else if (args[i] === '--out') {
            outDir = args[++i];
        } else {
            inputs.push(args[i]);
        }
    }
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
                const { html, title } = await convertToAllInOneHtml(inputPath);
                const target = path.join(
                    targetDir,
                    `${safeFileName(title)}.html`
                );
                await fs.writeFile(target, html, 'utf8');
                console.log(`  -> ${target}`);
            }
            if (format === 'package' || format === 'both') {
                console.log(`Konvertiere (HTML5-Paket): ${inputPath}`);
                const { zip, title } = await convertToHtml5Package(inputPath);
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

# H5P Converter

Wandelt `.h5p`-Dateien ohne H5P-Server in ausführbares HTML um – wahlweise als:

1. **All-in-one-HTML-Datei** – eine einzige HTML-Datei, in der alle Skripte,
   Styles und Medien (als Base64/data-URIs) eingebettet sind. Läuft **offline
   per Doppelklick** in jedem modernen Browser. Ideal zum Weitergeben per
   E-Mail, USB-Stick oder Cloud.
2. **HTML5-Paket (`.zip`)** – `index.html` + entpackte H5P-Inhalte +
   [h5p-standalone](https://github.com/tunapanda/h5p-standalone)-Player.
   Zum Hochladen auf einen **Webserver** oder ins **LMS** (benötigt
   http/https; `file://` blockieren Browser aus Sicherheitsgründen –
   Details stehen in der `LIESMICH.txt` im Paket).

Der All-in-one-Export nutzt die [Lumi H5P-Nodejs-library](https://github.com/Lumieducation/H5P-Nodejs-library)
(`@lumieducation/h5p-server` + `h5p-html-exporter`) – dieselbe Technik wie die
Lumi-Desktop-App. Alles läuft lokal, es werden keine Inhalte hochgeladen.

## Technische Voraussetzungen

- **Node.js ≥ 18** (getestet mit Node 22) und npm
- Internetverbindung **nur einmalig** bei der Installation
  (npm-Pakete + H5P-Core-/Editor-Dateien von GitHub); danach offline nutzbar
- Windows, macOS oder Linux

## Installation

```
npm install
```

Das lädt die Abhängigkeiten und automatisch (postinstall) die H5P-Core- und
Editor-Dateien nach `vendor/`. Falls das Setup separat nötig ist:
`npm run setup`.

## Nutzung

### Web-Oberfläche (empfohlen)

```
npm start
```

oder unter Windows einfach **`start.cmd`** doppelklicken. Danach im Browser
<http://localhost:3300> öffnen, `.h5p`-Datei per Drag & Drop ablegen,
Format wählen, „Umwandeln & herunterladen“.

### Kommandozeile

```
node src/cli.js meine-datei.h5p                    # All-in-one-HTML (Standard)
node src/cli.js meine-datei.h5p --format package   # HTML5-Paket (.zip)
node src/cli.js *.h5p --format both --out ausgabe  # beides, in Zielordner
```

## Projektstruktur

```
scripts/setup.js    einmaliger Download der H5P-Core-/Editor-Dateien
src/converter.js    Kernlogik (beide Konvertierungen)
src/cli.js          Kommandozeilen-Interface
src/server.js       lokale Web-Oberfläche (Express, Port 3300)
public/index.html   Browser-UI (Drag & Drop)
vendor/             H5P-Core-/Editor-Dateien (durch Setup erzeugt)
test-data/          Beispieldateien und Konvertierungsergebnisse
```

## Online bereitstellen

Wie du die Anwendung ins Internet stellst (Cloud-Plattform, eigener Server,
Docker, temporärer Tunnel) inkl. Voraussetzungen steht in
[DEPLOYMENT.md](DEPLOYMENT.md). Ein `Dockerfile` liegt bei.

## Grenzen

- Der All-in-one-Export funktioniert mit allen offiziellen
  H5P-Hub-Inhaltstypen; exotische Dritt-Bibliotheken können abweichen.
- Videos/Audio werden in die HTML-Datei eingebettet – die Datei kann dadurch
  sehr groß werden. Für medienlastige Inhalte ist das HTML5-Paket besser.
- Extern verlinkte Ressourcen (absolute URLs, z. B. YouTube) werden nicht
  eingebettet und benötigen zur Laufzeit Internet.
- Lernstände werden nicht gespeichert (kein LMS/xAPI-Backend); die Inhalte
  selbst sind voll interaktiv.

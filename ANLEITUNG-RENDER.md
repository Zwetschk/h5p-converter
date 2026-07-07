# Schritt-für-Schritt: H5P Converter kostenlos auf Render.com veröffentlichen

Diese Anleitung bringt die Anwendung in ca. 20–30 Minuten online.
Es sind keine Programmierkenntnisse nötig – nur Copy & Paste der Befehle.

**Was du am Ende hast:** Eine öffentliche Adresse wie
`https://h5p-converter.onrender.com`, unter der jeder (oder nur du) den
Converter im Browser nutzen kann – inklusive HTTPS, ohne eigenen Server.

**Voraussetzungen:**
- [x] Git ist installiert (bei dir vorhanden: Version 2.53)
- [ ] Ein kostenloses **GitHub**-Konto (Schritt 1)
- [ ] Ein kostenloses **Render**-Konto (Schritt 4)

---

## Schritt 1: GitHub-Konto erstellen (falls noch nicht vorhanden)

1. Öffne <https://github.com/signup>.
2. E-Mail-Adresse eingeben (z. B. deine Gmail-Adresse), Passwort wählen,
   Benutzernamen festlegen (z. B. `ckottbauer`).
3. Bestätigungscode aus der E-Mail eingeben – fertig.

> GitHub ist der Ort, an dem der Programmcode liegt. Render holt sich den
> Code später automatisch von dort.

## Schritt 2: Leeres Repository auf GitHub anlegen

1. Auf GitHub oben rechts auf **+** → **New repository** klicken.
2. Ausfüllen:
   - **Repository name:** `h5p-converter`
   - **Visibility:** `Private` (empfohlen – der Code ist dann nicht
     öffentlich sichtbar; Render kann trotzdem darauf zugreifen)
   - **WICHTIG:** Keine Häkchen bei „Add a README", „Add .gitignore" oder
     „Choose a license" setzen – das Repository muss leer sein.
3. Auf **Create repository** klicken.
4. Die angezeigte Adresse notieren, sie lautet:
   `https://github.com/DEIN-BENUTZERNAME/h5p-converter.git`

## Schritt 3: Projekt von deinem PC zu GitHub hochladen

Öffne **PowerShell** (Windows-Taste → „PowerShell" tippen → Enter) und
führe die folgenden Befehle **einzeln nacheinander** aus.

**3a – In den Projektordner wechseln:**

```powershell
cd "C:\Users\ckott\Downloads\KI-Tests\Kindle-Reiseführer\h5p-converter"
```

**3b – Git einmalig deinen Namen mitteilen** (nur nötig, wenn du Git noch
nie benutzt hast; die Angaben erscheinen später in der Änderungshistorie):

```powershell
git config --global user.name "Dein Name"
git config --global user.email "ckottbauer@gmail.com"
```

**3c – Repository anlegen und alle Dateien einchecken:**

```powershell
git init
git add .
git commit -m "H5P Converter"
git branch -M main
```

> Die Ordner `node_modules/`, `vendor/` und Testausgaben werden dank der
> vorhandenen `.gitignore` automatisch ausgelassen – sie werden beim
> Deployment neu erzeugt.

**3d – Mit GitHub verbinden und hochladen**
(ersetze `DEIN-BENUTZERNAME` durch deinen GitHub-Benutzernamen!):

```powershell
git remote add origin https://github.com/DEIN-BENUTZERNAME/h5p-converter.git
git push -u origin main
```

Beim ersten `git push` öffnet sich ein Anmeldefenster
(„Git Credential Manager"): **Sign in with your browser** wählen und
dich bei GitHub anmelden. Danach läuft der Upload durch.

**Kontrolle:** Lade die GitHub-Seite deines Repositories neu – du solltest
jetzt die Projektdateien sehen (`src/`, `public/`, `package.json`, …).

## Schritt 4: Render-Konto erstellen

1. Öffne <https://render.com> und klicke auf **Get Started** / **Sign Up**.
2. Wähle **„Sign up with GitHub"** – dadurch entfällt später das Verbinden
   der Konten.
3. GitHub fragt: „Authorize Render?" → **Authorize** klicken.
4. Ggf. E-Mail bestätigen. Bei Fragen zur Nutzung („What brings you…")
   irgendetwas Passendes wählen – das hat keine Auswirkungen.

## Schritt 5: Web Service anlegen und deployen

1. Im Render-Dashboard oben auf **New +** → **Web Service** klicken.
2. **Quelle wählen:** Dein Repository `h5p-converter` sollte in der Liste
   erscheinen. Falls nicht: auf **„Configure account"** / **„Connect GitHub"**
   klicken und Render Zugriff auf das Repository geben
   („Only select repositories" → `h5p-converter` auswählen → Save).
3. Repository anklicken → **Connect**.
4. Einstellungen prüfen (durch die beiliegende `render.yaml` bzw.
   automatische Erkennung meist schon vorausgefüllt):

   | Feld | Wert |
   |---|---|
   | Name | `h5p-converter` (frei wählbar; wird Teil der Adresse) |
   | Region | `Frankfurt (EU Central)` – näher = schneller |
   | Branch | `main` |
   | Runtime / Language | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | `Free` |

5. Ganz unten auf **Deploy Web Service** klicken.
6. Jetzt läuft der Build (2–5 Minuten). Im Log siehst du u. a.
   `added … packages` und `H5P Core: lade …` (das ist unser Setup-Skript,
   das die H5P-Dateien lädt). Am Ende erscheint:
   `H5P Converter läuft: http://localhost:10000` und der Status wechselt
   auf **Live** (grün).

## Schritt 6: Testen

1. Oben links auf der Service-Seite steht deine Adresse, z. B.
   `https://h5p-converter.onrender.com` – anklicken.
2. Die Converter-Oberfläche erscheint. Eine `.h5p`-Datei hineinziehen,
   Format wählen, **Umwandeln & herunterladen** klicken.
3. Die heruntergeladene HTML-Datei per Doppelklick öffnen → der Inhalt
   muss abspielbar sein.

**Geschafft – die Anwendung ist online!** Die Adresse kannst du beliebig
weitergeben.

---

## Spätere Änderungen veröffentlichen (Updates)

Wenn du am Projekt etwas änderst, genügt in PowerShell im Projektordner:

```powershell
git add .
git commit -m "Beschreibung der Änderung"
git push
```

Render erkennt den Push automatisch und deployt neu (Auto-Deploy).

## Wissenswertes zum Free-Tier & Problemlösung

- **Einschlafen:** Nach ~15 Minuten ohne Zugriffe wird die App schlafen
  gelegt. Der nächste Aufruf dauert dann 30–60 Sekunden („Cold Start") –
  danach ist sie wieder schnell. Abhilfe: bezahlter „Starter"-Plan
  (~7 $/Monat) oder damit leben.
- **Monatslimit:** Der Free-Plan umfasst 750 Instanzstunden/Monat – für
  einen einzelnen Dienst mehr als genug.
- **Große Dateien:** Der Free-Plan hat 512 MB RAM. Sehr große H5P-Dateien
  (Videos, > ~100 MB) können beim Konvertieren scheitern → Starter-Plan
  oder Datei lokal konvertieren.
- **Build schlägt fehl mit „Download fehlgeschlagen":** Das Setup-Skript
  konnte GitHub nicht erreichen – im Dashboard **Manual Deploy → Clear
  build cache & deploy** erneut versuchen.
- **„Repository not found" beim Push (Schritt 3d):** Benutzername in der
  Adresse falsch oder Repository nicht angelegt – Schritt 2 prüfen, dann
  `git remote set-url origin https://github.com/DEIN-BENUTZERNAME/h5p-converter.git`
  und erneut `git push -u origin main`.
- **Passwortschutz:** Soll nicht jeder die Adresse nutzen können, ist auf
  Render der einfachste Weg, den Dienst nur per unauffälliger Adresse zu
  teilen; echten Passwortschutz müsste man in `src/server.js` ergänzen
  (z. B. mit dem npm-Paket `express-basic-auth` – bei Bedarf einbaubar).

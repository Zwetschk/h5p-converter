# H5P Converter online bereitstellen

Diese Anleitung beschreibt, wie du die **Converter-Anwendung selbst** (die
Web-Oberfläche zum Umwandeln) öffentlich ins Internet stellst.

> **Wichtige Unterscheidung:**
> - Die **Ergebnisse** der Konvertierung (All-in-one-HTML, HTML5-Paket)
>   kannst du auf *jedem* beliebigen Webspace veröffentlichen – auch auf
>   reinem statischem Hosting (GitHub Pages, Netlify, klassischer
>   PHP-Webspace, Moodle/WordPress-Dateibereich). Dafür ist **kein** Server
>   mit Node.js nötig.
> - Die **Converter-Anwendung selbst** ist ein Node.js-Server. Sie braucht
>   Hosting, das **Node.js-Prozesse** ausführen kann. Reines statisches
>   Hosting und klassischer Shared-Webspace (nur PHP) funktionieren dafür
>   **nicht**.

---

## Allgemeine Voraussetzungen

| Anforderung | Details |
|---|---|
| Laufzeitumgebung | Node.js ≥ 18 (oder Docker) |
| RAM | mind. 512 MB, empfohlen 1–2 GB (große H5P-Dateien werden im Speicher verarbeitet) |
| Festplatte | ca. 300 MB (App + node_modules + H5P-Core-Dateien) |
| Internet beim Installieren | einmalig nötig (npm-Pakete + H5P-Core-Dateien von GitHub); der Betrieb selbst braucht kein Internet |
| HTTPS | für öffentlichen Betrieb dringend empfohlen (bei PaaS automatisch, auf VPS via Let's Encrypt) |
| Datenschutz | hochgeladene Dateien werden nur temporär verarbeitet und danach gelöscht; es gibt keine Datenbank |

Die App liest den Port aus der Umgebungsvariable `PORT` (Standard 3300) –
das erwarten alle gängigen Hoster.

---

## Option 1: Cloud-Plattform / PaaS (am einfachsten)

> **Ausführliche Klick-für-Klick-Anleitung:** siehe
> [ANLEITUNG-RENDER.md](ANLEITUNG-RENDER.md) (inkl. GitHub-Einrichtung,
> Fehlerbehebung und Update-Workflow). Eine `render.yaml` mit den
> passenden Einstellungen liegt dem Projekt bei.

Geeignet: **Render.com** (kostenloser Einstieg), **Railway.app**,
**Fly.io**, Heroku. Kein eigener Server, HTTPS automatisch.

Am Beispiel **Render**:

1. Projekt in ein GitHub-Repository pushen (der Ordner `h5p-converter/`
   als Repo-Wurzel; `node_modules/`, `vendor/` und `test-data/` per
   `.gitignore` ausschließen – `vendor/` wird beim Build neu geladen).
2. Auf <https://render.com> anmelden → **New → Web Service** → GitHub-Repo
   verbinden.
3. Einstellungen:
   - **Runtime:** Node
   - **Build Command:** `npm install` (führt automatisch das Setup aus)
   - **Start Command:** `npm start`
   - **Instance Type:** Free (zum Testen) oder Starter
4. Deploy klicken. Nach 2–3 Minuten ist die App unter
   `https://<name>.onrender.com` erreichbar.

Hinweise:
- Im **Free-Tier** schläft die App nach Inaktivität ein (erster Aufruf
  dauert dann ~30–60 s) und Upload-Größen/CPU sind begrenzt.
- Railway/Fly.io funktionieren analog; Fly.io kann auch direkt das
  beiliegende `Dockerfile` verwenden (`fly launch`).

---

## Option 2: Eigener Server / VPS (volle Kontrolle)

Geeignet: Hetzner Cloud (ab ~4 €/Monat), netcup, IONOS, Strato V-Server,
DigitalOcean … Grundlage: Ubuntu 22.04/24.04, SSH-Zugang, eine Domain
(z. B. `converter.deine-domain.de`, per DNS-A-Record auf die Server-IP).

### Schritt 1: Node.js installieren

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

### Schritt 2: App auf den Server bringen und installieren

```bash
sudo mkdir -p /opt/h5p-converter && sudo chown $USER /opt/h5p-converter
# Variante A: aus deinem Git-Repository
git clone https://github.com/<dein-name>/h5p-converter.git /opt/h5p-converter
# Variante B: per Kopie von deinem PC (dort ausführen):
#   scp -r h5p-converter/ user@server:/opt/  (ohne node_modules/)

cd /opt/h5p-converter
npm install          # installiert Pakete + lädt H5P-Core-Dateien
node src/cli.js --help   # Funktionstest
```

### Schritt 3: Als Dienst dauerhaft laufen lassen (pm2)

```bash
sudo npm install -g pm2
pm2 start src/server.js --name h5p-converter
pm2 save
pm2 startup          # angezeigten Befehl einmal ausführen → Autostart beim Reboot
```

### Schritt 4: Nginx als Reverse-Proxy mit HTTPS

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/h5p-converter <<'EOF'
server {
    listen 80;
    server_name converter.deine-domain.de;

    client_max_body_size 500m;          # Upload-Limit (an eigene Bedürfnisse anpassen)
    proxy_read_timeout 300s;            # große Dateien brauchen Zeit

    location / {
        proxy_pass http://127.0.0.1:3300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
sudo ln -s /etc/nginx/sites-available/h5p-converter /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d converter.deine-domain.de   # HTTPS-Zertifikat (Let's Encrypt)
```

Fertig: `https://converter.deine-domain.de`.

### Optional: Zugriffsschutz (empfohlen bei öffentlichem Betrieb)

Ohne Schutz kann *jeder* Dateien hochladen und Rechenzeit verbrauchen.
Einfachster Schutz – HTTP Basic Auth in Nginx:

```bash
sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd meinbenutzer
# im server-Block bei "location /" ergänzen:
#   auth_basic "H5P Converter";
#   auth_basic_user_file /etc/nginx/.htpasswd;
sudo systemctl reload nginx
```

---

## Option 3: Docker (VPS, NAS, Firmenserver)

Ein `Dockerfile` liegt dem Projekt bei. Auf jedem System mit Docker:

```bash
cd h5p-converter
docker build -t h5p-converter .
docker run -d --name h5p-converter --restart unless-stopped -p 3300:3300 h5p-converter
```

Danach läuft die App auf Port 3300 (davor wie in Option 2 einen
Reverse-Proxy mit HTTPS setzen). Läuft auch auf Synology/QNAP-NAS
mit Container-Unterstützung. Der **Build** braucht Internetzugang
(lädt npm-Pakete und H5P-Core-Dateien), der Container danach nicht mehr.

---

## Option 4: Vom eigenen PC aus temporär freigeben (ohne Server)

Zum kurzfristigen Teilen (Kollegin soll „mal eben“ etwas konvertieren),
ohne irgendetwas zu mieten:

1. Converter lokal starten (`start.cmd` bzw. `npm start`).
2. Einen Tunnel-Dienst starten, der localhost:3300 öffentlich macht:
   - **Cloudflare Tunnel** (kostenlos, ohne Konto für Schnelltests):
     ```
     winget install Cloudflare.cloudflared
     cloudflared tunnel --url http://localhost:3300
     ```
     → gibt eine `https://….trycloudflare.com`-Adresse aus.
   - Alternativen: **ngrok** (`ngrok http 3300`), **Tailscale Funnel**
     (nur für eigene Geräte/Team, mit Login-Schutz).
3. Adresse weitergeben. Tunnel beenden = Zugang weg.

Nicht für Dauerbetrieb gedacht (PC muss laufen, Adresse wechselt).

---

## Was NICHT funktioniert (für die App selbst)

- **Statisches Hosting**: GitHub Pages, Netlify (statisch), einfacher
  Webspace – dort läuft kein Node.js-Server.
- **Klassischer Shared-Webspace nur mit PHP** (viele günstige
  Hosting-Tarife): kein Node.js → nicht geeignet. Manche Hoster (z. B.
  IONOS/Strato in größeren Tarifen, Uberspace, alfahosting) bieten
  Node.js-Unterstützung – dann geht es nach dem Muster von Option 2.
- **Serverless Functions** (Netlify/Vercel Functions) sind wegen
  Laufzeit-/Größenlimits und der H5P-Core-Dateien nur mit erheblichem
  Umbau möglich – nicht empfohlen.

---

## Betriebshinweise für den öffentlichen Betrieb

- **Zugriffsschutz** einrichten (Basic Auth, s. o.), wenn der Dienst nicht
  für die Allgemeinheit gedacht ist.
- **Upload-Limit**: In `src/server.js` ist es auf 500 MB gesetzt
  (`limits.fileSize`) – für den öffentlichen Betrieb ggf. auf z. B. 100 MB
  senken; zusätzlich `client_max_body_size` in Nginx anpassen.
- **Updates**: gelegentlich `npm update` bzw. `npm audit` ausführen und
  neu deployen, um Sicherheitsupdates der Abhängigkeiten mitzunehmen.
- **Logs**: bei pm2 `pm2 logs h5p-converter`, bei Docker `docker logs`.

## Empfehlung nach Anwendungsfall

| Anwendungsfall | Empfehlung |
|---|---|
| Nur du selbst, gelegentlich | lokal lassen (`start.cmd`), gar nicht hosten |
| Kurz mit anderen teilen | Option 4 (Cloudflare Tunnel) |
| Dauerhaft, wenig Aufwand, wenig Last | Option 1 (Render/Railway) |
| Dauerhaft, volle Kontrolle, eigene Domain | Option 2 (VPS + pm2 + Nginx) |
| Firmen-/Schulserver, NAS vorhanden | Option 3 (Docker) |

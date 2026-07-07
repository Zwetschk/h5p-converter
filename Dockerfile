# H5P Converter – Container-Image
# Build:  docker build -t h5p-converter .
# Start:  docker run -d -p 3300:3300 --name h5p-converter h5p-converter
FROM node:22-alpine

WORKDIR /app

# Erst Abhängigkeiten installieren (Docker-Layer-Cache nutzen).
# postinstall lädt dabei die H5P-Core-/Editor-Dateien nach vendor/
# – dafür braucht der Build-Vorgang Internetzugang.
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

ENV PORT=3300
EXPOSE 3300

# Laufzeit ohne Root-Rechte; schreibt nur ins System-Temp-Verzeichnis
USER node

CMD ["node", "src/server.js"]

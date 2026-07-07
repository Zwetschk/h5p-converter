/**
 * Lokale Web-Oberfläche: Drag & Drop einer .h5p-Datei, Format wählen,
 * Ergebnis wird als Download zurückgeliefert.
 */
const path = require('path');
const os = require('os');
const { promises: fs } = require('fs');
const express = require('express');
const multer = require('multer');
const {
    convertToAllInOneHtml,
    convertToHtml5Package,
    safeFileName
} = require('./converter');

const PORT = process.env.PORT || 3300;
const upload = multer({
    dest: path.join(os.tmpdir(), 'h5p-uploads'),
    limits: { fileSize: 500 * 1024 * 1024 } // 500 MB
});

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/convert', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }
    const format = req.body.format === 'package' ? 'package' : 'html';
    try {
        if (format === 'html') {
            const { html, title } = await convertToAllInOneHtml(req.file.path);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                contentDisposition(`${safeFileName(title)}.html`)
            );
            res.send(html);
        } else {
            const { zip, title } = await convertToHtml5Package(req.file.path);
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader(
                'Content-Disposition',
                contentDisposition(`${safeFileName(title)}-html5-paket.zip`)
            );
            res.send(zip);
        }
    } catch (error) {
        console.error('Konvertierung fehlgeschlagen:', error);
        res.status(422).json({ error: error.message });
    } finally {
        fs.rm(req.file.path, { force: true }).catch(() => {});
    }
});

function contentDisposition(filename) {
    const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

app.listen(PORT, () => {
    console.log(`H5P Converter läuft: http://localhost:${PORT}`);
});

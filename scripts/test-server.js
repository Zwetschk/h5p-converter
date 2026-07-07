// Kleiner statischer Server nur zum Testen der Konvertierungsergebnisse.
const path = require('path');
const express = require('express');
const app = express();
app.use(express.static(path.join(__dirname, '..', 'test-data', 'out')));
app.listen(8090, () => console.log('Testserver: http://localhost:8090'));

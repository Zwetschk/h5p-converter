@echo off
rem Startet den H5P Converter und oeffnet die Web-Oberflaeche im Browser.
cd /d "%~dp0"
start "" http://localhost:3300
node src\server.js

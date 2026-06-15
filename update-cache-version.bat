@echo off
:: ─────────────────────────────────────────────────────────
::  CineLog — Aggiorna versione cache del Service Worker
::  Esegui questo script dopo aver modificato file statici
::  (index.html, style.css, app.js, ecc.)
:: ─────────────────────────────────────────────────────────

set SW_FILE=frontend\service-worker.js

:: Leggi versione attuale
for /f "tokens=*" %%a in ('python -c "import re; content=open('%SW_FILE%').read(); m=re.search(r'CACHE_VERSION = (\d+)', content); print(m.group(1) if m else 1)"') do set CURRENT=%%a

:: Incrementa
set /a NEW=%CURRENT%+1

:: Sostituisci nel file
python -c "
import re, sys
with open(r'%SW_FILE%', 'r') as f:
    content = f.read()
content = re.sub(r'CACHE_VERSION = \d+', 'CACHE_VERSION = %NEW%', content)
with open(r'%SW_FILE%', 'w') as f:
    f.write(content)
print('Cache version: %CURRENT% -> %NEW%')
"

echo.
echo  Service worker aggiornato: v%CURRENT% -^> v%NEW%
echo  Riavvia il server con start.bat per applicare le modifiche.
echo.
pause

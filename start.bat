@echo off
title CineLog
color 0A

echo.
echo  =========================================
echo   CineLog
echo  =========================================
echo.
echo  Come vuoi avviare CineLog?
echo.
echo    [1] Finestra app  (PyWebView - consigliato)
echo    [2] Solo server   (apri http://localhost:8000 nel browser)
echo.
set /p CHOICE="Scelta [1/2, default 1]: "
if "%CHOICE%"=="" set CHOICE=1

:: Cerca Python 3.12 o 3.11 prima, poi fallback al default
set PYTHON=
for %%V in (3.12 3.11 3.10 3.13) do (
    if not defined PYTHON (
        py -%%V --version >nul 2>&1
        if not errorlevel 1 set PYTHON=py -%%V
    )
)
if not defined PYTHON (
    python --version >nul 2>&1
    if not errorlevel 1 (
        set PYTHON=python
    ) else (
        echo  [ERRORE] Python non trovato. Installalo da python.org
        pause
        exit /b 1
    )
)

echo  Uso: %PYTHON%
echo.

:: Installa dipendenze
echo  Controllo dipendenze...
%PYTHON% -m pip install -r backend\requirements.txt --quiet
if errorlevel 1 (
    echo  [ERRORE] Installazione dipendenze fallita.
    echo  Se usi Python 3.14, installa Python 3.12 da python.org
    pause
    exit /b 1
)

:: Aggiorna versione cache SW
%PYTHON% -c "
import re, time
try:
    sw = open('frontend/service-worker.js').read()
    new_ver = int(time.time())
    sw = re.sub(r'CACHE_VERSION = \d+', f'CACHE_VERSION = {new_ver}', sw)
    open('frontend/service-worker.js', 'w').write(sw)
except: pass
" 2>nul

echo.

if "%CHOICE%"=="2" goto SERVER_ONLY

:GUI_MODE
echo  Avvio CineLog in finestra app...
echo  (Chiudi la finestra per fermare il server)
echo.
cd backend
%PYTHON% gui.py
goto END

:SERVER_ONLY
echo  Avvio server su http://localhost:8000
echo  Documentazione API: http://localhost:8000/docs
echo.
echo  Premi Ctrl+C per fermare il server.
echo.
cd backend
%PYTHON% -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

:END
pause

@echo off
title CineLog
color 0A

echo.
echo  =========================================
echo   CineLog - Avvio in corso...
echo  =========================================
echo.

:: Controlla che Python sia installato
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERRORE] Python non trovato. Installalo da python.org
    pause
    exit /b 1
)

:: Installa le dipendenze se non ci sono
echo  Controllo dipendenze...
pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo  Installazione dipendenze ^(solo al primo avvio^)...
    pip install -r backend\requirements.txt
    echo.
)

:: Avvia il server FastAPI (serve anche il frontend)
echo  Avvio server su http://localhost:8000
echo  Documentazione API: http://localhost:8000/docs
echo.
echo  Premi Ctrl+C per fermare il server.
echo.

cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

pause

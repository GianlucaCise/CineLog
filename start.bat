@echo off
title CineLog
color 0A

echo.
echo  =========================================
echo   CineLog - Avvio in corso...
echo  =========================================
echo.

:: Cerca Python 3.12 o 3.11 prima, poi fallback al default
set PYTHON=
for %%V in (3.12 3.11 3.10 3.13) do (
    if not defined PYTHON (
        py -%%V --version >nul 2>&1
        if not errorlevel 1 set PYTHON=py -%%V
    )
)

:: Fallback al python di sistema
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
%PYTHON% --version
echo.

:: Installa dipendenze usando lo stesso Python
echo  Controllo dipendenze...
%PYTHON% -m pip install -r backend\requirements.txt --quiet
if errorlevel 1 (
    echo.
    echo  [ERRORE] Installazione dipendenze fallita.
    echo  Se usi Python 3.14, installa Python 3.12 da python.org
    echo  I pacchetti non supportano ancora Python 3.14.
    pause
    exit /b 1
)

echo.
echo  Avvio server su http://localhost:8000
echo  Documentazione API: http://localhost:8000/docs
echo.
echo  Premi Ctrl+C per fermare il server.
echo.

cd backend
%PYTHON% -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

pause

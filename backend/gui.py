"""
CineLog — gui.py
Avvia FastAPI in un thread background e apre una finestra PyWebView nativa.
Usato sia per lo sviluppo locale che come entrypoint per l'exe PyInstaller.
"""

import sys
import os
import threading
import time
import logging
from pathlib import Path

# ─── PATH RESOLUTION ───────────────────────────────────────
# Quando compilato con PyInstaller, i file estratti sono in sys._MEIPASS
if getattr(sys, 'frozen', False):
    BASE_DIR    = Path(sys._MEIPASS)
    EXE_DIR     = Path(sys.executable).parent
    # Redirect log a file accanto all'exe
    log_path    = EXE_DIR / 'cinelog.log'
    _log_file   = open(log_path, 'a', encoding='utf-8')
    sys.stdout  = _log_file
    sys.stderr  = _log_file
else:
    BASE_DIR    = Path(__file__).parent.parent
    EXE_DIR     = BASE_DIR

os.environ['CINELOG_FRONTEND_DIR'] = str(BASE_DIR / 'frontend')
os.environ['CINELOG_DB_DIR']       = str(EXE_DIR)

# ─── BACKEND THREAD ────────────────────────────────────────
sys.path.insert(0, str(BASE_DIR / 'backend'))

def start_backend():
    import uvicorn
    from main import app
    uvicorn.run(app, host='127.0.0.1', port=8000, log_config=None)

def wait_for_backend(timeout=10):
    """Aspetta che FastAPI sia pronto prima di aprire la finestra."""
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen('http://127.0.0.1:8000/api/status', timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False

# ─── MAIN ──────────────────────────────────────────────────
if __name__ == '__main__':
    # Avvia il server in background
    server_thread = threading.Thread(target=start_backend, daemon=True)
    server_thread.start()

    # Aspetta che sia pronto
    ready = wait_for_backend(timeout=15)
    if not ready:
        print('Backend non risponde dopo 15 secondi — controlla cinelog.log')

    # Apri la finestra PyWebView
    import webview

    window = webview.create_window(
        title='CineLog',
        url='http://127.0.0.1:8000',
        width=1280,
        height=800,
        min_size=(900, 600),
        resizable=True,
        text_select=True,        # permetti selezione testo
        confirm_close=False,
    )

    webview.start(
        debug=False,             # True per aprire DevTools (solo sviluppo)
        storage_path=str(EXE_DIR / '.webview_cache'),
    )

    # Quando la finestra viene chiusa, il daemon thread del server muore con il processo
    sys.exit(0)

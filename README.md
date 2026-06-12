# 🎬 CineLog "v2"

Diario personale di film e serie TV con backend FastAPI + SQLite.

## Avvio rapido (Windows)

```
Doppio click su start.bat
```

Apre automaticamente il server su **http://localhost:8000**.  
Al primo avvio installa le dipendenze Python automaticamente.

## Requisiti

- Python 3.9+

## Struttura

```
cinelog/
├── backend/
│   ├── main.py           # FastAPI server + API REST
│   ├── database.py       # Schema SQLite e helpers
│   ├── requirements.txt
│   └── cinelog.db        # Creato automaticamente al primo avvio
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── config.example.js
│   └── config.js         # Tua configurazione — non pubblicare!
├── start.bat
└── README.md
```

## Come funziona il salvataggio

CineLog usa **due layer di storage** con fallback automatico:

1. **Backend SQLite** (priorità) — quando `start.bat` è in esecuzione, tutti i dati vengono letti e scritti su `backend/cinelog.db`. Il file è portabile: copialo per fare backup.

2. **IndexedDB** (fallback) — se il backend non è raggiungibile, l'app funziona comunque usando il database del browser. I dati vengono sincronizzati al backend al prossimo avvio.

L'indicatore **● Server / ○ Offline** nell'header mostra lo stato in tempo reale.

## Migrazione da una versione precedente

Se hai già dati in IndexedDB dalla versione precedente:

1. Avvia il server con `start.bat`
2. Apri le Impostazioni
3. Clicca **"Migra dati locali → SQLite"**

## API REST

Con il server avviato, la documentazione interattiva è disponibile su:  
**http://localhost:8000/docs**

Endpoint principali:
- `GET /api/status` — stato server e DB
- `GET/POST/PUT/DELETE /api/media` — film e serie
- `GET/POST/PUT/DELETE /api/sagas` — saghe
- `GET/PUT /api/settings/{key}` — impostazioni
- `POST /api/import` — importazione bulk JSON

## Configurazione

Copia `frontend/config.example.js` in `frontend/config.js` e compila i campi,  
oppure usa **Impostazioni → Scarica config.js aggiornato** dall'app.

`config.js` è già nel `.gitignore`.

## Backup

- **SQLite**: copia `backend/cinelog.db` dove vuoi
- **JSON**: Impostazioni → Esporta JSON
- **Gist**: Impostazioni → Backup su GitHub Gist

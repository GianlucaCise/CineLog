# 🎬 CineLog v2

Diario personale di film e serie TV con backend FastAPI + SQLite.

---

## Avvio rapido (Windows)

```
Doppio click su start.bat
```

Apre automaticamente il server su **http://localhost:8000**.  
Al primo avvio installa le dipendenze Python automaticamente.

> **Nota Python:** richiede Python 3.10, 3.11 o 3.12. Python 3.14 non è ancora supportato
> dai pacchetti usati. Se hai più versioni installate, `start.bat` sceglie automaticamente
> la versione compatibile tramite il Python Launcher di Windows (`py`).

---

## Requisiti

- Python 3.10 / 3.11 / 3.12 — [python.org](https://python.org)
- Browser moderno (Chrome, Edge, Firefox)

---

## Struttura

```
cinelog/
├── backend/
│   ├── main.py              # FastAPI server + API REST
│   ├── database.py          # Schema SQLite, helpers e migrazione automatica
│   ├── requirements.txt
│   └── cinelog.db           # Creato automaticamente al primo avvio
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── manifest.json        # PWA manifest
│   ├── service-worker.js    # PWA cache offline
│   ├── icons/               # Icone PWA (192x192, 512x512)
│   ├── config.example.js    # Template configurazione
│   └── config.js            # Tua configurazione — non pubblicare!
├── start.bat                # Avvia il server
├── update-cache-version.bat # Invalida cache PWA dopo modifiche manuali
├── favicon.ico
└── README.md
```

---

## Funzionalità

### Libreria
- Film e serie con poster, anno, genere, sinossi, note personali
- Ricerca automatica via **TMDB** (API Key v3 o Read Access Token v4)
- Vista **griglia** o **lista**
- Ordinamento per data aggiunta, titolo, anno, voto
- Filtri: tutti / film / serie / da valutare

### Valutazioni
- **Stelle con mezze stelle** (½★ – 5★) e/o **voto numerico** (0–10), sincronizzati
- Valutazione per **stagione** e per **singolo episodio**

### Serie TV
- Stagioni ed episodi recuperati automaticamente da TMDB
- Flag **visto / non visto** per ogni episodio con checkbox
- Tasti "✓ Tutti / ○ Nessuno" per marcare una stagione intera
- Indicatore episodio corrente (primo non visto) con barra avanzamento
- Percentuale avanzamento per stagione e per la serie intera

### Avanzamento visione
- **Film**: campo durata in minuti + modale avanzamento con barra animata
- **Serie**: calcolato automaticamente dai flag episodi visti

### Saghe
- Raggruppa film e serie in saghe (MCU, Harry Potter, Spider-Man…)
- Pagina dedicata con miniature e contatore titoli

### Watchlist
- Segna titoli da guardare con 📌
- Sezione dedicata con badge nel menu
- Quando aggiungi dalla watchlist, la spunta "Da vedere" è pre-selezionata

### Tag personalizzati
- Etichette libere per ogni titolo (es. "capolavoro", "da rivedere", "horror")
- Aggiunta con `Enter` o virgola, rimovibili con ✕
- Tag cloud nella pagina statistiche

### Data visione
- Campi inizio / fine visione
- Se stesso giorno: "Visto il 15/06/2024"
- Se più giorni: "Dal 10/06 al 15/06/2024"

### Statistiche
- Totali (titoli, film, serie, ore viste, media voti)
- Grafico distribuzione voti
- Bar chart generi e anni più frequenti
- Tag cloud

---

## Salvataggio dati

CineLog usa **due layer di storage** con fallback automatico:

**1. Backend SQLite** (priorità) — quando `start.bat` è in esecuzione, tutti i dati
vengono letti e scritti su `backend/cinelog.db`. È un file portabile: copialo per fare backup.

**2. IndexedDB** (fallback) — se il backend non è raggiungibile, l'app funziona comunque
usando il database locale del browser. I dati vengono sincronizzati al backend al prossimo avvio.

L'indicatore **● Server / ○ Offline** nell'header mostra lo stato in tempo reale.

### Migrazione da versione precedente

Se hai già dati in IndexedDB:
1. Avvia il server con `start.bat`
2. Apri le Impostazioni
3. Clicca **"Migra dati locali → SQLite"**

---

## Backup

| Metodo | Come | Quando usarlo |
|--------|------|---------------|
| **SQLite** | Copia `backend/cinelog.db` | Backup completo e portabile |
| **Gist** | Impostazioni → Esegui il backup! | Sync online, recuperabile da qualsiasi browser |
| **Auto Gist** | Impostazioni → frequenza auto backup | Automatico ogni 1/6/12/24 ore |
| **JSON** | Impostazioni → Esporta JSON | Formato universale, import/export tra versioni |

---

## Configurazione

### Chiave API TMDB

Necessaria per la ricerca automatica di film e serie. Gratuita.

1. Registrati su [themoviedb.org](https://www.themoviedb.org)
2. Vai su [Impostazioni → API](https://www.themoviedb.org/settings/api)
3. Crea un'applicazione (puoi mettere `http://localhost` come URL)
4. Copia la **API Key v3** (stringa corta) oppure il **Read Access Token v4** (inizia con `eyJ…`)

Inserisci la chiave in **Impostazioni → API TMDB** nell'app, oppure in `config.js`.

### config.js

Copia `frontend/config.example.js` in `frontend/config.js` e compila:

```js
const CINELOG_CONFIG = {
  TMDB_KEY: 'la-tua-chiave',
  GITHUB_TOKEN: 'ghp_...',   // per il backup su Gist
  GIST_ID: '',               // lascia vuoto per crearne uno nuovo
};
```

`config.js` è già nel `.gitignore`. Puoi anche scaricarlo aggiornato da
**Impostazioni → Scarica config.js aggiornato**.

Per ogni chiave puoi scegliere se leggerla dal **database** o da **config.js**
nella sezione "Sorgente chiavi API" delle impostazioni.

---

## PWA — Installazione come app desktop

Con il server avviato, apri `http://localhost:8000` in **Chrome** o **Edge**.
Clicca sull'icona di installazione nella barra degli indirizzi (▯↓) e CineLog
appare nel menu Start come un'app normale, senza barra del browser.

> `start.bat` aggiorna automaticamente la versione della cache ad ogni avvio,
> quindi le modifiche ai file statici vengono sempre recepite.
> Se modifichi file senza riavviare il server, usa `update-cache-version.bat`.

---

## API REST

Con il server avviato, la documentazione interattiva è su:
**http://localhost:8000/docs**

Endpoint principali:

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/api/status` | Stato server e dimensione DB |
| GET/POST/PUT/DELETE | `/api/media` | Film e serie |
| GET/POST/PUT/DELETE | `/api/sagas` | Saghe |
| GET/PUT | `/api/settings/{key}` | Impostazioni |
| GET | `/api/stats` | Statistiche aggregate |
| POST | `/api/import` | Importazione bulk JSON |

---

## Pubblicazione su GitHub

`config.js` è già nel `.gitignore` — non verrà mai incluso nei commit.

Per pubblicare il solo frontend su **GitHub Pages**:
1. Rimuovi la dipendenza dal backend (i dati vivranno solo in IndexedDB)
2. Inserisci la chiave TMDB direttamente nelle impostazioni dell'app
3. Abilita GitHub Pages dalla branch `main`

Per la **GitHub Action** che compila automaticamente un `.exe` ad ogni release,
il supporto è in arrivo — vedi la sezione Issues del repository.

---

## Licenza

MIT

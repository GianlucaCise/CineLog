# 🎬 CineLog

Diario personale di film e serie TV. Valutazioni per film, serie, singole stagioni ed episodi. Gruppi in saghe. Watchlist. Backup su GitHub Gist.

---

## Funzionalità

- **Libreria** — cataloga film e serie con poster, anno, genere e sinossi
- **Valutazioni** — stelle (con mezze stelle), voto 0–10, o entrambi sincronizzati (½★ = 1, 1★ = 2, … 5★ = 10)
- **Serie TV** — valutazione per stagione e per singolo episodio; stagioni ed episodi recuperati automaticamente da TMDB
- **Saghe** — raggruppa titoli in saghe (es. Spider-Man, MCU, Harry Potter)
- **Watchlist** — segna titoli da guardare, con badge nel menu
- **TMDB** — ricerca automatica di film e serie con poster, sinossi e dati stagioni/episodi
- **Storage** — IndexedDB (persistente, locale, nessun server richiesto)
- **Backup** — export/import JSON locale + sync su GitHub Gist privato

---

## Avvio rapido

Il progetto è composto da file statici. Non serve nessun server backend, ma il browser richiede che i file vengano serviti via `http://` (non `file://`) per via delle restrizioni CORS dell'API TMDB.

### Con Python (consigliato)

```bash
# Entra nella cartella del progetto
cd cinelog

# Python 3
python -m http.server 8080
```

Apri il browser su **http://localhost:8080**

### Con Node.js

```bash
npx serve .
```

### Con VS Code

Installa l'estensione **Live Server** di Ritwick Dey, poi clicca su *Go Live* in basso a destra.

---

## Struttura del progetto

```
cinelog/
├── index.html          # Markup
├── style.css           # Stili
├── app.js              # Logica
├── config.example.js   # Template configurazione (vedi sotto)
├── config.js           # Configurazione personale — NON pubblicare!
└── .gitignore          # Esclude config.js automaticamente
```

---

## Configurazione

### Chiave API TMDB

Necessaria per la ricerca automatica di film e serie. Gratuita.

1. Registrati su [themoviedb.org](https://www.themoviedb.org)
2. Vai su [Impostazioni → API](https://www.themoviedb.org/settings/api)
3. Crea un'applicazione (puoi mettere `http://localhost` come URL)
4. Copia la **API Key v3** (stringa corta) oppure il **Read Access Token v4** (inizia con `eyJ…`) — entrambi funzionano

Puoi inserire la chiave in due modi:

#### Metodo 1 — In-app (consigliato per uso locale)

Apri **Impostazioni** nell'app → incolla la chiave nel campo *Chiave API*. Viene salvata in IndexedDB sul tuo browser. Non esce mai dal tuo computer.

> ⚠️ Questo metodo **non modifica** `config.js`. Il file sul disco rimane invariato perché il browser non può scrivere file nel filesystem. Le impostazioni vengono salvate nel database interno del browser.

#### Metodo 2 — `config.js` (per deployment su GitHub Pages o simili)

```bash
# Copia il template
cp config.example.js config.js
```

Modifica `config.js`:

```js
const CINELOG_CONFIG = {
  TMDB_KEY: 'la-tua-chiave-qui',
  GITHUB_TOKEN: '',
  GIST_ID: '',
};
```

> `config.js` è già nel `.gitignore` — non verrà mai incluso nei commit.

---

### Backup su GitHub Gist

Permette di salvare e ripristinare i tuoi dati su un Gist privato.

1. Vai su [github.com/settings/tokens](https://github.com/settings/tokens)
2. Crea un **Personal Access Token** (classic) con permesso **`gist`**
3. Incollalo in **Impostazioni → Token GitHub**

Al primo backup viene creato automaticamente un Gist privato. L'ID viene salvato e riutilizzato per i backup successivi. Puoi anche inserire manualmente l'ID di un Gist esistente.

In alternativa puoi inserire token e ID in `config.js`:

```js
const CINELOG_CONFIG = {
  TMDB_KEY: '...',
  GITHUB_TOKEN: 'ghp_...',
  GIST_ID: '',   // lascia vuoto per crearne uno nuovo
};
```

---

## Salvataggio dei dati

CineLog usa **IndexedDB** come database principale. I dati sono:

- Salvati automaticamente ad ogni modifica
- Persistenti tra sessioni del browser
- Locali al browser in uso (non sincronizzati tra dispositivi, usa il backup Gist per quello)
- Cancellati se pulisci i dati del sito nel browser

Per non perdere i dati usa regolarmente il backup su Gist o l'export JSON locale (Impostazioni → Esporta JSON).

---

## Pubblicazione su GitHub Pages

1. Assicurati che `config.js` **non** sia nel repository (è già nel `.gitignore`)
2. Fai push del progetto su GitHub
3. Vai su *Settings → Pages* e abilita GitHub Pages dalla branch `main`
4. Inserisci la chiave TMDB direttamente nelle impostazioni dell'app una volta online

---

## Licenza

MIT

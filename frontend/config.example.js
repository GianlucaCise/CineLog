// ─────────────────────────────────────────────────────────
//  CineLog — Configurazione
//  1. Copia questo file e rinominalo in: config.js
//  2. Inserisci i tuoi valori
//  3. config.js è già nel .gitignore — non verrà mai pubblicato
//
//  Le impostazioni UI (tema, colori, modalità valutazione)
//  si configurano direttamente dall'app e vengono salvate nel DB.
// ─────────────────────────────────────────────────────────

const CINELOG_CONFIG = {
  // Chiave API TMDB (v3, stringa corta) OPPURE Read Access Token (v4, inizia con eyJ...)
  // Ottieni la tua chiave su: https://www.themoviedb.org/settings/api
  TMDB_KEY: '',

  // Token GitHub per il backup su Gist (opzionale)
  // Genera un token su: https://github.com/settings/tokens
  // Permessi necessari: solo "gist"
  GITHUB_TOKEN: '',

  // ID del Gist esistente da usare per il backup (opzionale)
  // Lascia vuoto per crearne uno nuovo automaticamente al primo backup
  GIST_ID: '',
};

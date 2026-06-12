// ─────────────────────────────────────────────────────────
//  CineLog — Configurazione
//  1. Copia questo file e rinominalo in: config.js
//  2. Inserisci i tuoi valori
//  3. Aggiungi config.js al tuo .gitignore (già presente)
//
//  In alternativa usa "Scarica config.js aggiornato"
//  nelle Impostazioni dell'app per generarlo automaticamente.
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

  // Tema UI: 'dark' | 'light' | 'system'
  THEME: 'dark',

  // Colore accent: 'gold' | 'blue' | 'green' | 'red' | 'purple' | 'pink'
  ACCENT: 'gold',

  // Modalità valutazione: 'stars' | 'numeric' | 'both'
  RATING_MODE: 'both',
};

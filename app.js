/* ═══════════════════════════════════════════════════════════
   CineLog — app.js
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─── CONFIG (from config.js if available) ──────────────────
const CFG = (typeof CINELOG_CONFIG !== 'undefined') ? CINELOG_CONFIG : { TMDB_KEY: '', GITHUB_TOKEN: '', GIST_ID: '' };

// ─── STATE ─────────────────────────────────────────────────
let ratingMode = 'both';    // 'stars' | 'numeric' | 'both'
let tmdbKey    = CFG.TMDB_KEY    || '';
let ghToken    = CFG.GITHUB_TOKEN || '';
let gistId     = CFG.GIST_ID     || '';
let currentFilter    = 'all';
let searchQuery      = '';
let currentPage      = 'library';
let currentDetailId  = null;
let currentSagaId    = null;
let editingMediaId   = null;
let epRatingTarget   = null;
let seasonRatingTarget = null;
let tmdbTimer        = null;

const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

// ─── INDEXEDDB ─────────────────────────────────────────────
let db;
const DB_NAME    = 'CineLogDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('media'))
        d.createObjectStore('media', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('sagas'))
        d.createObjectStore('sagas', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings'))
        d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function dbPut(store, obj) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function dbDelete(store, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function getSetting(key) {
  return new Promise((resolve) => {
    const tx  = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror   = () => resolve(null);
  });
}

async function setSetting(key, value) {
  return dbPut('settings', { key, value });
}

// In-memory cache
let mediaList = [];
let sagaList  = [];

async function loadAll() {
  mediaList = await dbGetAll('media');
  sagaList  = await dbGetAll('sagas');
}

async function saveMedia(item) {
  await dbPut('media', item);
  const idx = mediaList.findIndex(m => m.id === item.id);
  if (idx >= 0) mediaList[idx] = item; else mediaList.push(item);
}

async function deleteMedia(id) {
  await dbDelete('media', id);
  mediaList = mediaList.filter(m => m.id !== id);
}

async function saveSaga(item) {
  await dbPut('sagas', item);
  const idx = sagaList.findIndex(s => s.id === item.id);
  if (idx >= 0) sagaList[idx] = item; else sagaList.push(item);
}

async function deleteSaga(id) {
  await dbDelete('sagas', id);
  sagaList = sagaList.filter(s => s.id !== id);
}

// ─── RATING HELPERS ────────────────────────────────────────

// Convert between half-star (0..5 in 0.5 steps) and 0-10 numeric
function starsToNumeric(stars) { return stars * 2; }
function numericToStars(n)     { return n / 2; }

function ratingIsEmpty(r) {
  if (!r) return true;
  return r.stars == null && r.numeric == null;
}

/** Render a static stars display for a rating object */
function renderStars(stars) {
  // stars: 0..5 in 0.5 steps
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (stars >= i) {
      html += `<span class="s-full">★</span>`;
    } else if (stars >= i - 0.5) {
      // half star using clip-path trick via CSS class
      html += `<span class="s-half" style="display:inline-block;position:relative;">★<span style="position:absolute;left:0;top:0;color:var(--bg4);clip-path:inset(0 0 0 50%);">★</span></span>`;
    } else {
      html += `<span class="s-empty">★</span>`;
    }
  }
  return `<span class="stars-display">${html}</span>`;
}

function displayRating(r) {
  if (ratingIsEmpty(r)) return '<span class="no-rating">Nessuna valutazione</span>';
  let html = '';
  if ((ratingMode === 'stars' || ratingMode === 'both') && r.stars != null) {
    html += renderStars(r.stars) + ' ';
  }
  if ((ratingMode === 'numeric' || ratingMode === 'both') && r.numeric != null) {
    html += `<span class="score-badge">${r.numeric}/10</span>`;
  }
  return html || '<span class="no-rating">—</span>';
}

function displayRatingSmall(r) {
  if (ratingIsEmpty(r)) return '<span class="no-rating">—</span>';
  if ((ratingMode === 'numeric' || ratingMode === 'both') && r.numeric != null)
    return `<span class="score-badge">${r.numeric}/10</span>`;
  if (r.stars != null) return renderStars(r.stars);
  return '<span class="no-rating">—</span>';
}

/**
 * Build an interactive star picker + optional numeric input.
 * Returns an object: { el, getRating }
 */
function buildRatingPicker(initial) {
  const wrap = document.createElement('div');
  wrap.className = 'rating-row';

  let currentStars   = initial?.stars ?? 0;
  let currentNumeric = initial?.numeric ?? null;

  let starPicker = null;
  let numInput   = null;
  const label    = document.createElement('span');
  label.className = 'rating-val-label';

  function updateLabel() {
    if (currentStars > 0)
      label.textContent = currentStars + '★';
    else
      label.textContent = '';
  }

  if (ratingMode === 'stars' || ratingMode === 'both') {
    starPicker = document.createElement('div');
    starPicker.className = 'star-picker';

    for (let i = 1; i <= 5; i++) {
      const slot = document.createElement('span');
      slot.className = 'star-slot';
      slot.textContent = '★';
      slot.dataset.i = i;

      // Half-star hover zone (left 50%)
      const halfZone = document.createElement('span');
      halfZone.className = 'half-overlay';
      halfZone.addEventListener('mouseenter', () => previewStars(i - 0.5));
      halfZone.addEventListener('click', () => setStars(i - 0.5));

      // Full-star hover zone (right 50%)
      const fullZone = document.createElement('span');
      fullZone.className = 'full-overlay';
      fullZone.addEventListener('mouseenter', () => previewStars(i));
      fullZone.addEventListener('click', () => setStars(i));

      slot.appendChild(halfZone);
      slot.appendChild(fullZone);
      starPicker.appendChild(slot);
    }

    starPicker.addEventListener('mouseleave', () => paintStars(currentStars));

    wrap.appendChild(starPicker);
    wrap.appendChild(label);
    paintStars(currentStars);
    updateLabel();
  }

  if (ratingMode === 'numeric' || ratingMode === 'both') {
    numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.min  = 0; numInput.max = 10; numInput.step = 0.5;
    numInput.value = currentNumeric != null ? currentNumeric : '';
    numInput.className = 'form-input';
    numInput.style.width = '90px';
    numInput.placeholder = '0–10';

    numInput.addEventListener('input', () => {
      const v = parseFloat(numInput.value);
      if (!isNaN(v) && ratingMode === 'both') {
        // Sync stars from numeric
        currentNumeric = Math.min(10, Math.max(0, v));
        currentStars   = numericToStars(currentNumeric);
        paintStars(currentStars);
        updateLabel();
      }
    });

    wrap.appendChild(numInput);
  }

  function previewStars(val) {
    paintStars(val);
  }

  function setStars(val) {
    currentStars = val;
    if (ratingMode === 'both') {
      currentNumeric = starsToNumeric(val);
      if (numInput) numInput.value = currentNumeric;
    }
    paintStars(currentStars);
    updateLabel();
  }

  function paintStars(val) {
    if (!starPicker) return;
    starPicker.querySelectorAll('.star-slot').forEach((slot, idx) => {
      const i = idx + 1;
      slot.classList.remove('lit', 'half-lit');
      // Color the star text
      if (val >= i) {
        slot.style.color = 'var(--accent)';
      } else if (val >= i - 0.5) {
        // Half: color left half via gradient
        slot.style.background = 'linear-gradient(90deg, var(--accent) 50%, var(--bg4) 50%)';
        slot.style.webkitBackgroundClip = 'text';
        slot.style.webkitTextFillColor = 'transparent';
        slot.style.backgroundClip = 'text';
        return;
      } else {
        slot.style.color = 'var(--bg4)';
      }
      slot.style.background = '';
      slot.style.webkitBackgroundClip = '';
      slot.style.webkitTextFillColor = '';
      slot.style.backgroundClip = '';
    });
  }

  function getRating() {
    const r = {};
    if (ratingMode === 'stars' || ratingMode === 'both') {
      if (currentStars > 0) r.stars = currentStars;
    }
    if (ratingMode === 'numeric' || ratingMode === 'both') {
      if (numInput && numInput.value !== '') {
        r.numeric = parseFloat(numInput.value);
      } else if (ratingMode === 'both' && currentStars > 0) {
        r.numeric = starsToNumeric(currentStars);
      }
    }
    return Object.keys(r).length ? r : null;
  }

  return { el: wrap, getRating };
}

// ─── TOAST ─────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => {
    t.style.animation = 'slideOut .2s ease forwards';
    setTimeout(() => t.remove(), 220);
  }, duration);
}

// ─── TMDB ──────────────────────────────────────────────────
function tmdbIsV4(key) { return key && key.startsWith('eyJ'); }

function tmdbFetchOpts() {
  if (tmdbIsV4(tmdbKey))
    return { headers: { 'Authorization': 'Bearer ' + tmdbKey, 'Content-Type': 'application/json' } };
  return {};
}

function tmdbBuildUrl(path, params = '') {
  const base = 'https://api.themoviedb.org/3' + path;
  if (tmdbIsV4(tmdbKey)) return base + (params ? '?' + params : '');
  const join = params ? '&' : '?';
  return base + '?api_key=' + tmdbKey + (params ? join + params : '');
}

async function tmdbTest(key) {
  const isV4 = key.startsWith('eyJ');
  const url   = 'https://api.themoviedb.org/3/configuration' + (isV4 ? '' : '?api_key=' + key);
  const opts  = isV4 ? { headers: { Authorization: 'Bearer ' + key } } : {};
  try {
    const r = await fetch(url, opts);
    return { ok: r.ok, status: r.status, isV4 };
  } catch (e) {
    return { ok: false, status: 0, isV4, networkError: true };
  }
}

function tmdbSearch(q) {
  clearTimeout(tmdbTimer);
  const res = document.getElementById('tmdb-results');
  if (!tmdbKey || q.length < 2) { res.style.display = 'none'; return; }
  tmdbTimer = setTimeout(async () => {
    res.style.display = 'block';
    res.innerHTML = '<div class="tmdb-msg">🔍 Ricerca in corso...</div>';
    try {
      const url = tmdbBuildUrl('/search/multi', `query=${encodeURIComponent(q)}&language=it-IT`);
      const r   = await fetch(url, tmdbFetchOpts());
      if (r.status === 401) { res.innerHTML = '<div class="tmdb-msg">❌ Chiave API non valida</div>'; return; }
      if (!r.ok)            { res.innerHTML = `<div class="tmdb-msg">❌ Errore ${r.status}</div>`; return; }
      const data = await r.json();
      const results = (data.results || []).filter(x => x.media_type === 'movie' || x.media_type === 'tv').slice(0, 8);
      if (!results.length) { res.innerHTML = '<div class="tmdb-msg">Nessun risultato</div>'; return; }
      res.innerHTML = results.map(x => {
        const title = x.title || x.name;
        const year  = (x.release_date || x.first_air_date || '').slice(0, 4);
        const type  = x.media_type === 'movie' ? 'Film' : 'Serie';
        const thumb = x.poster_path
          ? `<img class="tmdb-thumb" src="${TMDB_IMG}${x.poster_path}" loading="lazy">`
          : `<div class="tmdb-thumb-ph">🎬</div>`;
        const payload = JSON.stringify({ id: x.id, title, year, mediaType: x.media_type, poster: x.poster_path ? TMDB_IMG + x.poster_path : '', overview: x.overview || '' }).replace(/"/g, '&quot;');
        return `<div class="tmdb-item" onclick="fillFromTmdb(JSON.parse(this.dataset.p))" data-p="${payload}">
          ${thumb}<div class="tmdb-info"><h4>${title}</h4><p>${type}${year ? ' · ' + year : ''}</p></div></div>`;
      }).join('');
    } catch (e) {
      res.innerHTML = '<div class="tmdb-msg">❌ Errore di rete — usa http://localhost?</div>';
    }
  }, 380);
}

async function fillFromTmdb(data) {
  document.getElementById('f-title').value    = data.title;
  document.getElementById('f-year').value     = data.year;
  document.getElementById('f-type').value     = data.mediaType === 'tv' ? 'series' : 'movie';
  document.getElementById('f-poster').value   = data.poster || '';
  document.getElementById('f-synopsis').value = data.overview || '';
  toggleSeriesFields();
  document.getElementById('tmdb-results').style.display = 'none';
  document.getElementById('tmdb-search').value = data.title;

  // For TV series: fetch full details to get seasons + episodes
  if (data.mediaType === 'tv') {
    const seasonsWrap = document.getElementById('f-seasons-wrap');
    const seasonsInput = document.getElementById('f-seasons');
    seasonsInput.value = '';
    seasonsInput.placeholder = 'Caricamento...';
    seasonsInput.disabled = true;

    try {
      const url = tmdbBuildUrl(`/tv/${data.id}`, 'language=it-IT&append_to_response=season/1');
      const r   = await fetch(url, tmdbFetchOpts());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const tv  = await r.json();

      // Filter out specials (season 0) unless it's the only one
      const seasons = (tv.seasons || []).filter(s => s.season_number > 0);
      const numSeasons = seasons.length || tv.number_of_seasons || 1;
      seasonsInput.value = numSeasons;
      seasonsInput.placeholder = '1';

      // Store detailed season data on the form for saveMediaForm to use
      // Each season gets episode count from TMDB
      const seasonData = seasons.map(s => ({
        num: s.season_number,
        episodeCount: s.episode_count,
        airDate: s.air_date,
        name: s.name,
      }));
      document.getElementById('f-seasons-wrap').dataset.tmdbSeasons = JSON.stringify(seasonData);

      toast(`Serie trovata: ${numSeasons} stagion${numSeasons === 1 ? 'e' : 'i'}, ${tv.number_of_episodes || '?'} episodi totali`, 'success');
    } catch (e) {
      seasonsInput.placeholder = '1';
      toast('Dettagli serie non disponibili, inserisci le stagioni manualmente', 'info');
    } finally {
      seasonsInput.disabled = false;
    }
  } else {
    // Clear any leftover season data
    document.getElementById('f-seasons-wrap').dataset.tmdbSeasons = '';
  }
}

// ─── GITHUB GIST BACKUP ────────────────────────────────────
async function gistBackup() {
  if (!ghToken) { toast('Inserisci un token GitHub nelle impostazioni', 'error'); return; }
  const log = document.getElementById('gist-log');
  if (log) log.textContent = 'Preparazione dati...';

  const payload = {
    ratingMode,
    exportedAt: new Date().toISOString(),
    media: mediaList,
    sagas: sagaList,
  };
  const content = JSON.stringify(payload, null, 2);
  const filename = 'cinelog-backup.json';

  try {
    let method, url;
    const currentGistId = gistId || await getSetting('gistId');

    if (currentGistId) {
      method = 'PATCH';
      url    = `https://api.github.com/gists/${currentGistId}`;
    } else {
      method = 'POST';
      url    = 'https://api.github.com/gists';
    }

    const body = { description: 'CineLog backup', public: false, files: { [filename]: { content } } };
    if (log) log.textContent = (method === 'POST' ? 'Creazione' : 'Aggiornamento') + ' Gist...';

    const r = await fetch(url, {
      method,
      headers: { Authorization: 'token ' + ghToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.json();
      throw new Error(err.message || r.status);
    }

    const data = await r.json();
    gistId = data.id;
    await setSetting('gistId', gistId);
    await setSetting('ghToken', ghToken);

    const msg = `✓ Backup completato — ${new Date().toLocaleTimeString('it-IT')}\nGist ID: ${gistId}\nURL: ${data.html_url}`;
    if (log) log.textContent = msg;
    toast('Backup su Gist completato!', 'success');

    // Update the gist ID field in settings if visible
    const gistInput = document.getElementById('settings-gist-id');
    if (gistInput) gistInput.value = gistId;
  } catch (e) {
    const msg = '✕ Errore: ' + e.message;
    if (log) log.textContent = msg;
    toast('Errore backup: ' + e.message, 'error');
  }
}

async function gistRestore() {
  const currentGistId = gistId || await getSetting('gistId');
  if (!ghToken || !currentGistId) {
    toast('Token GitHub e Gist ID richiesti per il ripristino', 'error'); return;
  }
  const log = document.getElementById('gist-log');
  if (log) log.textContent = 'Download backup...';

  try {
    const r = await fetch(`https://api.github.com/gists/${currentGistId}`, {
      headers: { Authorization: 'token ' + ghToken },
    });
    if (!r.ok) throw new Error('Gist non trovato o accesso negato');
    const data = await r.json();
    const file = Object.values(data.files)[0];
    const payload = JSON.parse(file.content);

    if (!payload.media || !payload.sagas) throw new Error('Formato backup non valido');

    if (!confirm(`Ripristinare il backup del ${new Date(payload.exportedAt).toLocaleString('it-IT')}?\nQuesto sovrascriverà i dati attuali.`)) return;

    // Clear and re-import
    for (const m of payload.media)  await dbPut('media', m);
    for (const s of payload.sagas)  await dbPut('sagas', s);
    if (payload.ratingMode) { ratingMode = payload.ratingMode; await setSetting('ratingMode', ratingMode); }

    await loadAll();
    renderAll();

    if (log) log.textContent = `✓ Ripristino completato — ${new Date(payload.exportedAt).toLocaleString('it-IT')}`;
    toast('Backup ripristinato!', 'success');
  } catch (e) {
    if (log) log.textContent = '✕ Errore: ' + e.message;
    toast('Errore ripristino: ' + e.message, 'error');
  }
}

// ─── EXPORT / IMPORT JSON ──────────────────────────────────
function exportJSON() {
  const payload = { ratingMode, exportedAt: new Date().toISOString(), media: mediaList, sagas: sagaList };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cinelog-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function importJSON() { document.getElementById('import-input').click(); }

async function handleImport(input) {
  const file = input.files[0]; if (!file) return;
  const text = await file.text();
  try {
    const payload = JSON.parse(text);
    if (!payload.media || !payload.sagas) throw new Error('Formato non valido');
    if (!confirm(`Importare ${payload.media.length} titoli e ${payload.sagas.length} saghe?\nI dati esistenti verranno mantenuti (merge).`)) return;
    for (const m of payload.media)  await dbPut('media', m);
    for (const s of payload.sagas)  await dbPut('sagas', s);
    if (payload.ratingMode) ratingMode = payload.ratingMode;
    await loadAll(); renderAll();
    toast(`Importati ${payload.media.length} titoli`, 'success');
  } catch (e) {
    toast('Errore importazione: ' + e.message, 'error');
  }
  input.value = '';
}

// ─── PAGES ─────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const map = { library: 0, watchlist: 1, saghe: 2 };
  const idx = map[name];
  if (idx != null) document.querySelectorAll('.nav-btn')[idx]?.classList.add('active');
  currentPage = name;
  if (name === 'library')   renderGrid();
  if (name === 'watchlist') renderWatchlist();
  if (name === 'saghe')     renderSaghe();
}

// ─── RENDER ────────────────────────────────────────────────
function renderAll() { renderGrid(); renderWatchlist(); renderSaghe(); updateStats(); }

function updateStats() {
  const total   = mediaList.length;
  const movies  = mediaList.filter(m => m.type === 'movie').length;
  const series  = mediaList.filter(m => m.type === 'series').length;
  const rated   = mediaList.filter(m => !ratingIsEmpty(m.rating)).length;
  const watchl  = mediaList.filter(m => m.watchlist).length;

  document.getElementById('stats-bar').innerHTML = `
    <div class="stat-pill"><b>${total}</b> titoli</div>
    <div class="stat-pill"><b>${movies}</b> film</div>
    <div class="stat-pill"><b>${series}</b> serie</div>
    <div class="stat-pill"><b>${rated}</b> valutati</div>
    <div class="stat-pill"><b>${sagaList.length}</b> saghe</div>`;

  // Watchlist badge
  const badge = document.getElementById('watchlist-badge');
  if (badge) { badge.textContent = watchl; badge.style.display = watchl ? '' : 'none'; }
}

function getFilteredMedia() {
  let items = mediaList.filter(m => !m.watchlist); // exclude watchlist from library
  if (currentFilter === 'movie')   items = items.filter(m => m.type === 'movie');
  if (currentFilter === 'series')  items = items.filter(m => m.type === 'series');
  if (currentFilter === 'unrated') items = items.filter(m => ratingIsEmpty(m.rating));
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(m => m.title.toLowerCase().includes(q) || (m.genre || '').toLowerCase().includes(q));
  }
  return items;
}

function makeCard(m, showWatchlistBadge = false) {
  const card = document.createElement('div');
  card.className = 'media-card';
  const sagaName = m.sagaId ? sagaList.find(s => s.id === m.sagaId)?.name : '';
  card.innerHTML = `
    ${m.poster ? `<img class="card-poster" src="${m.poster}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
    <div class="card-poster-placeholder" style="${m.poster ? 'display:none' : ''}">🎬</div>
    ${showWatchlistBadge && m.watchlist ? '<div class="card-watchlist-badge">Da vedere</div>' : ''}
    <div class="card-body">
      <div class="card-badge ${m.type === 'movie' ? 'badge-movie' : 'badge-series'}">${m.type === 'movie' ? 'Film' : 'Serie'}</div>
      <div class="card-title">${m.title}</div>
      <div class="card-meta">${m.year || ''}${m.genre ? ' · ' + m.genre : ''}${sagaName ? ' · ' + sagaName : ''}</div>
      <div class="card-rating">${displayRatingSmall(m.rating)}</div>
    </div>`;
  card.onclick = () => openDetail(m.id);
  return card;
}

function renderGrid() {
  const grid  = document.getElementById('media-grid');
  const empty = document.getElementById('library-empty');
  const items = getFilteredMedia();
  grid.innerHTML = '';
  if (!items.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  items.forEach((m, i) => { const c = makeCard(m); c.style.animationDelay = (i * 0.03) + 's'; grid.appendChild(c); });
}

function renderWatchlist() {
  const grid  = document.getElementById('watchlist-grid');
  const empty = document.getElementById('watchlist-empty');
  const items = mediaList.filter(m => m.watchlist);
  if (!grid) return;
  grid.innerHTML = '';
  if (!items.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  items.forEach((m, i) => { const c = makeCard(m, true); c.style.animationDelay = (i * 0.03) + 's'; grid.appendChild(c); });
}

function setFilter(f, el) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderGrid();
}
function filterSearch(v) { searchQuery = v; renderGrid(); }

// ─── SAGHE RENDER ──────────────────────────────────────────
function renderSaghe() {
  const grid  = document.getElementById('saga-grid');
  const empty = document.getElementById('saga-empty');
  if (!grid) return;
  grid.innerHTML = '';
  if (!sagaList.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  sagaList.forEach((s, i) => {
    const items = mediaList.filter(m => m.sagaId === s.id);
    const thumbs = items.slice(0, 6).map(m =>
      m.poster
        ? `<img class="saga-thumb" src="${m.poster}" loading="lazy" onerror="this.outerHTML='<div class=\\'saga-thumb-ph\\'>🎬</div>'">`
        : `<div class="saga-thumb-ph">🎬</div>`
    ).join('');
    const card = document.createElement('div');
    card.className = 'saga-card'; card.style.animationDelay = (i * 0.04) + 's';
    card.innerHTML = `
      <h3>${s.name}</h3>
      <p class="saga-count">${items.length} titol${items.length === 1 ? 'o' : 'i'}</p>
      ${s.description ? `<p style="font-size:.82rem;color:var(--text3);margin-bottom:.75rem">${s.description}</p>` : ''}
      <div class="saga-thumbs">${thumbs || '<span style="color:var(--text3);font-size:.8rem">Nessun titolo</span>'}</div>`;
    card.onclick = () => openSagaDetail(s.id);
    grid.appendChild(card);
  });
}

// ─── DETAIL ────────────────────────────────────────────────
function openDetail(id) {
  currentDetailId = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-detail').classList.add('active');
  renderDetail(id);
}

function closeDetail() {
  currentDetailId = null;
  showPage(currentPage === 'detail' ? 'library' : currentPage);
}

function renderDetail(id) {
  const m = mediaList.find(x => x.id === id);
  if (!m) return;
  const cont      = document.getElementById('detail-content');
  const sagaName  = m.sagaId ? sagaList.find(s => s.id === m.sagaId)?.name : '';
  const posterHtml = m.poster
    ? `<img class="detail-poster" src="${m.poster}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const phHtml = `<div class="detail-poster-ph" style="${m.poster ? 'display:none' : ''}">🎬</div>`;

  let seasonsHtml = '';
  if (m.type === 'series') {
    const seasons = m.seasons || [];
    seasonsHtml = `<div class="seasons-section">
      <div class="section-header">
        <h2 class="section-title">Stagioni</h2>
        <button class="btn btn-ghost btn-sm" onclick="addSeason('${id}')">+ Stagione</button>
      </div>`;
    seasons.forEach((s, si) => {
      seasonsHtml += `
        <div class="season-block">
          <div class="season-header" onclick="toggleSeason(this)">
            <h3>Stagione ${s.num}</h3>
            <div style="display:flex;align-items:center;gap:.5rem;margin-right:.5rem">${displayRatingSmall(s.rating)}</div>
            <span class="season-toggle">▾</span>
          </div>
          <div class="season-body" id="sb-${id}-${si}">
            <div class="season-rating-area">
              <label>Valutazione stagione</label>
              <span>${displayRating(s.rating) || '<span class="no-rating">Nessuna</span>'}</span>
              <button class="btn btn-ghost btn-xs" onclick="openSeasonRate('${id}',${si})">Modifica</button>
            </div>
            <ul class="episode-list">
              ${(s.episodes || []).map((ep, ei) => `
                <li class="episode-item">
                  <span class="ep-num">${ep.num || ei + 1}</span>
                  <span class="ep-title ${ep.rating ? 'watched' : ''}">${ep.title || 'Episodio ' + (ei + 1)}</span>
                  <div class="ep-rating">
                    ${displayRatingSmall(ep.rating)}
                    <button class="ep-rate-btn" onclick="openEpRate('${id}',${si},${ei})">★</button>
                  </div>
                </li>`).join('')}
            </ul>
            <button class="add-ep-btn" onclick="addEpisode('${id}',${si})">+ Aggiungi episodio</button>
          </div>
        </div>`;
    });
    seasonsHtml += '</div>';
  }

  cont.innerHTML = `
    <div class="detail-hero">
      ${posterHtml}${phHtml}
      <div class="detail-info">
        <h1>${m.title}</h1>
        <div class="detail-meta">
          <span class="card-badge ${m.type === 'movie' ? 'badge-movie' : 'badge-series'}">${m.type === 'movie' ? 'Film' : 'Serie TV'}</span>
          ${m.year ? `<span>${m.year}</span>` : ''}
          ${m.genre ? `<span>${m.genre}</span>` : ''}
          ${sagaName ? `<span style="color:var(--accent)">◆ ${sagaName}</span>` : ''}
          ${m.watchlist ? `<span class="card-badge badge-watchlist">📌 Da vedere</span>` : ''}
        </div>
        ${m.synopsis ? `<p class="detail-synopsis">${m.synopsis}</p>` : ''}
        <div class="detail-rating-box">
          <label>Valutazione complessiva</label>
          <div id="detail-rating-val">${displayRating(m.rating)}</div>
          <button class="btn btn-ghost btn-sm" style="margin-top:.25rem" onclick="openMediaRate('${id}')">Modifica valutazione</button>
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost btn-sm" onclick="editMedia('${id}')">✏ Modifica</button>
          <button class="btn ${m.watchlist ? 'btn-success' : 'btn-ghost'} btn-sm" onclick="toggleWatchlist('${id}')">
            ${m.watchlist ? '✓ In watchlist' : '📌 Aggiungi a watchlist'}
          </button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteMedia('${id}')">🗑 Elimina</button>
        </div>
      </div>
    </div>
    ${seasonsHtml}`;
}

// ─── WATCHLIST TOGGLE ──────────────────────────────────────
async function toggleWatchlist(id) {
  const m = mediaList.find(x => x.id === id);
  m.watchlist = !m.watchlist;
  await saveMedia(m);
  renderDetail(id);
  updateStats();
  toast(m.watchlist ? 'Aggiunto alla watchlist' : 'Rimosso dalla watchlist', 'info');
}

// ─── SEASONS & EPISODES ────────────────────────────────────
function toggleSeason(header) {
  const body   = header.nextElementSibling;
  const toggle = header.querySelector('.season-toggle');
  body.classList.toggle('open');
  toggle.textContent = body.classList.contains('open') ? '▴' : '▾';
}

async function addSeason(mediaId) {
  const m = mediaList.find(x => x.id === mediaId);
  if (!m.seasons) m.seasons = [];
  m.seasons.push({ num: m.seasons.length + 1, rating: null, episodes: [] });
  await saveMedia(m);
  renderDetail(mediaId);
}

async function addEpisode(mediaId, si) {
  const m = mediaList.find(x => x.id === mediaId);
  const s = m.seasons[si];
  s.episodes.push({ num: s.episodes.length + 1, title: '', rating: null });
  await saveMedia(m);
  renderDetail(mediaId);
  document.getElementById(`sb-${mediaId}-${si}`)?.classList.add('open');
}

// ─── DYNAMIC MODAL HELPER ──────────────────────────────────
function makeDynModal(title, bodyEl, onSave) {
  const ov = document.createElement('div');
  ov.className = 'overlay open'; ov.id = 'dyn-modal';
  const modal = document.createElement('div');
  modal.className = 'modal modal-sm';
  const h = document.createElement('h2'); h.className = 'modal-title'; h.textContent = title;
  const close = document.createElement('button'); close.className = 'close-btn'; close.textContent = '✕';
  close.onclick = () => ov.remove();
  const btns = document.createElement('div');
  btns.style = 'display:flex;gap:.75rem;justify-content:flex-end;margin-top:1.5rem';
  const cancel = document.createElement('button'); cancel.className = 'btn btn-ghost'; cancel.textContent = 'Annulla'; cancel.onclick = () => ov.remove();
  const save   = document.createElement('button'); save.className   = 'btn btn-primary'; save.textContent = 'Salva';   save.onclick = onSave;
  btns.append(cancel, save);
  modal.append(close, h, bodyEl, btns);
  ov.appendChild(modal);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}

// ─── RATE EPISODE ──────────────────────────────────────────
function openEpRate(mediaId, si, ei) {
  const m  = mediaList.find(x => x.id === mediaId);
  const ep = m.seasons[si].episodes[ei];

  const wrap = document.createElement('div');
  const tg   = document.createElement('div'); tg.className = 'form-group';
  const tl   = document.createElement('label'); tl.className = 'form-label'; tl.textContent = 'Titolo episodio';
  const ti   = document.createElement('input'); ti.className = 'form-input'; ti.value = ep.title || ''; ti.placeholder = 'Es. Il Trono di Spade';
  tg.append(tl, ti);

  const rg  = document.createElement('div'); rg.className = 'form-group';
  const rl  = document.createElement('label'); rl.className = 'form-label'; rl.textContent = 'Valutazione';
  const { el: ratingEl, getRating } = buildRatingPicker(ep.rating);
  rg.append(rl, ratingEl);

  wrap.append(tg, rg);

  makeDynModal(`Episodio ${ep.num || ei + 1}`, wrap, async () => {
    ep.title  = ti.value.trim();
    ep.rating = getRating();
    await saveMedia(m);
    document.getElementById('dyn-modal')?.remove();
    renderDetail(mediaId);
    document.getElementById(`sb-${mediaId}-${si}`)?.classList.add('open');
  });
}

// ─── RATE SEASON ───────────────────────────────────────────
function openSeasonRate(mediaId, si) {
  const m = mediaList.find(x => x.id === mediaId);
  const s = m.seasons[si];
  const { el: ratingEl, getRating } = buildRatingPicker(s.rating);
  const wrap = document.createElement('div'); wrap.className = 'form-group';
  const lbl  = document.createElement('label'); lbl.className = 'form-label'; lbl.textContent = 'Valutazione';
  wrap.append(lbl, ratingEl);

  makeDynModal(`Stagione ${s.num}`, wrap, async () => {
    s.rating = getRating();
    await saveMedia(m);
    document.getElementById('dyn-modal')?.remove();
    renderDetail(mediaId);
    document.getElementById(`sb-${mediaId}-${si}`)?.classList.add('open');
  });
}

// ─── RATE MEDIA ────────────────────────────────────────────
function openMediaRate(mediaId) {
  const m = mediaList.find(x => x.id === mediaId);
  const { el: ratingEl, getRating } = buildRatingPicker(m.rating);
  const wrap = document.createElement('div'); wrap.className = 'form-group';
  const lbl  = document.createElement('label'); lbl.className = 'form-label'; lbl.textContent = 'Valutazione complessiva';
  wrap.append(lbl, ratingEl);

  makeDynModal(m.title, wrap, async () => {
    m.rating = getRating();
    await saveMedia(m);
    document.getElementById('dyn-modal')?.remove();
    renderDetail(mediaId);
    updateStats();
    toast('Valutazione salvata', 'success');
  });
}

// ─── ADD / EDIT MEDIA MODAL ────────────────────────────────
let _addRatingPicker = null;

function openAdd() {
  editingMediaId = null;
  document.getElementById('add-modal-title').textContent = 'Aggiungi titolo';
  clearAddForm();
  openModal('modal-add');
}

function clearAddForm() {
  ['f-title','f-year','f-genre','f-synopsis','f-poster','f-seasons'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-type').value = 'movie';
  document.getElementById('f-seasons-wrap').style.display = 'none';
  document.getElementById('f-watchlist').checked = false;
  document.getElementById('tmdb-search').value = '';
  document.getElementById('tmdb-results').style.display = 'none';
  populateSagaSelect('');
  const ratingWrap = document.getElementById('add-rating-wrap');
  ratingWrap.innerHTML = '';
  const { el, getRating } = buildRatingPicker(null);
  ratingWrap.appendChild(el);
  _addRatingPicker = getRating;
}

function toggleSeriesFields() {
  const isSeries = document.getElementById('f-type').value === 'series';
  document.getElementById('f-seasons-wrap').style.display = isSeries ? 'block' : 'none';
}

function populateSagaSelect(selected) {
  const sel = document.getElementById('f-saga');
  sel.innerHTML = '<option value="">— Nessuna saga —</option>';
  sagaList.forEach(s => sel.innerHTML += `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${s.name}</option>`);
}

async function saveMediaForm() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { toast('Il titolo è obbligatorio', 'error'); return; }

  const type     = document.getElementById('f-type').value;
  const year     = document.getElementById('f-year').value;
  const genre    = document.getElementById('f-genre').value.trim();
  const synopsis = document.getElementById('f-synopsis').value.trim();
  const poster   = document.getElementById('f-poster').value.trim();
  const sagaId   = document.getElementById('f-saga').value || null;
  const watchlist = document.getElementById('f-watchlist').checked;
  const rating   = _addRatingPicker ? _addRatingPicker() : null;

  if (editingMediaId) {
    const m = mediaList.find(x => x.id === editingMediaId);
    Object.assign(m, { title, type, year: year ? parseInt(year) : null, genre, synopsis, poster, rating, sagaId, watchlist });
    if (type === 'series' && !m.seasons) m.seasons = [];
    await saveMedia(m);
  } else {
    const numSeasons = parseInt(document.getElementById('f-seasons').value) || 1;
    let seasons = undefined;
    if (type === 'series') {
      const rawTmdb = document.getElementById('f-seasons-wrap').dataset.tmdbSeasons;
      const tmdbSeasons = rawTmdb ? JSON.parse(rawTmdb) : null;
      if (tmdbSeasons && tmdbSeasons.length) {
        seasons = tmdbSeasons.map(s => ({
          num: s.num, rating: null,
          episodes: Array.from({ length: s.episodeCount || 0 }, (_, ei) => ({ num: ei+1, title: '', rating: null })),
        }));
      } else {
        seasons = Array.from({ length: numSeasons }, (_, i) => ({ num: i+1, rating: null, episodes: [] }));
      }
    }
    const m = {
      id: Date.now().toString() + Math.random().toString(36).slice(2,6),
      title, type,
      year: year ? parseInt(year) : null,
      genre, synopsis, poster, rating, sagaId, watchlist,
      seasons,
    };
    await saveMedia(m);
  }
  closeModal('modal-add');
  renderAll();
  toast(editingMediaId ? 'Titolo aggiornato' : 'Titolo aggiunto!', 'success');
  editingMediaId = null;
}

function editMedia(id) {
  const m = mediaList.find(x => x.id === id);
  editingMediaId = id;
  document.getElementById('add-modal-title').textContent = 'Modifica titolo';
  document.getElementById('f-title').value    = m.title;
  document.getElementById('f-type').value     = m.type;
  document.getElementById('f-year').value     = m.year || '';
  document.getElementById('f-genre').value    = m.genre || '';
  document.getElementById('f-synopsis').value = m.synopsis || '';
  document.getElementById('f-poster').value   = m.poster || '';
  document.getElementById('f-watchlist').checked = m.watchlist || false;
  toggleSeriesFields();
  populateSagaSelect(m.sagaId || '');
  const ratingWrap = document.getElementById('add-rating-wrap');
  ratingWrap.innerHTML = '';
  const { el, getRating } = buildRatingPicker(m.rating);
  ratingWrap.appendChild(el);
  _addRatingPicker = getRating;
  openModal('modal-add');
}

async function confirmDeleteMedia(id) {
  const m = mediaList.find(x => x.id === id);
  if (!confirm(`Eliminare "${m.title}"?`)) return;
  await deleteMedia(id);
  closeDetail();
  renderAll();
  toast('Titolo eliminato', 'info');
}

// ─── SAGA DETAIL ───────────────────────────────────────────
function openSagaDetail(id) {
  currentSagaId = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-saga-detail').classList.add('active');
  renderSagaDetail(id);
}
function closeSagaDetail() { currentSagaId = null; showPage('saghe'); }

function renderSagaDetail(id) {
  const s     = sagaList.find(x => x.id === id);
  if (!s) return;
  const items = mediaList.filter(m => m.sagaId === id);
  const cont  = document.getElementById('saga-detail-content');
  cont.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2rem;gap:1rem;flex-wrap:wrap">
      <div>
        <h1 style="font-size:2rem;color:var(--accent)">${s.name}</h1>
        ${s.description ? `<p style="color:var(--text2);margin-top:.3rem">${s.description}</p>` : ''}
      </div>
      <div style="display:flex;gap:.5rem">
        <button class="btn btn-ghost btn-sm" onclick="editSaga('${id}')">✏ Modifica</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteSaga('${id}')">🗑 Elimina</button>
      </div>
    </div>
    <div class="media-grid" id="saga-items-grid"></div>
    ${!items.length ? '<div class="empty-state"><p>Nessun titolo in questa saga.</p></div>' : ''}`;
  const grid = document.getElementById('saga-items-grid');
  items.forEach((m, i) => { const c = makeCard(m); c.style.animationDelay = (i * 0.03) + 's'; grid?.appendChild(c); });
}

function openAddSaga() {
  document.getElementById('saga-name').value = '';
  document.getElementById('saga-desc').value = '';
  document.getElementById('saga-modal-title').textContent = 'Nuova saga';
  document.getElementById('saga-save-btn').onclick = saveSagaForm;
  openModal('modal-saga');
}

function editSaga(id) {
  const s = sagaList.find(x => x.id === id);
  document.getElementById('saga-name').value = s.name;
  document.getElementById('saga-desc').value = s.description || '';
  document.getElementById('saga-modal-title').textContent = 'Modifica saga';
  document.getElementById('saga-save-btn').onclick = () => updateSagaForm(id);
  openModal('modal-saga');
}

async function saveSagaForm() {
  const name = document.getElementById('saga-name').value.trim();
  if (!name) { toast('Inserisci un nome', 'error'); return; }
  await saveSaga({ id: Date.now().toString(), name, description: document.getElementById('saga-desc').value.trim() });
  closeModal('modal-saga'); renderSaghe(); updateStats(); toast('Saga creata!', 'success');
}

async function updateSagaForm(id) {
  const s = sagaList.find(x => x.id === id);
  s.name        = document.getElementById('saga-name').value.trim();
  s.description = document.getElementById('saga-desc').value.trim();
  await saveSaga(s);
  closeModal('modal-saga'); renderSagaDetail(id); renderSaghe(); toast('Saga aggiornata', 'success');
}

async function confirmDeleteSaga(id) {
  const s = sagaList.find(x => x.id === id);
  if (!confirm(`Eliminare la saga "${s.name}"?\nI titoli non verranno eliminati.`)) return;
  for (const m of mediaList.filter(x => x.sagaId === id)) { m.sagaId = null; await saveMedia(m); }
  await deleteSaga(id);
  closeSagaDetail(); renderAll(); toast('Saga eliminata', 'info');
}

// ─── SETTINGS ──────────────────────────────────────────────
async function openSettings() {
  document.getElementById('settings-tmdb').value     = tmdbKey || '';
  document.getElementById('settings-gh-token').value  = ghToken || '';
  document.getElementById('settings-gist-id').value   = gistId  || await getSetting('gistId') || '';
  document.getElementById('settings-rating').value    = ratingMode;
  document.getElementById('gist-log').textContent     = '';
  updateApiStatus(tmdbKey);
  openModal('modal-settings');
}

async function saveSettings() {
  const newKey     = document.getElementById('settings-tmdb').value.trim();
  const newGhToken = document.getElementById('settings-gh-token').value.trim();
  const newGistId  = document.getElementById('settings-gist-id').value.trim();
  const newMode    = document.getElementById('settings-rating').value;

  if (newKey !== tmdbKey) { tmdbKey = newKey; await setSetting('tmdbKey', tmdbKey); }
  if (newGhToken !== ghToken) { ghToken = newGhToken; await setSetting('ghToken', ghToken); }
  if (newGistId !== gistId)  { gistId  = newGistId;  await setSetting('gistId',  gistId);  }
  if (newMode !== ratingMode) { ratingMode = newMode; await setSetting('ratingMode', ratingMode); renderAll(); }

  closeModal('modal-settings');
  toast('Impostazioni salvate', 'success');
}

function updateApiStatus(key) {
  // Status box inside settings modal
  const box = document.getElementById('api-status-box');
  if (box) {
    if (!key) { box.innerHTML = ''; }
    else {
      const isV4 = tmdbIsV4(key);
      box.className = 'api-status ' + (isV4 ? 'v4' : 'v3');
      box.innerHTML = '<span class="api-dot blue"></span> Modalità: <b>' + (isV4 ? 'Read Access Token v4' : 'API Key v3') + '</b>';
    }
  }
  updateHeaderApiPill(key);
}

function updateHeaderApiPill(key) {
  const pill = document.getElementById('header-api-pill');
  if (!pill) return;
  if (!key) {
    pill.textContent = 'TMDB: nessuna chiave';
    pill.className = 'header-api-pill no-key';
    return;
  }
  const isV4 = tmdbIsV4(key);
  const source = (CFG.TMDB_KEY && key === CFG.TMDB_KEY) ? ' · config.js' : ' · impostazioni';
  pill.textContent = 'TMDB ' + (isV4 ? 'v4' : 'v3') + source;
  pill.className = 'header-api-pill has-key';
}

async function autoTestApiKey() {
  const pill = document.getElementById('header-api-pill');
  if (!tmdbKey || !pill) return;
  pill.textContent = 'TMDB: verifica...';
  pill.className = 'header-api-pill testing';
  const { ok, isV4, networkError } = await tmdbTest(tmdbKey);
  const source = (CFG.TMDB_KEY && tmdbKey === CFG.TMDB_KEY) ? ' · config.js' : ' · impostazioni';
  if (networkError) {
    pill.textContent = 'TMDB: errore rete';
    pill.className = 'header-api-pill error';
  } else if (ok) {
    pill.textContent = 'TMDB ' + (isV4 ? 'v4' : 'v3') + ' ✓' + source;
    pill.className = 'header-api-pill ok';
  } else {
    pill.textContent = 'TMDB: chiave non valida';
    pill.className = 'header-api-pill error';
  }
}

async function testApiKey() {
  const key = document.getElementById('settings-tmdb').value.trim();
  const box = document.getElementById('api-status-box');
  if (!key) { toast('Inserisci una chiave prima di testarla', 'error'); return; }
  box.className = 'api-status testing';
  box.innerHTML = '<span class="api-dot gray pulse"></span> Test in corso...';
  const { ok, status, isV4, networkError } = await tmdbTest(key);
  if (networkError) {
    box.className = 'api-status error';
    box.innerHTML = '<span class="api-dot red"></span> Errore di rete — usa http://localhost';
  } else if (ok) {
    box.className = 'api-status ok';
    box.innerHTML = `<span class="api-dot green"></span> Chiave valida ✓ — <b>${isV4 ? 'Token v4' : 'API Key v3'}</b>`;
  } else {
    box.className = 'api-status error';
    box.innerHTML = `<span class="api-dot red"></span> Non valida (HTTP ${status})`;
  }
}

// ─── MODAL HELPERS ─────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ─── INIT ──────────────────────────────────────────────────
async function init() {
  await openDB();
  await loadAll();

  // Load persisted settings (DB overrides config.js if user set them manually)
  const savedMode    = await getSetting('ratingMode');
  const savedTmdb    = await getSetting('tmdbKey');
  const savedGhToken = await getSetting('ghToken');
  const savedGistId  = await getSetting('gistId');

  if (savedMode)    ratingMode = savedMode;
  if (savedTmdb)    tmdbKey    = savedTmdb;
  if (savedGhToken) ghToken    = savedGhToken;
  if (savedGistId)  gistId     = savedGistId;

  // Config.js values act as defaults if DB has nothing
  if (!tmdbKey && CFG.TMDB_KEY)     tmdbKey = CFG.TMDB_KEY;
  if (!ghToken && CFG.GITHUB_TOKEN) ghToken = CFG.GITHUB_TOKEN;
  if (!gistId  && CFG.GIST_ID)      gistId  = CFG.GIST_ID;

  if (savedMode) {
    startApp();
  } else {
    document.getElementById('setup-overlay').style.display = 'flex';
  }

  // Show TMDB key status in header and auto-test
  updateHeaderApiPill(tmdbKey);
  if (tmdbKey) autoTestApiKey();

  // Overlay close on backdrop click
  document.querySelectorAll('.overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('open'); });
  });
}

async function chooseRating(mode) {
  ratingMode = mode;
  await setSetting('ratingMode', ratingMode);
  document.getElementById('setup-tmdb-section').style.display = 'flex';
}

async function setupSaveTmdb() {
  const k = document.getElementById('setup-tmdb-input').value.trim();
  if (k) { tmdbKey = k; await setSetting('tmdbKey', k); }
  startApp();
}
async function setupSkipTmdb() { startApp(); }

function startApp() {
  document.getElementById('setup-overlay').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  renderAll();
  showPage('library');
}

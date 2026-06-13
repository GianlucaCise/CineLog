/* ═══════════════════════════════════════════════════════════
   CineLog — app.js
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─── CONFIG (from config.js if available) ──────────────────
const CFG = (typeof CINELOG_CONFIG !== 'undefined') ? CINELOG_CONFIG : { TMDB_KEY: '', GITHUB_TOKEN: '', GIST_ID: '' };

// Key source preferences: 'db' | 'config' per ogni chiave
// Salvato in DB come keySources: { tmdbKey: 'db', ghToken: 'db', gistId: 'db' }
let keySources = { tmdbKey: 'db', ghToken: 'db', gistId: 'db' };

function resolveKey(dbValue, cfgValue, sourceKey) {
  const src = keySources[sourceKey] || 'db';
  if (src === 'config') return cfgValue || dbValue || '';
  return dbValue || cfgValue || '';
}

// ─── API LAYER ─────────────────────────────────────────────
const API_BASE = 'http://localhost:8000/api';
let backendOnline = false;

async function checkBackend() {
  try {
    const r = await fetch(API_BASE + '/status', { signal: AbortSignal.timeout(2000) });
    backendOnline = r.ok;
  } catch { backendOnline = false; }
  updateBackendIndicator();
  return backendOnline;
}

function updateBackendIndicator() {
  const el = document.getElementById('backend-indicator');
  if (!el) return;
  if (backendOnline) {
    el.textContent = '● Server';
    el.className = 'backend-pill online';
    el.title = 'Backend SQLite connesso';
  } else {
    el.textContent = '○ Offline';
    el.className = 'backend-pill offline';
    el.title = 'Backend non raggiungibile — uso IndexedDB locale';
  }
}

async function testBackendConnection() {
  const btn = document.getElementById('test-backend-btn');
  const box = document.getElementById('backend-status-box');
  if (btn) btn.textContent = 'Test…';
  try {
    const r   = await fetch(API_BASE + '/status', { signal: AbortSignal.timeout(3000) });
    const data = await r.json();
    backendOnline = r.ok;
    if (box) {
      box.className = 'api-status ok';
      box.innerHTML = '<span class="api-dot green"></span> Connesso — DB: ' +
        data.db_size_kb + ' KB · ' + (data.db_exists ? 'cinelog.db presente' : 'nuovo DB');
    }
  } catch (e) {
    backendOnline = false;
    if (box) {
      box.className = 'api-status error';
      box.innerHTML = '<span class="api-dot red"></span> Non raggiungibile — uso IndexedDB locale';
    }
  }
  if (btn) btn.textContent = 'Testa connessione';
  updateBackendIndicator();
}

// API helpers — usano il backend se online, altrimenti IndexedDB
async function apiGet(path) {
  const r = await fetch(API_BASE + path, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function apiPut(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function apiDelete(path) {
  const r = await fetch(API_BASE + path, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

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
  if (backendOnline) {
    try {
      // Normalize saga_id -> sagaId for frontend compatibility
      const rawMedia = await apiGet('/media');
      mediaList = rawMedia.map(m => ({ ...m, sagaId: m.saga_id ?? m.sagaId }));
      sagaList  = await apiGet('/sagas');
      // Sync to IndexedDB as local cache
      for (const m of mediaList) await dbPut('media', m);
      for (const s of sagaList)  await dbPut('sagas', s);
      return;
    } catch (e) {
      console.warn('Backend load failed, falling back to IndexedDB', e);
      backendOnline = false; updateBackendIndicator();
    }
  }
  mediaList = await dbGetAll('media');
  sagaList  = await dbGetAll('sagas');
}

async function saveMedia(item) {
  // Normalize for API (sagaId -> saga_id)
  const apiItem = { ...item, saga_id: item.sagaId ?? item.saga_id };
  if (backendOnline) {
    try {
      const existing = mediaList.find(m => m.id === item.id);
      const saved = existing
        ? await apiPut('/media/' + item.id, apiItem)
        : await apiPost('/media', apiItem);
      const normalized = { ...saved, sagaId: saved.saga_id ?? saved.sagaId };
      await dbPut('media', normalized);
      const idx = mediaList.findIndex(m => m.id === normalized.id);
      if (idx >= 0) mediaList[idx] = normalized; else mediaList.push(normalized);
      return;
    } catch (e) {
      console.warn('Backend save failed, falling back to IndexedDB', e);
      backendOnline = false; updateBackendIndicator();
    }
  }
  await dbPut('media', item);
  const idx = mediaList.findIndex(m => m.id === item.id);
  if (idx >= 0) mediaList[idx] = item; else mediaList.push(item);
}

async function deleteMedia(id) {
  if (backendOnline) {
    try { await apiDelete('/media/' + id); } catch (e) { console.warn(e); }
  }
  await dbDelete('media', id);
  mediaList = mediaList.filter(m => m.id !== id);
}

async function saveSaga(item) {
  if (backendOnline) {
    try {
      const existing = sagaList.find(s => s.id === item.id);
      const saved = existing
        ? await apiPut('/sagas/' + item.id, item)
        : await apiPost('/sagas', item);
      await dbPut('sagas', saved);
      const idx = sagaList.findIndex(s => s.id === saved.id);
      if (idx >= 0) sagaList[idx] = saved; else sagaList.push(saved);
      return;
    } catch (e) {
      console.warn('Backend save failed, falling back to IndexedDB', e);
      backendOnline = false; updateBackendIndicator();
    }
  }
  await dbPut('sagas', item);
  const idx = sagaList.findIndex(s => s.id === item.id);
  if (idx >= 0) sagaList[idx] = item; else sagaList.push(item);
}

async function deleteSaga(id) {
  if (backendOnline) {
    try { await apiDelete('/sagas/' + id); } catch (e) { console.warn(e); }
  }
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
async function gistBackup(silent = false) {
  if (!ghToken) { if (!silent) toast('Inserisci un token GitHub nelle impostazioni', 'error'); return; }
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
    if (!silent) toast('Backup su Gist completato!', 'success');
  else toast('Auto-backup Gist completato', 'info', 2000);

    // Update the gist ID field in settings if visible
    const gistInput = document.getElementById('settings-gist-id');
    if (gistInput) gistInput.value = gistId;
  } catch (e) {
    const msg = '✕ Errore: ' + e.message;
    if (log) log.textContent = msg;
    if (!silent) toast('Errore backup: ' + e.message, 'error');
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
const PAGE_URLS = { library: '/', watchlist: '/watchlist', saghe: '/saghe', statistiche: '/statistiche' };
const URL_PAGES = { '/': 'library', '/watchlist': 'watchlist', '/saghe': 'saghe', '/statistiche': 'statistiche' };

function showPage(name, pushHistory = true) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const map = { library: 0, watchlist: 1, saghe: 2, statistiche: 3 };
  const idx = map[name];
  if (idx != null) document.querySelectorAll('.nav-btn')[idx]?.classList.add('active');
  currentPage = name;
  if (name === 'library')      renderGrid();
  if (name === 'watchlist')    renderWatchlist();
  if (name === 'saghe')        renderSaghe();
  if (name === 'statistiche')  renderStats();
  if (pushHistory && PAGE_URLS[name]) {
    history.pushState({ page: name }, '', PAGE_URLS[name]);
  }
}

window.addEventListener('popstate', e => {
  const name = (e.state?.page) || URL_PAGES[location.pathname] || 'library';
  showPage(name, false);
});

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
  let items   = sortItems(getFilteredMedia());
  grid.innerHTML = '';

  // Switch between grid and list view
  const isGrid = viewMode === 'grid';
  grid.className = isGrid ? 'media-grid' : 'media-list';

  if (!items.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  items.forEach((m, i) => {
    const c = isGrid ? makeCard(m) : makeListRow(m);
    c.style.animationDelay = (i * 0.02) + 's';
    grid.appendChild(c);
  });
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
        ${m.runtime ? renderProgressBar(m.progress, m.runtime) : ''}
        ${formatWatchedDates(m.watched_start, m.watched_end) ? `<p style="font-size:.82rem;color:var(--text2);margin:.5rem 0">${formatWatchedDates(m.watched_start, m.watched_end)}</p>` : ''}
        ${(m.tags||[]).length ? `<div class="tags-wrap" style="margin:.5rem 0">${m.tags.map(t=>`<span class="tag-pill">${t}</span>`).join('')}</div>` : ''}
        ${m.notes ? `<div class="detail-notes">${m.notes}</div>` : ''}
        <div class="detail-actions">
          <button class="btn btn-ghost btn-sm" onclick="editMedia('${id}')">✏ Modifica</button>
          ${m.runtime ? `<button class="btn btn-ghost btn-sm" onclick="openProgressModal('${id}')">⏱ Avanzamento</button>` : ''}
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
  let _mdDown = false;
  ov.addEventListener('mousedown', e => { _mdDown = e.target === ov; });
  ov.addEventListener('click', e => { if (e.target === ov && _mdDown) ov.remove(); _mdDown = false; });
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

function openAddWatchlist() {
  openAdd();
  // Pre-select watchlist checkbox
  requestAnimationFrame(() => {
    const cb = document.getElementById('f-watchlist');
    if (cb) cb.checked = true;
  });
}

function clearAddForm() {
  ['f-title','f-year','f-genre','f-synopsis','f-poster','f-seasons',
   'f-runtime','f-notes','f-watched-start','f-watched-end'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-type').value = 'movie';
  document.getElementById('f-seasons-wrap').style.display = 'none';
  document.getElementById('f-watchlist').checked = false;
  document.getElementById('tmdb-search').value = '';
  document.getElementById('tmdb-results').style.display = 'none';
  document.getElementById('f-tags-wrap').innerHTML = '';
  document.getElementById('f-tag-input').value = '';
  _formTags = [];
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

  const type          = document.getElementById('f-type').value;
  const year          = document.getElementById('f-year').value;
  const genre         = document.getElementById('f-genre').value.trim();
  const synopsis      = document.getElementById('f-synopsis').value.trim();
  const poster        = document.getElementById('f-poster').value.trim();
  const sagaId        = document.getElementById('f-saga').value || null;
  const watchlist     = document.getElementById('f-watchlist').checked;
  const rating        = _addRatingPicker ? _addRatingPicker() : null;
  const runtime       = parseInt(document.getElementById('f-runtime').value) || null;
  const notes         = document.getElementById('f-notes').value.trim() || null;
  const watchedStart  = document.getElementById('f-watched-start').value || null;
  const watchedEnd    = document.getElementById('f-watched-end').value || null;
  const tags          = [..._formTags];

  const baseFields = {
    title, type, year: year ? parseInt(year) : null,
    genre, synopsis, poster, rating, sagaId, watchlist,
    tags, runtime, notes,
    watched_start: watchedStart, watched_end: watchedEnd,
  };

  if (editingMediaId) {
    const m = mediaList.find(x => x.id === editingMediaId);
    Object.assign(m, baseFields);
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
      ...baseFields, seasons,
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
  document.getElementById('f-title').value         = m.title;
  document.getElementById('f-type').value          = m.type;
  document.getElementById('f-year').value          = m.year || '';
  document.getElementById('f-genre').value         = m.genre || '';
  document.getElementById('f-synopsis').value      = m.synopsis || '';
  document.getElementById('f-poster').value        = m.poster || '';
  document.getElementById('f-runtime').value       = m.runtime || '';
  document.getElementById('f-notes').value         = m.notes || '';
  document.getElementById('f-watched-start').value = m.watched_start || '';
  document.getElementById('f-watched-end').value   = m.watched_end || '';
  document.getElementById('f-watchlist').checked   = m.watchlist || false;
  // Tags
  _formTags = [...(m.tags || [])];
  renderFormTags();
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
  // Show DB value in fields (what's stored in DB, regardless of active source)
  const dbTmdb    = await getSetting('tmdbKey') || '';
  const dbGhToken = await getSetting('ghToken')  || '';
  const dbGistId  = await getSetting('gistId')   || '';

  document.getElementById('settings-tmdb').value      = dbTmdb;
  document.getElementById('settings-gh-token').value  = dbGhToken;
  document.getElementById('settings-gist-id').value   = dbGistId;
  document.getElementById('settings-rating').value    = ratingMode;
  document.getElementById('gist-log').textContent     = '';
  const savedInterval = await getSetting('autoBackupInterval');
  const abSel = document.getElementById('settings-auto-backup');
  if (abSel) abSel.value = savedInterval || '';
  document.getElementById('config-preview').style.display = 'none';

  // Populate source selectors
  const srcTmdb   = document.getElementById('src-tmdb');
  const srcGh     = document.getElementById('src-ghtoken');
  const srcGist   = document.getElementById('src-gistid');
  if (srcTmdb)   srcTmdb.value   = keySources.tmdbKey || 'db';
  if (srcGh)     srcGh.value     = keySources.ghToken  || 'db';
  if (srcGist)   srcGist.value   = keySources.gistId   || 'db';

  // Show config.js values if available
  updateKeySourcePreviews();

  updateApiStatus(tmdbKey);
  syncThemeUI();
  syncGistToggle();
  openModal('modal-settings');
}

function updateKeySourcePreviews() {
  const keys = [
    { id: 'cfg-preview-tmdb',    val: CFG.TMDB_KEY,      label: 'TMDB Key' },
    { id: 'cfg-preview-ghtoken', val: CFG.GITHUB_TOKEN,  label: 'GitHub Token' },
    { id: 'cfg-preview-gistid',  val: CFG.GIST_ID,       label: 'Gist ID' },
  ];
  keys.forEach(({ id, val }) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (val) {
      el.textContent = val.length > 24 ? val.slice(0,12) + '…' + val.slice(-6) : val;
      el.style.color = 'var(--green)';
    } else {
      el.textContent = 'non presente in config.js';
      el.style.color = 'var(--text3)';
    }
  });
}

async function saveSettings() {
  const newKey     = document.getElementById('settings-tmdb').value.trim();
  const newGhToken = document.getElementById('settings-gh-token')?.value.trim() || '';
  const newGistId  = document.getElementById('settings-gist-id')?.value.trim()  || '';
  const newMode    = document.getElementById('settings-rating').value;
  const newTheme   = document.documentElement.getAttribute('data-theme')  || 'dark';
  const newAccent  = document.documentElement.getAttribute('data-accent') || 'gold';

  // Read key source toggles
  const newKeySources = {
    tmdbKey: document.getElementById('src-tmdb')?.value    || 'db',
    ghToken: document.getElementById('src-ghtoken')?.value || 'db',
    gistId:  document.getElementById('src-gistid')?.value  || 'db',
  };
  keySources = newKeySources;
  await setSetting('keySources', keySources);

  // Save DB-sourced keys to DB; config-sourced keys are NOT stored in DB
  const settingsToSave = {};
  const newTmdb = newKeySources.tmdbKey === 'config' ? (CFG.TMDB_KEY || '') : newKey;
  const newGh   = newKeySources.ghToken  === 'config' ? (CFG.GITHUB_TOKEN || '') : newGhToken;
  const newGist = newKeySources.gistId   === 'config' ? (CFG.GIST_ID || '') : newGistId;

  if (newTmdb !== tmdbKey)   { tmdbKey = newTmdb; await setSetting('tmdbKey', tmdbKey); settingsToSave.tmdbKey = tmdbKey; }
  if (newGh   !== ghToken)   { ghToken = newGh;   await setSetting('ghToken', ghToken); settingsToSave.ghToken = ghToken; }
  if (newGist !== gistId)    { gistId  = newGist;  await setSetting('gistId',  gistId);  settingsToSave.gistId  = gistId;  }
  if (newMode !== ratingMode) { ratingMode = newMode; await setSetting('ratingMode', ratingMode); settingsToSave.ratingMode = ratingMode; renderAll(); }
  if (newTheme !== currentTheme || newAccent !== currentAccent) {
    applyTheme(newTheme, newAccent);
    await setSetting('theme',  newTheme);
    await setSetting('accent', newAccent);
    settingsToSave.theme  = newTheme;
    settingsToSave.accent = newAccent;
  }

  // Sync to backend
  if (backendOnline) {
    try {
      for (const [k, v] of Object.entries(settingsToSave))
        await apiPut('/settings/' + k, { value: v });
      await apiPut('/settings/keySources', { value: keySources });
    } catch(e) { console.warn('Settings sync to backend failed', e); }
  }

  // Auto backup interval
  const abSel = document.getElementById('settings-auto-backup');
  if (abSel) {
    const interval = abSel.value || null;
    await setSetting('autoBackupInterval', interval);
    if (backendOnline) { try { await apiPut('/settings/autoBackupInterval', { value: interval }); } catch(e) {} }
    scheduleAutoBackup();
  }

  updateHeaderApiPill(tmdbKey);
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

  // Check backend first
  await checkBackend();

  // Load settings — backend first, then IndexedDB, then config.js
  let savedMode, savedTmdb, savedGhToken, savedGistId, savedTheme, savedAccent;
  if (backendOnline) {
    try {
      const s    = await apiGet('/settings');
      savedMode    = s.ratingMode  || null;
      savedTmdb    = s.tmdbKey     || null;
      savedGhToken = s.ghToken     || null;
      savedGistId  = s.gistId      || null;
      savedTheme   = s.theme       || null;
      savedAccent  = s.accent      || null;
      // Mirror to IndexedDB
      for (const [k,v] of Object.entries(s)) if (v) await setSetting(k, v);
    } catch(e) { console.warn('Settings from backend failed', e); }
  }
  if (!savedMode)    savedMode    = await getSetting('ratingMode');
  if (!savedTmdb)    savedTmdb    = await getSetting('tmdbKey');
  if (!savedGhToken) savedGhToken = await getSetting('ghToken');
  if (!savedGistId)  savedGistId  = await getSetting('gistId');
  if (!savedTheme)   savedTheme   = await getSetting('theme');
  if (!savedAccent)  savedAccent  = await getSetting('accent');

  if (savedMode) ratingMode = savedMode;

  // Load key source preferences from DB
  const savedKeySources = await getSetting('keySources');
  if (savedKeySources) keySources = { ...keySources, ...savedKeySources };

  // Resolve each key based on its source preference
  tmdbKey = resolveKey(savedTmdb,    CFG.TMDB_KEY,      'tmdbKey');
  ghToken = resolveKey(savedGhToken, CFG.GITHUB_TOKEN,  'ghToken');
  gistId  = resolveKey(savedGistId,  CFG.GIST_ID,       'gistId');

  if (!ratingMode) ratingMode = 'both';

  const theme  = savedTheme  || 'dark';
  const accent = savedAccent || 'gold';
  applyTheme(theme, accent);

  await loadAll();

  if (savedMode) {
    startApp();
  } else {
    document.getElementById('setup-overlay').style.display = 'flex';
  }

  updateHeaderApiPill(tmdbKey);
  if (tmdbKey) autoTestApiKey();

  // Overlay close on backdrop click — only if mousedown also started on backdrop
  // (prevents closing when dragging text selection out of modal)
  document.querySelectorAll('.overlay').forEach(ov => {
    let mousedownOnBackdrop = false;
    ov.addEventListener('mousedown', e => { mousedownOnBackdrop = e.target === ov; });
    ov.addEventListener('click', e => {
      if (e.target === ov && mousedownOnBackdrop) ov.classList.remove('open');
      mousedownOnBackdrop = false;
    });
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
  const initialPage = URL_PAGES[location.pathname] || 'library';
  history.replaceState({ page: initialPage }, '', PAGE_URLS[initialPage] || '/');
  showPage(initialPage, false);
  scheduleAutoBackup();
}

// ─── THEME & ACCENT ────────────────────────────────────────
let currentTheme  = 'dark';
let currentAccent = 'gold';

function applyTheme(theme, accent) {
  document.documentElement.setAttribute('data-theme',  theme);
  document.documentElement.setAttribute('data-accent', accent);
  currentTheme  = theme;
  currentAccent = accent;
}

function previewTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // Update active button
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.themeVal === theme));
}

function previewAccent(accent) {
  document.documentElement.setAttribute('data-accent', accent);
  document.querySelectorAll('.accent-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.accentVal === accent));
}

function syncThemeUI() {
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.themeVal === currentTheme));
  document.querySelectorAll('.accent-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.accentVal === currentAccent));
}

// ─── GIST TOGGLE ───────────────────────────────────────────
function toggleGistFields(enabled) {
  document.getElementById('backup-fields').classList.toggle('hidden', !enabled);
}

function syncGistToggle() {
  const hasToken = !!(ghToken);
  const toggle = document.getElementById('gist-toggle');
  if (toggle) {
    toggle.checked = hasToken;
    toggleGistFields(hasToken);
  }
}

// ─── CONFIG.JS DOWNLOAD ────────────────────────────────────
function buildConfigJs() {
  const tmdb  = document.getElementById('settings-tmdb')?.value.trim()    || tmdbKey  || '';
  const gh    = document.getElementById('settings-gh-token')?.value.trim() || ghToken  || '';
  const gist  = document.getElementById('settings-gist-id')?.value.trim()  || gistId   || '';
  const theme  = currentTheme;
  const accent = currentAccent;
  const rating = document.getElementById('settings-rating')?.value || ratingMode;

  return `// ─────────────────────────────────────────────────────────
//  CineLog — Configurazione
//  Generato automaticamente il ${new Date().toLocaleString('it-IT')}
//  ⚠️  Non pubblicare questo file (è già nel .gitignore)
//
//  Le impostazioni UI (tema, colori, modalità valutazione)
//  vengono salvate nel database — non servono qui.
// ─────────────────────────────────────────────────────────

const CINELOG_CONFIG = {
  // Chiave API TMDB (v3 corta) oppure Read Access Token (v4, eyJ...)
  TMDB_KEY: '${tmdb}',

  // Token GitHub per il backup su Gist (permesso: gist)
  GITHUB_TOKEN: '${gh}',

  // ID del Gist esistente (lascia vuoto per crearne uno nuovo)
  GIST_ID: '${gist}',
};
`;
}

function downloadConfigJs() {
  const content = buildConfigJs();

  // Show preview
  const preview = document.getElementById('config-preview');
  if (preview) { preview.textContent = content; preview.style.display = 'block'; }

  // Download
  const blob = new Blob([content], { type: 'text/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'config.js';
  a.click();
  toast('config.js scaricato — sostituisci il file nella cartella del progetto', 'success', 5000);
}

// ─── CLEAR ALL DATA ────────────────────────────────────────
async function clearAllData() {
  const confirmed = confirm(
    'Sei sicuro di voler eliminare TUTTI i dati?\n\n' +
    '• Film e serie\n• Saghe\n• Valutazioni\n• Impostazioni\n\n' +
    'Questa operazione è IRREVERSIBILE.'
  );
  if (!confirmed) return;

  // Second confirmation
  const typed = prompt('Scrivi ELIMINA per confermare:');
  if (typed !== 'ELIMINA') { toast('Operazione annullata', 'info'); return; }

  try {
    const stores = ['media', 'sagas', 'settings'];
    for (const store of stores) {
      const tx  = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      await new Promise(r => tx.oncomplete = r);
    }
    mediaList = []; sagaList = [];
    ratingMode = 'both'; tmdbKey = ''; ghToken = ''; gistId = '';
    applyTheme('dark', 'gold');
    closeModal('modal-settings');
    renderAll();
    toast('Tutti i dati eliminati', 'info');
  } catch (e) {
    toast('Errore durante l\'eliminazione: ' + e.message, 'error');
  }
}

// ─── MIGRATE INDEXEDDB → BACKEND ───────────────────────────
async function migrateToBackend() {
  if (!backendOnline) {
    toast('Backend non raggiungibile', 'error'); return;
  }
  const localMedia = await dbGetAll('media');
  const localSagas = await dbGetAll('sagas');
  if (!localMedia.length && !localSagas.length) {
    toast('Nessun dato locale da migrare', 'info'); return;
  }
  if (!confirm(`Migrare ${localMedia.length} titoli e ${localSagas.length} saghe da IndexedDB al backend SQLite?`)) return;
  try {
    const res = await apiPost('/import', { media: localMedia, sagas: localSagas });
    toast(`Migrazione completata: ${res.imported.media} titoli, ${res.imported.sagas} saghe`, 'success');
    await loadAll(); renderAll();
  } catch(e) {
    toast('Errore migrazione: ' + e.message, 'error');
  }
}

// ─── TAGS ──────────────────────────────────────────────────
let _formTags = [];

function renderFormTags() {
  const wrap = document.getElementById('f-tags-wrap');
  if (!wrap) return;
  wrap.innerHTML = _formTags.map((t, i) => `
    <span class="tag-pill">
      ${t}<button type="button" onclick="removeFormTag(${i})" class="tag-remove">✕</button>
    </span>`).join('');
}

function addFormTag() {
  const inp = document.getElementById('f-tag-input');
  const val = inp.value.trim().toLowerCase();
  if (!val || _formTags.includes(val)) { inp.value = ''; return; }
  _formTags.push(val);
  inp.value = '';
  renderFormTags();
}

function removeFormTag(i) {
  _formTags.splice(i, 1);
  renderFormTags();
}

function handleTagKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addFormTag(); }
}

// ─── PROGRESS ──────────────────────────────────────────────
function calcProgress(watchedMinutes, totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return null;
  const pct = Math.min(100, Math.round((watchedMinutes / totalMinutes) * 100));
  return { watched_minutes: watchedMinutes, total_minutes: totalMinutes, percent: pct };
}

function renderProgressBar(progress, runtime) {
  if (!runtime) return '';
  const pct = progress?.percent ?? 0;
  const watched = progress?.watched_minutes ?? 0;
  return `
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-label">${watched}/${runtime} min · ${pct}%</span>
    </div>`;
}

function openProgressModal(mediaId) {
  const m = mediaList.find(x => x.id === mediaId);
  if (!m?.runtime) { toast('Imposta prima la durata nelle impostazioni del titolo', 'info'); return; }
  const wrap = document.createElement('div');
  wrap.className = 'form-group';
  const lbl = document.createElement('label'); lbl.className = 'form-label';
  lbl.textContent = `Minuti visti (su ${m.runtime})`;
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = 0; inp.max = m.runtime; inp.step = 1;
  inp.className = 'form-input';
  inp.value = m.progress?.watched_minutes ?? 0;
  const bar = document.createElement('div'); bar.style.marginTop = '.5rem';
  bar.innerHTML = renderProgressBar(m.progress, m.runtime);
  inp.oninput = () => {
    const prog = calcProgress(parseInt(inp.value)||0, m.runtime);
    bar.innerHTML = renderProgressBar(prog, m.runtime);
  };
  wrap.append(lbl, inp, bar);
  makeDynModal('Avanzamento visione', wrap, async () => {
    m.progress = calcProgress(parseInt(inp.value)||0, m.runtime);
    await saveMedia(m);
    document.getElementById('dyn-modal')?.remove();
    renderDetail(mediaId);
    toast('Avanzamento salvato', 'success');
  });
}

// ─── WATCHED DATES HELPERS ─────────────────────────────────
function formatWatchedDates(start, end) {
  if (!start && !end) return null;
  const fmt = d => new Date(d).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' });
  if (start && end) {
    const s = new Date(start).toDateString();
    const e = new Date(end).toDateString();
    if (s === e) return 'Visto il ' + fmt(start);
    return 'Dal ' + fmt(start) + ' al ' + fmt(end);
  }
  if (end)   return 'Finito il ' + fmt(end);
  if (start) return 'Iniziato il ' + fmt(start);
}

// ─── LIBRARY VIEW MODE & SORTING ───────────────────────────
let viewMode   = 'grid';   // 'grid' | 'list'
let sortMode   = 'added';  // 'added' | 'title' | 'year' | 'rating'
let sortDir    = 'desc';

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('btn-view-grid')?.classList.toggle('active', mode === 'grid');
  document.getElementById('btn-view-list')?.classList.toggle('active', mode === 'list');
  renderGrid();
}

function setSort(mode) {
  if (sortMode === mode) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortMode = mode; sortDir = mode === 'title' ? 'asc' : 'desc'; }
  document.querySelectorAll('.sort-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.sort === sortMode));
  renderGrid();
}

function sortItems(items) {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    switch (sortMode) {
      case 'title':  return dir * a.title.localeCompare(b.title, 'it');
      case 'year':   return dir * ((a.year||0) - (b.year||0));
      case 'rating': return dir * ((a.rating?.numeric ?? a.rating?.stars*2 ?? -1) - (b.rating?.numeric ?? b.rating?.stars*2 ?? -1));
      default:       return dir * ((a.created_at||'') < (b.created_at||'') ? -1 : 1);
    }
  });
}

function makeListRow(m) {
  const sagaName = m.sagaId ? sagaList.find(s => s.id === m.sagaId)?.name : '';
  const row = document.createElement('div');
  row.className = 'list-row';
  row.innerHTML = `
    ${m.poster ? `<img class="list-thumb" src="${m.poster}" loading="lazy" onerror="this.style.display='none'">` : '<div class="list-thumb-ph">🎬</div>'}
    <div class="list-info">
      <div class="list-title">${m.title}</div>
      <div class="list-meta">${m.year||''}${m.genre?' · '+m.genre:''}${sagaName?' · '+sagaName:''}</div>
      ${(m.tags||[]).length ? `<div class="list-tags">${m.tags.map(t=>`<span class="tag-pill tag-sm">${t}</span>`).join('')}</div>` : ''}
    </div>
    <div class="list-rating">${displayRatingSmall(m.rating)}</div>`;
  row.onclick = () => openDetail(m.id);
  return row;
}

// ─── AUTO BACKUP ───────────────────────────────────────────
let _autoBackupTimer = null;

async function scheduleAutoBackup() {
  clearInterval(_autoBackupTimer);
  const intervalHours = await getSetting('autoBackupInterval');
  if (!intervalHours || !ghToken) return;
  const ms = intervalHours * 60 * 60 * 1000;
  _autoBackupTimer = setInterval(async () => {
    if (!ghToken) return;
    await gistBackup(true); // silent=true
    await setSetting('lastAutoBackup', new Date().toISOString());
  }, ms);
  console.info(`Auto backup ogni ${intervalHours}h`);
}

// ─── STATS PAGE ────────────────────────────────────────────
async function renderStats() {
  const cont = document.getElementById('stats-content');
  if (!cont) return;
  cont.innerHTML = '<p style="color:var(--text3)">Caricamento...</p>';

  // Compute from local data (always available)
  const total    = mediaList.length;
  const movies   = mediaList.filter(m => m.type === 'movie').length;
  const series   = mediaList.filter(m => m.type === 'series').length;
  const rated    = mediaList.filter(m => !ratingIsEmpty(m.rating)).length;
  const watchl   = mediaList.filter(m => m.watchlist).length;

  const allRatings = mediaList.filter(m => m.rating?.numeric != null).map(m => m.rating.numeric);
  const avgRating  = allRatings.length ? (allRatings.reduce((a,b)=>a+b,0)/allRatings.length).toFixed(1) : '—';

  const totalMins = mediaList.filter(m => m.runtime && m.watched_end)
    .reduce((s, m) => s + m.runtime, 0);
  const totalHours = Math.floor(totalMins / 60);
  const totalDays  = (totalMins / 60 / 24).toFixed(1);

  // Genre distribution
  const genreCounts = {};
  mediaList.forEach(m => { if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre]||0)+1; });
  const topGenres = Object.entries(genreCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);

  // Rating distribution
  const ratingBuckets = Array(11).fill(0);
  allRatings.forEach(r => { const b = Math.round(r); if (b >= 0 && b <= 10) ratingBuckets[b]++; });
  const maxBucket = Math.max(...ratingBuckets, 1);

  // Tag cloud
  const tagCounts = {};
  mediaList.forEach(m => (m.tags||[]).forEach(t => { tagCounts[t] = (tagCounts[t]||0)+1; }));
  const topTags = Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,20);

  // Year distribution
  const yearCounts = {};
  mediaList.forEach(m => { if (m.year) yearCounts[m.year] = (yearCounts[m.year]||0)+1; });
  const topYears = Object.entries(yearCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);

  const lastBackup = await getSetting('lastAutoBackup');

  cont.innerHTML = `
    <!-- BIG NUMBERS -->
    <div class="stats-big-grid">
      <div class="stat-big"><span class="stat-big-num">${total}</span><span class="stat-big-label">Titoli totali</span></div>
      <div class="stat-big"><span class="stat-big-num">${movies}</span><span class="stat-big-label">Film</span></div>
      <div class="stat-big"><span class="stat-big-num">${series}</span><span class="stat-big-label">Serie</span></div>
      <div class="stat-big"><span class="stat-big-num">${sagaList.length}</span><span class="stat-big-label">Saghe</span></div>
      <div class="stat-big"><span class="stat-big-num">${rated}</span><span class="stat-big-label">Valutati</span></div>
      <div class="stat-big"><span class="stat-big-num">${avgRating}</span><span class="stat-big-label">Media voti</span></div>
      <div class="stat-big"><span class="stat-big-num">${totalHours}h</span><span class="stat-big-label">Ore viste</span></div>
      <div class="stat-big"><span class="stat-big-num">${watchl}</span><span class="stat-big-label">Da vedere</span></div>
    </div>

    <!-- RATING DISTRIBUTION -->
    ${allRatings.length ? `
    <div class="stats-section">
      <h3 class="stats-section-title">Distribuzione voti</h3>
      <div class="rating-dist">
        ${ratingBuckets.map((n, i) => `
          <div class="rating-dist-col">
            <div class="rating-dist-bar-wrap">
              <div class="rating-dist-bar" style="height:${Math.round((n/maxBucket)*100)}%"></div>
            </div>
            <div class="rating-dist-label">${i}</div>
            ${n ? `<div class="rating-dist-count">${n}</div>` : ''}
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- GENRES -->
    ${topGenres.length ? `
    <div class="stats-section">
      <h3 class="stats-section-title">Generi più visti</h3>
      <div class="stat-bar-list">
        ${topGenres.map(([g,n]) => `
          <div class="stat-bar-row">
            <span class="stat-bar-label">${g}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round(n/topGenres[0][1]*100)}%"></div></div>
            <span class="stat-bar-count">${n}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- TAG CLOUD -->
    ${topTags.length ? `
    <div class="stats-section">
      <h3 class="stats-section-title">Tag più usati</h3>
      <div class="tag-cloud">
        ${topTags.map(([t,n]) => `<span class="tag-pill" style="font-size:${Math.min(1.2, .7+n*0.12)}rem">${t} <b>${n}</b></span>`).join('')}
      </div>
    </div>` : ''}

    <!-- YEARS -->
    ${topYears.length ? `
    <div class="stats-section">
      <h3 class="stats-section-title">Anni più frequenti</h3>
      <div class="stat-bar-list">
        ${topYears.map(([y,n]) => `
          <div class="stat-bar-row">
            <span class="stat-bar-label">${y}</span>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round(n/topYears[0][1]*100)}%"></div></div>
            <span class="stat-bar-count">${n}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}

    ${lastBackup ? `<p style="font-size:.78rem;color:var(--text3);margin-top:1rem">Ultimo backup automatico: ${new Date(lastBackup).toLocaleString('it-IT')}</p>` : ''}
  `;
}

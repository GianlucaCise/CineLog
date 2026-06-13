"""
CineLog — database.py
Gestione SQLite asincrona con aiosqlite.
"""

import aiosqlite
import json
from pathlib import Path

DB_PATH = Path(__file__).parent / "cinelog.db"


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    """Crea le tabelle se non esistono, e migra quelle esistenti."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS media (
                id           TEXT PRIMARY KEY,
                title        TEXT NOT NULL,
                type         TEXT NOT NULL CHECK(type IN ('movie','series')),
                year         INTEGER,
                genre        TEXT,
                synopsis     TEXT,
                poster       TEXT,
                rating       TEXT,
                saga_id      TEXT,
                watchlist    INTEGER DEFAULT 0,
                seasons      TEXT,
                tags         TEXT,          -- JSON: ["tag1","tag2"]
                runtime      INTEGER,       -- durata in minuti (film) o per episodio (serie)
                progress     TEXT,          -- JSON: {watched_minutes, percent}
                watched_start TEXT,         -- data inizio visione ISO
                watched_end   TEXT,         -- data fine visione ISO
                notes        TEXT,          -- recensione/note personali
                created_at   TEXT DEFAULT (datetime('now')),
                updated_at   TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (saga_id) REFERENCES sagas(id) ON DELETE SET NULL
            )
        """)

        # Migrazione colonne su DB esistente
        existing_cols = set()
        async with db.execute("PRAGMA table_info(media)") as cur:
            async for row in cur:
                existing_cols.add(row[1])

        migrations = [
            ("tags",          "TEXT"),
            ("runtime",       "INTEGER"),
            ("progress",      "TEXT"),
            ("watched_start", "TEXT"),
            ("watched_end",   "TEXT"),
            ("notes",         "TEXT"),
        ]
        for col, typ in migrations:
            if col not in existing_cols:
                await db.execute(f"ALTER TABLE media ADD COLUMN {col} {typ}")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS sagas (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                created_at  TEXT DEFAULT (datetime('now'))
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)

        await db.commit()


def row_to_media(row) -> dict:
    d = dict(row)
    d["rating"]   = json.loads(d["rating"])   if d["rating"]  else None
    d["seasons"]  = json.loads(d["seasons"])  if d["seasons"] else None
    d["tags"]     = json.loads(d["tags"])     if d["tags"]    else []
    d["progress"] = json.loads(d["progress"]) if d["progress"] else None
    d["watchlist"] = bool(d["watchlist"])
    return d


def row_to_saga(row) -> dict:
    return dict(row)

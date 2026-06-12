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
    """Crea le tabelle se non esistono."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        # Tabella media (film e serie)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS media (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL,
                type        TEXT NOT NULL CHECK(type IN ('movie','series')),
                year        INTEGER,
                genre       TEXT,
                synopsis    TEXT,
                poster      TEXT,
                rating      TEXT,          -- JSON: {stars, numeric}
                saga_id     TEXT,
                watchlist   INTEGER DEFAULT 0,
                seasons     TEXT,          -- JSON: array stagioni (solo per serie)
                created_at  TEXT DEFAULT (datetime('now')),
                updated_at  TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (saga_id) REFERENCES sagas(id) ON DELETE SET NULL
            )
        """)

        # Tabella saghe
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sagas (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                description TEXT,
                created_at  TEXT DEFAULT (datetime('now'))
            )
        """)

        # Tabella impostazioni chiave-valore
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
    d["watchlist"] = bool(d["watchlist"])
    return d


def row_to_saga(row) -> dict:
    return dict(row)

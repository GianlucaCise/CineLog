"""
CineLog — main.py
FastAPI backend con SQLite. Serve anche i file statici del frontend.
"""

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, Any
from pathlib import Path
from contextlib import asynccontextmanager
import aiosqlite
import json
import time

from database import init_db, get_db, row_to_media, row_to_saga, DB_PATH

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


# ─── LIFESPAN ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


# ─── APP ───────────────────────────────────────────────────
app = FastAPI(
    title="CineLog API",
    description="Backend per CineLog — diario personale di film e serie.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── PYDANTIC MODELS ───────────────────────────────────────
class MediaIn(BaseModel):
    id:        Optional[str]  = None
    title:     str
    type:      str
    year:      Optional[int]  = None
    genre:     Optional[str]  = None
    synopsis:  Optional[str]  = None
    poster:    Optional[str]  = None
    rating:    Optional[Any]  = None
    saga_id:   Optional[str]  = None
    watchlist: Optional[bool] = False
    seasons:   Optional[Any]  = None

class SagaIn(BaseModel):
    id:          Optional[str] = None
    name:        str
    description: Optional[str] = None

class SettingIn(BaseModel):
    value: Any


# ─── HEALTH / STATUS ───────────────────────────────────────
@app.get("/api/status", tags=["System"])
async def status():
    """Verifica che il server sia raggiungibile e il database aperto."""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("SELECT 1")
        return {
            "ok": True,
            "db": str(DB_PATH),
            "db_exists": DB_PATH.exists(),
            "db_size_kb": round(DB_PATH.stat().st_size / 1024, 1) if DB_PATH.exists() else 0,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── MEDIA ─────────────────────────────────────────────────
@app.get("/api/media", tags=["Media"])
async def list_media():
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM media ORDER BY created_at DESC") as cur:
            rows = await cur.fetchall()
        return [row_to_media(r) for r in rows]
    finally:
        await db.close()


@app.get("/api/media/{media_id}", tags=["Media"])
async def get_media(media_id: str):
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM media WHERE id=?", (media_id,)) as cur:
            row = await cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Media non trovato")
        return row_to_media(row)
    finally:
        await db.close()


@app.post("/api/media", tags=["Media"], status_code=201)
async def create_media(item: MediaIn):
    item_id = item.id or f"{int(time.time()*1000)}"
    db = await get_db()
    try:
        await db.execute("""
            INSERT INTO media (id, title, type, year, genre, synopsis, poster,
                               rating, saga_id, watchlist, seasons)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        """, (
            item_id, item.title, item.type, item.year, item.genre,
            item.synopsis, item.poster,
            json.dumps(item.rating) if item.rating is not None else None,
            item.saga_id, int(item.watchlist or False),
            json.dumps(item.seasons) if item.seasons is not None else None,
        ))
        await db.commit()
        async with db.execute("SELECT * FROM media WHERE id=?", (item_id,)) as cur:
            row = await cur.fetchone()
        return row_to_media(row)
    finally:
        await db.close()


@app.put("/api/media/{media_id}", tags=["Media"])
async def update_media(media_id: str, item: MediaIn):
    db = await get_db()
    try:
        async with db.execute("SELECT id FROM media WHERE id=?", (media_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(status_code=404, detail="Media non trovato")
        await db.execute("""
            UPDATE media SET
                title=?, type=?, year=?, genre=?, synopsis=?, poster=?,
                rating=?, saga_id=?, watchlist=?, seasons=?,
                updated_at=datetime('now')
            WHERE id=?
        """, (
            item.title, item.type, item.year, item.genre,
            item.synopsis, item.poster,
            json.dumps(item.rating) if item.rating is not None else None,
            item.saga_id, int(item.watchlist or False),
            json.dumps(item.seasons) if item.seasons is not None else None,
            media_id,
        ))
        await db.commit()
        async with db.execute("SELECT * FROM media WHERE id=?", (media_id,)) as cur:
            row = await cur.fetchone()
        return row_to_media(row)
    finally:
        await db.close()


@app.delete("/api/media/{media_id}", tags=["Media"])
async def delete_media(media_id: str):
    db = await get_db()
    try:
        await db.execute("DELETE FROM media WHERE id=?", (media_id,))
        await db.commit()
        return {"deleted": media_id}
    finally:
        await db.close()


# ─── SAGAS ─────────────────────────────────────────────────
@app.get("/api/sagas", tags=["Saghe"])
async def list_sagas():
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM sagas ORDER BY name") as cur:
            rows = await cur.fetchall()
        return [row_to_saga(r) for r in rows]
    finally:
        await db.close()


@app.post("/api/sagas", tags=["Saghe"], status_code=201)
async def create_saga(saga: SagaIn):
    saga_id = saga.id or f"{int(time.time()*1000)}"
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO sagas (id, name, description) VALUES (?,?,?)",
            (saga_id, saga.name, saga.description),
        )
        await db.commit()
        async with db.execute("SELECT * FROM sagas WHERE id=?", (saga_id,)) as cur:
            row = await cur.fetchone()
        return row_to_saga(row)
    finally:
        await db.close()


@app.put("/api/sagas/{saga_id}", tags=["Saghe"])
async def update_saga(saga_id: str, saga: SagaIn):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE sagas SET name=?, description=? WHERE id=?",
            (saga.name, saga.description, saga_id),
        )
        await db.commit()
        async with db.execute("SELECT * FROM sagas WHERE id=?", (saga_id,)) as cur:
            row = await cur.fetchone()
        return row_to_saga(row)
    finally:
        await db.close()


@app.delete("/api/sagas/{saga_id}", tags=["Saghe"])
async def delete_saga(saga_id: str):
    db = await get_db()
    try:
        await db.execute("UPDATE media SET saga_id=NULL WHERE saga_id=?", (saga_id,))
        await db.execute("DELETE FROM sagas WHERE id=?", (saga_id,))
        await db.commit()
        return {"deleted": saga_id}
    finally:
        await db.close()


# ─── SETTINGS ──────────────────────────────────────────────
@app.get("/api/settings", tags=["Settings"])
async def get_all_settings():
    db = await get_db()
    try:
        async with db.execute("SELECT key, value FROM settings") as cur:
            rows = await cur.fetchall()
        return {r["key"]: json.loads(r["value"]) if r["value"] else None for r in rows}
    finally:
        await db.close()


@app.put("/api/settings/{key}", tags=["Settings"])
async def set_setting(key: str, body: SettingIn):
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(body.value)),
        )
        await db.commit()
        return {"key": key, "value": body.value}
    finally:
        await db.close()


# ─── BULK IMPORT (per migrazione da IndexedDB) ─────────────
@app.post("/api/import", tags=["System"])
async def bulk_import(data: dict):
    """
    Importa un backup JSON (stesso formato dell'export del frontend).
    { media: [...], sagas: [...] }
    """
    db = await get_db()
    imported = {"media": 0, "sagas": 0}
    try:
        for s in data.get("sagas", []):
            await db.execute(
                "INSERT OR REPLACE INTO sagas (id, name, description) VALUES (?,?,?)",
                (s.get("id", str(int(time.time()*1000))), s["name"], s.get("description")),
            )
            imported["sagas"] += 1

        for m in data.get("media", []):
            await db.execute("""
                INSERT OR REPLACE INTO media
                    (id, title, type, year, genre, synopsis, poster,
                     rating, saga_id, watchlist, seasons)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """, (
                m.get("id", str(int(time.time()*1000))),
                m["title"], m.get("type","movie"),
                m.get("year"), m.get("genre"), m.get("synopsis"), m.get("poster"),
                json.dumps(m["rating"]) if m.get("rating") else None,
                m.get("sagaId") or m.get("saga_id"),
                int(m.get("watchlist", False)),
                json.dumps(m["seasons"]) if m.get("seasons") else None,
            ))
            imported["media"] += 1

        await db.commit()
        return {"ok": True, "imported": imported}
    finally:
        await db.close()


# ─── FRONTEND ROUTES (SPA fallback) ────────────────────────
# Serve index.html for all frontend routes so the History API works on refresh
@app.get("/watchlist", include_in_schema=False)
@app.get("/saghe",     include_in_schema=False)
async def spa_fallback():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

# ─── STATIC FILES (frontend) ────────────────────────────────
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

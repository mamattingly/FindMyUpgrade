from pathlib import Path
from urllib.parse import urlparse
import re
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl

app = FastAPI(title="WoW Forever Dungeon Advisor", version="0.1.0")
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"

class ScanRequest(BaseModel):
    url: HttpUrl

@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "wow-forever-dungeon-advisor"}

@app.get("/api/demo")
async def demo():
    return {
        "notice": "Illustrative demo only; not a verified loot recommendation.",
        "dungeons": [
            {"name": "Example: Crypt of the Forgotten", "estimated_minutes": 28, "drop_rate_confidence": "unknown"},
            {"name": "Example: Sunken Archive", "estimated_minutes": 36, "drop_rate_confidence": "unknown"}
        ]
    }

@app.post("/api/scan")
async def scan(req: ScanRequest):
    url = str(req.url)
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc.lower() not in {"foreverbuilds.io", "www.foreverbuilds.io"}:
        raise HTTPException(400, "Use a valid HTTPS ForeverBuilds character URL.")
    try:
        async with httpx.AsyncClient(timeout=18, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 WoWForeverDungeonAdvisor/0.1"}) as client:
            response = await client.get(url)
            response.raise_for_status()
    except Exception as exc:
        raise HTTPException(502, f"Could not retrieve the character page ({type(exc).__name__}).") from exc
    soup = BeautifulSoup(response.text, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else "ForeverBuilds character"
    text = soup.get_text(" ", strip=True)
    level = re.search(r"\bLevel\s*(\d{1,2})\b", text, re.I)
    class_match = re.search(r"\b(Priest|Warrior|Paladin|Hunter|Rogue|Shaman|Mage|Warlock|Druid)\b", title + " " + text, re.I)
    faction = re.search(r"\b(Alliance|Horde)\b", text, re.I)
    return {
        "source_url": url,
        "page_title": title,
        "character": {
            "name": title.split("|")[0].strip()[:80],
            "level": int(level.group(1)) if level else None,
            "class": class_match.group(1).title() if class_match else "Unknown",
            "faction": faction.group(1).title() if faction else "Unknown",
            "spec": "Unknown"
        },
        "equipped_gear": [],
        "scan_status": "partial",
        "message": "Page retrieved. Gear and spec were not reliably identified, so no personalized dungeon ranking was generated."
    }

@app.post("/api/analyze")
async def analyze(payload: dict):
    return {
        "status": "insufficient_data",
        "rankings": [],
        "message": "A sourced loot dataset, equipped items, and reliable drop-rate data are required before calculating expected useful upgrades per hour."
    }

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    @app.get("/{path:path}")
    async def frontend(path: str):
        candidate = (DIST / path).resolve()
        if path and candidate.is_file() and str(candidate).startswith(str(DIST.resolve())):
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
else:
    @app.get("/")
    async def root():
        return {"message": "Frontend build missing. Build frontend/ before starting the app."}

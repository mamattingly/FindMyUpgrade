from pathlib import Path
from urllib.parse import quote
import re
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal

app = FastAPI(title="WoW Forever Dungeon Advisor", version="0.2.0")
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"

REGION_LOCALES = {
    "us": "en-us",
    "eu": "en-gb",
    "kr": "ko-kr",
    "tw": "zh-tw",
}
CLASSES = "Priest|Warrior|Paladin|Hunter|Rogue|Shaman|Mage|Warlock|Druid"

class ScanRequest(BaseModel):
    region: Literal["us", "eu", "kr", "tw"] = "us"
    name: str = Field(min_length=3, max_length=80)

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

def armory_character_url(region: str, full_name: str) -> str:
    parts = full_name.strip().split()
    if len(parts) != 2:
        raise HTTPException(400, "Enter the character's first name and surname.")
    slug = "-".join(parts).lower()
    return f"https://worldofwarcraft.blizzard.com/{REGION_LOCALES[region]}/forever/{region}/armory/character/{quote(slug, safe='-')}"

@app.post("/api/scan")
async def scan(req: ScanRequest):
    url = armory_character_url(req.region, req.name)
    try:
        async with httpx.AsyncClient(
            timeout=25,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 WoWForeverDungeonAdvisor/0.2"}
        ) as client:
            response = await client.get(url)
    except httpx.RequestError as exc:
        raise HTTPException(502, "Blizzard's Armory could not be reached. Please try again.") from exc

    if response.status_code == 404:
        raise HTTPException(404, "Character not found. Check the region and exact first name and surname. Characters may need to be level 10+ and logged out before appearing.")
    if response.status_code >= 400:
        raise HTTPException(502, f"Blizzard's Armory returned HTTP {response.status_code}. Please try again later.")

    soup = BeautifulSoup(response.text, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else "WoW Forever Armory"
    visible_text = soup.get_text(" ", strip=True)
    requested_name = " ".join(req.name.strip().split())
    # Reject generic error/landing pages instead of treating any HTTP 200 as a character.
    has_character_marker = (
        "characterProfileInitialState" in response.text
        or requested_name.casefold() in title.casefold()
        or requested_name.casefold() in visible_text.casefold()
    )
    if not has_character_marker:
        raise HTTPException(404, "Blizzard did not return a matching public character page. Check the spelling and region.")

    level_match = re.search(r"\bLevel\s*(\d{1,2})\b", visible_text, re.I)
    class_match = re.search(rf"\b({CLASSES})\b", title + " " + visible_text, re.I)
    faction_match = re.search(r"\b(Alliance|Horde)\b", visible_text, re.I)

    return {
        "source_url": str(response.url),
        "page_title": title,
        "character": {
            "name": requested_name,
            "region": req.region.upper(),
            "level": int(level_match.group(1)) if level_match else None,
            "class": class_match.group(1).title() if class_match else "Unknown",
            "faction": faction_match.group(1).title() if faction_match else "Unknown",
            "spec": "Unknown"
        },
        "equipped_gear": [],
        "scan_status": "profile_found_partial",
        "message": "Found the public Blizzard Armory page. Equipped-gear extraction is not yet verified, so dungeon rankings are withheld rather than guessed."
    }

@app.post("/api/analyze")
async def analyze(payload: dict):
    return {
        "status": "insufficient_data",
        "rankings": [],
        "message": "A sourced loot dataset, verified equipped items, and reliable drop-rate data are required before calculating expected useful upgrades per hour."
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

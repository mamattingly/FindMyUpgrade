from pathlib import Path
from urllib.parse import quote
import re
import json
import html
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal

app = FastAPI(title="WoW Forever Dungeon Advisor", version="0.3.0")
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"

REGION_LOCALES = {"us": "en-us", "eu": "en-gb", "kr": "ko-kr", "tw": "zh-tw"}
REGION_HOSTS = {"us": "us", "eu": "eu", "kr": "kr", "tw": "tw"}

class ScanRequest(BaseModel):
    region: Literal["us", "eu", "kr", "tw"] = "us"
    name: str = Field(min_length=3, max_length=80)

@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "wow-forever-dungeon-advisor"}

def _script_json(page: str, pattern: str):
    match = re.search(pattern, page, re.S | re.I)
    if not match:
        return None
    raw = html.unescape(match.group(1))
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None

def _normal_name(value: str) -> str:
    return " ".join(value.casefold().split())

def _character_from_page(page: str):
    state = _script_json(page, r"var\s+characterProfileInitialState\s*=\s*(\{.*?\})\s*;\s*</script>")
    character = state.get("character") if isinstance(state, dict) else None
    return character if isinstance(character, dict) and character.get("slug") else None

def _search_characters(page: str):
    model = _script_json(page, r'<script\s+id=["\']model["\']>\s*model\s*=\s*(\{.*?\})\s*;?\s*</script>')
    if not isinstance(model, dict):
        return []
    categories = model.get("categories") or []
    for category in categories:
        if isinstance(category, dict) and category.get("enum") == "CHARACTER":
            return [item for item in (category.get("results") or []) if isinstance(item, dict)]
    return []

async def _get_page(client: httpx.AsyncClient, url: str):
    try:
        response = await client.get(url)
    except httpx.RequestError as exc:
        raise HTTPException(502, "Blizzard's Armory could not be reached. Please try again.") from exc
    if response.status_code >= 500:
        raise HTTPException(502, f"Blizzard's Armory returned HTTP {response.status_code}. Please try again later.")
    return response

@app.post("/api/scan")
async def scan(req: ScanRequest):
    requested_name = " ".join(req.name.strip().split())
    parts = requested_name.split()
    if len(parts) != 2:
        raise HTTPException(400, "Enter the character's first name and surname.")
    slug = "-".join(parts).casefold()
    base = f"https://worldofwarcraft.blizzard.com/{REGION_LOCALES[req.region]}/forever/{req.region}/armory"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ForeverDungeonAdvisor/0.3)"}

    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=headers) as client:
        # The Armory search model is the authoritative way to confirm a name match.
        search_response = await _get_page(client, f"{base}?q={quote(requested_name)}")
        if search_response.status_code >= 400:
            raise HTTPException(502, f"Blizzard's Armory search returned HTTP {search_response.status_code}.")
        matches = _search_characters(search_response.text)
        exact = next((item for item in matches if _normal_name(item.get("name_search") or f"{item.get('name','')} {item.get('surname','')}") == _normal_name(requested_name)), None)

        # Search can omit a profile temporarily; direct slug lookup is still attempted,
        # but a page is accepted only when it contains Blizzard's embedded character object.
        profile_slug = exact.get("slug") if exact else slug
        profile_url = f"{base}/character/{quote(profile_slug, safe='-')}"
        profile_response = await _get_page(client, profile_url)
        if profile_response.status_code >= 400:
            raise HTTPException(404, "No public character profile was found. Check the exact name and region; characters generally appear after reaching level 10 and logging out.")

        character = _character_from_page(profile_response.text)
        if not character:
            raise HTTPException(404, "Blizzard returned a page, but it did not contain a character profile. This is not being treated as a successful lookup.")

        actual_name = " ".join([str(character.get("name") or ""), str(character.get("surname") or "")]).strip()
        if _normal_name(actual_name) != _normal_name(requested_name):
            raise HTTPException(404, f"The returned profile ({actual_name or 'unnamed'}) does not exactly match {requested_name}. No profile was saved.")

        char_class = (character.get("class") or {}).get("name") or (character.get("character_class") or {}).get("name")
        race = (character.get("race") or {}).get("name")
        faction_obj = character.get("faction") or {}
        faction = faction_obj.get("name") or faction_obj.get("slug") or faction_obj.get("type")
        ruleset = character.get("ruleset") or {}
        equipped = character.get("equipment")
        # Some page revisions include an item array; do not invent items if the
        # embedded profile only contains an API hyperlink.
        gear = []
        if isinstance(equipped, list):
            gear = equipped
        elif isinstance(equipped, dict) and isinstance(equipped.get("equipped_items"), list):
            gear = equipped["equipped_items"]

        result = {
            "source_url": str(profile_response.url),
            "page_title": BeautifulSoup(profile_response.text, "html.parser").title.get_text(" ", strip=True) if BeautifulSoup(profile_response.text, "html.parser").title else "WoW Forever Armory",
            "character": {
                "name": actual_name,
                "region": req.region.upper(),
                "level": character.get("level"),
                "class": char_class or "Unknown",
                "race": race or "Unknown",
                "faction": faction.title() if isinstance(faction, str) else "Unknown",
                "ruleset": ruleset.get("name") if isinstance(ruleset, dict) else None,
                "spec": "Unknown"
            },
            "equipped_gear": gear,
            "scan_status": "profile_found" if char_class and character.get("level") else "profile_found_partial",
            "message": "Found and verified the exact public character profile. Specialization and equipped-item details will be shown only when the source exposes them."
        }
        return result

@app.post("/api/analyze")
async def analyze(payload: dict):
    return {
        "status": "insufficient_data",
        "rankings": [],
        "message": "A verified gear snapshot and sourced dungeon loot/drop-rate dataset are still required before calculating useful upgrades per hour."
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

from pathlib import Path
from urllib.parse import quote
import os, re, json, html, time, asyncio
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal

app = FastAPI(title="WoW Forever Dungeon Advisor", version="0.4.2")
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"
REGION_LOCALES = {"us": "en_US", "eu": "en_GB", "kr": "ko_KR", "tw": "zh_TW"}
REGION_WEB_LOCALES = {"us": "en-us", "eu": "en-gb", "kr": "ko-kr", "tw": "zh-tw"}
TOKEN_CACHE = {"access_token": None, "expires_at": 0}

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
    try:
        return json.loads(html.unescape(match.group(1)))
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
    for category in model.get("categories") or []:
        if isinstance(category, dict) and category.get("enum") == "CHARACTER":
            return [item for item in (category.get("results") or []) if isinstance(item, dict)]
    return []

async def _get_page(client: httpx.AsyncClient, url: str):
    try:
        return await client.get(url)
    except httpx.RequestError as exc:
        raise HTTPException(502, "Blizzard's Armory could not be reached. Please try again.") from exc

async def _blizzard_token_diagnostic(client: httpx.AsyncClient):
    client_id, client_secret = os.getenv("BLIZZARD_CLIENT_ID"), os.getenv("BLIZZARD_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None, {"credentials_present": False, "token_status": "missing_credentials"}
    if TOKEN_CACHE["access_token"] and TOKEN_CACHE["expires_at"] > time.time() + 60:
        return TOKEN_CACHE["access_token"], {"credentials_present": True, "token_status": "cached_token"}
    try:
        response = await client.post("https://oauth.battle.net/token",
            data={"grant_type": "client_credentials"}, auth=(client_id, client_secret))
        if response.status_code != 200:
            return None, {"credentials_present": True, "token_status": "oauth_rejected", "oauth_http_status": response.status_code}
        data = response.json()
        TOKEN_CACHE["access_token"] = data["access_token"]
        TOKEN_CACHE["expires_at"] = time.time() + int(data.get("expires_in", 86400))
        return TOKEN_CACHE["access_token"], {"credentials_present": True, "token_status": "token_acquired"}
    except httpx.TimeoutException:
        return None, {"credentials_present": True, "token_status": "oauth_timeout"}
    except httpx.HTTPError:
        return None, {"credentials_present": True, "token_status": "oauth_network_error"}
    except (KeyError, ValueError):
        return None, {"credentials_present": True, "token_status": "oauth_invalid_response"}

async def _profile_api_diagnostic(client, token, region, slug, endpoint):
    url = f"https://{region}.api.blizzard.com/profile/wow/character/{quote(slug, safe='-')}/{endpoint}"
    try:
        response = await client.get(url,
            params={"namespace": f"profile-forever-{region}", "locale": REGION_LOCALES[region]},
            headers={"Authorization": f"Bearer {token}"})
        if response.status_code == 200:
            try:
                payload = response.json()
                return {"http_status": 200, "json": isinstance(payload, dict), "keys": sorted(payload.keys()) if isinstance(payload, dict) else []}, payload
            except ValueError:
                return {"http_status": 200, "json": False, "keys": []}, None
        return {"http_status": response.status_code, "json": False, "keys": []}, None
    except httpx.TimeoutException:
        return {"http_status": None, "error": "timeout"}, None
    except httpx.HTTPError:
        return {"http_status": None, "error": "network_error"}, None

async def _blizzard_token(client: httpx.AsyncClient):
    token, _ = await _blizzard_token_diagnostic(client)
    return token

async def _profile_api(client, token, region, slug, endpoint):
    _, payload = await _profile_api_diagnostic(client, token, region, slug, endpoint)
    return payload

def _gear_from_api(data):
    result = []
    for entry in (data or {}).get("equipped_items", []):
        if not isinstance(entry, dict): continue
        item, slot = entry.get("item") or {}, entry.get("slot") or {}
        level = entry.get("level")
        result.append({"slot": slot.get("name") or slot.get("type", {}).get("name") or "Unknown slot",
            "name": item.get("name") or "Unknown item",
            "item_level": level.get("value") if isinstance(level, dict) else level,
            "quality": (entry.get("quality") or {}).get("name"), "id": item.get("id")})
    return result

def _spec_from_api(data):
    if not isinstance(data, dict):
        return "Unknown"

    # Forever's character endpoint returns specialization_groups rather
    # than the older/retail-style top-level specializations array.
    groups = data.get("specialization_groups") or []
    for group in groups:
        if not isinstance(group, dict):
            continue
        if group.get("is_active") or group.get("active"):
            specs = group.get("specializations") or []
            for spec in specs:
                if not isinstance(spec, dict):
                    continue
                details = spec.get("specialization") or spec
                name = details.get("name") if isinstance(details, dict) else None
                if name:
                    return name
    # Fallback for API variants where the active marker is on the spec.
    for group in groups:
        if not isinstance(group, dict):
            continue
        for spec in group.get("specializations") or []:
            if not isinstance(spec, dict):
                continue
            if spec.get("is_active") or spec.get("active"):
                details = spec.get("specialization") or spec
                if isinstance(details, dict) and details.get("name"):
                    return details["name"]

    # Preserve compatibility with responses using a flat specialization list.
    for spec in data.get("specializations") or []:
        if not isinstance(spec, dict):
            continue
        if spec.get("is_active") or spec.get("active"):
            details = spec.get("specialization") or spec
            if isinstance(details, dict) and details.get("name"):
                return details["name"]
    return "Unknown"

def _professions_from_api(data):
    if not isinstance(data, dict): return []
    found = []
    for group in ("primaries", "secondaries"):
        for p in data.get(group, []) or []:
            prof = p.get("profession") or {}
            found.append({"name": prof.get("name") or "Unknown",
                "type": "Primary" if group == "primaries" else "Secondary",
                "skill": p.get("skill_points", 0), "max_skill": p.get("max_skill_points", 300),
                "tiers": [{"name": t.get("tier", {}).get("name"), "skill": t.get("skill_points", 0)}
                    for t in p.get("tiers", []) if isinstance(t, dict)]})
    return found

@app.post("/api/scan")
async def scan(req: ScanRequest):
    requested_name = " ".join(req.name.strip().split())
    parts = requested_name.split()
    if len(parts) != 2: raise HTTPException(400, "Enter the character's first name and surname.")
    slug = "-".join(parts).casefold()
    base = f"https://worldofwarcraft.blizzard.com/{REGION_WEB_LOCALES[req.region]}/forever/{req.region}/armory"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ForeverDungeonAdvisor/0.4)"}
    async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers=headers) as client:
        search_response = await _get_page(client, f"{base}?q={quote(requested_name)}")
        if search_response.status_code >= 500: raise HTTPException(502, f"Blizzard's Armory search returned HTTP {search_response.status_code}. Please try again later.")
        if search_response.status_code >= 400: raise HTTPException(502, f"Blizzard's Armory search returned HTTP {search_response.status_code}.")
        matches = _search_characters(search_response.text)
        exact = next((x for x in matches if _normal_name(x.get("name_search") or f"{x.get('name','')} {x.get('surname','')}") == _normal_name(requested_name)), None)
        profile_slug = exact.get("slug") if exact else slug
        profile_response = await _get_page(client, f"{base}/character/{quote(profile_slug, safe='-')}")
        if profile_response.status_code >= 400:
            raise HTTPException(404, "No public character profile was found. Check the exact name and region; characters generally appear after reaching level 10 and logging out.")
        character = _character_from_page(profile_response.text)
        if not character: raise HTTPException(404, "Blizzard returned a page without an embedded character profile.")
        actual_name = " ".join([str(character.get("name") or ""), str(character.get("surname") or "")]).strip()
        if _normal_name(actual_name) != _normal_name(requested_name):
            raise HTTPException(404, f"The returned profile ({actual_name or 'unnamed'}) does not exactly match {requested_name}.")
        char_class = (character.get("class") or {}).get("name") or (character.get("character_class") or {}).get("name")
        race = (character.get("race") or {}).get("name")
        faction_obj = character.get("faction") or {}
        faction = faction_obj.get("name") or faction_obj.get("slug") or faction_obj.get("type")
        ruleset = character.get("ruleset") or {}
        gear, spec, professions, api_status = [], "Unknown", [], "credentials_not_configured"
        token = await _blizzard_token(client)
        if token:
            equipment_data, spec_data, profession_data = await asyncio.gather(
                _profile_api(client, token, req.region, profile_slug, "equipment"),
                _profile_api(client, token, req.region, profile_slug, "specializations"),
                _profile_api(client, token, req.region, profile_slug, "professions"))
            gear, spec, professions = _gear_from_api(equipment_data), _spec_from_api(spec_data), _professions_from_api(profession_data)
            api_status = "connected" if any([equipment_data, spec_data, profession_data]) else "api_data_unavailable"
        soup = BeautifulSoup(profile_response.text, "html.parser")
        return {"source_url": str(profile_response.url),
            "page_title": soup.title.get_text(" ", strip=True) if soup.title else "WoW Forever Armory",
            "character": {"name": actual_name, "region": req.region.upper(), "level": character.get("level"),
                "class": char_class or "Unknown", "race": race or "Unknown",
                "faction": faction.title() if isinstance(faction, str) else "Unknown",
                "ruleset": ruleset.get("name") if isinstance(ruleset, dict) else None, "spec": spec},
            "equipped_gear": gear, "professions": professions, "api_status": api_status,
            "scan_status": "profile_found" if char_class and character.get("level") else "profile_found_partial",
            "message": "Character verified. Gear, specialization and profession skills were retrieved from Blizzard's profile API." if api_status == "connected" else "Character verified. Add Blizzard API credentials in Render to enable automatic gear, specialization and profession retrieval. You can track profession skill manually in this build."}

@app.get("/api/diagnostics")
async def diagnostics(region: Literal["us", "eu", "kr", "tw"] = "us", name: str = "Faith Heal"):
    parts = " ".join(name.strip().split()).split()
    if len(parts) != 2:
        raise HTTPException(400, "Enter the character's first name and surname.")
    slug = "-".join(parts).casefold()
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        token, auth = await _blizzard_token_diagnostic(client)
        result = {"app_version": app.version, **auth, "region": region.upper(), "character_slug": slug}
        if not token:
            return result
        endpoints = ("equipment", "specializations", "professions")
        checks = await asyncio.gather(*[
            _profile_api_diagnostic(client, token, region, slug, endpoint)
            for endpoint in endpoints
        ])
        for endpoint, (status, payload) in zip(endpoints, checks):
            result[endpoint] = status
            if endpoint == "equipment" and isinstance(payload, dict):
                items = payload.get("equipped_items")
                result["equipment_item_count"] = len(items) if isinstance(items, list) else None
                result["equipment_item_samples"] = [
                    {
                        "entry_keys": sorted(entry.keys()) if isinstance(entry, dict) else [],
                        "entry_name": entry.get("name") if isinstance(entry, dict) else None,
                        "item_type": type(entry.get("item")).__name__ if isinstance(entry, dict) else None,
                        "item_keys": sorted((entry.get("item") or {}).keys()) if isinstance(entry, dict) and isinstance(entry.get("item"), dict) else [],
                        "item_name": (entry.get("item") or {}).get("name") if isinstance(entry, dict) and isinstance(entry.get("item"), dict) else None,
                        "item_id": (entry.get("item") or {}).get("id") if isinstance(entry, dict) and isinstance(entry.get("item"), dict) else None,
                    }
                    for entry in (items or [])[:3]
                ]
            elif endpoint == "specializations" and isinstance(payload, dict):
                groups = payload.get("specialization_groups")
                flat_specs = payload.get("specializations")
                result["specialization_group_count"] = len(groups) if isinstance(groups, list) else None
                result["specialization_count"] = (
                    sum(len(g.get("specializations") or []) for g in groups if isinstance(g, dict))
                    if isinstance(groups, list) else
                    len(flat_specs) if isinstance(flat_specs, list) else None
                )
                result["active_specialization_groups"] = (
                    sum(1 for g in groups if isinstance(g, dict) and (g.get("is_active") or g.get("active")))
                    if isinstance(groups, list) else None
                )
                result["specialization_candidates"] = [
                    (s.get("specialization") or s).get("name")
                    for g in (groups or []) if isinstance(g, dict)
                    for s in (g.get("specializations") or []) if isinstance(s, dict)
                    and isinstance((s.get("specialization") or s), dict)
                    and (s.get("specialization") or s).get("name")
                ][:8]
            elif endpoint == "professions" and isinstance(payload, dict):
                result["profession_groups"] = [k for k in ("primaries", "secondaries") if isinstance(payload.get(k), list)]
        return result

@app.post("/api/analyze")
async def analyze(payload: dict):
    return {"status": "insufficient_data", "rankings": [], "message": "Verified equipped gear and a sourced dungeon loot/drop-rate dataset are required before calculating meaningful upgrades per hour."}

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    @app.get("/{path:path}")
    async def frontend(path: str):
        candidate = (DIST / path).resolve()
        if path and candidate.is_file() and str(candidate).startswith(str(DIST.resolve())): return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
else:
    @app.get("/")
    async def root(): return {"message": "Frontend build missing. Build frontend/ before starting the app."}

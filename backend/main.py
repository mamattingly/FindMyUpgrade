from pathlib import Path
from urllib.parse import quote
import os, re, json, html, time, asyncio, csv, io
import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal
from backend.recommendations import DUNGEONS, recommend_dungeons

app = FastAPI(title="WoW Forever Dungeon Advisor", version="0.9.0")
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"
REGION_LOCALES = {"us": "en_US", "eu": "en_GB", "kr": "ko_KR", "tw": "zh_TW"}
REGION_WEB_LOCALES = {"us": "en-us", "eu": "en-gb", "kr": "ko-kr", "tw": "zh-tw"}
TOKEN_CACHE = {"access_token": None, "expires_at": 0}
ITEM_CACHE = {}
ITEM_ICON_CACHE = {}
MODEL_ASSET_CACHE = {}

class ScanRequest(BaseModel):
    region: Literal["us", "eu", "kr", "tw"] = "us"
    name: str = Field(min_length=3, max_length=80)

@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "wow-forever-dungeon-advisor", "app_version": app.version}

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
        if not isinstance(entry, dict):
            continue
        item, slot = entry.get("item") or {}, entry.get("slot") or {}
        level = entry.get("level")
        raw_stats = entry.get("stats") or []
        stats = []
        for stat in raw_stats:
            if not isinstance(stat, dict):
                continue
            stat_type = stat.get("type") or {}
            stat_name = stat_type.get("name") if isinstance(stat_type, dict) else None
            if stat_name and stat.get("value") is not None:
                stats.append({"name": stat_name, "value": stat.get("value")})
        armor = entry.get("armor") or {}
        weapon = entry.get("weapon") or {}
        dps = weapon.get("dps") or {}
        result.append({
            "slot": slot.get("name") or slot.get("type", {}).get("name") or "Unknown slot",
            # Forever returns the display name on the equipped_items entry;
            # entry.item contains only the item id and resource key.
            "name": entry.get("name") or item.get("name") or "Unknown item",
            "item_level": level.get("value") if isinstance(level, dict) else level,
            "quality": (entry.get("quality") or {}).get("name"), "id": item.get("id"),
            "stats": stats,
            "armor": armor.get("value") if isinstance(armor, dict) else armor,
            "weapon_dps": dps.get("value") if isinstance(dps, dict) else dps,
        })
    return result

def _spec_from_api(data):
    """Return only the explicitly active specialization; never guess from list order."""
    if not isinstance(data, dict):
        return "Unknown"
    groups = data.get("specialization_groups") or []
    for group in groups:
        if not isinstance(group, dict) or not (group.get("is_active") or group.get("active")):
            continue
        specs = group.get("specializations") or []
        for entry in specs:
            if not isinstance(entry, dict) or not (entry.get("is_active") or entry.get("active")):
                continue
            details = entry.get("specialization") or entry
            if isinstance(details, dict) and details.get("name"):
                return details["name"]
        # An active group with one spec is unambiguous; never assume the first
        # spec when the group contains multiple choices but no active marker.
        if len(specs) == 1 and isinstance(specs[0], dict):
            details = specs[0].get("specialization") or specs[0]
            if isinstance(details, dict) and details.get("name"):
                return details["name"]
    for group in groups:
        if not isinstance(group, dict):
            continue
        for entry in group.get("specializations") or []:
            if not isinstance(entry, dict) or not (entry.get("is_active") or entry.get("active")):
                continue
            details = entry.get("specialization") or entry
            if isinstance(details, dict) and details.get("name"):
                return details["name"]
    for entry in data.get("specializations") or []:
        if not isinstance(entry, dict) or not (entry.get("is_active") or entry.get("active")):
            continue
        details = entry.get("specialization") or entry
        if isinstance(details, dict) and details.get("name"):
            return details["name"]
    return "Unknown"
def _api_name(value):
    return value.get("name") if isinstance(value, dict) else value


MODEL_RACE_IDS = {
    "human": 1, "orc": 2, "dwarf": 3, "night elf": 4,
    "undead": 5, "scourge": 5, "tauren": 6, "gnome": 7,
    "troll": 8, "blood elf": 10, "draenei": 11,
}


MODEL_SLOT_BY_NAME = {
    "head": 1, "shoulder": 3, "shoulders": 3, "shirt": 4,
    "chest": 5, "waist": 6, "legs": 7, "feet": 8,
    "wrist": 9, "wrists": 9, "hands": 10, "back": 15,
    "main hand": 16, "mainhand": 16, "off hand": 17, "offhand": 17,
    "ranged": 18, "tabard": 19,
}


def _model_viewer_slot(slot, inventory_type=None):
    name = str(_api_name(slot) or "").strip().casefold().replace("_", " ")
    name = re.sub(r"\s+", " ", name)
    if name == "chest" and str(_api_name(inventory_type) or "").casefold() == "robe":
        return 20
    return MODEL_SLOT_BY_NAME.get(name)


def _appearance_gender_id(gender):
    value = str(_api_name(gender) or "").casefold()
    if value in {"male", "masculine"}:
        return 1
    if value in {"female", "feminine"}:
        return 0
    return None


async def _blizzard_static_json(client, token, region, path, required_field=None):
    """Fetch a model-data field from the best matching Blizzard static namespace."""
    forever_first = (
        f"static-forever-{region}",
        f"static-classic1x-{region}",
        f"static-classic-{region}",
    )
    namespaces = forever_first
    for namespace in namespaces:
        try:
            response = await client.get(
                f"https://{region}.api.blizzard.com/{path.lstrip('/')}",
                params={"namespace": namespace, "locale": REGION_LOCALES[region]},
                headers={"Authorization": f"Bearer {token}"}, timeout=10)
            if response.status_code != 200:
                continue
            payload = response.json()
            if not isinstance(payload, dict):
                continue
            # A 200 response without the field we need is not a successful
            # appearance lookup; continue to the next compatible namespace.
            if required_field and not payload.get(required_field):
                continue
            return payload
        except (httpx.HTTPError, ValueError, TypeError):
            continue
    return None


MODEL_DISPLAY_CACHE = {}
MODEL_DISPLAY_DIAGNOSTICS = {}


def _parse_wowhead_model_display_id(page):
    """Read modelviewer.displayid from JSON or JavaScript object syntax."""
    source = page or ""
    marker = re.search(r"""["']?modelviewer["']?\s*:""", source, re.I)
    if not marker:
        return None
    # Keep the search local to the modelviewer object so another item's
    # displayid elsewhere on a long database page cannot be mistaken for it.
    section = source[marker.start():marker.start() + 3000]
    match = re.search(
        r"""["']?display(?:id|Id|ID)["']?\s*:\s*["']?(\d+)""",
        section, re.I)
    return int(match.group(1)) if match else None


async def _wowhead_page_display_id(client, item_id):
    """Fallback for legacy items absent from Blizzard's appearance catalog."""
    item_id = int(item_id)
    if item_id in MODEL_DISPLAY_CACHE:
        return MODEL_DISPLAY_CACHE[item_id]
    urls = [f"https://www.wowhead.com/forever/item={item_id}"]
    if item_id < 100000:
        urls.append(f"https://www.wowhead.com/classic/item={item_id}")
    diagnostics = []
    for url in urls:
        try:
            response = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml",
                },
                timeout=12)
            display_id = _parse_wowhead_model_display_id(response.text) if response.status_code == 200 else None
            diagnostics.append({
                "url": url, "status": response.status_code,
                "html_length": len(response.text or ""),
                "modelviewer_present": bool(re.search(r'modelviewer', response.text or "", re.I)),
                "display_id": display_id,
            })
            if display_id:
                MODEL_DISPLAY_CACHE[item_id] = display_id
                MODEL_DISPLAY_DIAGNOSTICS[item_id] = diagnostics
                return display_id
        except (httpx.HTTPError, ValueError) as exc:
            diagnostics.append({"url": url, "error": type(exc).__name__})
            continue
    MODEL_DISPLAY_CACHE[item_id] = None
    MODEL_DISPLAY_DIAGNOSTICS[item_id] = diagnostics
    return None


MODEL_APPEARANCE_CACHE = {}
MODEL_APPEARANCE_DIAGNOSTICS = {}
WAGO_DB2_CACHE = {"build": None, "item_to_appearances": {}, "appearance_to_display": {}, "diagnostics": []}
WAGO_DB2_LOCK = asyncio.Lock()
WAGO_DB2_BUILDS = ("1.60.1.70938", "1.60.1.70888", "1.60.1.70532")


def _csv_field(row, field):
    target = re.sub(r"[^a-z0-9]", "", field.casefold())
    for key, value in row.items():
        if re.sub(r"[^a-z0-9]", "", str(key).casefold()) == target:
            return value
    return None


def _parse_wago_appearance_tables(item_modified_csv, item_appearance_csv):
    """Build ItemID -> ItemDisplayInfoID through the two authoritative DB2 tables."""
    item_to_appearances = {}
    for row in csv.DictReader(io.StringIO((item_modified_csv or "").lstrip("\\ufeff"))):
        try:
            item_id = int(_csv_field(row, "ItemID") or 0)
            appearance_id = int(_csv_field(row, "ItemAppearanceID") or 0)
            order_index = int(_csv_field(row, "OrderIndex") or 0)
        except (TypeError, ValueError):
            continue
        if item_id > 0 and appearance_id > 0:
            item_to_appearances.setdefault(item_id, []).append((order_index, appearance_id))

    appearance_to_display = {}
    for row in csv.DictReader(io.StringIO((item_appearance_csv or "").lstrip("\\ufeff"))):
        try:
            appearance_id = int(_csv_field(row, "ID") or 0)
            display_id = int(_csv_field(row, "ItemDisplayInfoID") or 0)
        except (TypeError, ValueError):
            continue
        if appearance_id > 0 and display_id > 0:
            appearance_to_display[appearance_id] = display_id

    item_to_display = {}
    for item_id, candidates in item_to_appearances.items():
        for _order_index, appearance_id in sorted(candidates):
            display_id = appearance_to_display.get(appearance_id)
            if display_id:
                item_to_display[item_id] = {
                    "appearance_id": appearance_id,
                    "display_id": display_id,
                }
                break
    return item_to_display, len(item_to_appearances), len(appearance_to_display)


async def _fetch_wago_csv(client, table, build):
    url = f"https://wago.tools/db2/{table}/csv"
    try:
        response = await client.get(
            url, params={"build": build, "locale": "enUS"},
            headers={"User-Agent": "WoW-Forever-Dungeon-Advisor/0.9.0", "Accept": "text/csv,*/*"},
            timeout=35)
        if response.status_code != 200:
            return None, {"table": table, "build": build, "status": response.status_code}
        body = response.text
        if len(body) > 60 * 1024 * 1024:
            return None, {"table": table, "build": build, "status": 200,
                          "error": "CSV exceeded the 60 MB safety limit", "bytes": len(body)}
        reader = csv.DictReader(io.StringIO(body.lstrip("\\ufeff")))
        fields = reader.fieldnames or []
        return body, {"table": table, "build": build, "status": 200,
                      "bytes": len(response.content), "columns": fields[:30]}
    except (httpx.HTTPError, ValueError) as exc:
        return None, {"table": table, "build": build, "error": type(exc).__name__}


async def _wago_build_candidates(client):
    candidates = []
    try:
        response = await client.get(
            "https://wago.tools/db2",
            headers={"User-Agent": "WoW-Forever-Dungeon-Advisor/0.8.9"},
            timeout=15)
        match = re.search(r'data-page="([^"]+)"', response.text)
        if response.status_code == 200 and match:
            payload = json.loads(html.unescape(match.group(1)))
            versions = payload.get("props", {}).get("versions", [])
            candidates = [v for v in versions if re.match(r"^1\\.60\\.1\\.\\d+$", str(v))]
            candidates.sort(key=lambda v: tuple(int(x) for x in re.findall(r"\\d+", v)), reverse=True)
    except (httpx.HTTPError, ValueError, TypeError):
        pass
    return list(dict.fromkeys(candidates + list(WAGO_DB2_BUILDS)))


async def _load_wago_appearance_index(client):
    if WAGO_DB2_CACHE["build"] or WAGO_DB2_CACHE["diagnostics"]:
        return WAGO_DB2_CACHE
    async with WAGO_DB2_LOCK:
        if WAGO_DB2_CACHE["build"] or WAGO_DB2_CACHE["diagnostics"]:
            return WAGO_DB2_CACHE
        builds = await _wago_build_candidates(client)
        WAGO_DB2_CACHE["diagnostics"].append({
            "source": "wago_db2_build_discovery", "candidate_builds": builds[:5]
        })
        for build in builds[:5]:
            modified_task = _fetch_wago_csv(client, "ItemModifiedAppearance", build)
            appearance_task = _fetch_wago_csv(client, "ItemAppearance", build)
            modified_csv, appearance_csv = await asyncio.gather(modified_task, appearance_task)
            WAGO_DB2_CACHE["diagnostics"].extend([modified_csv[1], appearance_csv[1]])
            if not modified_csv[0] or not appearance_csv[0]:
                continue
            try:
                item_map, modified_count, appearance_count = _parse_wago_appearance_tables(
                    modified_csv[0], appearance_csv[0])
            except (csv.Error, UnicodeError, ValueError):
                continue
            if item_map:
                WAGO_DB2_CACHE.update({
                    "build": build,
                    "item_to_appearances": item_map,
                    "appearance_to_display": {},
                    "diagnostics": WAGO_DB2_CACHE["diagnostics"] + [{
                        "build": build, "resolved_item_count": len(item_map),
                        "item_modified_appearance_item_count": modified_count,
                        "item_appearance_count": appearance_count,
                    }],
                })
                break
        return WAGO_DB2_CACHE


async def _wago_item_display_data(client, item_id):
    cache = await _load_wago_appearance_index(client)
    result = cache["item_to_appearances"].get(int(item_id))
    if result:
        return result
    return None



def _parse_icyveins_item_appearance(page):
    """Extract Icy Veins' Forever ItemAppearance ID from its item reference block."""
    text = BeautifulSoup(page or "", "html.parser").get_text(" ", strip=True)
    match = re.search(r"\bAppearance\s*:\s*(\d+)\b", text, re.I)
    return int(match.group(1)) if match else None


def _extract_thewowdb_model_fields(payload):
    """Extract only explicit appearance/display fields from TheWoWDB JSON."""
    display_names = {"item_display_info_id", "display_id", "displayid", "display_info_id"}
    appearance_names = {"appearance_id", "appearanceid", "item_appearance_id", "appearance"}
    found = {"display_id": None, "appearance_id": None}

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                normalized = re.sub(r"[^a-z0-9]", "", str(key).casefold())
                if normalized in {re.sub(r"[^a-z0-9]", "", x) for x in display_names}:
                    try:
                        number = int(child)
                        if number > 0 and found["display_id"] is None:
                            found["display_id"] = number
                    except (TypeError, ValueError):
                        pass
                elif normalized in {re.sub(r"[^a-z0-9]", "", x) for x in appearance_names}:
                    candidates = child if isinstance(child, list) else [child]
                    for candidate_value in candidates:
                        if isinstance(candidate_value, dict):
                            candidate_value = candidate_value.get("id")
                        try:
                            number = int(candidate_value)
                            if number > 0 and found["appearance_id"] is None:
                                found["appearance_id"] = number
                        except (TypeError, ValueError):
                            pass
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(payload)
    return found


async def _icyveins_item_appearance_id(client, item_id):
    item_id = int(item_id)
    if item_id in MODEL_APPEARANCE_CACHE:
        return MODEL_APPEARANCE_CACHE[item_id]
    url = f"https://db.icy-veins.com/wow-forever/items/{item_id}"
    diagnostic = {"source": "icy_veins", "url": url}
    try:
        response = await client.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml",
            },
            timeout=12)
        appearance_id = _parse_icyveins_item_appearance(response.text) if response.status_code == 200 else None
        diagnostic.update({
            "status": response.status_code,
            "html_length": len(response.text or ""),
            "appearance_id": appearance_id,
        })
    except httpx.HTTPError as exc:
        appearance_id = None
        diagnostic["error"] = type(exc).__name__
    MODEL_APPEARANCE_CACHE[item_id] = appearance_id
    MODEL_APPEARANCE_DIAGNOSTICS.setdefault(item_id, []).append(diagnostic)
    return appearance_id


async def _thewowdb_item_model_fields(client, item_id):
    url = f"https://thewowdb.com/api/v1/forever/item/{int(item_id)}"
    diagnostic = {"source": "thewowdb", "url": url}
    try:
        response = await client.get(url, headers={"Accept": "application/json"}, timeout=12)
        diagnostic["status"] = response.status_code
        if response.status_code != 200:
            MODEL_APPEARANCE_DIAGNOSTICS.setdefault(int(item_id), []).append(diagnostic)
            return {"display_id": None, "appearance_id": None}
        payload = response.json()
        fields = _extract_thewowdb_model_fields(payload)
        diagnostic.update({
            "top_keys": sorted(payload.keys())[:50] if isinstance(payload, dict) else [],
            **fields,
        })
        MODEL_APPEARANCE_DIAGNOSTICS.setdefault(int(item_id), []).append(diagnostic)
        return fields
    except (httpx.HTTPError, ValueError) as exc:
        diagnostic["error"] = type(exc).__name__
        MODEL_APPEARANCE_DIAGNOSTICS.setdefault(int(item_id), []).append(diagnostic)
        return {"display_id": None, "appearance_id": None}


async def _blizzard_item_appearance_display_id(client, token, region, appearance_id):
    if not appearance_id:
        return None
    data = await _blizzard_static_json(
        client, token, region, f"data/wow/item-appearance/{int(appearance_id)}",
        required_field="item_display_info_id")
    try:
        value = int((data or {}).get("item_display_info_id"))
        return value if value > 0 else None
    except (TypeError, ValueError):
        return None


async def _build_character_model(client, token, region, appearance, race_name=None):
    """Build Classic viewer input from Forever's transmog-aware appearance API."""
    if not isinstance(appearance, dict):
        return None
    playable_race = appearance.get("playable_race") or {}
    race_id = playable_race.get("id") if isinstance(playable_race, dict) else None
    if not race_id:
        race_id = MODEL_RACE_IDS.get(str(race_name or "").casefold())
    gender = appearance.get("gender") or {}
    gender_type = gender.get("type") if isinstance(gender, dict) else gender
    gender_id = 0 if str(gender_type).casefold() == "female" else 1 if str(gender_type).casefold() == "male" else None
    if not race_id or gender_id is None:
        return None

    # The viewer uses 1-based inventory slots. Blizzard's internal_slot_id is
    # 0-based, so viewerSlot = internal_slot_id + 1.
    not_displayed = {2, 11, 12, 13, 14}
    visible = []
    for entry in appearance.get("items") or []:
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        try:
            viewer_slot = int(entry.get("internal_slot_id")) + 1
        except (TypeError, ValueError):
            continue
        if viewer_slot in not_displayed:
            continue
        visible.append({"item_id": int(entry["id"]), "slot": viewer_slot})

    async def resolve_appearance(item):
        data = await _blizzard_static_json(
            client, token, region, f"data/wow/item/{item['item_id']}",
            required_field="appearances")
        appearances = (data or {}).get("appearances") or []
        if not appearances or not isinstance(appearances[0], dict):
            return None
        appearance_id = appearances[0].get("id")
        if not appearance_id:
            return None
        return int(appearance_id)

    appearance_ids = await asyncio.gather(*(resolve_appearance(item) for item in visible))

    display_ids = await asyncio.gather(*(
        _blizzard_item_appearance_display_id(client, token, region, app_id)
        for app_id in appearance_ids
    ))
    display_sources = [
        "blizzard_item_appearance" if display_id else None
        for display_id in display_ids
    ]

    # Forever item pages can expose an ItemAppearance row even when the
    # Blizzard Item API omits the item's appearances array.
    fallback_semaphore = asyncio.Semaphore(5)

    async def fallback_display_data(item_id):
        async with fallback_semaphore:
            # Query the free Forever item API and the Forever item reference
            # page concurrently. Both provide item-specific data, never guesses.
            thewowdb_task = _thewowdb_item_model_fields(client, item_id)
            icy_task = _icyveins_item_appearance_id(client, item_id)
            thewowdb_fields, icy_appearance_id = await asyncio.gather(thewowdb_task, icy_task)

            wago_fields = await _wago_item_display_data(client, item_id)
            if wago_fields:
                MODEL_APPEARANCE_DIAGNOSTICS.setdefault(item_id, []).append({
                    "source": "wago_db2",
                    "build": WAGO_DB2_CACHE.get("build"),
                    "appearance_id": wago_fields.get("appearance_id"),
                    "display_id": wago_fields.get("display_id"),
                })
                return wago_fields["display_id"], "wago_db2_itemappearance_chain"

            if thewowdb_fields.get("display_id"):
                return thewowdb_fields["display_id"], "thewowdb_display_id"

            appearance_id = (
                thewowdb_fields.get("appearance_id")
                or icy_appearance_id
            )
            if appearance_id:
                display_id = await _blizzard_item_appearance_display_id(
                    client, token, region, appearance_id)
                MODEL_APPEARANCE_DIAGNOSTICS.setdefault(item_id, []).append({
                    "source": "blizzard_item_appearance_from_fallback",
                    "appearance_id": appearance_id,
                    "display_id": display_id,
                })
                if display_id:
                    return display_id, "blizzard_item_appearance_from_icyveins_or_thewowdb"

            # Last resort only: Wowhead item pages are frequently bot-blocked
            # from server runtimes, but retain the fallback for when accessible.
            display_id = await _wowhead_page_display_id(client, item_id)
            if display_id:
                return display_id, "wowhead_modelviewer"
            return None, None

    fallback_indexes = [i for i, display_id in enumerate(display_ids) if not display_id]
    fallback_values = await asyncio.gather(*(
        fallback_display_data(visible[i]["item_id"]) for i in fallback_indexes
    ))
    for index, (display_id, source) in zip(fallback_indexes, fallback_values):
        display_ids[index] = display_id
        display_sources[index] = source

    items = []
    missing = []
    resolved_appearances = []
    for equipped, display_id, source in zip(visible, display_ids, display_sources):
        if display_id:
            items.append([equipped["slot"], display_id])
            resolved_appearances.append({
                "item_id": equipped["item_id"],
                "slot": equipped["slot"],
                "display_id": display_id,
                "source": source,
            })
        else:
            missing.append(equipped["item_id"])

    customizations = []
    for entry in appearance.get("customizations") or []:
        if not isinstance(entry, dict):
            continue
        option = entry.get("option") or {}
        choice = entry.get("choice") or {}
        option_name = _api_name(option.get("name"))
        display_order = choice.get("display_order")
        if option_name and display_order is not None:
            try:
                customizations.append({
                    "option_name": str(option_name),
                    "display_order": int(display_order),
                })
            except (TypeError, ValueError):
                continue
    return {
        "race": int(race_id), "gender": gender_id,
        "customizations": customizations, "items": items,
        "resolved_item_count": len(items),
        "equipped_visual_item_count": len(visible),
        "missing_display_ids": missing,
        "resolved_appearances": resolved_appearances,
        "display_fallback_debug": {
            str(item_id): (
                MODEL_APPEARANCE_DIAGNOSTICS.get(item_id, [])
                + MODEL_DISPLAY_DIAGNOSTICS.get(item_id, [])
            ) for item_id in set(missing) | {x["item_id"] for x in resolved_appearances
                                             if x["source"] != "blizzard_item_appearance"}
        },
        "source": "Blizzard Forever appearance + Wago DB2, TheWoWDB, Icy Veins and Wowhead item display metadata",
        "wago_db2": {
            "build": WAGO_DB2_CACHE.get("build"),
            "diagnostics": WAGO_DB2_CACHE.get("diagnostics", []),
        },
    }

def _numeric_value(value):
    if isinstance(value, dict):
        return value.get("value")
    return value

def _normalise_thewowdb_item(data, item_id):
    preview = data.get("preview_item") or {}
    raw_stats = data.get("stats") or data.get("attributes") or preview.get("stats") or []
    stats, stats_display = [], []
    if isinstance(raw_stats, dict):
        raw_stats = [{"name": k, "value": _numeric_value(v)} for k, v in raw_stats.items()]
    for stat in raw_stats if isinstance(raw_stats, list) else []:
        if not isinstance(stat, dict):
            continue
        stat_name = _api_name(stat.get("name") or stat.get("stat") or stat.get("type"))
        value = stat.get("value", stat.get("amount"))
        if stat_name and value is not None:
            stats.append({"name": stat_name, "value": _numeric_value(value)})
        display = stat.get("display") or stat.get("display_string")
        if isinstance(display, dict):
            display = display.get("display_string") or display.get("text")
        if display:
            stats_display.append(str(display))
    inventory = data.get("inventory_type") or data.get("inventoryType") or data.get("slot")
    item_class = data.get("item_class") or data.get("itemClass") or data.get("class")
    item_subclass = data.get("item_subclass") or data.get("itemSubclass") or data.get("subclass")
    level = data.get("item_level", data.get("itemLevel", data.get("level")))
    if level is None:
        level = (preview.get("level") or {}).get("value")
    armor = data.get("armor") or preview.get("armor") or 0
    weapon = data.get("weapon") or preview.get("weapon") or {}
    dps = weapon.get("dps") if isinstance(weapon, dict) else data.get("dps")
    links = data.get("links") or {}
    return {
        "id": int(item_id), "name": data.get("name"),
        "required_level": data.get("required_level", data.get("requiredLevel", 0)),
        "inventory_type": _api_name(inventory), "item_class": _api_name(item_class),
        "item_subclass": _api_name(item_subclass), "item_level": _numeric_value(level),
        "stats": stats, "stats_display": stats_display,
        "armor": _numeric_value(armor), "weapon_dps": _numeric_value(dps),
        "data_url": links.get("html") or data.get("url"),
        "data_source": "TheWoWDB",
    }

def _parse_tooltip_fragment(page, item_id, name=None, data_url=None, data_source="WarcraftDB Forever"):
    soup = BeautifulSoup(page, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    lines = [str(x).strip() for x in soup.stripped_strings if str(x).strip()]
    starts = [i for i, line in enumerate(lines) if re.match(r"Item Level\s+\d+", line, re.I)]
    start = starts[-1] if starts else 0
    section = lines[start:start + 45]
    section_text = " ".join(section)
    heading = soup.find("h1")
    name = name or (heading.get_text(" ", strip=True) if heading else None)
    level_match = re.search(r"Item Level\s+(\d+)", section_text, re.I)
    required_match = re.search(r"Requires Level\s+(\d+)", section_text, re.I)
    drop_match = re.search(r"Drop Chance:\s*([\d.]+)\s*%", section_text, re.I)
    source_match = re.search(r"Dropped by:\s*(.*?)\s+Drop Chance:", section_text, re.I)
    armor_match = re.search(r"(\d+)\s+Armor\b", section_text, re.I)
    dps_match = re.search(r"\(([\d.]+)\s+damage per second\)", section_text, re.I)
    type_line = next((line for line in section[:9] if re.search(
        r"\b(Head|Neck|Shoulder|Back|Chest|Robe|Shirt|Wrist|Hands|Waist|Legs|Feet|Finger|Trinket|Two-Hand|One-Hand|Main Hand|Off Hand|Held In Off-hand|Ranged)\b",
        line, re.I)), "")
    low_type = type_line.casefold()
    if "two-hand" in low_type or "two hand" in low_type:
        inventory = "Two-Hand"
    elif "one-hand" in low_type or "one hand" in low_type:
        inventory = "One-Hand"
    elif "main hand" in low_type:
        inventory = "Main Hand"
    elif "held in off-hand" in low_type:
        inventory = "Held In Off-hand"
    elif "off hand" in low_type:
        inventory = "Off Hand"
    elif "ranged" in low_type or "wand" in low_type:
        inventory = "Ranged"
    elif "shoulder" in low_type:
        inventory = "Shoulder"
    elif "chest" in low_type or "robe" in low_type:
        inventory = "Chest"
    elif "back" in low_type or "cloak" in low_type:
        inventory = "Back"
    elif "finger" in low_type or "ring" in low_type:
        inventory = "Finger"
    elif "trinket" in low_type:
        inventory = "Trinket"
    else:
        inventory = next((x for x in ("Head", "Neck", "Shirt", "Wrist", "Hands", "Waist", "Legs", "Feet")
                          if x.casefold() in low_type), None)
    weapon_tokens = ("staff", "wand", "dagger", "mace", "sword", "axe", "polearm", "fist", "bow", "gun", "crossbow", "thrown")
    armor_tokens = ("cloth", "leather", "mail", "plate", "shield")
    item_class = "Weapon" if any(x in low_type for x in weapon_tokens) else "Armor"
    subclass = next((x.title() for x in weapon_tokens + armor_tokens if x in low_type), "Miscellaneous")
    stats = []
    stat_patterns = [
        ("Stamina", r"\+([\d.]+)\s+Stamina\b"),
        ("Intellect", r"\+([\d.]+)\s+Intellect\b"),
        ("Spirit", r"\+([\d.]+)\s+Spirit\b"),
        ("Strength", r"\+([\d.]+)\s+Strength\b"),
        ("Agility", r"\+([\d.]+)\s+Agility\b"),
        ("Attack Power", r"\+([\d.]+)\s+Attack Power\b"),
        ("Spell Damage", r"\+([\d.]+)\s+Spell Damage\b"),
        ("Spell Healing", r"\+([\d.]+)\s+Healing\b"),
        ("Mana per 5 sec", r"Restores\s+([\d.]+)\s+mana per 5 sec"),
    ]
    for stat_name, pattern in stat_patterns:
        match = re.search(pattern, section_text, re.I)
        if match:
            stats.append({"name": stat_name, "value": float(match.group(1))})
    for pattern, stat_name in [
        (r"Increases damage and healing done by magical spells and effects by up to\s+([\d.]+)", "Spell Healing"),
        (r"Increases healing done by spells and effects by up to\s+([\d.]+)", "Spell Healing"),
        (r"Increases damage done by spells and effects by up to\s+([\d.]+)", "Spell Damage"),
        (r"Improves your chance to get a critical strike by\s+([\d.]+)%", "Spell Critical Strike"),
    ]:
        match = re.search(pattern, section_text, re.I)
        if match:
            stats.append({"name": stat_name, "value": float(match.group(1))})
    return {
        "id": int(item_id), "name": name, "required_level": int(required_match.group(1)) if required_match else 0,
        "inventory_type": inventory, "item_class": item_class, "item_subclass": subclass,
        "item_level": int(level_match.group(1)) if level_match else None,
        "stats": stats, "stats_display": [x for x in section if re.match(r"^\+|^Equip:", x)],
        "armor": int(armor_match.group(1)) if armor_match else 0,
        "weapon_dps": float(dps_match.group(1)) if dps_match else 0,
        "drop_chance": float(drop_match.group(1)) if drop_match else None,
        "drop_source_name": source_match.group(1).strip() if source_match else None,
        "data_url": data_url or f"https://www.wowhead.com/forever/item={int(item_id)}",
        "data_source": data_source,
    }

def _parse_wowhead_item_page(page, item_id):
    soup = BeautifulSoup(page, "html.parser")
    heading = soup.find("h1")
    name = heading.get_text(" ", strip=True) if heading else None
    return _parse_tooltip_fragment(page, item_id, name=name,
        data_url=f"https://www.wowhead.com/forever/item={int(item_id)}",
        data_source="Wowhead Forever")

async def _warcraftdb_item_data(client, item_id):
    try:
        url = f"https://forever.warcraftdb.com/api/v1/tooltip/item/{int(item_id)}"
        response = await client.get(url,
            headers={"User-Agent": "WoWForeverDungeonAdvisor/0.5 (+https://github.com/mamattingly/FindMyUpgrade)",
                     "Accept": "application/json"}, timeout=10)
        if response.status_code != 200:
            return {"http_status": response.status_code, "item_id": int(item_id), "parsed": False}
        data = response.json()
        parsed = _parse_tooltip_fragment(
            data.get("html") or "", item_id, name=data.get("name"),
            data_url=f"https://forever.warcraftdb.com/data/item/{int(item_id)}",
            data_source="WarcraftDB Forever")
        parsed["quality"] = data.get("quality")
        return {"http_status": 200, "parsed": bool(parsed.get("name") and parsed.get("stats")), **parsed}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"http_status": None, "item_id": int(item_id), "parsed": False, "error": "request_or_json_error"}

async def _wowhead_item_data(client, item_id):
    try:
        response = await client.get(
            f"https://nether.wowhead.com/tooltip/item/{int(item_id)}",
            params={"dataEnv": 16, "locale": 0, "json": 1},
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                     "Accept": "application/json,text/plain,*/*", "Referer": "https://www.wowhead.com/forever/"},
            timeout=12)
        if response.status_code != 200:
            return {"http_status": response.status_code, "item_id": int(item_id), "parsed": False,
                    "body_prefix": response.text[:160]}
        try:
            data = response.json()
        except ValueError:
            return {"http_status": 200, "item_id": int(item_id), "parsed": False,
                    "content_type": response.headers.get("content-type"),
                    "body_prefix": response.text[:300]}
        if isinstance(data, str):
            tooltip_html, name = data, None
        elif isinstance(data, dict):
            tooltip_html = data.get("tooltip") or data.get("html") or data.get("tooltipHtml") or data.get("tooltip_html") or ""
            name = data.get("name")
            display_id = data.get("displayid") or data.get("displayId") or data.get("display_id")
        else:
            tooltip_html, name = "", None
        parsed = _parse_tooltip_fragment(
            tooltip_html, item_id, name=name,
            data_url=f"https://www.wowhead.com/forever/item={int(item_id)}",
            data_source="Wowhead Forever")
        return {"http_status": 200, "parsed": bool(parsed.get("name") and parsed.get("stats")),
                "response_keys": sorted(data.keys()) if isinstance(data, dict) else [],
                "display_id": display_id if isinstance(data, dict) else None,
                **parsed}
    except httpx.HTTPError:
        return {"http_status": None, "item_id": int(item_id), "parsed": False, "error": "request_error"}

async def _wowhead_item_icon(client, item_id):
    """Return the Wowhead-hosted item icon, cached for this process."""
    item_id = int(item_id)
    if item_id in ITEM_ICON_CACHE:
        return ITEM_ICON_CACHE[item_id]
    try:
        response = await client.get(
            f"https://nether.wowhead.com/tooltip/item/{item_id}",
            params={"dataEnv": 16, "locale": 0, "json": 1},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json",
                     "Referer": "https://www.wowhead.com/forever/"},
            timeout=8)
        data = response.json() if response.status_code == 200 else {}
        icon = data.get("icon") if isinstance(data, dict) else None
        icon_url = data.get("iconUrl") if isinstance(data, dict) else None
        if not icon_url and isinstance(icon, str) and re.fullmatch(r"[a-z0-9_]+", icon, re.I):
            icon_url = f"https://wow.zamimg.com/images/wow/icons/large/{icon}.jpg"
        if icon_url:
            ITEM_ICON_CACHE[item_id] = icon_url
        return icon_url
    except (httpx.HTTPError, ValueError, TypeError):
        return None


async def _thottbot_item_data(client, item_id):
    status, payload = await _thottbot_get(client, f"items/{int(item_id)}")
    if status != 200 or not isinstance(payload, dict):
        return None
    data = payload.get("data") or {}
    item = data.get("item") or {}
    if not isinstance(item, dict) or not item.get("name"):
        return None
    stats = []
    for stat in item.get("stats") or []:
        if not isinstance(stat, dict) or stat.get("value") is None:
            continue
        stat_name = stat.get("name") or stat.get("stat") or stat.get("type")
        if isinstance(stat_name, dict):
            stat_name = stat_name.get("name")
        if stat_name:
            stats.append({"name": str(stat_name), "value": stat.get("value")})
    dropped = []
    for source in data.get("droppedBy") or []:
        if not isinstance(source, dict):
            continue
        observed = source.get("observed")
        encounters = source.get("encounters")
        raw_chance = source.get("dropChance", source.get("drop_chance"))
        chance = None
        try:
            if observed is not None and encounters:
                chance = float(observed) / float(encounters) * 100.0
            elif raw_chance is not None:
                chance = float(raw_chance)
        except (TypeError, ValueError, ZeroDivisionError):
            chance = None
        dropped.append({
            "npc_id": source.get("id") or source.get("npcId") or source.get("npc_id"),
            "name": source.get("name") or source.get("npcName"),
            "drop_chance": round(chance, 3) if chance is not None else None,
            "observed": observed, "encounters": encounters,
        })
    damage_min, damage_max, speed_ms = item.get("damageMin"), item.get("damageMax"), item.get("speedMs")
    weapon_dps = None
    try:
        if damage_min is not None and damage_max is not None and speed_ms:
            weapon_dps = ((float(damage_min) + float(damage_max)) / 2.0) / (float(speed_ms) / 1000.0)
    except (TypeError, ValueError, ZeroDivisionError):
        weapon_dps = None
    return {
        "id": int(item_id), "name": item.get("name"),
        "required_level": item.get("requiredLevel") or 0,
        "inventory_type": item.get("inventoryType"),
        "item_class": item.get("itemClass"),
        "item_subclass": item.get("itemSpec"),
        "item_level": item.get("itemLevel"),
        "stats": stats, "stats_display": [],
        "armor": item.get("armor") or 0, "weapon_dps": weapon_dps or 0,
        "usable_by": item.get("usableBy") or [],
        "drop_sources": dropped,
        "data_url": f"https://thottbot-forever.com/items/{int(item_id)}",
        "data_source": "Thottbot Forever",
    }

async def _blizzard_item_metadata(client, token, region, item_id):
    namespaces = (
        (f"static-forever-{region}", "Blizzard Forever metadata"),
        (f"static-classic1x-{region}", "Blizzard Classic Era metadata"),
        (f"static-classic-{region}", "Blizzard Classic metadata"),
    ) if int(item_id) >= 100000 else (
        (f"static-classic1x-{region}", "Blizzard Classic Era metadata"),
        (f"static-classic-{region}", "Blizzard Classic metadata"),
        (f"static-forever-{region}", "Blizzard Forever metadata"),
    )
    for namespace, source in namespaces:
        try:
            response = await client.get(
                f"https://{region}.api.blizzard.com/data/wow/item/{int(item_id)}",
                params={"namespace": namespace, "locale": REGION_LOCALES[region]},
                headers={"Authorization": f"Bearer {token}"}, timeout=8)
            if response.status_code != 200:
                continue
            data = response.json()
            return {
                "item_class": _api_name(data.get("item_class")),
                "item_subclass": _api_name(data.get("item_subclass")),
                "inventory_type": _api_name(data.get("inventory_type")),
                "required_level": data.get("required_level"),
                "data_source": source,
            }
        except (httpx.HTTPError, ValueError, TypeError):
            continue
    return None

async def _static_item_data(client, token, region, item_id, semaphore):
    cache_key = (app.version, region, int(item_id))
    if cache_key in ITEM_CACHE:
        return ITEM_CACHE[cache_key]
    async with semaphore:
        try:
            # 1) Thottbot Forever structured records, including observed sources.
            thottbot = await _thottbot_item_data(client, item_id)
            if thottbot and (thottbot.get("stats") or thottbot.get("armor") or thottbot.get("weapon_dps")):
                ITEM_CACHE[cache_key] = thottbot
                return thottbot

            # 2) Wowhead's Forever tooltip API (dataEnv=16) has exact item
            # stats and recorded drop chances for this game version.
            wowhead = await _wowhead_item_data(client, item_id)
            if wowhead.get("parsed") and wowhead.get("name") and wowhead.get("stats"):
                metadata = await _blizzard_item_metadata(client, token, region, item_id)
                if metadata:
                    for key in ("item_class", "item_subclass"):
                        if metadata.get(key):
                            wowhead[key] = metadata[key]
                    if not wowhead.get("inventory_type") and metadata.get("inventory_type"):
                        wowhead["inventory_type"] = metadata["inventory_type"]
                    if metadata.get("data_source"):
                        wowhead["data_source"] = "Wowhead Forever + " + metadata["data_source"]
                ITEM_CACHE[cache_key] = wowhead
                return wowhead

            # 3) WarcraftDB's public Forever tooltip endpoint.
            warcraftdb = await _warcraftdb_item_data(client, item_id)
            if warcraftdb.get("parsed"):
                ITEM_CACHE[cache_key] = warcraftdb
                return warcraftdb

            # 4) Blizzard Forever static first, then Classic Era metadata as a
            # clearly-labelled fallback for legacy items absent from Forever.
            blizzard_result = None
            namespaces = (
                (f"static-forever-{region}", "Blizzard Forever"),
                (f"static-classic1x-{region}", "Blizzard Classic Era fallback"),
                (f"static-classic-{region}", "Blizzard Classic fallback"),
            )
            for namespace, source_label in namespaces:
                response = await client.get(
                    f"https://{region}.api.blizzard.com/data/wow/item/{int(item_id)}",
                    params={"namespace": namespace, "locale": REGION_LOCALES[region]},
                    headers={"Authorization": f"Bearer {token}"}, timeout=8)
                if response.status_code != 200:
                    continue
                data = response.json()
                preview = data.get("preview_item") or {}
                raw_stats = preview.get("stats") or data.get("stats") or []
                stats, stats_display = [], []
                for stat in raw_stats if isinstance(raw_stats, list) else []:
                    if not isinstance(stat, dict):
                        continue
                    stat_type = stat.get("type") or {}
                    stat_name = stat_type.get("name") if isinstance(stat_type, dict) else None
                    if stat_name and stat.get("value") is not None:
                        stats.append({"name": stat_name, "value": stat.get("value")})
                    display = (stat.get("display") or {}).get("display_string") if isinstance(stat.get("display"), dict) else None
                    if display:
                        stats_display.append(display)
                item_level = _numeric_value(preview.get("level") or data.get("level"))
                armor = preview.get("armor") or data.get("armor") or {}
                weapon = preview.get("weapon") or data.get("weapon") or {}
                dps = weapon.get("dps") or {}
                blizzard_result = {
                    "id": int(item_id), "name": data.get("name"),
                    "required_level": data.get("required_level"),
                    "inventory_type": _api_name(data.get("inventory_type")),
                    "item_class": _api_name(data.get("item_class")),
                    "item_subclass": _api_name(data.get("item_subclass")),
                    "item_level": item_level, "stats": stats, "stats_display": stats_display,
                    "armor": _numeric_value(armor), "weapon_dps": _numeric_value(dps),
                    "data_url": f"https://www.wowhead.com/forever/item={int(item_id)}",
                    "data_source": source_label,
                }
                if wowhead.get("parsed"):
                    blizzard_result["drop_chance"] = wowhead.get("drop_chance")
                    blizzard_result["drop_source_name"] = wowhead.get("drop_source_name")
                if blizzard_result.get("name") and (stats or blizzard_result.get("armor") or blizzard_result.get("weapon_dps")):
                    ITEM_CACHE[cache_key] = blizzard_result
                    return blizzard_result

            # 4) Public item APIs as last-resort fallbacks for custom items.
            twdb = await client.get(f"https://thewowdb.com/api/v1/forever/item/{int(item_id)}",
                headers={"User-Agent": "WoWForeverDungeonAdvisor/0.5 (+https://github.com/mamattingly/FindMyUpgrade)",
                         "Accept": "application/json"}, timeout=8)
            if twdb.status_code == 200:
                candidate = _normalise_thewowdb_item(twdb.json(), item_id)
                if candidate.get("name") and (candidate.get("stats") or candidate.get("armor") or candidate.get("weapon_dps")):
                    if wowhead.get("parsed"):
                        candidate["drop_chance"] = wowhead.get("drop_chance")
                        candidate["drop_source_name"] = wowhead.get("drop_source_name")
                    ITEM_CACHE[cache_key] = candidate
                    return candidate
            ITEM_CACHE[cache_key] = None
            return None
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            ITEM_CACHE[cache_key] = None
            return None

async def _build_dungeon_recommendations(client, token, region, character, gear):
    level = int(character.get("level") or 0)
    faction = (character.get("faction") or "").casefold()
    current_dungeons = [
        dungeon for dungeon in DUNGEONS
        if dungeon.get("bosses")
        and int(dungeon.get("min_level") or 0) <= level <= int(dungeon.get("max_level") or 0)
        and (not dungeon.get("faction") or dungeon.get("faction", "").casefold() == faction)
    ]
    source_ids = []
    seen = set()
    for dungeon in current_dungeons:
        for boss in dungeon.get("bosses", []):
            for item_id in boss.get("items", []):
                item_id = int(item_id)
                if item_id not in seen:
                    seen.add(item_id)
                    source_ids.append(item_id)
    # Avoid turning a single character lookup into hundreds of upstream calls.
    requested_ids = source_ids[:160]
    # These are independent remote item lookups; bounded concurrency of 8
    # reduces cold-scan latency without opening an unbounded request fan-out.
    semaphore = asyncio.Semaphore(8)
    fetched = await asyncio.gather(*[
        _static_item_data(client, token, region, item_id, semaphore)
        for item_id in requested_ids
    ], return_exceptions=True)
    item_data = {}
    for item_id, result in zip(requested_ids, fetched):
        if isinstance(result, dict):
            item_data[item_id] = result
    recommendation = recommend_dungeons(character, gear, item_data)
    recommendation["items_requested"] = len(requested_ids)
    recommendation["item_data_coverage"] = (
        round(len(item_data) / len(requested_ids), 2) if requested_ids else 0
    )
    recommendation["catalog_truncated"] = len(source_ids) > len(requested_ids)
    return recommendation

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
        model_data, media_assets = None, {}
        dungeon_recommendations = {"status": "credentials_not_configured", "rankings": [], "recommended": None, "message": "Configure Blizzard API credentials to compare dungeon loot against equipped gear."}
        token = await _blizzard_token(client)
        if token:
            equipment_data, spec_data, profession_data, appearance_data, media_data = await asyncio.gather(
                _profile_api(client, token, req.region, profile_slug, "equipment"),
                _profile_api(client, token, req.region, profile_slug, "specializations"),
                _profile_api(client, token, req.region, profile_slug, "professions"),
                _profile_api(client, token, req.region, profile_slug, "appearance"),
                _profile_api(client, token, req.region, profile_slug, "character-media"))
            gear, spec, professions = _gear_from_api(equipment_data), _spec_from_api(spec_data), _professions_from_api(profession_data)
            model_data = await _build_character_model(client, token, req.region, appearance_data, race)
            media_assets = {
                asset.get("key"): asset.get("value")
                for asset in (media_data or {}).get("assets", [])
                if isinstance(asset, dict) and asset.get("key") and asset.get("value")
            }
            api_status = "connected" if any([equipment_data, spec_data, profession_data]) else "api_data_unavailable"
            if equipment_data and char_class and character.get("level"):
                dungeon_recommendations = await _build_dungeon_recommendations(client, token, req.region, {
                    "level": character.get("level"), "class": char_class, "spec": spec,
                    "faction": faction.title() if isinstance(faction, str) else "Unknown",
                }, gear)
        soup = BeautifulSoup(profile_response.text, "html.parser")
        return {"source_url": str(profile_response.url),
            "page_title": soup.title.get_text(" ", strip=True) if soup.title else "WoW Forever Armory",
            "character": {"name": actual_name, "region": req.region.upper(), "level": character.get("level"),
                "class": char_class or "Unknown", "race": race or "Unknown",
                "faction": faction.title() if isinstance(faction, str) else "Unknown",
                "ruleset": ruleset.get("name") if isinstance(ruleset, dict) else None, "spec": spec},
            "equipped_gear": gear, "professions": professions, "api_status": api_status,
            "model_data": model_data if token else None,
            "armory_render_url": media_assets.get("main-raw") or media_assets.get("main-sd-raw"),
            "dungeon_recommendations": dungeon_recommendations,
            "scan_status": "profile_found" if char_class and character.get("level") else "profile_found_partial",
            "message": "Character verified. Gear, specialization and profession skills were retrieved from Blizzard's profile API." if api_status == "connected" else "Character verified, but automatic gear and dungeon analysis could not complete. Check the API connection status."}



@app.get("/api/modelviewer/classic/{asset_path:path}")
async def classic_modelviewer_asset(asset_path: str):
    """Same-origin, cacheable proxy for the Classic model-viewer data files."""
    clean = asset_path.strip("/")
    if not clean or any(part in {".", ".."} for part in clean.split("/")):
        raise HTTPException(400, "Invalid model asset path.")
    cached = MODEL_ASSET_CACHE.get(clean)
    if cached:
        body, media_type = cached
        return Response(content=body, media_type=media_type,
                        headers={"Cache-Control": "public, max-age=86400"})
    url = f"https://wow.zamimg.com/modelviewer/classic/{clean}"
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
            upstream = await client.get(url)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "The WoW model asset server could not be reached.") from exc
    if upstream.status_code == 404:
        raise HTTPException(404, "Classic model asset not found.")
    if upstream.status_code != 200:
        raise HTTPException(502, f"Classic model asset server returned HTTP {upstream.status_code}.")
    media_type = upstream.headers.get("content-type", "application/octet-stream").split(";")[0]
    body = upstream.content
    if len(body) <= 12 * 1024 * 1024:
        if len(MODEL_ASSET_CACHE) >= 160:
            MODEL_ASSET_CACHE.pop(next(iter(MODEL_ASSET_CACHE)))
        MODEL_ASSET_CACHE[clean] = (body, media_type)
    return Response(content=body, media_type=media_type,
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/item-icons")
async def item_icons(ids: str):
    """Load item artwork separately so image latency never blocks character analysis."""
    try:
        item_ids = list(dict.fromkeys(int(x.strip()) for x in ids.split(",") if x.strip()))
    except ValueError:
        raise HTTPException(400, "Item IDs must be comma-separated integers.")
    if not item_ids or len(item_ids) > 50:
        raise HTTPException(400, "Supply between 1 and 50 item IDs.")
    semaphore = asyncio.Semaphore(10)
    # A shared client reuses connections across the icon batch.
    async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
        async def fetch_icon(item_id):
            async with semaphore:
                return str(item_id), await _wowhead_item_icon(client, item_id)
        results = await asyncio.gather(*(fetch_icon(item_id) for item_id in item_ids))
    return {"icons": {item_id: url for item_id, url in results if url}}


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
        endpoints = ("equipment", "specializations", "professions", "appearance", "character-media")
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
            elif endpoint == "appearance" and isinstance(payload, dict):
                result["appearance_race_id"] = (payload.get("playable_race") or {}).get("id")
                result["appearance_gender"] = _api_name(payload.get("gender"))
                result["appearance_customization_count"] = len(payload.get("customizations") or [])
                result["appearance_item_count"] = len(payload.get("items") or [])
                result["appearance_item_sample"] = (payload.get("items") or [])[:3]
            elif endpoint == "character-media" and isinstance(payload, dict):
                result["character_media_assets"] = [x.get("key") for x in payload.get("assets", []) if isinstance(x, dict)]
            elif endpoint == "professions" and isinstance(payload, dict):
                result["profession_groups"] = [k for k in ("primaries", "secondaries") if isinstance(payload.get(k), list)]
        return result



async def _static_item_diagnostic(client, token, region, item_id):
    url = f"https://{region}.api.blizzard.com/data/wow/item/{int(item_id)}"
    try:
        response = await client.get(url,
            params={"namespace": f"static-forever-{region}", "locale": REGION_LOCALES[region]},
            headers={"Authorization": f"Bearer {token}"})
        static_status = response.status_code
        warcraftdb = await _warcraftdb_item_data(client, item_id)
        if warcraftdb.get("parsed"):
            return {
                "item_id": int(item_id), "source": "WarcraftDB Forever",
                "blizzard_http_status": static_status, "http_status": 200,
                "name": warcraftdb.get("name"), "required_level": warcraftdb.get("required_level"),
                "inventory_type": warcraftdb.get("inventory_type"),
                "item_class": warcraftdb.get("item_class"), "item_subclass": warcraftdb.get("item_subclass"),
                "item_level": warcraftdb.get("item_level"), "stats": warcraftdb.get("stats"),
                "drop_source_name": warcraftdb.get("drop_source_name"),
                "drop_chance": warcraftdb.get("drop_chance"), "data_url": warcraftdb.get("data_url"),
            }
        twdb = await client.get(f"https://thewowdb.com/api/v1/forever/item/{int(item_id)}",
            headers={"User-Agent": "WoWForeverDungeonAdvisor/0.5 (+https://github.com/mamattingly/FindMyUpgrade)",
                     "Accept": "application/json"}, timeout=8)
        twdb_status = twdb.status_code
        wowhead = await _wowhead_item_data(client, item_id)
        if wowhead.get("parsed"):
            return {
                "item_id": int(item_id), "source": "Wowhead Forever",
                "blizzard_http_status": static_status, "thewowdb_http_status": twdb_status,
                "http_status": 200, "name": wowhead.get("name"),
                "required_level": wowhead.get("required_level"),
                "inventory_type": wowhead.get("inventory_type"),
                "item_class": wowhead.get("item_class"),
                "item_subclass": wowhead.get("item_subclass"),
                "item_level": wowhead.get("item_level"),
                "stats": wowhead.get("stats"),
                "drop_source_name": wowhead.get("drop_source_name"),
                "drop_chance": wowhead.get("drop_chance"),
                "data_url": wowhead.get("data_url"),
            }
        if twdb_status == 200:
            raw = twdb.json()
            normal = _normalise_thewowdb_item(raw, item_id)
            return {
                "item_id": int(item_id), "source": "TheWoWDB",
                "blizzard_http_status": static_status, "thewowdb_http_status": twdb_status,
                "wowhead_http_status": wowhead.get("http_status"), "http_status": 200,
                "name": normal.get("name"), "top_keys": sorted(raw.keys()),
                "required_level": normal.get("required_level"),
                "inventory_type": normal.get("inventory_type"),
                "item_class": normal.get("item_class"),
                "item_subclass": normal.get("item_subclass"),
                "item_level": normal.get("item_level"), "stats": normal.get("stats"),
                "data_url": normal.get("data_url"),
            }
        if static_status == 200:
            data = response.json()
            preview = data.get("preview_item") or {}
            stats = preview.get("stats") or data.get("stats") or []
            return {
                "item_id": int(item_id), "source": "Blizzard",
                "blizzard_http_status": static_status, "thewowdb_http_status": twdb_status,
                "wowhead_http_status": wowhead.get("http_status"), "http_status": 200,
                "name": data.get("name"), "top_keys": sorted(data.keys()),
                "required_level": data.get("required_level"),
                "inventory_type": _api_name(data.get("inventory_type")),
                "item_class": _api_name(data.get("item_class")),
                "item_subclass": _api_name(data.get("item_subclass")),
                "item_level": _numeric_value(preview.get("level") or data.get("level")),
                "stats": [
                    {"name": (s.get("type") or {}).get("name") if isinstance(s.get("type"), dict) else s.get("name"),
                     "value": s.get("value")} for s in stats if isinstance(s, dict)
                ],
            }
        return {"item_id": int(item_id), "source": None,
                "blizzard_http_status": static_status, "thewowdb_http_status": twdb_status,
                "wowhead_http_status": wowhead.get("http_status"), "http_status": None}
    except (httpx.HTTPError, ValueError, TypeError):
        return {"item_id": int(item_id), "http_status": None, "error": "request_or_json_error"}

@app.get("/api/item-diagnostics")
async def item_diagnostics(region: Literal["us", "eu", "kr", "tw"] = "us", ids: str = "7684,7713,6696,274291,274292,274293"):
    try:
        item_ids = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "Item IDs must be comma-separated integers.")
    if not item_ids or len(item_ids) > 12:
        raise HTTPException(400, "Supply between 1 and 12 item IDs.")
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        token, auth = await _blizzard_token_diagnostic(client)
        if not token:
            return {"app_version": app.version, **auth, "items": []}
        items = await asyncio.gather(*[_static_item_diagnostic(client, token, region, x) for x in item_ids])
        return {"app_version": app.version, "region": region.upper(), "items": items}


async def _thottbot_get(client, path):
    try:
        response = await client.get(f"https://thottbot-forever.com/api/v1/{path.lstrip('/')}",
            headers={"Accept": "application/json", "User-Agent": "WoWForeverDungeonAdvisor/0.5 (+https://github.com/mamattingly/FindMyUpgrade)"},
            timeout=12)
        if response.status_code != 200:
            return response.status_code, None
        return response.status_code, response.json()
    except (httpx.HTTPError, ValueError):
        return None, None

@app.get("/api/thottbot-diagnostics")
async def thottbot_diagnostics(ids: str = "7713,7711,281290,19019,274291,274292,274155"):
    try:
        item_ids = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "Item IDs must be comma-separated integers.")
    if not item_ids or len(item_ids) > 12:
        raise HTTPException(400, "Supply between 1 and 12 item IDs.")
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        dungeon_status, dungeon_payload = await _thottbot_get(client, "dungeons")
        raw_dungeons = (dungeon_payload or {}).get("data") or []
        dungeon_samples = []
        zone_samples = []
        targets = {"gnomeregan", "razorfen kraul", "scarlet monastery", "blackfathom deeps"}
        for dungeon in raw_dungeons if isinstance(raw_dungeons, list) else []:
            if not isinstance(dungeon, dict):
                continue
            zone = dungeon.get("zone") or {}
            instance = dungeon.get("instance") or {}
            dungeon_samples.append({
                "instance": instance, "zone": zone,
                "boss_count": dungeon.get("bossCount"), "loot_count": dungeon.get("lootCount"),
            })
            if str(zone.get("name") or "").casefold() in targets and zone.get("id"):
                status, zone_payload = await _thottbot_get(client, f"zones/{zone['id']}")
                zone_data = (zone_payload or {}).get("data") or {}
                zone_samples.append({
                    "zone_id": zone.get("id"), "zone_name": zone.get("name"),
                    "http_status": status,
                    "response_keys": sorted((zone_payload or {}).keys()),
                    "data_keys": sorted(zone_data.keys()) if isinstance(zone_data, dict) else [],
                    "bosses": (zone_data.get("bosses") or [])[:5] if isinstance(zone_data, dict) else [],
                    "npcs_count": len(zone_data.get("npcs") or []) if isinstance(zone_data, dict) else None,
                    "npc_sample": (zone_data.get("npcs") or [])[:5] if isinstance(zone_data, dict) else [],
                    "loot_count": len(zone_data.get("loot") or zone_data.get("lootTable") or []) if isinstance(zone_data, dict) else None,
                    "loot_sample": (zone_data.get("loot") or zone_data.get("lootTable") or [])[:8] if isinstance(zone_data, dict) else [],
                })
        item_samples = []
        for item_id in item_ids:
            status, payload = await _thottbot_get(client, f"items/{item_id}")
            data = (payload or {}).get("data") or {}
            item = data.get("item") or {}
            item_samples.append({
                "id": item_id, "http_status": status,
                "response_keys": sorted(data.keys()) if isinstance(data, dict) else [],
                "item_keys": sorted(item.keys()) if isinstance(item, dict) else [],
                "name": item.get("name") if isinstance(item, dict) else None,
                "item_sample": {k: item.get(k) for k in ("itemLevel", "requiredLevel", "inventoryType", "itemClass", "itemSubclass", "itemSpec", "usableBy", "source", "quality", "armor", "stats", "damageMin", "damageMax", "speedMs") if isinstance(item, dict) and k in item},
                "dropped_by": (data.get("droppedBy") or [])[:5] if isinstance(data, dict) else [],
            })
        return {
            "app_version": app.version,
            "dungeons_http_status": dungeon_status,
            "dungeon_count": len(raw_dungeons) if isinstance(raw_dungeons, list) else None,
            "dungeon_samples": dungeon_samples,
            "zone_samples": zone_samples,
            "item_samples": item_samples,
        }



@app.get("/api/warcraftdb-diagnostics")
async def warcraftdb_diagnostics(ids: str = "7711,7713,7714,281290,274291"):
    try:
        item_ids = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "Item IDs must be comma-separated integers.")
    if not item_ids or len(item_ids) > 12:
        raise HTTPException(400, "Supply between 1 and 12 item IDs.")
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        items = []
        for item_id in item_ids:
            result = await _warcraftdb_item_data(client, item_id)
            items.append({
                "item_id": item_id, "http_status": result.get("http_status"),
                "parsed": result.get("parsed"), "name": result.get("name"),
                "inventory_type": result.get("inventory_type"),
                "item_class": result.get("item_class"), "item_subclass": result.get("item_subclass"),
                "item_level": result.get("item_level"), "required_level": result.get("required_level"),
                "stats": result.get("stats"), "drop_source_name": result.get("drop_source_name"),
                "drop_chance": result.get("drop_chance"), "data_url": result.get("data_url"),
            })
        return {"app_version": app.version, "items": items}


@app.get("/api/static-namespace-diagnostics")
async def static_namespace_diagnostics(ids: str = "7711,7713,7714,281290"):
    try:
        item_ids = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "Item IDs must be comma-separated integers.")
    if not item_ids or len(item_ids) > 8:
        raise HTTPException(400, "Supply between 1 and 8 item IDs.")
    namespaces = ("static-forever-us", "static-classic1x-us", "static-classic-us", "static-us")
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        token = await _blizzard_token(client)
        if not token:
            return {"app_version": app.version, "token_available": False, "items": []}
        results = []
        for item_id in item_ids:
            variants = []
            for namespace in namespaces:
                try:
                    response = await client.get(
                        f"https://us.api.blizzard.com/data/wow/item/{item_id}",
                        params={"namespace": namespace, "locale": "en_US"},
                        headers={"Authorization": f"Bearer {token}"}, timeout=8)
                    if response.status_code == 200:
                        data = response.json()
                        preview = data.get("preview_item") or {}
                        variants.append({
                            "namespace": namespace, "http_status": 200,
                            "name": data.get("name"),
                            "top_keys": sorted(data.keys()),
                            "preview_keys": sorted(preview.keys()),
                            "item_level": _numeric_value(preview.get("level") or data.get("level")),
                            "stats": preview.get("stats") or data.get("stats") or [],
                        })
                    else:
                        variants.append({"namespace": namespace, "http_status": response.status_code})
                except (httpx.HTTPError, ValueError):
                    variants.append({"namespace": namespace, "http_status": None})
            results.append({"item_id": item_id, "variants": variants})
        return {"app_version": app.version, "token_available": True, "items": results}


@app.get("/api/wowhead-tooltip-diagnostics")
async def wowhead_tooltip_diagnostics(ids: str = "7711,7713,7714"):
    try:
        item_ids = [int(x.strip()) for x in ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "Item IDs must be comma-separated integers.")
    if not item_ids or len(item_ids) > 12:
        raise HTTPException(400, "Supply between 1 and 12 item IDs.")
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        items = [await _wowhead_item_data(client, item_id) for item_id in item_ids]
    return {"app_version": app.version, "data_env": 16, "items": items}

@app.post("/api/analyze")
async def analyze(payload: dict):
    character = payload.get("character") or {}
    gear = payload.get("equipped_gear") or payload.get("gear") or []
    region = str(character.get("region") or payload.get("region") or "us").casefold()
    if region not in REGION_LOCALES:
        raise HTTPException(400, "Unsupported region.")
    if not character.get("level") or not character.get("class") or not isinstance(gear, list):
        raise HTTPException(400, "Character level, class and equipped gear are required.")
    async with httpx.AsyncClient(timeout=25, follow_redirects=True) as client:
        token = await _blizzard_token(client)
        if not token:
            return {"status": "credentials_not_configured", "rankings": [], "recommended": None,
                    "message": "Configure Blizzard API credentials before running dungeon analysis."}
        return await _build_dungeon_recommendations(client, token, region, character, gear)

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

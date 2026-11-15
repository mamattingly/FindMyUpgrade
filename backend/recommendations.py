"""Dungeon upgrade scoring for WoW: Forever.

Dungeon/boss/item source mappings are derived from AllTheThings' Forever
database under its MIT license. Item stats are supplied by Blizzard's
static-forever Game Data API at request time.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).with_name("dungeon_loot.json")
try:
    _CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError):
    _CATALOG = {"dungeons": []}

DUNGEONS = _CATALOG.get("dungeons", [])
CATALOG_SOURCE = _CATALOG.get("source", "Unknown dungeon source")
CATALOG_LICENSE = _CATALOG.get("license", "Unknown")

# These are transparent leveling-oriented estimates, not a combat simulator.
# Users can refine them later; they are deliberately not presented as exact
# theorycraft or as a probability of a drop.
STAT_WEIGHTS = {
    "Priest": {"intellect": 1.00, "spell_healing": 1.15, "spell_damage": 0.90,
               "spirit": 0.72, "mp5": 1.20, "stamina": 0.34,
               "spell_crit": 0.48, "crit": 0.30, "armor": 0.004},
    "Mage": {"intellect": 1.00, "spell_damage": 1.20, "spirit": 0.48,
             "stamina": 0.30, "spell_crit": 0.72, "mp5": 0.25, "armor": 0.003},
    "Warlock": {"intellect": 0.90, "spell_damage": 1.20, "stamina": 0.52,
                "spirit": 0.38, "spell_crit": 0.58, "armor": 0.003},
    "Druid": {"intellect": 0.95, "spell_healing": 1.10, "spell_damage": 0.82,
              "spirit": 0.72, "mp5": 1.05, "stamina": 0.38,
              "agility": 0.72, "strength": 0.42, "armor": 0.004},
    "Shaman": {"intellect": 0.92, "spell_healing": 0.95, "spell_damage": 0.88,
               "spirit": 0.60, "mp5": 1.02, "stamina": 0.40,
               "agility": 0.45, "strength": 0.42, "armor": 0.004},
    "Paladin": {"strength": 0.78, "intellect": 0.78, "stamina": 0.48,
                "spell_healing": 0.82, "spell_damage": 0.45, "spirit": 0.42,
                "mp5": 0.52, "agility": 0.30, "crit": 0.48, "armor": 0.006},
    "Hunter": {"agility": 1.00, "attack_power": 0.82, "stamina": 0.42,
               "intellect": 0.24, "crit": 0.62, "hit": 0.58,
               "strength": 0.18, "armor": 0.004},
    "Rogue": {"agility": 1.00, "attack_power": 0.82, "stamina": 0.38,
              "strength": 0.42, "crit": 0.62, "hit": 0.62, "armor": 0.004},
    "Warrior": {"strength": 1.00, "stamina": 0.48, "agility": 0.62,
                "attack_power": 0.72, "crit": 0.62, "hit": 0.68,
                "defense": 0.32, "armor": 0.006},
}
DEFAULT_WEIGHTS = {"intellect": 0.8, "strength": 0.7, "agility": 0.7,
                   "stamina": 0.4, "spirit": 0.4, "attack_power": 0.6,
                   "spell_damage": 0.6, "spell_healing": 0.6, "mp5": 0.4}

SLOT_MAP = {
    "head": "Head", "neck": "Neck", "shoulder": "Shoulders",
    "shoulders": "Shoulders", "cloak": "Back", "back": "Back",
    "chest": "Chest", "robe": "Chest", "shirt": "Shirt",
    "wrist": "Wrist", "hands": "Hands", "waist": "Waist",
    "legs": "Legs", "feet": "Feet", "finger": "Ring",
    "ring": "Ring", "trinket": "Trinket", "main hand": "Main Hand",
    "one-hand": "Main Hand", "one hand": "Main Hand",
    "two-hand": "Main Hand", "two hand": "Main Hand",
    "weapon": "Main Hand", "held in off-hand": "Off Hand",
    "off hand": "Off Hand", "off-hand": "Off Hand",
    "ranged": "Ranged", "wand": "Ranged",
}

WEAPON_ALLOW = {
    "Priest": ("dagger", "mace", "staff", "wand"),
    "Mage": ("dagger", "staff", "sword", "wand"),
    "Warlock": ("dagger", "staff", "sword", "wand"),
    "Druid": ("dagger", "mace", "staff", "polearm", "fist"),
    "Shaman": ("dagger", "mace", "staff", "axe", "fist"),
    "Paladin": ("axe", "mace", "sword", "polearm"),
    "Hunter": ("axe", "dagger", "fist", "polearm", "staff", "sword", "bow", "gun", "crossbow", "thrown"),
    "Rogue": ("axe", "dagger", "fist", "mace", "sword", "bow", "gun", "crossbow", "thrown"),
    "Warrior": ("axe", "dagger", "fist", "mace", "polearm", "staff", "sword", "bow", "gun", "crossbow", "thrown"),
}

def _stat_key(name: str) -> str | None:
    n = (name or "").casefold().replace("_", " ").replace("-", " ")
    if "intellect" in n: return "intellect"
    if "spirit" in n: return "spirit"
    if "stamina" in n: return "stamina"
    if "mana" in n and ("5" in n or "regen" in n): return "mp5"
    if "healing" in n: return "spell_healing"
    if "spell damage" in n or "spell power" in n: return "spell_damage"
    if "spell critical" in n or "spell crit" in n: return "spell_crit"
    if "attack power" in n: return "attack_power"
    if "agility" in n: return "agility"
    if "strength" in n: return "strength"
    if "hit" in n: return "hit"
    if "defense" in n: return "defense"
    if "critical" in n or n == "crit": return "crit"
    if "armor" in n: return "armor"
    if "dodge" in n: return "dodge"
    if "parry" in n: return "parry"
    if "block" in n: return "block"
    return None

def normalise_stats(raw_stats: Any) -> dict[str, float]:
    result: dict[str, float] = {}
    if isinstance(raw_stats, dict):
        iterable = [{"name": k, "value": v} for k, v in raw_stats.items()]
    elif isinstance(raw_stats, list):
        iterable = raw_stats
    else:
        iterable = []
    for stat in iterable:
        if not isinstance(stat, dict):
            continue
        typ = stat.get("type") or {}
        name = stat.get("name") or stat.get("stat") or (typ.get("name") if isinstance(typ, dict) else None)
        value = stat.get("value")
        key = _stat_key(str(name or ""))
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            continue
        if key and numeric:
            result[key] = result.get(key, 0.0) + numeric
    return result

def slot_key(value: str | None) -> str | None:
    return SLOT_MAP.get((value or "").strip().casefold())

def item_score(item: dict[str, Any], class_name: str) -> float:
    weights = STAT_WEIGHTS.get(class_name, DEFAULT_WEIGHTS)
    stats = normalise_stats(item.get("stats"))
    score = sum(value * weights.get(key, 0.0) for key, value in stats.items())
    try:
        score += float(item.get("armor") or 0) * weights.get("armor", 0.003)
    except (TypeError, ValueError):
        pass
    if score > 0:
        try:
            # A small item-level tie-breaker only when the item has useful stats.
            score += float(item.get("item_level") or 0) * 0.02
        except (TypeError, ValueError):
            pass
    try:
        score += float(item.get("weapon_dps") or 0) * (0.35 if class_name in ("Priest", "Mage", "Warlock") else 0.65)
    except (TypeError, ValueError):
        pass
    return round(score, 3)

def item_is_usable(item: dict[str, Any], class_name: str, level: int) -> bool:
    usable_by = item.get("usable_by")
    if isinstance(usable_by, list) and usable_by:
        allowed_classes = {str(x).casefold() for x in usable_by}
        if class_name.casefold() not in allowed_classes:
            return False
    try:
        required = int(item.get("required_level") or 0)
    except (TypeError, ValueError):
        required = 0
    if required > int(level):
        return False
    inv = (item.get("inventory_type") or "").casefold()
    slot = slot_key(inv)
    if not slot:
        return False
    item_class = (item.get("item_class") or "").casefold()
    subclass = (item.get("item_subclass") or "").casefold()

    if slot in ("Neck", "Back", "Ring", "Trinket", "Off Hand"):
        return item_class in ("armor", "weapon", "") or "misc" in subclass
    if item_class == "armor":
        if slot in ("Shirt",):
            return True
        if class_name in ("Priest", "Mage", "Warlock"):
            return "cloth" in subclass
        if class_name in ("Druid", "Rogue"):
            return "cloth" in subclass or "leather" in subclass
        if class_name in ("Hunter", "Shaman"):
            allowed = ("cloth", "leather", "mail") if level >= 40 else ("cloth", "leather")
            return any(x in subclass for x in allowed)
        if class_name in ("Paladin", "Warrior"):
            allowed = ("cloth", "leather", "mail", "plate") if level >= 40 else ("cloth", "leather", "mail")
            return any(x in subclass for x in allowed)
        return False
    if item_class == "weapon":
        allowed = WEAPON_ALLOW.get(class_name, ())
        return any(token in subclass for token in allowed)
    return False

def _current_scores(gear: list[dict[str, Any]], class_name: str) -> dict[str, list[tuple[float, dict[str, Any]]]]:
    slots: dict[str, list[tuple[float, dict[str, Any]]]] = {}
    for item in gear:
        key = slot_key(item.get("slot"))
        if not key:
            continue
        slots.setdefault(key, []).append((item_score(item, class_name), item))
    return slots

def _clean_source_name(value: str | None) -> str:
    value = (value or "").split("<", 1)[0].casefold()
    return "".join(ch for ch in value if ch.isalnum())

def _expected_best_gain(candidates: list[dict[str, Any]]) -> tuple[float, list[dict[str, Any]]]:
    # The highest-gain item is the one we would equip if several drops for the
    # same slot occur. Assuming per-item Wowhead drop chances are independent,
    # compute the expected value of the best item seen in that slot.
    by_item: dict[int, dict[str, Any]] = {}
    for candidate in candidates:
        item_id = int(candidate["item_id"])
        chance = max(0.0, min(100.0, float(candidate.get("drop_chance") or 0.0))) / 100.0
        if chance <= 0:
            continue
        existing = by_item.get(item_id)
        if existing:
            existing["probability_none"] *= (1.0 - chance)
        else:
            by_item[item_id] = {**candidate, "probability_none": 1.0 - chance}
    unique = list(by_item.values())
    for item in unique:
        item["combined_chance"] = 1.0 - item.pop("probability_none")
    ordered = sorted(unique, key=lambda x: x["gain"], reverse=True)
    probability_no_better_drop = 1.0
    expected = 0.0
    for item in ordered:
        probability = item["combined_chance"]
        item["expected_contribution"] = round(item["gain"] * probability * probability_no_better_drop, 3)
        expected += item["expected_contribution"]
        probability_no_better_drop *= (1.0 - probability)
    ordered.sort(key=lambda x: x["expected_contribution"], reverse=True)
    return round(expected, 3), ordered

def recommend_dungeons(character: dict[str, Any], gear: list[dict[str, Any]],
                       item_data: dict[int, dict[str, Any]]) -> dict[str, Any]:
    level = int(character.get("level") or 0)
    class_name = character.get("class") or "Unknown"
    faction = (character.get("faction") or "").casefold()
    current = _current_scores(gear, class_name)
    ranked = []
    catalog_dungeons = [d for d in DUNGEONS
        if d.get("bosses") and int(d.get("min_level") or 0) <= level <= int(d.get("max_level") or 0)
        and (not d.get("faction") or d.get("faction", "").casefold() == faction)]
    for dungeon in catalog_dungeons:
        slot_candidates: dict[str, list[dict[str, Any]]] = {}
        possible_upgrades = []
        for boss in dungeon.get("bosses", []):
            boss_name = boss.get("boss") or ""
            for item_id in boss.get("items", []):
                item = item_data.get(int(item_id))
                if not item or not item_is_usable(item, class_name, level):
                    continue
                key = slot_key(item.get("inventory_type"))
                if not key:
                    continue
                score = item_score(item, class_name)
                equipped = current.get(key, [])
                inventory_type = (item.get("inventory_type") or "").casefold()
                if key in ("Ring", "Trinket"):
                    baseline = min((x[0] for x in equipped), default=0.0) if len(equipped) >= 2 else 0.0
                elif inventory_type in ("two-hand", "two hand"):
                    main_score = max((x[0] for x in current.get("Main Hand", [])), default=0.0)
                    offhand_score = max((x[0] for x in current.get("Off Hand", [])), default=0.0)
                    baseline = main_score + offhand_score
                else:
                    baseline = max((x[0] for x in equipped), default=0.0)
                gain = round(score - baseline, 3)
                if gain <= 0.05:
                    continue
                drop_source = item.get("drop_source_name")
                source_matches = (
                    not drop_source
                    or _clean_source_name(drop_source) in _clean_source_name(boss_name)
                    or _clean_source_name(boss_name) in _clean_source_name(drop_source)
                )
                drop_chance = item.get("drop_chance") if source_matches else None
                candidate = {
                    "slot": key, "item_id": int(item_id), "name": item.get("name"),
                    "item_level": item.get("item_level"), "required_level": item.get("required_level"),
                    "gain": gain, "boss": boss_name, "item_score": score,
                    "item_url": item.get("data_url") or f"https://www.wowhead.com/forever/item={int(item_id)}",
                    "item_data_source": item.get("data_source") or "Unknown",
                    "drop_chance": drop_chance,
                    "drop_rate_verified": drop_chance is not None,
                    "stats": item.get("stats_display") or [],
                }
                possible_upgrades.append(candidate)
                slot_candidates.setdefault(key, []).append(candidate)
        slot_results = []
        for slot, candidates in slot_candidates.items():
            # Use the strongest upgrade for each slot. When a verified chance
            # exists, show its expected contribution; otherwise keep it as a
            # clearly-labelled potential upgrade rather than inventing odds.
            best = max(candidates, key=lambda x: x["gain"])
            expected_gain = (
                round(best["gain"] * float(best["drop_chance"]) / 100.0, 3)
                if best.get("drop_chance") is not None else None
            )
            slot_results.append({
                **best, "expected_gain": expected_gain,
                "slot_candidate_count": len(candidates),
            })
        verified = [x for x in slot_results if x.get("drop_rate_verified")]
        coverage = round(len(verified) / len(slot_results), 2) if slot_results else 0
        full_drop_data = bool(slot_results) and len(verified) == len(slot_results)
        slot_results.sort(
            key=lambda x: (x["expected_gain"] if full_drop_data else x["gain"]),
            reverse=True)
        potential_score = round(sum(x["gain"] for x in slot_results), 3)
        expected_score = round(sum(x["expected_gain"] or 0 for x in slot_results), 3) if full_drop_data else None
        rank_score = expected_score if full_drop_data else potential_score
        if not slot_results:
            continue
        ranked.append({
            "name": dungeon["name"], "min_level": dungeon["min_level"],
            "max_level": dungeon["max_level"], "score": rank_score,
            "potential_score": potential_score, "expected_score": expected_score,
            "score_label": "Expected upgrade value per full run" if full_drop_data else "Potential upgrade score",
            "upgrade_slots": len(slot_results), "best_upgrade": slot_results[0],
            "upgrades": slot_results[:6], "possible_upgrade_count": len(possible_upgrades),
            "drop_rate_coverage": coverage,
            "source_url": dungeon.get("source_url"),
            "faction_requirement": dungeon.get("faction"),
            "access_requirement": dungeon.get("access_requirement"),
        })
    ranked.sort(key=lambda x: (x["score"], x["upgrade_slots"], x["best_upgrade"]["gain"]), reverse=True)
    if not catalog_dungeons:
        status = "no_dungeon_catalog"
        message = "No sourced dungeon loot catalog is available for this character's current level and faction."
    elif not item_data:
        status = "data_unavailable"
        message = "Forever item data could not be loaded, so no dungeon ranking was calculated."
    elif not ranked:
        status = "no_upgrades_found"
        message = "No usable dungeon drops in the current-level catalog scored above the equipped gear."
    elif any(x["drop_rate_coverage"] < 1 for x in ranked):
        status = "partial_data"
        message = "Ranked by stat-weighted upgrade potential. Verified drop chances are shown where available; missing chances are not estimated."
    else:
        status = "ready"
        message = "Ranked by expected stat-weighted upgrade value per full dungeon run, using verified drop chances. Run durations are not verified, so this is not an upgrades-per-hour estimate."
    return {
        "status": status, "message": message, "recommended": ranked[0] if ranked else None,
        "rankings": ranked[:8], "dungeons_checked": len(catalog_dungeons),
        "items_evaluated": len(item_data), "scoring": "estimated_class_stat_weights",
        "catalog_source": CATALOG_SOURCE, "catalog_license": CATALOG_LICENSE,
        "item_data_sources": sorted({x.get("data_source", "Unknown") for x in item_data.values()}),
        "drop_rates_available": bool(ranked) and all(x["drop_rate_coverage"] == 1 for x in ranked),
        "run_times_available": False,
    }

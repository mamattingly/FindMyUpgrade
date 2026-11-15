from backend import recommendations as rec
from backend.main import _parse_wowhead_item_page


def test_normalise_stats_from_blizzard_shape():
    stats = rec.normalise_stats([
        {"type": {"name": "Intellect"}, "value": 8},
        {"type": {"name": "Spirit"}, "value": 5},
        {"type": {"name": "Mana per 5 sec"}, "value": 2},
    ])
    assert stats == {"intellect": 8.0, "spirit": 5.0, "mp5": 2.0}


def test_priest_stat_score_prefers_caster_stats():
    caster = {"stats": [{"name": "Intellect", "value": 8},
                        {"name": "Spell Healing", "value": 10}]}
    melee = {"stats": [{"name": "Strength", "value": 20}]}
    assert rec.item_score(caster, "Priest") > rec.item_score(melee, "Priest")


def test_priest_can_equip_cloth_but_not_leather_chest():
    base = {"inventory_type": "Chest", "item_class": "Armor", "required_level": 30}
    assert rec.item_is_usable({**base, "item_subclass": "Cloth"}, "Priest", 34)
    assert not rec.item_is_usable({**base, "item_subclass": "Leather"}, "Priest", 34)


def test_priest_can_equip_wands_and_staves_but_not_swords():
    base = {"item_class": "Weapon", "required_level": 30}
    assert rec.item_is_usable({**base, "inventory_type": "Ranged", "item_subclass": "Wand"}, "Priest", 34)
    assert rec.item_is_usable({**base, "inventory_type": "Two-Hand", "item_subclass": "Staff"}, "Priest", 34)
    assert not rec.item_is_usable({**base, "inventory_type": "One-Hand", "item_subclass": "Sword"}, "Priest", 34)


def test_recommendation_selects_dungeon_with_real_slot_upgrades(monkeypatch):
    monkeypatch.setattr(rec, "DUNGEONS", [{
        "name": "Test Crypt", "min_level": 30, "max_level": 40, "faction": None,
        "source_url": "https://example.invalid/test-crypt",
        "bosses": [{"boss": "Test Boss", "items": [1001, 1002]}],
    }])
    character = {"level": 34, "class": "Priest", "spec": "Discipline", "faction": "Alliance"}
    equipped = [{"slot": "Chest", "item_level": 20,
                 "stats": [{"name": "Intellect", "value": 5}]}]
    item_data = {
        1001: {"name": "Better Robe", "inventory_type": "Chest", "item_class": "Armor",
               "item_subclass": "Cloth", "required_level": 30, "item_level": 35,
               "stats": [{"name": "Intellect", "value": 12}], "stats_display": ["+12 Intellect"],
               "drop_chance": 25, "drop_source_name": "Test Boss"},
        1002: {"name": "Leather Tunic", "inventory_type": "Chest", "item_class": "Armor",
               "item_subclass": "Leather", "required_level": 30, "item_level": 40,
               "stats": [{"name": "Intellect", "value": 50}]},
    }
    result = rec.recommend_dungeons(character, equipped, item_data)
    assert result["status"] == "ready"
    assert result["recommended"]["name"] == "Test Crypt"
    assert result["recommended"]["upgrade_slots"] == 1
    assert result["recommended"]["best_upgrade"]["name"] == "Better Robe"
    assert result["drop_rates_available"] is True


def test_wowhead_forever_item_parser_extracts_stats_and_drop_chance():
    page = """
    <html><head><title>Illusionary Rod - Item - WoW Forever</title></head>
    <body>
      <h1>Illusionary Rod</h1>
      <div>Item Level 39</div>
      <div>Binds when picked up</div>
      <div>Two-Hand Staff</div>
      <div>70 - 105 Damage Speed 3.40</div>
      <div>(25.74 damage per second)</div>
      <div>+10 Stamina</div><div>+6 Intellect</div><div>+7 Spirit</div>
      <div>Requires Level 34</div>
      <div>Equip: Improves your chance to get a critical strike by 1.0%.</div>
      <div>Equip: Increases damage and healing done by magical spells and effects by up to 44.</div>
      <div>Dropped by: Arcanist Doan Drop Chance: 30.62%</div>
    </body></html>
    """
    item = _parse_wowhead_item_page(page, 7713)
    assert item["name"] == "Illusionary Rod"
    assert item["inventory_type"] == "Two-Hand"
    assert item["item_subclass"] == "Staff"
    assert item["required_level"] == 34
    assert item["drop_source_name"] == "Arcanist Doan"
    assert item["drop_chance"] == 30.62
    assert {x["name"] for x in item["stats"]} >= {"Stamina", "Intellect", "Spirit", "Spell Healing"}


def test_two_hander_must_replace_both_mainhand_and_offhand(monkeypatch):
    monkeypatch.setattr(rec, "DUNGEONS", [{
        "name": "Test Crypt", "min_level": 30, "max_level": 40, "faction": None,
        "source_url": "https://example.invalid/test-crypt",
        "bosses": [{"boss": "Test Boss", "items": [2001]}],
    }])
    character = {"level": 34, "class": "Priest", "faction": "Alliance"}
    equipped = [
        {"slot": "Main Hand", "stats": [{"name": "Intellect", "value": 10}]},
        {"slot": "Off Hand", "stats": [{"name": "Intellect", "value": 10}]},
    ]
    item_data = {
        2001: {"name": "Staff", "inventory_type": "Two-Hand", "item_class": "Weapon",
               "item_subclass": "Staff", "required_level": 30, "item_level": 35,
               "stats": [{"name": "Intellect", "value": 15}],
               "drop_chance": 25, "drop_source_name": "Test Boss"},
    }
    result = rec.recommend_dungeons(character, equipped, item_data)
    assert result["status"] == "no_upgrades_found"
    assert result["recommended"] is None



def test_restoration_shaman_values_healing_and_hides_spell_damage():
    item = {"stats": [
        {"name": "Intellect", "value": 8},
        {"name": "Spell Healing", "value": 14},
        {"name": "Spell Damage", "value": 20},
        {"name": "Spirit", "value": 6},
    ]}
    assert rec.item_score(item, "Shaman", "Restoration") > rec.item_score(
        {"stats": [{"name": "Spell Damage", "value": 100}]}, "Shaman", "Restoration")
    assert rec.relevant_item_stats(item, "Shaman", "Restoration") == [
        "+8 Intellect", "+14 Spell Healing", "+6 Spirit"
    ]


def test_shadow_priest_displays_damage_not_healing():
    item = {"stats": [
        {"name": "Intellect", "value": 8},
        {"name": "Spell Healing", "value": 14},
        {"name": "Spell Damage", "value": 20},
    ]}
    assert rec.relevant_item_stats(item, "Priest", "Shadow") == [
        "+8 Intellect", "+20 Spell Damage"
    ]


def test_melee_class_hides_spell_stats_and_keeps_attack_stats():
    item = {"stats": [
        {"name": "Agility", "value": 10},
        {"name": "Attack Power", "value": 12},
        {"name": "Spell Damage", "value": 50},
        {"name": "Spell Healing", "value": 50},
        {"name": "Hit", "value": 4},
    ]}
    assert rec.relevant_item_stats(item, "Rogue", "Combat") == [
        "+10 Agility", "+12 Attack Power", "+4 Hit"
    ]


def test_tank_spec_includes_defensive_stats():
    weights = rec.stat_weights("Warrior", "Protection")
    assert weights["defense"] > 0
    assert weights["dodge"] > 0
    assert weights["spell_damage"] == 0

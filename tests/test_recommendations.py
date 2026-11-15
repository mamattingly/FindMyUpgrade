from backend import recommendations as rec
from backend.main import _parse_wowhead_item_page, _spec_from_api, _build_character_model, _parse_wowhead_model_display_id


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
    character = {"level": 34, "class": "Priest", "spec": "Discipline", "faction": "Alliance"}
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
    assert result["recommended"]["upgrade_slots"] == 0
    assert result["recommended"]["best_upgrade"] is None



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


def test_profession_only_dungeons_remain_available_for_run_logging(monkeypatch):
    monkeypatch.setattr(rec, "DUNGEONS", [
        {"name": f"Test Dungeon {i}", "min_level": 30, "max_level": 40,
         "faction": None, "source_url": "https://example.invalid/dungeon", "bosses": []}
        for i in range(10)
    ])
    character = {"level": 34, "class": "Priest", "spec": "Discipline", "faction": "Alliance"}
    result = rec.recommend_dungeons(character, [], {9999: {"name": "unused"}})
    assert result["status"] == "no_upgrades_found"
    assert len(result["rankings"]) == 10
    assert all(d["upgrade_slots"] == 0 and d["best_upgrade"] is None for d in result["rankings"])


def test_healer_specs_do_not_get_physical_dps_or_weapon_dps_bonus():
    physical = {"stats": [
        {"name": "Strength", "value": 100},
        {"name": "Agility", "value": 100},
        {"name": "Attack Power", "value": 100},
    ], "weapon_dps": 80}
    healing = {"stats": [
        {"name": "Intellect", "value": 15},
        {"name": "Spell Healing", "value": 25},
        {"name": "Spirit", "value": 12},
        {"name": "Mana per 5 sec", "value": 5},
    ], "weapon_dps": 0}
    for class_name, spec in [
        ("Priest", "Discipline"), ("Priest", "Holy"),
        ("Druid", "Restoration"), ("Shaman", "Restoration"),
        ("Paladin", "Holy"),
    ]:
        assert rec.item_score(healing, class_name, spec) > rec.item_score(physical, class_name, spec)
        shown = rec.relevant_item_stats(physical, class_name, spec)
        assert not any("Strength" in stat or "Agility" in stat or "Attack Power" in stat for stat in shown)


def test_tank_and_healer_weapon_dps_does_not_inflate_score():
    weapon = {"stats": [{"name": "Intellect", "value": 10}], "weapon_dps": 100}
    without_dps = {"stats": [{"name": "Intellect", "value": 10}], "weapon_dps": 0}
    for class_name, spec in [
        ("Priest", "Discipline"), ("Shaman", "Restoration"),
        ("Paladin", "Protection"), ("Warrior", "Protection"),
    ]:
        assert rec.item_score(weapon, class_name, spec) == rec.item_score(without_dps, class_name, spec)


def test_unknown_specialization_does_not_guess_dps_recommendations():
    result = rec.recommend_dungeons(
        {"level": 34, "class": "Priest", "spec": "Unknown", "faction": "Alliance"},
        [], {123: {"name": "Test item"}},
    )
    assert result["status"] == "specialization_unavailable"
    assert result["rankings"] == []
    assert result["recommended"] is None


def test_spec_parser_requires_active_spec_not_first_list_entry():
    payload = {"specialization_groups": [{
        "is_active": True,
        "specializations": [
            {"specialization": {"name": "Shadow"}},
            {"specialization": {"name": "Discipline"}, "is_active": True},
        ],
    }]}
    assert _spec_from_api(payload) == "Discipline"


def test_spec_parser_does_not_guess_when_active_group_has_multiple_unmarked_specs():
    payload = {"specialization_groups": [{
        "is_active": True,
        "specializations": [
            {"specialization": {"name": "Shadow"}},
            {"specialization": {"name": "Discipline"}},
        ],
    }]}
    assert _spec_from_api(payload) == "Unknown"


def test_classic_model_viewer_uses_blizzard_appearance_ids_and_display_order(monkeypatch):
    import asyncio
    from backend import main

    async def fake_static_json(client, token, region, path, required_field=None):
        if path == "data/wow/item/123":
            return {"appearances": [{"id": 900}]}
        if path == "data/wow/item/125":
            return {"appearances": [{"id": 901}]}
        if path == "data/wow/item-appearance/900":
            return {"item_display_info_id": 456}
        if path == "data/wow/item-appearance/901":
            return {"item_display_info_id": 789}
        return None

    monkeypatch.setattr(main, "_blizzard_static_json", fake_static_json)

    appearance = {
        "playable_race": {"id": 4, "name": "Night Elf"},
        "gender": {"type": "FEMALE", "name": "Female"},
        "items": [
            {"id": 123, "internal_slot_id": 0},
            {"id": 124, "internal_slot_id": 1},
            {"id": 125, "internal_slot_id": 2},
            {"id": 126, "internal_slot_id": 10},
        ],
        "customizations": [
            {"option": {"id": 1, "name": "Skin Color"},
             "choice": {"id": 20, "display_order": 3}},
            {"option": {"id": 2, "name": "Hair Style"},
             "choice": {"id": 30, "display_order": 7}},
        ],
    }
    result = asyncio.run(main._build_character_model(
        object(), "token", "us", appearance, "Night Elf"))

    assert result["race"] == 4
    assert result["gender"] == 0
    assert result["items"] == [[1, 456], [3, 789]]
    assert result["customizations"] == [
        {"option_name": "Skin Color", "display_order": 3},
        {"option_name": "Hair Style", "display_order": 7},
    ]
    assert result["equipped_visual_item_count"] == 2
    assert result["missing_display_ids"] == []


def test_wowhead_item_page_model_display_id_parser():
    page = '<script>WH.Gatherer.addData(3, 1, {"id":6512,"modelviewer":{"displayid":98765,"type":1,"typeid":6512}});</script>'
    assert _parse_wowhead_model_display_id(page) == 98765
    assert _parse_wowhead_model_display_id("modelviewer: { displayID: 12345, type: 1 }") == 12345
    assert _parse_wowhead_model_display_id("<html>no model metadata</html>") is None


def test_icy_veins_item_appearance_parser():
    from backend.main import _parse_icyveins_item_appearance
    page = """
      <main>
        <h1>Town Clerk's Mittens</h1>
        <dl><dt>Appearance:</dt><dd>66022</dd></dl>
      </main>
    """
    assert _parse_icyveins_item_appearance(page) == 66022
    assert _parse_icyveins_item_appearance("<html>No appearance data</html>") is None


def test_thewowdb_model_fields_extract_display_and_appearance_ids():
    from backend.main import _extract_thewowdb_model_fields
    payload = {
        "id": 270029,
        "appearance": {"id": 66022},
        "media": {"icon": 132961},
        "display_id": 123456,
    }
    assert _extract_thewowdb_model_fields(payload) == {
        "display_id": 123456,
        "appearance_id": 66022,
    }


def test_wago_db2_item_appearance_to_display_chain():
    from backend.main import _parse_wago_appearance_tables

    modified = """ID,ItemID,ItemAppearanceModifierID,ItemAppearanceID,OrderIndex,TransmogSourceTypeEnum
1,6512,0,65235,0,0
2,1929,0,63657,0,0
3,6394,0,65175,0,0
4,9794,0,66021,0,0
5,270029,0,66022,0,0
"""
    appearances = """ID,DisplayType,ItemDisplayInfoID,DefaultIconFileDataID,UiOrder
65235,0,12345,0,1
63657,0,23456,0,1
65175,0,34567,0,1
66021,0,45678,0,1
66022,0,56789,0,1
"""
    mapping, modified_count, appearance_count = _parse_wago_appearance_tables(
        modified, appearances)

    assert mapping == {
        6512: {"appearance_id": 65235, "display_id": 12345},
        1929: {"appearance_id": 63657, "display_id": 23456},
        6394: {"appearance_id": 65175, "display_id": 34567},
        9794: {"appearance_id": 66021, "display_id": 45678},
        270029: {"appearance_id": 66022, "display_id": 56789},
    }
    assert modified_count == 5
    assert appearance_count == 5

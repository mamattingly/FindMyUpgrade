from backend import recommendations as rec


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
               "stats": [{"name": "Intellect", "value": 12}], "stats_display": ["+12 Intellect"]},
        1002: {"name": "Leather Tunic", "inventory_type": "Chest", "item_class": "Armor",
               "item_subclass": "Leather", "required_level": 30, "item_level": 40,
               "stats": [{"name": "Intellect", "value": 50}]},
    }
    result = rec.recommend_dungeons(character, equipped, item_data)
    assert result["status"] == "ready"
    assert result["recommended"]["name"] == "Test Crypt"
    assert result["recommended"]["upgrade_slots"] == 1
    assert result["recommended"]["best_upgrade"]["name"] == "Better Robe"
    assert result["drop_rates_available"] is False

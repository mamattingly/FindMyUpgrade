import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWmvCharacterXml,
  canExportWmvCharacter,
} from "./wowModelViewerExport.js";

function sampleCharacter(overrides = {}) {
  return {
    race: 4,
    gender: 0,
    wmv_sex: 1,
    playable_class_id: 8,
    customizations: [
      { option_name: "Skin Color", display_order: 2, option_id: 3, choice_id: 117 },
      { option_name: "Face", display_order: 1, option_id: 4, choice_id: 225 },
    ],
    resolved_item_count: 4,
    missing_display_ids: [],
    resolved_appearances: [
      { item_id: 100, internal_slot_id: 0, slot: 1, display_id: 2100 },
      { item_id: 200, internal_slot_id: 4, slot: 5, display_id: 2200 },
      { item_id: 300, internal_slot_id: 15, slot: 16, display_id: 2300 },
      { item_id: 400, internal_slot_id: 16, slot: 17, display_id: 2400 },
    ],
    ...overrides,
  };
}

test("exports a version 2.0 native character with race, sex and exact customization IDs", () => {
  const xml = buildWmvCharacterXml(sampleCharacter());
  assert.match(
    xml,
    /<file name="Character\\NightElf\\Female\\NightElfFemale\.m2" race="4" sex="1"\/>/
  );
  assert.match(xml, /<customization id="3" value="117"\/>/);
  assert.match(xml, /<customization id="4" value="225"\/>/);
  assert.match(xml, /<eyeGlowType value="1"\/>/);
  assert.match(xml, /<SavedCharacter version="2\.0">/);
});

test("maps Blizzard equipment slots to WoW Model Viewer's CharSlots enum", () => {
  const xml = buildWmvCharacterXml(sampleCharacter({
    resolved_appearances: [
      { item_id: 10, internal_slot_id: 0, display_id: 100 },
      { item_id: 20, internal_slot_id: 2, display_id: 200 },
      { item_id: 30, internal_slot_id: 3, display_id: 300 },
      { item_id: 40, internal_slot_id: 4, display_id: 400 },
      { item_id: 50, internal_slot_id: 5, display_id: 500 },
      { item_id: 60, internal_slot_id: 6, display_id: 600 },
      { item_id: 70, internal_slot_id: 7, display_id: 700 },
      { item_id: 80, internal_slot_id: 8, display_id: 800 },
      { item_id: 90, internal_slot_id: 9, display_id: 900 },
      { item_id: 140, internal_slot_id: 14, display_id: 1400 },
      { item_id: 150, internal_slot_id: 15, display_id: 1500 },
      { item_id: 160, internal_slot_id: 16, display_id: 1600 },
      { item_id: 180, internal_slot_id: 18, display_id: 1800 },
    ],
  }));
  const slotByItem = Object.fromEntries(
    [...xml.matchAll(/<slot value="(\d+)"\/>\s*<id value="(\d+)"\/>/g)]
      .map((match) => [Number(match[2]), Number(match[1])])
  );
  assert.deepEqual(slotByItem, {
    10: 0, 20: 1, 30: 4, 40: 6, 50: 3, 60: 5, 70: 2,
    80: 7, 90: 8, 140: 11, 150: 9, 160: 10, 180: 12,
  });
});

test("uses the Death Knight eye glow only for the Death Knight class", () => {
  const xml = buildWmvCharacterXml(sampleCharacter({ playable_class_id: 6 }));
  assert.match(xml, /<eyeGlowType value="2"\/>/);
});

test("refuses export when any equipped appearance is unresolved", () => {
  const data = sampleCharacter({ missing_display_ids: [12345] });
  assert.equal(canExportWmvCharacter(data), false);
  assert.throws(() => buildWmvCharacterXml(data), /appearance\(s\) are unresolved/);
});

test("refuses export when exact customization option/choice IDs are unavailable", () => {
  const data = sampleCharacter({
    customizations: [{ option_name: "Face", display_order: 2 }],
  });
  assert.equal(canExportWmvCharacter(data), false);
  assert.throws(() => buildWmvCharacterXml(data), /original customization IDs/);
});

test("refuses races without a verified Classic model directory", () => {
  const data = sampleCharacter({ race: 99 });
  assert.equal(canExportWmvCharacter(data), false);
  assert.throws(() => buildWmvCharacterXml(data), /does not have a verified Classic character model path/);
});

test("does not silently overwrite duplicate visual slots", () => {
  const data = sampleCharacter({
    resolved_appearances: [
      { item_id: 10, internal_slot_id: 0, display_id: 100 },
      { item_id: 11, internal_slot_id: 0, display_id: 101 },
    ],
  });
  assert.throws(() => buildWmvCharacterXml(data), /duplicate visual slots/);
});

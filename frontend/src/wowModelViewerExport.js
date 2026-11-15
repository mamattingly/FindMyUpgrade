const MODEL_DIRECTORY_BY_RACE = {
  1: "Human",
  2: "Orc",
  3: "Dwarf",
  4: "NightElf",
  5: "Scourge",
  6: "Tauren",
  7: "Gnome",
  8: "Troll",
  10: "BloodElf",
  11: "Draenei",
};

// WoW Model Viewer's CharSlots enum, mapped from Blizzard internal_slot_id.
// This is intentionally not the same as Wowhead's 1-based viewer slot numbering.
const WMV_SLOT_BY_INTERNAL_SLOT = {
  0: 0,   // head -> CS_HEAD
  2: 1,   // shoulder -> CS_SHOULDER
  3: 4,   // shirt -> CS_SHIRT
  4: 6,   // chest -> CS_CHEST
  5: 3,   // waist -> CS_BELT
  6: 5,   // legs -> CS_PANTS
  7: 2,   // feet -> CS_BOOTS
  8: 7,   // wrist -> CS_BRACERS
  9: 8,   // hands -> CS_GLOVES
  14: 11, // back -> CS_CAPE
  15: 9,  // main hand -> CS_HAND_RIGHT
  16: 10, // off hand -> CS_HAND_LEFT
  18: 12, // tabard -> CS_TABARD
};

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wmvAppearances(modelData) {
  const appearances = Array.isArray(modelData?.resolved_appearances)
    ? modelData.resolved_appearances
    : [];
  return appearances.map((appearance) => {
    const internalSlot = Number.isInteger(Number(appearance.internal_slot_id))
      ? Number(appearance.internal_slot_id)
      : Number(appearance.slot) - 1;
    const viewerSlot = WMV_SLOT_BY_INTERNAL_SLOT[internalSlot];
    return {
      internalSlot,
      viewerSlot,
      itemId: positiveInteger(appearance.item_id),
      displayId: positiveInteger(appearance.display_id),
    };
  }).filter((item) => item.viewerSlot !== undefined && item.itemId && item.displayId);
}

export function canExportWmvCharacter(modelData) {
  if (!modelData || !positiveInteger(modelData.race)) return false;
  const sex = modelData.wmv_sex;
  if (![0, 1].includes(Number(sex))) return false;
  if (!MODEL_DIRECTORY_BY_RACE[Number(modelData.race)]) return false;
  const customizations = Array.isArray(modelData.customizations) ? modelData.customizations : [];
  if (customizations.some((entry) =>
    !positiveInteger(entry.option_id) || !positiveInteger(entry.choice_id)
  )) return false;
  if (Number(modelData.missing_display_ids?.length || 0) > 0) return false;
  return wmvAppearances(modelData).length > 0;
}

export function buildWmvCharacterXml(modelData, characterClass = "") {
  if (!modelData || !positiveInteger(modelData.race)) {
    throw new Error("The character race is missing. Refresh the Armory profile first.");
  }
  const raceId = Number(modelData.race);
  const raceDirectory = MODEL_DIRECTORY_BY_RACE[raceId];
  if (!raceDirectory) {
    throw new Error("This race does not have a verified Classic character model path yet.");
  }
  const sex = Number(modelData.wmv_sex);
  if (![0, 1].includes(sex)) {
    throw new Error("The character's gender metadata is missing. Refresh the Armory profile.");
  }

  const customizations = Array.isArray(modelData.customizations) ? modelData.customizations : [];
  if (customizations.some((entry) =>
    !positiveInteger(entry.option_id) || !positiveInteger(entry.choice_id)
  )) {
    throw new Error("Refresh this character once to retrieve the original customization IDs before exporting.");
  }

  const missingDisplayIds = modelData.missing_display_ids || [];
  if (missingDisplayIds.length) {
    throw new Error(`Cannot export an exact character yet: ${missingDisplayIds.length} equipped appearance(s) are unresolved.`);
  }

  const appearances = wmvAppearances(modelData).sort((a, b) => a.viewerSlot - b.viewerSlot);
  if (!appearances.length) {
    throw new Error("No equipped character-model appearances were resolved.");
  }
  const duplicateSlots = new Set();
  for (const appearance of appearances) {
    if (duplicateSlots.has(appearance.viewerSlot)) {
      throw new Error("The equipped appearance data contains duplicate visual slots.");
    }
    duplicateSlots.add(appearance.viewerSlot);
  }

  const genderDirectory = sex === 0 ? "Male" : "Female";
  const modelPath = ["Character", raceDirectory, genderDirectory, `${raceDirectory}${genderDirectory}.m2`].join("\\");
  const eyeGlowType = Number(modelData.playable_class_id) === 6 ? 2 : 1;
  const customizationXml = customizations.map((entry) =>
    `      <customization id="${positiveInteger(entry.option_id)}" value="${positiveInteger(entry.choice_id)}"/>`
  ).join("\n");
  const itemXml = appearances.map((item) => [
    "    <item>",
    `      <slot value="${item.viewerSlot}"/>`,
    `      <id value="${item.itemId}"/>`,
    `      <displayId value="${item.displayId}"/>`,
    "      <level value=\"0\"/>",
    "    </item>",
  ].join("\n")).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<SavedCharacter version="2.0">',
    "  <model>",
    `    <file name="${xmlEscape(modelPath)}" race="${raceId}" sex="${sex}"/>`,
    "    <CharDetails>",
    customizationXml,
    `      <eyeGlowType value="${eyeGlowType}"/>`,
    '      <showUnderwear value="1"/>',
    '      <showEars value="1"/>',
    '      <showHair value="1"/>',
    '      <showFacialHair value="1"/>',
    '      <showFeet value="1"/>',
    '      <isDemonHunter value="0"/>',
    "    </CharDetails>",
    "  </model>",
    "  <equipment>",
    itemXml,
    "  </equipment>",
    "</SavedCharacter>",
    "",
  ].filter((line) => line !== "").join("\n");
}

function safeFilename(value) {
  const safe = String(value || "WoWCharacter")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/[ _-]+/g, "_")
    .slice(0, 60);
  return safe || "WoWCharacter";
}

export function downloadWmvCharacter(modelData, characterName, characterClass = "") {
  const xml = buildWmvCharacterXml(modelData, characterClass);
  const filename = `${safeFilename(characterName)}.chr`;
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

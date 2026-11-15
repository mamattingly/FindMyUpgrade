const SUPPORTED_REGIONS = new Set(["us", "eu", "kr", "tw"]);

/**
 * Resolve the scanned character to the matching community WoW Forever Armory
 * profile, which supplies the working ClassicPlus 3D viewer and its own
 * same-origin model assets. "Normal" is the standard PvE route.
 */
export function buildArmoryProfileUrl(name, region, ruleset) {
  const normalizedName = String(name || "").trim().replace(/\s+/g, " ");
  const parts = normalizedName.split(" ");
  if (parts.length !== 2 || parts.some((part) => !part)) return null;

  const regionKey = String(region || "").trim().toLowerCase();
  if (!SUPPORTED_REGIONS.has(regionKey)) return null;

  const rulesetKey = String(ruleset || "").trim().toLowerCase();
  const mode = rulesetKey.includes("pvp") ? "pvp" : "normal";
  const slug = normalizedName.replace(/\s+/g, "-");

  return `https://armorywowforever.com/c/forever/${regionKey}/${mode}/${encodeURIComponent(slug)}`;
}

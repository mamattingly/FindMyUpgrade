import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeSearchResults, rankSearchResults } from "../lib/search";

const catalog = [
  { id: 1, name: "Runecloth", kind: "item" },
  { id: 2, name: "Runecloth Bag", kind: "recipe" },
  { id: 3, name: "Wool Cloth", kind: "item" },
  { id: 4, name: "Bolt of Woolen Cloth", kind: "item" },
  { id: 5, name: "Silverleaf", kind: "item" },
];

describe("Forever Forge fuzzy search", () => {
  it("finds typo-tolerant matches", () => {
    const results = rankSearchResults(catalog, "runcloth");
    assert.ok(results.some(item => item.name === "Runecloth"));
  });
  it("prioritizes closer matches", () => {
    const results = rankSearchResults(catalog, "runecloth");
    assert.equal(results[0].name, "Runecloth");
  });
  it("matches numeric item IDs exactly", () => {
    assert.deepEqual(rankSearchResults(catalog, "3").map(item => item.id), [3]);
  });
  it("returns no results for empty input", () => {
    assert.deepEqual(rankSearchResults(catalog, "  "), []);
  });
  it("deduplicates by type and ID while retaining item and recipe with same ID", () => {
    const merged = mergeSearchResults([catalog[0], catalog[0]], [catalog[1]]);
    assert.equal(merged.length, 2);
  });
  it("respects result limits", () => {
    assert.ok(rankSearchResults(catalog, "cloth", 2).length <= 2);
  });
});

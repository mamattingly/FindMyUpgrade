import { rankSearchResults, type Searchable } from "@/lib/search";

export type CatalogEntry = Searchable & {
  kind: "item" | "recipe";
  outputId?: number;
  outputName?: string;
  outputCount?: number;
  profession?: string;
};
export type CatalogSnapshot = {
  entries: CatalogEntry[];
  itemCount: number;
  recipeCount: number;
  syncedAt: string;
  namespace: string;
};

type CatalogState = {
  snapshot: CatalogSnapshot | null;
  syncing: Promise<CatalogSnapshot> | null;
  lastError: string | null;
};
const stateKey = "__foreverForgeCatalog";
const root = globalThis as typeof globalThis & { [stateKey]?: CatalogState };
const state = root[stateKey] ?? (root[stateKey] = { snapshot: null, syncing: null, lastError: null });
const region = process.env.BLIZZARD_REGION || "us";
const locale = process.env.BLIZZARD_LOCALE || "en_US";
const base = region === "eu" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
const namespace = `static-forever-${region}`;
const MAX_ITEM_BATCHES = 100;
const PAGE_SIZE = 1000;
const REFRESH_MS = 24 * 60 * 60 * 1000;

let token: { value: string; expires: number } | null = null;
async function accessToken() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const id = process.env.BLIZZARD_CLIENT_ID, secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Blizzard API credentials are missing.");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Blizzard OAuth failed (${response.status}).`);
  const data = await response.json();
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}
async function bnet(path: string, bearer: string) {
  const url = new URL(path, base);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("locale", locale);
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + bearer },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Blizzard API ${response.status} at ${path}`);
  return response.json();
}
const localizedText = (value: any): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const preferred = value[locale] ?? value.en_US ?? value.en_GB ?? value["en-US"];
    if (typeof preferred === "string") return preferred;
    const first = Object.values(value).find((entry): entry is string => typeof entry === "string");
    if (first) return first;
  }
  return "";
};
const displayName = (value: any) => localizedText(value?.name) || localizedText(value?.display_string) || String(value?.id || "Unknown");
const unwrap = (rows: any[]) => rows.map(row => row?.data || row).filter(row => Number.isInteger(row?.id));

async function indexEveryItem(bearer: string): Promise<CatalogEntry[]> {
  const items = new Map<number, CatalogEntry>();
  let minimumId = 1;
  for (let batch = 0; batch < MAX_ITEM_BATCHES; batch++) {
    const query = new URL("/data/wow/search/item", base);
    query.searchParams.set("namespace", namespace);
    query.searchParams.set("orderby", "id");
    query.searchParams.set("_page", "1");
    query.searchParams.set("_pageSize", String(PAGE_SIZE));
    query.searchParams.set("id", `[${minimumId},]`);
    const response = await fetch(query, {
      headers: { Authorization: "Bearer " + bearer },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Item catalogue batch failed (${response.status}) at ID ${minimumId}.`);
    const data = await response.json();
    const rows = unwrap(data.results || []);
    if (!rows.length) return [...items.values()];
    let highestId = minimumId - 1;
    for (const item of rows) {
      const id = Number(item.id);
      if (!Number.isInteger(id)) continue;
      highestId = Math.max(highestId, id);
      items.set(id, { id, kind: "item", name: displayName(item) });
    }
    if (rows.length < PAGE_SIZE) return [...items.values()];
    if (highestId < minimumId) throw new Error("Item catalogue pagination stopped advancing; refusing to publish an incomplete index.");
    minimumId = highestId + 1;
  }
  throw new Error("Item catalogue exceeded the safety limit; refusing to publish an incomplete index.");
}

async function indexEveryRecipe(bearer: string): Promise<CatalogEntry[]> {
  const professionIndex = await bnet("/data/wow/profession/index", bearer);
  const professions = professionIndex.professions || [];
  const recipeMap = new Map<number, CatalogEntry>();
  for (const professionRef of professions) {
    const profession = await bnet(`/data/wow/profession/${professionRef.id}`, bearer);
    const tiers = profession.skill_tiers || [];
    const tierData = await Promise.all(tiers.map((tier: any) => bnet(`/data/wow/profession/${professionRef.id}/skill-tier/${tier.id}`, bearer)));
    for (const tier of tierData) {
      for (const category of tier.categories || []) {
        for (const row of category.recipes || []) {
          const recipe = row.recipe || row;
          if (!Number.isInteger(recipe?.id)) continue;
          recipeMap.set(recipe.id, {
            id: recipe.id,
            kind: "recipe",
            name: displayName(recipe),
            profession: displayName(professionRef),
            outputId: recipe.crafted_item?.id || recipe.id,
            outputName: recipe.crafted_item?.name || displayName(recipe),
            outputCount: recipe.crafted_item?.quantity || 1,
          });
        }
      }
    }
  }
  return [...recipeMap.values()];
}

export async function getCatalog(force = false): Promise<CatalogSnapshot> {
  const fresh = state.snapshot && Date.now() - Date.parse(state.snapshot.syncedAt) < REFRESH_MS;
  if (!force && fresh) return state.snapshot!;
  if (state.syncing) return state.syncing;
  state.syncing = (async () => {
    try {
      const bearer = await accessToken();
      const [items, recipes] = await Promise.all([indexEveryItem(bearer), indexEveryRecipe(bearer)]);
      const entries = [...items, ...recipes];
      if (!items.length || !recipes.length) throw new Error("Blizzard returned an empty item or recipe catalogue; incomplete index was not published.");
      const snapshot: CatalogSnapshot = {
        entries,
        itemCount: items.length,
        recipeCount: recipes.length,
        syncedAt: new Date().toISOString(),
        namespace,
      };
      state.snapshot = snapshot;
      state.lastError = null;
      return snapshot;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "Catalogue sync failed.";
      throw error;
    } finally {
      state.syncing = null;
    }
  })();
  return state.syncing;
}

export function catalogStatus() {
  return {
    ready: Boolean(state.snapshot),
    syncing: Boolean(state.syncing),
    lastError: state.lastError,
    itemCount: state.snapshot?.itemCount || 0,
    recipeCount: state.snapshot?.recipeCount || 0,
    syncedAt: state.snapshot?.syncedAt || null,
    namespace,
  };
}

export function searchCatalog(snapshot: CatalogSnapshot, query: string, limit = 50) {
  return rankSearchResults(snapshot.entries, query, limit);
}

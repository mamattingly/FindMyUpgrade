import { NextResponse } from "next/server";

export const revalidate = 3600;
const base = process.env.BLIZZARD_REGION === "eu" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
const region = process.env.BLIZZARD_REGION || "us";
const locale = process.env.BLIZZARD_LOCALE || "en_US";
let token: { value: string; expires: number } | null = null;

async function accessToken() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Add BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in Render environment variables.");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Blizzard OAuth failed (" + response.status + "). Check API credentials.");
  const data = await response.json();
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function bnet(path: string) {
  const bearer = await accessToken();
  const url = new URL(path, base);
  url.searchParams.set("namespace", `static-forever-${region}`);
  url.searchParams.set("locale", locale);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + bearer }, next: { revalidate: 3600 } });
  if (!response.ok) throw new Error(`Blizzard API ${response.status} at ${path}`);
  return response.json();
}

async function pool<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index]);
    }
  }));
  return output;
}

const displayName = (value: any) => value?.name || value?.display_string || value?.id?.toString?.() || "Unknown";

export async function GET() {
  try {
    const index = await bnet("/data/wow/profession/index");
    const professions = index.professions || [];
    const tierRows: { profession: string; tierId: number }[] = [];
    const professionDetails = await pool(professions, 5, async (profession: any) => {
      const detail = await bnet(`/data/wow/profession/${profession.id}`);
      return { name: displayName(profession), tiers: detail.skill_tiers || [] };
    });
    for (const profession of professionDetails) {
      for (const tier of profession.tiers) tierRows.push({ profession: profession.name, tierId: tier.id });
    }

    const tiers = await pool(tierRows, 6, async (row) => {
      const data = await bnet(`/data/wow/profession/${professionDetails.find((p: any) => p.name === row.profession)?.tiers.find((t: any) => t.id === row.tierId)?.id || 0}/skill-tier/${row.tierId}`);
      return { profession: row.profession, recipes: (data.categories || []).flatMap((category: any) => category.recipes || []) };
    });

    const recipeRefs = tiers.flatMap((tier) => tier.recipes.map((entry: any) => ({ profession: tier.profession, ref: entry.recipe || entry })))
      .filter((entry: any) => Number(entry.ref?.id) > 0);
    const unique = Array.from(new Map(recipeRefs.map((entry: any) => [entry.ref.id, entry])).values());

    const details = await pool(unique, 8, async (entry: any) => {
      try {
        const data = await bnet(`/data/wow/recipe/${entry.ref.id}`);
        return { ...data, profession: entry.profession };
      } catch {
        return { id: entry.ref.id, name: entry.ref.name || "Unknown recipe", profession: entry.profession, reagents: [] };
      }
    });

    const itemIds = Array.from(new Set(details.flatMap((recipe: any) => [
      recipe.crafted_item?.id,
      ...(recipe.reagents || []).map((r: any) => r.reagent?.id)
    ]).filter((id: any) => Number(id) > 0)));
    const itemNames = new Map<number, string>();
    await pool(itemIds, 10, async (id) => {
      try {
        const item = await bnet(`/data/wow/item/${id}`);
        itemNames.set(id, displayName(item));
      } catch { itemNames.set(id, `Item ${id}`); }
      return true;
    });

    const recipes = details.map((recipe: any) => ({
      id: recipe.id,
      name: displayName(recipe),
      profession: recipe.profession,
      outputId: recipe.crafted_item?.id || 0,
      outputName: itemNames.get(recipe.crafted_item?.id) || displayName(recipe),
      outputCount: recipe.crafted_item_quantity || 1,
      reagents: (recipe.reagents || []).map((row: any) => ({
        id: row.reagent?.id || 0,
        name: itemNames.get(row.reagent?.id) || `Item ${row.reagent?.id || "unknown"}`,
        quantity: row.quantity || 1
      })).filter((row: any) => row.id > 0)
    })).filter((recipe: any) => recipe.reagents.length > 0);

    return NextResponse.json({ recipes, source: "blizzard", count: recipes.length }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" }
    });
  } catch (error) {
    return NextResponse.json({
      recipes: [],
      source: "unavailable",
      message: error instanceof Error ? error.message : "Recipe data unavailable."
    }, { status: 200 });
  }
}

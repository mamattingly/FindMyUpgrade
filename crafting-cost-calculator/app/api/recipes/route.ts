import { NextRequest, NextResponse } from "next/server";

export const revalidate = 3600;
const base = process.env.BLIZZARD_REGION === "eu" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
const region = process.env.BLIZZARD_REGION || "us";
const locale = process.env.BLIZZARD_LOCALE || "en_US";
let token: { value: string; expires: number } | null = null;
async function accessToken() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const id = process.env.BLIZZARD_CLIENT_ID, secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Blizzard API credentials are missing from Render.");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST", headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials", cache: "no-store", signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("Blizzard OAuth failed (" + response.status + ").");
  const data = await response.json(); token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }; return token.value;
}
async function bnet(path: string) {
  const bearer = await accessToken(), url = new URL(path, base);
  url.searchParams.set("namespace", `static-forever-${region}`); url.searchParams.set("locale", locale);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + bearer }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Blizzard API ${response.status} at ${path}`);
  return response.json();
}
const displayName = (value: any) => value?.name || value?.display_string || String(value?.id || "Unknown");
export async function GET(req: NextRequest) {
  try {
    const professionFilter = req.nextUrl.searchParams.get("profession");
    const index = await bnet("/data/wow/profession/index");
    const professions = (index.professions || []).filter((p: any) => !professionFilter || displayName(p).toLowerCase() === professionFilter.toLowerCase());
    if (professionFilter && !professions.length) return NextResponse.json({ recipes: [], source: "blizzard", count: 0 });
    const professionDetails = await Promise.all(professions.map(async (p: any) => ({ id: p.id, name: displayName(p), detail: await bnet(`/data/wow/profession/${p.id}`) })));
    const tierRows = professionDetails.flatMap((p: any) => (p.detail.skill_tiers || []).map((tier: any) => ({ professionId: p.id, profession: p.name, tierId: tier.id })));
    const tierResults = await Promise.all(tierRows.map(async (tier: any) => {
      const data = await bnet(`/data/wow/profession/${tier.professionId}/skill-tier/${tier.tierId}`);
      return { profession: tier.profession, recipes: (data.categories || []).flatMap((c: any) => c.recipes || []) };
    }));
    const seen = new Map<number, any>();
    for (const tier of tierResults) for (const entry of tier.recipes) {
      const recipe = entry.recipe || entry;
      if (recipe?.id && !seen.has(recipe.id)) seen.set(recipe.id, { id: recipe.id, name: displayName(recipe), outputName: displayName(recipe), outputId: recipe.id, outputCount: 1, profession: tier.profession, reagents: [] });
    }
    const recipes = [...seen.values()];
    return NextResponse.json({ recipes, source: "blizzard", count: recipes.length }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return NextResponse.json({ recipes: [], source: "unavailable", message: error instanceof Error ? error.message : "Recipe discovery failed." }, { status: 200 });
  }
}

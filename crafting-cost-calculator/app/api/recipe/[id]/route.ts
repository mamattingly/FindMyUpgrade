import { NextRequest, NextResponse } from "next/server";
const region = process.env.BLIZZARD_REGION || "us";
const locale = process.env.BLIZZARD_LOCALE || "en_US";
const base = region === "eu" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
function textValue(value: any): string | null { if (typeof value === "string") return value; if (value && typeof value === "object") { const preferred = value[locale] ?? value.en_US ?? value.en_GB; if (typeof preferred === "string") return preferred; const first = Object.values(value).find((v): v is string => typeof v === "string"); if (first) return first; } return null; }
let token: { value: string; expires: number } | null = null;
async function getToken() {
  if (token && token.expires > Date.now() + 60000) return token.value;
  const id = process.env.BLIZZARD_CLIENT_ID, secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Blizzard API credentials are missing.");
  const response = await fetch("https://oauth.battle.net/token", { method: "POST", headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Blizzard OAuth failed (" + response.status + ").");
  const data = await response.json(); token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }; return token.value;
}
async function bnet(path: string) {
  const url = new URL(path, base); url.searchParams.set("namespace", `static-forever-${region}`); url.searchParams.set("locale", locale);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + await getToken() }, signal: AbortSignal.timeout(12000), next: { revalidate: 3600 } });
  if (!response.ok) throw new Error(`Blizzard API ${response.status} for ${path}`);
  return response.json();
}
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Invalid recipe ID." }, { status: 400 });
    const recipe = await bnet(`/data/wow/recipe/${id}`);
    const outputId = recipe.crafted_item?.id || 0;
    const reagentRows = await Promise.all((recipe.reagents || []).map(async (row: any) => {
      const reagentId = row.reagent?.id || 0; let reagentName = textValue(row.reagent?.name) || `Item ${reagentId}`;
      if (reagentId) { try { const item = await bnet(`/data/wow/item/${reagentId}`); reagentName = textValue(item.name) || reagentName; } catch {} }
      return { id: reagentId, name: reagentName, quantity: row.quantity || 1 };
    }));
    let outputName = textValue(recipe.name) || "Crafted item";
    if (outputId) { try { const item = await bnet(`/data/wow/item/${outputId}`); outputName = textValue(item.name) || outputName; } catch {} }
    return NextResponse.json({ recipe: { id: recipe.id, name: textValue(recipe.name) || outputName, profession: "Recipe", outputId, outputName, outputCount: recipe.crafted_item_quantity || 1, reagents: reagentRows.filter((r: any) => r.id > 0) }, source: "blizzard" }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Recipe detail failed." }, { status: 502 });
  }
}

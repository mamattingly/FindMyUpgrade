import { NextResponse } from "next/server";
const region = process.env.BLIZZARD_REGION || "us";
const locale = process.env.BLIZZARD_LOCALE || "en_US";
const base = region === "eu" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
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
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Invalid item ID." }, { status: 400 });
    const item = await bnet(`/data/wow/item/${id}`);
    return NextResponse.json({
      itemId: Number(id), name: item.name || `Item ${id}`,
      vendorPurchasePrice: Number.isFinite(item.purchase_price) ? item.purchase_price : null,
      vendorSellPrice: Number.isFinite(item.sell_price) ? item.sell_price : null,
      source: "blizzard"
    }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Item details unavailable." }, { status: 502 });
  }
}

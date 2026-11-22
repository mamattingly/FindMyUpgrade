import { NextRequest, NextResponse } from "next/server";
export const revalidate = 900;
const region = process.env.BLIZZARD_REGION || "us";
const base = region === "eu" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
let token: { value: string; expires: number } | null = null;
async function auth() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const id = process.env.BLIZZARD_CLIENT_ID, secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Blizzard API credentials are not configured.");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(id + ":" + secret).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error("Blizzard OAuth failed.");
  const data = await response.json();
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}
async function marketFetch(url: string, bearer: string) {
  const response = await fetch(url, { headers: { Authorization: "Bearer " + bearer }, next: { revalidate: 900 } });
  if (!response.ok) throw new Error(`Blizzard auction API returned ${response.status}`);
  return response.json();
}
export async function GET(req: NextRequest) {
  const itemId = Number(req.nextUrl.searchParams.get("itemId"));
  const houseId = Number(req.nextUrl.searchParams.get("houseId") || "110");
  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(houseId)) return NextResponse.json({ error: "Invalid item or auction house." }, { status: 400 });
  try {
    const bearer = await auth();
    const ruleset = process.env.BLIZZARD_RULESET_ID || "1";
    const namespace = `dynamic-forever-${region}`;
    const root = `${base}/data/wow/ruleset/${ruleset}/auctions/${houseId}`;
    const [auctionData, commodityData] = await Promise.all([
      marketFetch(`${root}?namespace=${namespace}`, bearer),
      marketFetch(`${root}/commodities?namespace=${namespace}`, bearer).catch(() => ({ auctions: [] }))
    ]);
    const listingPrices = (auctionData.auctions || [])
      .filter((auction: any) => auction.item?.id === itemId && auction.buyout > 0 && auction.quantity > 0)
      .map((auction: any) => ({ unitPrice: Math.ceil(auction.buyout / auction.quantity), quantity: auction.quantity }));
    const commodityPrices = (commodityData.auctions || [])
      .filter((auction: any) => auction.item?.id === itemId && auction.unit_price > 0 && auction.quantity > 0)
      .map((auction: any) => ({ unitPrice: auction.unit_price, quantity: auction.quantity }));
    const rows = [...listingPrices, ...commodityPrices].sort((a: any, b: any) => a.unitPrice - b.unitPrice);
    let remaining = Math.floor(rows.reduce((sum: number, row: any) => sum + row.quantity, 0) / 2);
    let median: number | null = null;
    for (const row of rows) { remaining -= row.quantity; if (remaining < 0) { median = row.unitPrice; break; } }
    return NextResponse.json({
      itemId, houseId, lowest: rows[0]?.unitPrice ?? null, median,
      quantity: rows.reduce((sum: number, row: any) => sum + row.quantity, 0),
      listings: rows.length, updatedAt: new Date().toISOString(), source: "Blizzard Game Data API"
    }, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" } });
  } catch (error) {
    return NextResponse.json({ itemId, houseId, lowest: null, median: null, quantity: 0, source: "unavailable", error: error instanceof Error ? error.message : "Market lookup failed." }, { status: 200 });
  }
}

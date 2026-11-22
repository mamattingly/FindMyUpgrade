import { NextRequest, NextResponse } from "next/server";
import { catalogStatus, getCatalog, searchCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 80);
  if (query.length < 2) return NextResponse.json({ results: [], ...catalogStatus() });
  try {
    const catalog = await getCatalog();
    const results = searchCatalog(catalog, query, 50);
    return NextResponse.json({
      results,
      count: results.length,
      source: "local-index",
      ready: true,
      itemCount: catalog.itemCount,
      recipeCount: catalog.recipeCount,
      syncedAt: catalog.syncedAt,
      namespace: catalog.namespace,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      results: [],
      source: "unavailable",
      ...catalogStatus(),
      error: error instanceof Error ? error.message : "Catalogue search failed.",
    }, { status: 503 });
  }
}

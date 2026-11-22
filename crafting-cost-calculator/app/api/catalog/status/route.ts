import { NextResponse } from "next/server";
import { catalogStatus, getCatalog } from "@/lib/catalog";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET() {
  try {
    const catalog = await getCatalog();
    return NextResponse.json({ ...catalogStatus(), ready: true, itemCount: catalog.itemCount, recipeCount: catalog.recipeCount, syncedAt: catalog.syncedAt });
  } catch (error) {
    return NextResponse.json({ ...catalogStatus(), error: error instanceof Error ? error.message : "Catalogue sync failed." }, { status: 503 });
  }
}
export async function POST() {
  try {
    const catalog = await getCatalog(true);
    return NextResponse.json({ ...catalogStatus(), ready: true, itemCount: catalog.itemCount, recipeCount: catalog.recipeCount, syncedAt: catalog.syncedAt });
  } catch (error) {
    return NextResponse.json({ ...catalogStatus(), error: error instanceof Error ? error.message : "Catalogue refresh failed." }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from "next/server";
export const revalidate = 3600;
const region = process.env.BLIZZARD_REGION || "us";
const locale = process.env.BLIZZARD_LOCALE || "en_US";
const base = region === "eu" ? "https://eu.api.blizzard.com" : "https://us.api.blizzard.com";
let token: { value: string; expires: number } | null = null;
async function accessToken() {
  if (token && token.expires > Date.now() + 60000) return token.value;
  const id = process.env.BLIZZARD_CLIENT_ID, secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Blizzard API credentials are missing.");
  const response = await fetch("https://oauth.battle.net/token", { method:"POST", headers:{Authorization:"Basic "+Buffer.from(id+":"+secret).toString("base64"),"Content-Type":"application/x-www-form-urlencoded"}, body:"grant_type=client_credentials", signal:AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Blizzard OAuth failed ("+response.status+").");
  const data=await response.json(); token={value:data.access_token,expires:Date.now()+data.expires_in*1000}; return token.value;
}
async function search(kind:"item"|"recipe", term:string, bearer:string) {
  const url=new URL(`/data/wow/search/${kind}`,base);
  url.searchParams.set("namespace",`static-forever-${region}`);
  url.searchParams.set(`name.${locale}`,term);
  url.searchParams.set("orderby","id");
  url.searchParams.set("_page","1");
  const response=await fetch(url,{headers:{Authorization:"Bearer "+bearer},next:{revalidate:3600},signal:AbortSignal.timeout(12000)});
  if (!response.ok) {
    if (response.status===400 || response.status===404) return [];
    throw new Error(`Blizzard ${kind} search failed (${response.status}).`);
  }
  const data=await response.json();
  return (data.results||[]).map((row:any)=>row.data||row).filter((row:any)=>row.id).slice(0,25);
}
export async function GET(req:NextRequest) {
  const term=(req.nextUrl.searchParams.get("q")||"").trim().slice(0,80);
  if(term.length<2) return NextResponse.json({results:[]});
  try {
    const bearer=await accessToken();
    const [items,recipes]=await Promise.all([search("item",term,bearer),search("recipe",term,bearer)]);
    const results=[
      ...recipes.map((r:any)=>({kind:"recipe",id:r.id,name:r.name||r.display_string||`Recipe ${r.id}`,profession:r.profession?.name||r.profession||"Recipe",outputId:r.crafted_item?.id||r.id})),
      ...items.map((i:any)=>({kind:"item",id:i.id,name:i.name||i.display_string||`Item ${i.id}`}))
    ];
    return NextResponse.json({results,count:results.length,source:"blizzard"},{headers:{"Cache-Control":"public, s-maxage=3600, stale-while-revalidate=86400"}});
  } catch(error) {
    return NextResponse.json({results:[],source:"unavailable",error:error instanceof Error?error.message:"Search failed."},{status:502});
  }
}

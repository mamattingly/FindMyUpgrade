// Shared, pure advisor logic and browser persistence helpers.
export const KEY="wow-forever-advisor-profiles", REGION_KEY="wow-forever-advisor-region", SKILL_KEY="wow-forever-profession-skills";
export const GOALS_KEY="wow-forever-farming-goals", RUNS_KEY="wow-forever-dungeon-runs";
export const NAMES=["Alchemy","Blacksmithing","Enchanting","Engineering","Herbalism","Leatherworking","Mining","Skinning","Tailoring","Cooking","First Aid","Fishing"];
export const SOURCES={Alchemy:"https://www.60.tools/guides/alchemy-leveling-guide",Blacksmithing:"https://www.60.tools/guides/blacksmithing-leveling-guide",Enchanting:"https://www.60.tools/guides/enchanting-leveling-guide",Engineering:"https://www.60.tools/guides/engineering-leveling-guide",Herbalism:"https://www.60.tools/guides/herbalism-leveling-guide",Leatherworking:"https://www.60.tools/guides/leatherworking-leveling-guide",Mining:"https://www.60.tools/guides/mining-leveling-guide",Skinning:"https://www.60.tools/guides/skinning-leveling-guide",Tailoring:"https://www.60.tools/guides/tailoring-leveling-guide",Cooking:"https://www.60.tools/guides/cooking-leveling-guide","First Aid":"https://www.60.tools/guides/first-aid-leveling-guide",Fishing:"https://www.60.tools/guides/fishing-leveling-guide"};
export const iconFallback="https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg";
const KEY="wow-forever-advisor-profiles", REGION_KEY="wow-forever-advisor-region", SKILL_KEY="wow-forever-profession-skills";
const GOALS_KEY="wow-forever-farming-goals", RUNS_KEY="wow-forever-dungeon-runs";
const NAMES=["Alchemy","Blacksmithing","Enchanting","Engineering","Herbalism","Leatherworking","Mining","Skinning","Tailoring","Cooking","First Aid","Fishing"];
const SOURCES={Alchemy:"https://www.60.tools/guides/alchemy-leveling-guide",Blacksmithing:"https://www.60.tools/guides/blacksmithing-leveling-guide",Enchanting:"https://www.60.tools/guides/enchanting-leveling-guide",Engineering:"https://www.60.tools/guides/engineering-leveling-guide",Herbalism:"https://www.60.tools/guides/herbalism-leveling-guide",Leatherworking:"https://www.60.tools/guides/leatherworking-leveling-guide",Mining:"https://www.60.tools/guides/mining-leveling-guide",Skinning:"https://www.60.tools/guides/skinning-leveling-guide",Tailoring:"https://www.60.tools/guides/tailoring-leveling-guide",Cooking:"https://www.60.tools/guides/cooking-leveling-guide","First Aid":"https://www.60.tools/guides/first-aid-leveling-guide",Fishing:"https://www.60.tools/guides/fishing-leveling-guide"};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}};
const iconFallback="https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg";
const XP_CACHE_KEY="wow-forever-dungeon-xp-cache";
function grayMobThreshold(level){const n=Math.max(1,Number(level)||1);if(n<=5)return 0;if(n<=39)return n-5-Math.floor(n/10);return n-9;}
async function loadForeverDungeonXp(dungeonNames){
 const cached=read(XP_CACHE_KEY,null);
 if(cached&&Date.now()-cached.savedAt<6*60*60*1000)return cached.data;
 const matches=Object.fromEntries(dungeonNames.map(n=>[n,[]]));
 for(let page=1;page<=200;page++){
  const response=await fetch(`https://thewowdb.com/api/v1/forever/npc/?page=${page}&per_page=100`);
  if(!response.ok)throw new Error("Could not load WoW Forever creature data.");
  const payload=await response.json(),rows=payload.results||payload.data||payload.npcs||[];
  if(!Array.isArray(rows)||!rows.length)break;
  for(const npc of rows){
   const raw=npc.level??npc.min_level??npc.minLevel??npc.level_min;
   const level=Number(raw);if(!Number.isFinite(level)||level<=0)continue;
   const zones=[npc.zone_name,npc.zone?.name,npc.area_name,npc.area?.name,npc.instance_name,npc.instance?.name,npc.location?.zone].filter(Boolean).join(" ").toLowerCase();
   if(!zones)continue;
   for(const dungeon of dungeonNames){const key=dungeon.toLowerCase();if(zones.includes(key))matches[dungeon].push(level);}
  }
  if(payload.has_more===false||(!payload.has_more&&rows.length<100))break;
 }
 localStorage.setItem(XP_CACHE_KEY,JSON.stringify({savedAt:Date.now(),data:matches}));
 return matches;
}
function rankInfo(skill){if(skill>=300)return {rank:"Artisan",next:null};if(skill>=200)return {rank:"Expert",next:300};if(skill>=125)return {rank:"Expert",next:200};if(skill>=75)return {rank:"Journeyman",next:125};if(skill>=50)return {rank:"Journeyman",next:75};return {rank:"Apprentice",next:50};}


export const KEY="wow-forever-advisor-profiles", REGION_KEY="wow-forever-advisor-region", SKILL_KEY="wow-forever-profession-skills";
export const GOALS_KEY="wow-forever-farming-goals", RUNS_KEY="wow-forever-dungeon-runs";
export const NAMES=["Alchemy","Blacksmithing","Enchanting","Engineering","Herbalism","Leatherworking","Mining","Skinning","Tailoring","Cooking","First Aid","Fishing"];
export const SOURCES={Alchemy:"https://www.60.tools/guides/alchemy-leveling-guide",Blacksmithing:"https://www.60.tools/guides/blacksmithing-leveling-guide",Enchanting:"https://www.60.tools/guides/enchanting-leveling-guide",Engineering:"https://www.60.tools/guides/engineering-leveling-guide",Herbalism:"https://www.60.tools/guides/herbalism-leveling-guide",Leatherworking:"https://www.60.tools/guides/leatherworking-leveling-guide",Mining:"https://www.60.tools/guides/mining-leveling-guide",Skinning:"https://www.60.tools/guides/skinning-leveling-guide",Tailoring:"https://www.60.tools/guides/tailoring-leveling-guide",Cooking:"https://www.60.tools/guides/cooking-leveling-guide","First Aid":"https://www.60.tools/guides/first-aid-leveling-guide",Fishing:"https://www.60.tools/guides/fishing-leveling-guide"};
export const iconFallback="https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg";
export const XP_CACHE_KEY="wow-forever-dungeon-xp-cache";
export const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}};
export function grayMobThreshold(level){const n=Math.max(1,Number(level)||1);if(n<=5)return 0;if(n<=39)return n-5-Math.floor(n/10);return n-9;}
export async function loadForeverDungeonXp(dungeonNames){
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
export function rankInfo(skill){if(skill>=300)return {rank:"Artisan",next:null};if(skill>=200)return {rank:"Expert",next:300};if(skill>=125)return {rank:"Expert",next:200};if(skill>=75)return {rank:"Journeyman",next:125};if(skill>=50)return {rank:"Journeyman",next:75};return {rank:"Apprentice",next:50};}


export function relevantStats(stats,className,spec){
 const healer=(className==="Priest"&&["Discipline","Holy"].includes(spec))||(className==="Druid"&&spec==="Restoration")||(className==="Shaman"&&spec==="Restoration")||(className==="Paladin"&&spec==="Holy");
 const caster=["Mage","Warlock"].includes(className)||(className==="Priest"&&spec==="Shadow")||(className==="Druid"&&spec==="Balance")||(className==="Shaman"&&spec==="Elemental");
 const tank=(className==="Warrior"&&spec==="Protection")||(className==="Paladin"&&spec==="Protection");
 const physical=["Hunter","Rogue","Warrior"].includes(className)||(className==="Druid"&&spec==="Feral")||(className==="Shaman"&&spec==="Enhancement")||(className==="Paladin"&&spec==="Retribution");
 return (stats||[]).filter(s=>{
  const n=String(s.name||"").toLowerCase();
  if(/intellect|stamina/.test(n))return true;
  if(healer)return /spirit|mana|healing|spell critical|critical strike/.test(n);
  if(caster)return /spell damage|spell power|spell critical|critical strike|spirit|mana/.test(n);
  if(tank)return /strength|defense|dodge|parry|block|armor|critical/.test(n);
  if(physical)return /agility|strength|attack power|hit|expertise|critical/.test(n);
  return !/spell damage|spell power|healing/.test(n);
 }).map(s=>(s.value>0?"+":"")+s.value+" "+s.name);
}

export function rankFarmDungeons(rankings,logs,goals){
 if(!rankings?.length)return {rankings:[],measured:false,missingGoals:[]};
 const byDungeon=new Map();
 for(const run of logs||[]){if(!byDungeon.has(run.dungeon))byDungeon.set(run.dungeon,[]);byDungeon.get(run.dungeon).push(run);}
 const measured=byDungeon.size>0;
 const active=[{key:'gear',enabled:true},{key:'tailoring',enabled:!!goals.tailoring},{key:'enchanting',enabled:!!goals.enchanting}].filter(x=>x.enabled);
 const missingGoals=active.filter(x=>x.key!=='gear'&&![...byDungeon.values()].some(rows=>rows.some(r=>x.key==='tailoring'?Number(r.cloth)>0:Number(r.disenchantables)>0))).map(x=>x.key);
 const rows=rankings.map(d=>{const runs=byDungeon.get(d.name)||[];if(!runs.length)return {...d,sampleCount:0};const minutes=runs.reduce((n,r)=>n+Number(r.minutes||0),0)/runs.length;const cloth=runs.reduce((n,r)=>n+Number(r.cloth||0),0)/runs.length;const disenchantables=runs.reduce((n,r)=>n+Number(r.disenchantables||0),0)/runs.length;return {...d,sampleCount:runs.length,avgMinutes:minutes,gearPerHour:minutes>0?Number(d.score||0)*60/minutes:0,clothPerHour:minutes>0?cloth*60/minutes:0,disenchantablesPerHour:minutes>0?disenchantables*60/minutes:0};});
 const useMeasured=measured;
 const candidates=useMeasured?rows.filter(d=>d.sampleCount>0):rows;
 const metrics=active.map(x=>({key:x.key,max:Math.max(0,...candidates.map(d=>x.key==='gear'?(d.gearPerHour??Number(d.score||0)):x.key==='tailoring'?(d.clothPerHour||0):(d.disenchantablesPerHour||0)))}));
 const scored=candidates.map(d=>{const components=metrics.map(m=>{const value=m.key==='gear'?(d.gearPerHour??Number(d.score||0)):m.key==='tailoring'?(d.clothPerHour||0):(d.disenchantablesPerHour||0);return m.max>0?value/m.max:0;});return {...d,farmScore:components.length?components.reduce((a,b)=>a+b,0)/components.length:0,measured:!!d.sampleCount};}).sort((a,b)=>b.farmScore-a.farmScore);
 return {rankings:scored,measured:useMeasured,missingGoals};
}

export function isDungeonXpEligible(levels, playerLevel){
 if(!Array.isArray(levels)||levels.length<5)return false;
 const threshold=grayMobThreshold(playerLevel);
 const xpMobs=levels.filter(level=>Number(level)>threshold).length;
 return xpMobs/levels.length>0.5;
}

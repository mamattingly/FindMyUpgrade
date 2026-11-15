import {useEffect,useMemo,useState} from "react";
import {Search,ChevronDown,ExternalLink,Shield,Compass,BookOpen,Sparkles,Target,Package,Download} from "lucide-react";
import CharacterModel from "./CharacterModel.jsx";
import {canExportWmvCharacter,downloadWmvCharacter} from "./wowModelViewerExport.js";
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
function ItemIcon({src,name,size="large"}){return <span className={"itemicon "+size}><img src={src||iconFallback} alt={name+" icon"} loading="lazy" onError={e=>{e.currentTarget.src=iconFallback}}/></span>}
function relevantStats(stats,className,spec){
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

function rankFarmDungeons(rankings,logs,goals){
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
function StatLine({stats}){if(!stats?.length)return null;return <div className="statline">{stats.map((s,i)=><span key={i}>{s}</span>)}</div>}
export default function App(){
 const [profiles,setProfiles]=useState(()=>read(KEY,[]).filter(p=>p&&p.name&&p.class&&p.class!=="Unknown"&&Number.isFinite(p.level)));
 const [region,setRegion]=useState(()=>localStorage.getItem(REGION_KEY)||"us");
 const [name,setName]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[active,setActive]=useState(0);
 const [skills,setSkills]=useState(()=>read(SKILL_KEY,{}));
 const [goals,setGoals]=useState(()=>read(GOALS_KEY,{gear:true,tailoring:false,enchanting:false,mustGrantXp:false}));\n const [xpMobLevels,setXpMobLevels]=useState(()=>read(XP_CACHE_KEY,null)?.data||{});\n const [xpLoading,setXpLoading]=useState(false);
 const [runLogs,setRunLogs]=useState(()=>read(RUNS_KEY,[]));
 const [runDungeon,setRunDungeon]=useState("");
 const [runMinutes,setRunMinutes]=useState("30");
 const [runCloth,setRunCloth]=useState("0");
 const [runDisenchantables,setRunDisenchantables]=useState("0");
 const [showAllSkills,setShowAllSkills]=useState(false);
 useEffect(()=>localStorage.setItem(KEY,JSON.stringify(profiles)),[profiles]);
 useEffect(()=>localStorage.setItem(REGION_KEY,region),[region]);
 useEffect(()=>localStorage.setItem(SKILL_KEY,JSON.stringify(skills)),[skills]);
 useEffect(()=>localStorage.setItem(GOALS_KEY,JSON.stringify(goals)),[goals]);
 useEffect(()=>localStorage.setItem(RUNS_KEY,JSON.stringify(runLogs)),[runLogs]);
 const current=profiles[active],skillKey=current?current.region+":"+current.name.toLowerCase():"";
 const currentSkills=skills[skillKey]||{},gear=useMemo(()=>current?.gear||[],[current]);
 const baseRec=current?.recommendations;\n const dungeonNames=baseRec?.rankings?.map(d=>d.name)||[];
 const characterRuns=runLogs.filter(r=>r.characterKey===skillKey);
 const farmRanking=rankFarmDungeons(baseRec?.rankings,characterRuns,goals);
 const rec=baseRec?{...baseRec,rankings:farmRanking.rankings,recommended:farmRanking.rankings[0]||baseRec.recommended}:null;
 const best=rec?.recommended;
 function saveRun(e){e.preventDefault();if(!runDungeon)return;const minutes=Math.max(1,Math.min(600,Number(runMinutes)||1));setRunLogs(old=>[{id:crypto.randomUUID(),characterKey:skillKey,dungeon:runDungeon,minutes,cloth:Math.max(0,Number(runCloth)||0),disenchantables:Math.max(0,Number(runDisenchantables)||0),createdAt:new Date().toISOString()},...old].slice(0,500));setMessage("Dungeon run saved. Recommendations recalculated from your recorded yields.");}
 async function scan(characterName=name,characterRegion=region){
  if(characterName.trim().split(/\s+/).length!==2){setMessage("Enter the character's first and last name.");return}
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({region:characterRegion,name:characterName.trim()})});
   const d=await r.json();if(!r.ok)throw new Error(d.detail||"Character lookup failed.");
   const profile={...d.character,id:crypto.randomUUID(),url:d.source_url,status:d.scan_status,scannedAt:new Date().toISOString(),gear:d.equipped_gear||[],professions:d.professions||[],apiStatus:d.api_status,model_data:d.model_data||null,armory_render_url:d.armory_render_url||null,recommendations:d.dungeon_recommendations||null};
   setProfiles(old=>[profile,...old.filter(p=>!(p.region===profile.region&&p.name?.toLowerCase()===profile.name.toLowerCase()))]);
   const iconIds=[...profile.gear.map(g=>g.id),...(profile.recommendations?.rankings?.[0]?.upgrades||[]).map(u=>u.item_id)].filter(Boolean);
   if(iconIds.length){
    fetch("/api/item-icons?ids="+encodeURIComponent([...new Set(iconIds)].join(",")))
     .then(r=>r.ok?r.json():null).then(payload=>{
      const icons=payload?.icons||{};
      setProfiles(old=>old.map(p=>{
       if(p.id!==profile.id)return p;
       const withIcon=item=>({...item,icon_url:icons[String(item.item_id)]||item.icon_url});
       const recommendations=p.recommendations?{
        ...p.recommendations,
        recommended:p.recommendations.recommended?{
         ...p.recommendations.recommended,
         best_upgrade:p.recommendations.recommended.best_upgrade?withIcon(p.recommendations.recommended.best_upgrade):null,
         upgrades:(p.recommendations.recommended.upgrades||[]).map(withIcon)
        }:null,
        rankings:(p.recommendations.rankings||[]).map(d=>({
         ...d,best_upgrade:d.best_upgrade?withIcon(d.best_upgrade):null,
         upgrades:(d.upgrades||[]).map(withIcon)
        }))
       }:p.recommendations;
       return {...p,gear:p.gear.map(g=>({...g,icon_url:icons[String(g.id)]||g.icon_url})),recommendations};
      }));
     }).catch(()=>{});
   }
   setActive(0);setName("");setMessage("Character synced successfully.");
   if(profile.professions.length){const seed={};profile.professions.forEach(p=>seed[p.name]=Number(p.skill)||0);const k=profile.region+":"+profile.name.toLowerCase();setSkills(old=>({...old,[k]:{...seed,...(old[k]||{})}}))}
  }catch(e){setMessage(e.message||"Could not find that character.")}finally{setBusy(false)}
 }
 function setSkill(prof,value){const n=Math.max(0,Math.min(300,Number(value)||0));setSkills(old=>({...old,[skillKey]:{...(old[skillKey]||{}),[prof]:n}}))}
 function toggleGoal(key){setGoals(old=>({...old,[key]:!old[key]}));if(key==="mustGrantXp"&&!goals.mustGrantXp&&!Object.keys(xpMobLevels).length){setXpLoading(true);loadForeverDungeonXp(dungeonNames).then(setXpMobLevels).catch(e=>setMessage(e.message)).finally(()=>setXpLoading(false));}}
 const visibleSkills=showAllSkills?NAMES:["Tailoring","Enchanting"];
 return <main className="app-shell">
  <header className="topbar">
   <a className="brand" href="#"><span className="brand-mark">F</span><span><b>FOREVER</b><small>DUNGEON ADVISOR</small></span></a>
   <div className="top-actions">{profiles.length>0?<select aria-label="Saved characters" value={active} onChange={e=>setActive(Number(e.target.value))}>{profiles.map((p,i)=><option key={p.id||i} value={i}>{p.name} · {p.class} {p.level}</option>)}</select>:<span className="top-caption">WOW FOREVER · CHARACTER PLANNER</span>}</div>
  </header>
  <section className="search-hero">
   <div><div className="kicker">YOUR NEXT RUN, OPTIMIZED</div><h1>Make every dungeon<br/><em>run count.</em></h1><p>Gear upgrades, profession materials, and smarter farming in one place.</p></div>
   <form className="search-card" onSubmit={e=>{e.preventDefault();scan()}}>
    <label htmlFor="character-name">CHARACTER</label>
    <div className="search-controls"><select aria-label="Region" value={region} onChange={e=>setRegion(e.target.value)}><option value="us">US</option><option value="eu">EU</option><option value="kr">KR</option><option value="tw">TW</option></select><input id="character-name" value={name} onChange={e=>setName(e.target.value)} placeholder="First name + surname" autoComplete="off"/><button disabled={busy}><Search size={16}/>{busy?"Syncing":"Analyze"}</button></div>
    <div className="search-foot"><span>Public Blizzard Armory profile</span><span>Saved locally on this device</span></div>
   </form>
  </section>
  {message&&<div className="notice" role="status">{message}</div>}
  {!current?<section className="welcome-panel"><div className="welcome-icon"><Compass size={25}/></div><h2>Start with your character</h2><p>Search your WoW Forever character to see equipped items, useful dungeon drops, and a farming plan shaped around your goals.</p></section>:<>
   <section className="character-strip">
    <div className="character-model"><CharacterModel modelData={current.model_data} armoryRenderUrl={current.armory_render_url} name={current.name}/></div>
    <div className="char-main"><div className="char-name">{current.name}</div><div className="char-sub">{current.race} {current.class} <span>·</span> Level {current.level} <span>·</span> {current.spec||"Specialization unavailable"}</div></div>
    <div className="character-actions"><button className="refresh-character" disabled={busy} onClick={()=>scan(current.name,String(current.region||region).toLowerCase())}>{busy?"Syncing…":"Refresh data"}</button><button className="native-export" title={canExportWmvCharacter(current.model_data)?"Download a native .chr file for WoW Model Viewer 1.1. The viewer runs separately and uses your installed Forever client.":"Refresh this character after the native model export update to retrieve exact customization IDs and all gear appearances."} disabled={!canExportWmvCharacter(current.model_data)} onClick={()=>{try{const filename=downloadWmvCharacter(current.model_data,current.name,current.class);setMessage(`Downloaded ${filename}. Open it in WoW Model Viewer 1.1 with the Forever client selected.`)}catch(error){setMessage(error?.message||"Could not export the character model.")}}}><Download size={13}/> Export .chr</button><a className="armory-link" href={current.url} target="_blank" rel="noreferrer">Armory <ExternalLink size={13}/></a></div>
   </section>
   <section className="goal-panel">
    <div className="section-heading"><div><div className="kicker">FARMING PREFERENCES</div><h2>What matters on your next run?</h2></div><span className="optional-tag">Optional goals</span></div>
    <div className="goal-options">
     <div className="goal-option active"><span className="goal-check">✓</span><Shield size={18}/><span><b>Gear upgrades</b><small>Always included</small></span></div>
     <button className={"goal-option "+(goals.tailoring?"active":"")} onClick={()=>toggleGoal("tailoring")}><span className="goal-check">{goals.tailoring?"✓":""}</span><Package size={18}/><span><b>Tailoring</b><small>Cloth & skill progress</small></span></button>
     <button className={"goal-option "+(goals.enchanting?"active":"")} onClick={()=>toggleGoal("enchanting")}><span className="goal-check">{goals.enchanting?"✓":""}</span><Sparkles size={18}/><span><b>Enchanting</b><small>Disenchantable loot</small></span></button>\n     <button className={"goal-option "+(goals.mustGrantXp?"active":"")} onClick={()=>toggleGoal("mustGrantXp")}><span className="goal-check">{goals.mustGrantXp?"✓":""}</span><Target size={18}/><span><b>Dungeons grant XP</b><small>{xpLoading?"Loading Forever NPCs…":"Most mobs must award XP"}</small></span></button>
    </div>
    {goals.mustGrantXp&&<p className="goal-note">{xpLoading?"Loading current WoW Forever creature levels…":`XP filter: more than half of recorded dungeon mobs must be above the gray-level cutoff. ${xpQualified.length} dungeons currently qualify; dungeons with fewer than five recorded NPCs are excluded.`}</p>}\n    {(goals.tailoring||goals.enchanting)&&<p className="goal-note">Selected profession goals now influence the ranking using your logged cloth and eligible disenchantable-item yields per hour. Record runs below; unverified global drop rates are never assumed.</p>}
    {(goals.tailoring||goals.enchanting)&&<div className="goal-skills">{["Tailoring","Enchanting"].filter(p=>goals[p.toLowerCase()]).map(p=><label key={p}>{p} skill<input type="number" min="0" max="300" value={Number(currentSkills[p]??current.professions?.find(x=>x.name===p)?.skill??0)} onChange={e=>setSkill(p,e.target.value)}/><span>/ 300</span></label>)}</div>}
   </section>
   <section className="run-log-panel">
    <div className="run-log-heading"><div><div className="kicker">PERSONAL FARM DATA</div><h3>Log a dungeon run</h3><p>Record your actual clear time and yields. These measurements improve recommendations for this character only.</p></div><span className="run-count">{characterRuns.length} runs saved</span></div>
    <form className="run-log-form" onSubmit={saveRun}>
     <label>Dungeon<select required value={runDungeon} onChange={e=>setRunDungeon(e.target.value)}><option value="">Choose dungeon</option>{(rec?.rankings||[]).map(d=><option key={d.name} value={d.name}>{d.name}</option>)}</select></label>
     <label>Minutes<input type="number" min="1" max="600" value={runMinutes} onChange={e=>setRunMinutes(e.target.value)} required/></label>
     <label>Cloth relevant to current skill<input type="number" min="0" value={runCloth} onChange={e=>setRunCloth(e.target.value)}/></label>
     <label>Items eligible at current Enchanting skill<input type="number" min="0" value={runDisenchantables} onChange={e=>setRunDisenchantables(e.target.value)}/></label>
     <button type="submit" disabled={!rec?.rankings?.length}>Save run</button>
    </form>
    <p className="run-log-foot">Only count cloth useful at your current Tailoring skill and items eligible for disenchanting at your current Enchanting skill. These are yield proxies, not guaranteed skill-ups. Log comparable full runs for the fairest comparison. Data is stored in this browser.</p>
    {farmRanking.measured&&<p className="run-log-foot">Ranking is now based on your recorded runs and the goals selected above. Dungeons without recorded runs are excluded until you log them.</p>}
    {farmRanking.missingGoals.length>0&&<p className="run-log-foot">No positive {farmRanking.missingGoals.join(" / ")} yields recorded yet; that goal will contribute zero until measured.</p>}
   </section>
   <section className="recommendation-layout">
    <div className="primary-column">
     <div className="section-heading recommendation-heading"><div><div className="kicker">YOUR BEST MATCH</div><h2>Where to run next</h2></div><span className="live-pill"><i/> Character analysis</span></div>
     {best&&(["ready","partial_data"].includes(rec.status)||farmRanking.measured)?<article className="best-card">
      <div className="best-card-top"><span className="recommend-label"><Target size={14}/> TOP DUNGEON</span><span className="level-pill">Level {best.min_level}–{best.max_level}</span></div>
      <h3>{best.name}</h3><p className="best-summary">{best.upgrade_slots} potential gear slot upgrades for {current.name}. {best.best_upgrade?.name?"Best target: "+best.best_upgrade.name+".":""} {best.sampleCount?`Based on ${best.sampleCount} logged run(s), averaging ${best.avgMinutes.toFixed(1)} minutes.`:"No personal run data yet; showing the gear-first baseline."}</p>
      <div className="best-stats"><div><b>{best.upgrade_slots}</b><span>Upgrade slots</span></div><div><b>{best.sampleCount?best.avgMinutes.toFixed(0)+"m":"—"}</b><span>Avg clear time</span></div><div><b>{goals.tailoring&&best.sampleCount?best.clothPerHour.toFixed(1):goals.enchanting&&best.sampleCount?best.disenchantablesPerHour.toFixed(1):rec.rankings?.length||1}</b><span>{goals.tailoring&&best.sampleCount?"Relevant cloth/hr":goals.enchanting&&best.sampleCount?"Eligible items/hr":"Dungeons compared"}</span></div></div>
      <div className="loot-heading"><span>UPGRADES TO TARGET</span><small>Item stats compared with your gear</small></div>
      <div className="loot-list">{(best.upgrades||[]).map(u=><a className="loot-row" href={u.item_url} target="_blank" rel="noreferrer" key={u.item_id+"-"+u.slot}>
       <ItemIcon src={u.icon_url} name={u.name}/><span className="loot-main"><b>{u.name}</b><small>{u.slot} <span>·</span> {u.boss}</small><StatLine stats={u.stats}/></span><span className="loot-extra"><b>{u.item_level?"iLvl "+u.item_level:""}</b><small>{u.drop_chance?u.drop_chance.toFixed(1)+"% drop":"Drop rate n/a"}</small><ExternalLink size={13}/></span>
      </a>)}</div>
      <div className="best-card-foot"><span>{best.sampleCount?"Measured personal yield rates · proxies, not skill-up guarantees":"Estimated stat-weighted gear value per run"}</span><a href={best.source_url} target="_blank" rel="noreferrer">Loot source <ExternalLink size={12}/></a></div>
     </article>:<div className="empty-card"><h3>{rec?.status==="no_upgrades_found"?"No useful upgrades found":goals.mustGrantXp?"No dungeons meet the XP filter":"Dungeon analysis unavailable"}</h3><p>{goals.mustGrantXp&&xpQualified.length===0?"No dungeons have sufficient Forever NPC level records to confirm that most mobs award XP at your current level.":rec?.message||"Run a fresh character analysis to calculate dungeon recommendations."}</p></div>}
     {rec?.rankings?.length>1&&<div className="alternatives"><div className="subhead">Other dungeons worth considering</div>{rec.rankings.slice(1,5).map((d,i)=><div className="alternative-row" key={d.name}><span className="rank-number">0{i+2}</span><div><b>{d.name}</b><small>{d.upgrade_slots} upgrade slots · {d.sampleCount?`${d.avgMinutes.toFixed(0)} min avg · ${d.clothPerHour?.toFixed(1)} cloth/hr · ${d.disenchantablesPerHour?.toFixed(1)} DE items/hr`:`best drop: ${d.best_upgrade?.name}`}</small></div><span className="alt-level">Lv {d.min_level}–{d.max_level}</span></div>)}</div>}
    </div>
    <aside className="side-column">
     <div className="side-card"><div className="kicker">CHARACTER SNAPSHOT</div><h3>Equipped gear</h3><div className="gear-count">{gear.length} items synced from Armory</div>
      <div className="gear-grid">{gear.map((g,i)=><div className="gear-tile" key={g.id||i} title={g.name+" · "+g.slot}><ItemIcon src={g.icon_url} name={g.name}/><span className="gear-info"><b>{g.name}</b><small>{g.slot} · {g.item_level?"iLvl "+g.item_level:""}</small><StatLine stats={relevantStats(g.stats,current.class,current.spec)}/></span></div>)}</div>
     </div>
     <details className="side-card profession-details"><summary><span><BookOpen size={16}/> Profession tracker</span><ChevronDown size={16}/></summary><p className="side-muted">Optional skill tracking. Progress is saved per character in this browser.</p>
      <div className="profession-inputs">{visibleSkills.map(prof=>{const skill=Number(currentSkills[prof]??current.professions?.find(p=>p.name===prof)?.skill??0),info=rankInfo(skill);return <label key={prof}><span>{prof}<small>{info.rank} · {skill}/300</small></span><input type="number" min="0" max="300" value={skill} onChange={e=>setSkill(prof,e.target.value)}/></label>})}</div>
      <button className="text-button" onClick={()=>setShowAllSkills(x=>!x)}>{showAllSkills?"Show focused skills":"Show all professions"}</button>
      <div className="profession-guides">{(showAllSkills?NAMES:["Tailoring","Enchanting"]).map(p=><a key={p} href={SOURCES[p]} target="_blank" rel="noreferrer">{p} guide <ExternalLink size={11}/></a>)}</div>
     </details>
     <div className="side-card method-card"><div className="kicker">HOW IT WORKS</div><p>Recommendations compare usable dungeon loot against your equipped stats. Stat weights are estimates, not a combat simulator.</p><p>When you log runs, the ranking compares stat-weighted gear value per hour with your measured cloth and eligible disenchantable-item yields per hour. These are personal yield proxies, not guaranteed profession skill-ups.</p></div>
    </aside>
   </section>
  </>}
  <footer className="footer"><span>FOREVER DUNGEON ADVISOR</span><span>Profiles and preferences stay in this browser</span></footer>
 </main>
}

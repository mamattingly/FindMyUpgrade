import {useEffect,useMemo,useState} from "react";
import {Search,ChevronDown,ExternalLink,Shield,Compass,BookOpen,Sparkles,Target,Package,Download} from "lucide-react";
import CharacterModel from "./CharacterModel.jsx";
import {canExportWmvCharacter,downloadWmvCharacter} from "./wowModelViewerExport.js";
import {KEY,REGION_KEY,SKILL_KEY,GOALS_KEY,RUNS_KEY,NAMES,SOURCES,iconFallback,read,loadForeverDungeonXp,rankInfo,relevantStats,rankFarmDungeons,XP_CACHE_KEY,isDungeonXpEligible} from "./lib/advisor.js";
function ItemIcon({src,name,size="large"}){return <span className={"itemicon "+size}><img src={src||iconFallback} alt={name+" icon"} loading="lazy" onError={e=>{e.currentTarget.src=iconFallback}}/></span>}
function StatLine({stats}){if(!stats?.length)return null;return <div className="statline">{stats.map((s,i)=><span key={i}>{s}</span>)}</div>}
function ItemTooltip({item}){
 if(!item)return null;
 const stats=(item.stat_values||item.stats||[]).map(stat=>({name:stat.name||stat.stat||stat.type?.name||"Stat",value:Number(stat.value??stat.amount??0)})).filter(stat=>stat.name&&Number.isFinite(stat.value)&&stat.value!==0);
 return <div className="wow-item-tooltip" role="tooltip">
  <b className="tooltip-item-name">{item.name||"Unknown item"}</b>
  {item.item_level!=null&&<span className="tooltip-line">Item Level {item.item_level}</span>}
  {item.slot&&<span className="tooltip-line">{item.slot}</span>}
  {item.required_level!=null&&<span className="tooltip-line">Requires Level {item.required_level}</span>}
  {item.armor!=null&&Number(item.armor)>0&&<span className="tooltip-line">{item.armor} Armor</span>}
  {item.weapon_dps!=null&&Number(item.weapon_dps)>0&&<span className="tooltip-line">{Number(item.weapon_dps).toFixed(1)} damage per second</span>}
  {stats.length>0?<div className="tooltip-stats">{stats.map((stat,i)=><span key={i}>+{stat.value} {stat.name}</span>)}</div>:<span className="tooltip-muted">Detailed stats unavailable</span>}
  {item.boss&&<span className="tooltip-source">Dropped by: {item.boss}</span>}
  {item.drop_chance!=null&&<span className="tooltip-muted">Drop chance: {Number(item.drop_chance).toFixed(1)}%</span>}
 </div>;
}
const UPGRADE_STAT_OPTIONS=[["intellect","Intellect"],["spirit","Spirit"],["stamina","Stamina"],["agility","Agility"],["strength","Strength"],["spell_damage","Spell Damage / Power"],["spell_healing","Healing"],["spell_crit","Spell Critical Strike"],["crit","Critical Strike"],["hit","Hit"],["expertise","Expertise"],["attack_power","Attack Power"],["mp5","Mana per 5 sec"],["defense","Defense"],["dodge","Dodge"],["parry","Parry"],["block","Block"],["armor","Armor"]];
function statKey(name){const n=String(name||"").toLowerCase().replace(/[_-]/g," ");if(n.includes("intellect"))return "intellect";if(n.includes("spirit"))return "spirit";if(n.includes("stamina"))return "stamina";if(n.includes("agility"))return "agility";if(n.includes("strength"))return "strength";if(n.includes("healing"))return "spell_healing";if(n.includes("spell damage")||n.includes("spell power"))return "spell_damage";if(n.includes("spell critical")||n.includes("spell crit"))return "spell_crit";if(n.includes("mana")&&(n.includes("5")||n.includes("regen")))return "mp5";if(n.includes("attack power"))return "attack_power";if(n.includes("expertise"))return "expertise";if(n.includes("hit"))return "hit";if(n.includes("defense"))return "defense";if(n.includes("dodge"))return "dodge";if(n.includes("parry"))return "parry";if(n.includes("block"))return "block";if(n.includes("armor"))return "armor";if(n.includes("critical")||n==="crit")return "crit";return null;}
function StatComparison({upgrade,character,selectedStats}){
 const equipped=upgrade.equipped_items||[],before=new Map(),after=new Map();
 const add=(map,stat)=>{const key=String(stat.name||stat.stat||stat.type?.name||"");const value=Number(stat.value??stat.amount??0);if(key&&Number.isFinite(value))map.set(key,(map.get(key)||0)+value);};
 for(const item of equipped)for(const stat of item.stats||[])add(before,stat);
 for(const stat of upgrade.stat_values||[])add(after,stat);
 const names=[...new Set([...before.keys(),...after.keys()])];
 const rows=names.map(name=>({name,key:statKey(name),old:before.get(name)||0,next:after.get(name)||0,delta:(after.get(name)||0)-(before.get(name)||0)})).filter(x=>(x.old!==0||x.next!==0)&&(!x.key||selectedStats.length===0||selectedStats.includes(x.key))).filter(x=>relevantStats([{name:x.name,value:1}],character.class,character.spec).length>0);
 return <div className="upgrade-comparison"><div className="comparison-items"><div><small>CURRENTLY EQUIPPED</small><b>{equipped.length?equipped.map(x=>x.name||"Equipped item").join(" + "):"Empty slot"}</b></div><span className="comparison-arrow">→</span><div><small>POTENTIAL UPGRADE</small><b>{upgrade.name}</b></div></div>
 {rows.length?<div className="comparison-stats"><div className="comparison-head"><span>STAT</span><span>HAVE</span><span>UPGRADE</span><span>NET GAIN</span></div>{rows.map(row=><div className="comparison-stat" key={row.name}><b>{row.name}</b><span>{row.old>0?"+":""}{row.old}</span><span>{row.next>0?"+":""}{row.next}</span><strong className={row.delta>0?"stat-up":row.delta<0?"stat-down":"stat-even"}>{row.delta>0?"+":""}{row.delta}</strong></div>)}</div>:<p className="comparison-empty">No selected relevant stats are present on this comparison.</p>}
 <div className="comparison-score">Estimated specialization-weighted upgrade value: <b className={upgrade.gain>0?"stat-up":"stat-down"}>{upgrade.gain>0?"+":""}{Number(upgrade.gain||0).toFixed(2)}</b></div></div>;
}
export default function App(){
 const [profiles,setProfiles]=useState(()=>read(KEY,[]).filter(p=>p&&p.name&&p.class&&p.class!=="Unknown"&&Number.isFinite(p.level)));
 const [region,setRegion]=useState(()=>localStorage.getItem(REGION_KEY)||"us");
 const [name,setName]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[active,setActive]=useState(0);
 const [skills,setSkills]=useState(()=>read(SKILL_KEY,{}));
 const [goals,setGoals]=useState(()=>read(GOALS_KEY,{gear:true,tailoring:false,enchanting:false,mustGrantXp:false}));
 const [xpMobLevels,setXpMobLevels]=useState(()=>read(XP_CACHE_KEY,null)?.data||{});
 const [xpLoading,setXpLoading]=useState(false);
 const [runLogs,setRunLogs]=useState(()=>read(RUNS_KEY,[]));
 const [runDungeon,setRunDungeon]=useState("");
 const [runMinutes,setRunMinutes]=useState("30");
 const [runCloth,setRunCloth]=useState("0");
 const [runDisenchantables,setRunDisenchantables]=useState("0");
 const [showAllSkills,setShowAllSkills]=useState(false);
 const [upgradeStats,setUpgradeStats]=useState(()=>read("wow-forever-upgrade-stat-preferences",[]));
 const [hoverPreview,setHoverPreview]=useState(null);
 const [hoverTooltip,setHoverTooltip]=useState(null);
 useEffect(()=>localStorage.setItem(KEY,JSON.stringify(profiles)),[profiles]);
 useEffect(()=>localStorage.setItem(REGION_KEY,region),[region]);
 useEffect(()=>localStorage.setItem(SKILL_KEY,JSON.stringify(skills)),[skills]);
 useEffect(()=>localStorage.setItem(GOALS_KEY,JSON.stringify(goals)),[goals]);
 useEffect(()=>localStorage.setItem(RUNS_KEY,JSON.stringify(runLogs)),[runLogs]);
 useEffect(()=>localStorage.setItem("wow-forever-upgrade-stat-preferences",JSON.stringify(upgradeStats)),[upgradeStats]);
 const current=profiles[active],skillKey=current?current.region+":"+current.name.toLowerCase():"";
 const currentSkills=skills[skillKey]||{},gear=useMemo(()=>current?.gear||[],[current]);
 const baseRec=current?.recommendations;
 const dungeonNames=baseRec?.rankings?.map(d=>d.name)||[];
 const xpQualified=goals.mustGrantXp?dungeonNames.filter(dungeon=>isDungeonXpEligible(xpMobLevels[dungeon],current?.level)):dungeonNames;
 const eligibleRankings=goals.mustGrantXp?(baseRec?.rankings||[]).filter(d=>xpQualified.includes(d.name)):baseRec?.rankings;
 const characterRuns=runLogs.filter(r=>r.characterKey===skillKey);
 const farmRanking=rankFarmDungeons(eligibleRankings,characterRuns,goals);
 const rec=baseRec?{...baseRec,rankings:farmRanking.rankings,recommended:farmRanking.rankings[0]||null}:null;
 const best=rec?.recommended;
 async function previewUpgrade(item){
  setHoverPreview({...item,loading:true});
  try{
   const response=await fetch("/api/item-appearance/"+encodeURIComponent(item.item_id));
   const appearance=response.ok?await response.json():null;
   setHoverPreview(current=>current?.item_id===item.item_id?appearance?.has_appearance?{...item,...appearance}:null:current);
  }catch{setHoverPreview(current=>current?.item_id===item.item_id?null:current)}
 }
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
         upgrades:(d.upgrades||[]).map(withIcon),all_upgrades:(d.all_upgrades||[]).map(withIcon)
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
 return <main className="app-shell"><style>{`.upgrade-stat-filter{margin:12px 0;padding:12px;border:1px solid var(--line,#303744);border-radius:10px;background:rgba(255,255,255,.025)}.upgrade-filter-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px}.upgrade-filter-heading button{background:none;border:0;color:var(--muted,#9aa4b2);font-size:10px;cursor:pointer}.upgrade-stat-filter p{font-size:10px;color:var(--muted,#9aa4b2);margin:6px 0 10px}.upgrade-stat-options{display:flex;flex-wrap:wrap;gap:8px 14px}.upgrade-stat-options label{display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text,#d8deea);cursor:pointer}.upgrade-stat-options input{accent-color:#65d6a3}.upgrade-results-count{font-size:10px;color:var(--muted,#9aa4b2);margin:8px 0}`}</style><style>{`
.upgrade-comparison{margin-top:10px;padding:10px 12px;border:1px solid var(--line,#303744);border-radius:10px;background:rgba(255,255,255,.025);min-width:0}
.comparison-items{display:flex;align-items:center;gap:10px;margin-bottom:9px}
.comparison-items>div{display:grid;gap:3px;min-width:0;flex:1}
.comparison-items small,.comparison-head{font-size:9px;letter-spacing:.09em;color:var(--muted,#8c96a6);font-weight:700}
.comparison-items b{font-size:11px;line-height:1.35;overflow-wrap:anywhere}
.comparison-arrow{color:var(--muted,#8c96a6)}
.comparison-stats{display:grid;gap:4px}
.comparison-head,.comparison-stat{display:grid;grid-template-columns:minmax(0,1.5fr) repeat(3,minmax(42px,.7fr));gap:7px;align-items:center}
.comparison-stat{font-size:11px;padding:4px 0;border-top:1px solid rgba(255,255,255,.06)}
.comparison-stat b{font-weight:600}
.comparison-stat span,.comparison-stat strong{text-align:right;font-variant-numeric:tabular-nums}
.stat-up{color:#65d6a3}.stat-down{color:#f08b8b}.stat-even{color:var(--muted,#8c96a6)}
.comparison-score{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08);font-size:10px;color:var(--muted,#9aa4b2)}
.comparison-empty{font-size:10px;color:var(--muted,#9aa4b2);margin:6px 0}
.loot-row{position:relative}
.wow-item-tooltip{position:absolute;z-index:30;left:54px;top:8px;width:min(290px,calc(100vw - 90px));padding:12px 14px;border:1px solid #7b6b48;border-radius:7px;background:linear-gradient(145deg,#171b24 0%,#0d1118 100%);box-shadow:0 12px 34px rgba(0,0,0,.62);color:#f1e8d0;text-align:left;pointer-events:none;display:grid;gap:4px;font-size:12px;font-weight:400}
.tooltip-item-name{font-size:14px;color:#f3c969;line-height:1.3;margin-bottom:2px}
.tooltip-line{color:#d8dce5}
.tooltip-stats{display:grid;gap:3px;margin:5px 0;color:#1eff00}
.tooltip-source{color:#f0d9a0;margin-top:4px}
.tooltip-muted{color:#aeb6c4;font-size:11px}
@media(max-width:640px){.wow-item-tooltip{left:0;top:calc(100% + 5px);width:min(290px,calc(100vw - 48px))}}

`}</style>
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
    <div className="character-model"><CharacterModel modelData={current.model_data} armoryRenderUrl={current.armory_render_url} name={current.name} previewItem={hoverPreview}/></div>
    <div className="char-main"><div className="char-name">{current.name}</div><div className="char-sub">{current.race} {current.class} <span>·</span> Level {current.level} <span>·</span> {current.spec||"Specialization unavailable"}</div></div>
    <div className="character-actions"><button className="refresh-character" disabled={busy} onClick={()=>scan(current.name,String(current.region||region).toLowerCase())}>{busy?"Syncing…":"Refresh data"}</button><button className="native-export" title={canExportWmvCharacter(current.model_data)?"Download a native .chr file for WoW Model Viewer 1.1. The viewer runs separately and uses your installed Forever client.":"Refresh this character after the native model export update to retrieve exact customization IDs and all gear appearances."} disabled={!canExportWmvCharacter(current.model_data)} onClick={()=>{try{const filename=downloadWmvCharacter(current.model_data,current.name,current.class);setMessage(`Downloaded ${filename}. Open it in WoW Model Viewer 1.1 with the Forever client selected.`)}catch(error){setMessage(error?.message||"Could not export the character model.")}}}><Download size={13}/> Export .chr</button><a className="armory-link" href={current.url} target="_blank" rel="noreferrer">Armory <ExternalLink size={13}/></a></div>
   </section>
   <section className="goal-panel">
    <div className="section-heading"><div><div className="kicker">FARMING PREFERENCES</div><h2>What matters on your next run?</h2></div><span className="optional-tag">Optional goals</span></div>
    <div className="goal-options">
     <div className="goal-option active"><span className="goal-check">✓</span><Shield size={18}/><span><b>Gear upgrades</b><small>Always included</small></span></div>
     <button className={"goal-option "+(goals.tailoring?"active":"")} onClick={()=>toggleGoal("tailoring")}><span className="goal-check">{goals.tailoring?"✓":""}</span><Package size={18}/><span><b>Tailoring</b><small>Cloth & skill progress</small></span></button>
     <button className={"goal-option "+(goals.enchanting?"active":"")} onClick={()=>toggleGoal("enchanting")}><span className="goal-check">{goals.enchanting?"✓":""}</span><Sparkles size={18}/><span><b>Enchanting</b><small>Disenchantable loot</small></span></button>
     <button className={"goal-option "+(goals.mustGrantXp?"active":"")} onClick={()=>toggleGoal("mustGrantXp")}><span className="goal-check">{goals.mustGrantXp?"✓":""}</span><Target size={18}/><span><b>Dungeons grant XP</b><small>{xpLoading?"Loading Forever NPCs…":"Most mobs must award XP"}</small></span></button>
    </div>
    {goals.mustGrantXp&&<p className="goal-note">{xpLoading?"Loading current WoW Forever creature levels…":`XP filter: more than half of recorded dungeon mobs must be above the gray-level cutoff. ${xpQualified.length} dungeons currently qualify; dungeons with fewer than five recorded NPCs are excluded.`}</p>}
    {(goals.tailoring||goals.enchanting)&&<p className="goal-note">Selected profession goals now influence the ranking using your logged cloth and eligible disenchantable-item yields per hour. Record runs below; unverified global drop rates are never assumed.</p>}
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
      <div className="loot-heading"><span>UPGRADES TO TARGET</span><small>Net stat changes versus the item replaced</small></div>
      <div className="upgrade-stat-filter"><div className="upgrade-filter-heading"><b>Search for upgrades with these stats</b><button type="button" onClick={()=>setUpgradeStats([])}>Clear filters</button></div><p>Select one or more stats. Matching items have at least one selected stat. Leave all unchecked to show every specialization-relevant upgrade.</p><div className="upgrade-stat-options">{UPGRADE_STAT_OPTIONS.filter(([key,label])=>relevantStats([{name:label,value:1}],current.class,current.spec).length>0).map(([key,label])=><label key={key}><input type="checkbox" checked={upgradeStats.includes(key)} onChange={e=>setUpgradeStats(old=>e.target.checked?[...old,key]:old.filter(x=>x!==key))}/>{label}</label>)}</div></div>
      {(()=>{const pool=best.all_upgrades||best.upgrades||[];const matches=upgradeStats.length?pool.filter(u=>(u.stat_values||[]).some(s=>upgradeStats.includes(statKey(s.name||s.stat||s.type?.name)))):pool;return <><div className="upgrade-results-count">Showing {Math.min(matches.length,20)} of {matches.length} matching potential upgrades</div><div className="loot-list">{matches.slice(0,20).map(u=><a className="loot-row" href={u.item_url} target="_blank" rel="noreferrer" key={u.item_id+"-"+u.slot} onMouseEnter={()=>{setHoverTooltip(u);previewUpgrade(u)}} onMouseLeave={()=>{setHoverTooltip(null);setHoverPreview(null)}} onFocus={()=>{setHoverTooltip(u);previewUpgrade(u)}} onBlur={()=>{setHoverTooltip(null);setHoverPreview(null)}}><ItemTooltip item={hoverTooltip?.item_id===u.item_id?hoverTooltip:null}/><ItemIcon src={u.icon_url} name={u.name}/><span className="loot-main"><b>{u.name}</b><small>{u.slot} <span>·</span> {u.boss}</small><StatLine stats={u.stats}/><StatComparison upgrade={u} character={current} selectedStats={upgradeStats}/></span><span className="loot-extra"><b>{u.item_level?"iLvl "+u.item_level:""}</b><small>{u.drop_chance?u.drop_chance.toFixed(1)+"% drop":"Drop rate n/a"}</small><ExternalLink size={13}/></span></a>)}</div></>})()}
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

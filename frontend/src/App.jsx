import {useEffect,useMemo,useState} from "react";
import {Search,ChevronDown,ExternalLink,Shield,Compass,BookOpen,Sparkles,Target,Package} from "lucide-react";
import CharacterModel from "./CharacterModel.jsx";
const KEY="wow-forever-advisor-profiles", REGION_KEY="wow-forever-advisor-region", SKILL_KEY="wow-forever-profession-skills";
const GOALS_KEY="wow-forever-farming-goals";
const NAMES=["Alchemy","Blacksmithing","Enchanting","Engineering","Herbalism","Leatherworking","Mining","Skinning","Tailoring","Cooking","First Aid","Fishing"];
const SOURCES={Alchemy:"https://www.60.tools/guides/alchemy-leveling-guide",Blacksmithing:"https://www.60.tools/guides/blacksmithing-leveling-guide",Enchanting:"https://www.60.tools/guides/enchanting-leveling-guide",Engineering:"https://www.60.tools/guides/engineering-leveling-guide",Herbalism:"https://www.60.tools/guides/herbalism-leveling-guide",Leatherworking:"https://www.60.tools/guides/leatherworking-leveling-guide",Mining:"https://www.60.tools/guides/mining-leveling-guide",Skinning:"https://www.60.tools/guides/skinning-leveling-guide",Tailoring:"https://www.60.tools/guides/tailoring-leveling-guide",Cooking:"https://www.60.tools/guides/cooking-leveling-guide","First Aid":"https://www.60.tools/guides/first-aid-leveling-guide",Fishing:"https://www.60.tools/guides/fishing-leveling-guide"};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}};
const iconFallback="https://wow.zamimg.com/images/wow/icons/large/inv_misc_questionmark.jpg";
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
function StatLine({stats}){if(!stats?.length)return null;return <div className="statline">{stats.map((s,i)=><span key={i}>{s}</span>)}</div>}
export default function App(){
 const [profiles,setProfiles]=useState(()=>read(KEY,[]).filter(p=>p&&p.name&&p.class&&p.class!=="Unknown"&&Number.isFinite(p.level)));
 const [region,setRegion]=useState(()=>localStorage.getItem(REGION_KEY)||"us");
 const [name,setName]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[active,setActive]=useState(0);
 const [skills,setSkills]=useState(()=>read(SKILL_KEY,{}));
 const [goals,setGoals]=useState(()=>read(GOALS_KEY,{gear:true,tailoring:false,enchanting:false}));
 const [showAllSkills,setShowAllSkills]=useState(false);
 useEffect(()=>localStorage.setItem(KEY,JSON.stringify(profiles)),[profiles]);
 useEffect(()=>localStorage.setItem(REGION_KEY,region),[region]);
 useEffect(()=>localStorage.setItem(SKILL_KEY,JSON.stringify(skills)),[skills]);
 useEffect(()=>localStorage.setItem(GOALS_KEY,JSON.stringify(goals)),[goals]);
 const current=profiles[active],skillKey=current?current.region+":"+current.name.toLowerCase():"";
 const currentSkills=skills[skillKey]||{},gear=useMemo(()=>current?.gear||[],[current]);
 const rec=current?.recommendations,best=rec?.recommended;
 async function scan(){
  if(name.trim().split(/\s+/).length!==2){setMessage("Enter the character's first and last name.");return}
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({region,name:name.trim()})});
   const d=await r.json();if(!r.ok)throw new Error(d.detail||"Character lookup failed.");
   const profile={...d.character,id:crypto.randomUUID(),url:d.source_url,status:d.scan_status,scannedAt:new Date().toISOString(),gear:d.equipped_gear||[],professions:d.professions||[],apiStatus:d.api_status,recommendations:d.dungeon_recommendations||null};
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
 function toggleGoal(key){setGoals(old=>({...old,[key]:!old[key]}))}
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
    <div className="character-model"><CharacterModel race={current.race} className={current.class} spec={current.spec}/></div>
    <div className="char-main"><div className="char-name">{current.name}</div><div className="char-sub">{current.race} {current.class} <span>·</span> Level {current.level} <span>·</span> {current.spec||"Specialization unavailable"}</div></div>
    <a className="armory-link" href={current.url} target="_blank" rel="noreferrer">Armory <ExternalLink size={13}/></a>
   </section>
   <section className="goal-panel">
    <div className="section-heading"><div><div className="kicker">FARMING PREFERENCES</div><h2>What matters on your next run?</h2></div><span className="optional-tag">Optional goals</span></div>
    <div className="goal-options">
     <div className="goal-option active"><span className="goal-check">✓</span><Shield size={18}/><span><b>Gear upgrades</b><small>Always included</small></span></div>
     <button className={"goal-option "+(goals.tailoring?"active":"")} onClick={()=>toggleGoal("tailoring")}><span className="goal-check">{goals.tailoring?"✓":""}</span><Package size={18}/><span><b>Tailoring</b><small>Cloth & skill progress</small></span></button>
     <button className={"goal-option "+(goals.enchanting?"active":"")} onClick={()=>toggleGoal("enchanting")}><span className="goal-check">{goals.enchanting?"✓":""}</span><Sparkles size={18}/><span><b>Enchanting</b><small>Disenchantable loot</small></span></button>
    </div>
    {(goals.tailoring||goals.enchanting)&&<p className="goal-note">Profession skills are saved with this character. Profession material values are being added after drop-source validation; they do not affect the current dungeon ranking yet.</p>}
    {(goals.tailoring||goals.enchanting)&&<div className="goal-skills">{["Tailoring","Enchanting"].filter(p=>goals[p.toLowerCase()]).map(p=><label key={p}>{p} skill<input type="number" min="0" max="300" value={Number(currentSkills[p]??current.professions?.find(x=>x.name===p)?.skill??0)} onChange={e=>setSkill(p,e.target.value)}/><span>/ 300</span></label>)}</div>}
   </section>
   <section className="recommendation-layout">
    <div className="primary-column">
     <div className="section-heading recommendation-heading"><div><div className="kicker">YOUR BEST MATCH</div><h2>Where to run next</h2></div><span className="live-pill"><i/> Character analysis</span></div>
     {best&&["ready","partial_data"].includes(rec.status)?<article className="best-card">
      <div className="best-card-top"><span className="recommend-label"><Target size={14}/> TOP DUNGEON</span><span className="level-pill">Level {best.min_level}–{best.max_level}</span></div>
      <h3>{best.name}</h3><p className="best-summary">{best.upgrade_slots} potential gear slot upgrades for {current.name}. {best.best_upgrade?.name?"Best target: "+best.best_upgrade.name+".":""}</p>
      <div className="best-stats"><div><b>{best.upgrade_slots}</b><span>Upgrade slots</span></div><div><b>{best.best_upgrade?.drop_chance?best.best_upgrade.drop_chance.toFixed(1)+"%":"—"}</b><span>Best item drop chance</span></div><div><b>{rec.rankings?.length||1}</b><span>Dungeons compared</span></div></div>
      <div className="loot-heading"><span>UPGRADES TO TARGET</span><small>Item stats compared with your gear</small></div>
      <div className="loot-list">{(best.upgrades||[]).map(u=><a className="loot-row" href={u.item_url} target="_blank" rel="noreferrer" key={u.item_id+"-"+u.slot}>
       <ItemIcon src={u.icon_url} name={u.name}/><span className="loot-main"><b>{u.name}</b><small>{u.slot} <span>·</span> {u.boss}</small><StatLine stats={u.stats}/></span><span className="loot-extra"><b>{u.item_level?"iLvl "+u.item_level:""}</b><small>{u.drop_chance?u.drop_chance.toFixed(1)+"% drop":"Drop rate n/a"}</small><ExternalLink size={13}/></span>
      </a>)}</div>
      <div className="best-card-foot"><span>Estimated stat-weighted value per run · not a run-time estimate</span><a href={best.source_url} target="_blank" rel="noreferrer">Loot source <ExternalLink size={12}/></a></div>
     </article>:<div className="empty-card"><h3>{rec?.status==="no_upgrades_found"?"No useful upgrades found":"Dungeon analysis unavailable"}</h3><p>{rec?.message||"Run a fresh character analysis to calculate dungeon recommendations."}</p></div>}
     {rec?.rankings?.length>1&&<div className="alternatives"><div className="subhead">Other dungeons worth considering</div>{rec.rankings.slice(1,5).map((d,i)=><div className="alternative-row" key={d.name}><span className="rank-number">0{i+2}</span><div><b>{d.name}</b><small>{d.upgrade_slots} upgrade slots · best drop: {d.best_upgrade?.name}</small></div><span className="alt-level">Lv {d.min_level}–{d.max_level}</span></div>)}</div>}
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
     <div className="side-card method-card"><div className="kicker">HOW IT WORKS</div><p>Recommendations compare usable dungeon loot against your equipped stats. Stat weights are estimates, not a combat simulator.</p><p>Dungeon clear times and complete profession-material drop tables are not yet verified, so the current score does not claim to maximize upgrades or profession skill-ups per hour.</p></div>
    </aside>
   </section>
  </>}
  <footer className="footer"><span>FOREVER DUNGEON ADVISOR</span><span>Profiles and preferences stay in this browser</span></footer>
 </main>
}

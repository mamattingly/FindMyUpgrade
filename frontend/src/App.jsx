import {useEffect,useMemo,useState} from "react";
const KEY="wow-forever-advisor-profiles", REGION_KEY="wow-forever-advisor-region", SKILL_KEY="wow-forever-profession-skills";
const NAMES=["Alchemy","Blacksmithing","Enchanting","Engineering","Herbalism","Leatherworking","Mining","Skinning","Tailoring","Cooking","First Aid","Fishing"];
const TYPES={Alchemy:"Crafting",Blacksmithing:"Crafting",Enchanting:"Crafting",Engineering:"Crafting",Herbalism:"Gathering",Leatherworking:"Crafting",Mining:"Gathering",Skinning:"Gathering",Tailoring:"Crafting",Cooking:"Secondary","First Aid":"Secondary",Fishing:"Secondary"};
const SOURCES={Alchemy:"https://www.60.tools/guides/professions",Blacksmithing:"https://www.60.tools/guides/professions",Enchanting:"https://www.60.tools/guides/professions",Engineering:"https://www.60.tools/guides/professions",Herbalism:"https://foreverdb.net/guide/professions",Leatherworking:"https://www.60.tools/guides/professions",Mining:"https://foreverdb.net/guide/professions",Skinning:"https://foreverdb.net/guide/professions",Tailoring:"https://www.60.tools/guides/professions",Cooking:"https://www.60.tools/guides/professions","First Aid":"https://www.60.tools/guides/professions",Fishing:"https://foreverdb.net/guide/professions"};
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}};
const validProfiles=()=>read(KEY,[]).filter(p=>p&&p.name&&p.class&&p.class!=="Unknown"&&Number.isFinite(p.level));
function rankInfo(skill){if(skill>=300)return {rank:"Artisan",next:null,cap:300};if(skill>=200)return {rank:"Expert",next:300,cap:300};if(skill>=125)return {rank:"Expert",next:200,cap:225,train:true};if(skill>=75)return {rank:"Journeyman",next:125,cap:150,train:true};if(skill>=50)return {rank:"Journeyman",next:75,cap:150};return {rank:"Apprentice",next:50,cap:75};}
export default function App(){
 const [profiles,setProfiles]=useState(validProfiles);
 const [region,setRegion]=useState(()=>localStorage.getItem(REGION_KEY)||"us");
 const [name,setName]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[active,setActive]=useState(0);
 const [skills,setSkills]=useState(()=>read(SKILL_KEY,{}));
 const [professionFilter,setProfessionFilter]=useState("All");
 useEffect(()=>localStorage.setItem(KEY,JSON.stringify(profiles)),[profiles]);
 useEffect(()=>localStorage.setItem(REGION_KEY,region),[region]);
 useEffect(()=>localStorage.setItem(SKILL_KEY,JSON.stringify(skills)),[skills]);
 const current=profiles[active], skillKey=current?current.region+":"+current.name.toLowerCase():"";
 const currentSkills=skills[skillKey]||{};
 async function scan(){
  if(name.trim().split(/\s+/).length!==2){setMessage("Enter the character's first name and surname.");return}
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({region,name:name.trim()})});
   const d=await r.json();if(!r.ok)throw new Error(d.detail||"Character lookup failed.");
   const profile={...d.character,id:crypto.randomUUID(),url:d.source_url,status:d.scan_status,scannedAt:new Date().toISOString(),gear:d.equipped_gear||[],professions:d.professions||[],apiStatus:d.api_status};
   setProfiles(old=>[profile,...old.filter(p=>!(p.region===profile.region&&p.name?.toLowerCase()===profile.name.toLowerCase()))]);
   setActive(0);setName("");setMessage(d.message);
   if(profile.professions.length){const seed={};profile.professions.forEach(p=>seed[p.name]=Number(p.skill)||0);const k=profile.region+":"+profile.name.toLowerCase();setSkills(old=>({...old,[k]:{...seed,...(old[k]||{})}}))}
  }catch(e){setMessage(e.message||"Could not find that character.")}finally{setBusy(false)}
 }
 function setSkill(prof,value){const n=Math.max(0,Math.min(300,Number(value)||0));setSkills(old=>({...old,[skillKey]:{...(old[skillKey]||{}),[prof]:n}}))}
 const displayed=NAMES.filter(p=>professionFilter==="All"||TYPES[p]===professionFilter);
 const gear=useMemo(()=>current?.gear||[],[current]);
 return <main className="shell">
  <header><div className="logo">⚔</div><div><b>FOREVER</b><small>DUNGEON ADVISOR</small></div><span className="free">FREE BUILD</span></header>
  <section className="hero"><span className="eyebrow">LOOT SMARTER. RUN LESS.</span><h1>Find your next<br/><em>best upgrade.</em></h1><p>Analyze your character, plan dungeon farming, and keep every profession moving toward 300.</p>
   <div className="scan"><label>FIND YOUR WOW FOREVER CHARACTER</label><div className="scanrow">
    <select aria-label="Region" value={region} onChange={e=>setRegion(e.target.value)}><option value="us">United States</option><option value="eu">Europe</option><option value="kr">Korea</option><option value="tw">Taiwan</option></select>
    <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="First name + surname" autoComplete="off"/>
    <button disabled={busy} onClick={scan}>{busy?"SEARCHING…":"FIND MY CHARACTER"}</button>
   </div><small>Enter the exact two-part character name. Public profiles generally appear after level 10 and a logout.</small></div>
  </section>
  {message&&<div className="notice" role="status">{message}</div>}
  <section className="grid"><article className="panel"><span className="eyebrow">CHARACTER ROSTER</span><h2>Profiles</h2>{profiles.length===0?<p className="muted">No verified characters saved yet.</p>:profiles.map((p,i)=><button className={"profile "+(i===active?"selected":"")} onClick={()=>setActive(i)} key={p.id}><b>{p.name}</b><small>{p.region} · {p.class} · Level {p.level}</small></button>)}</article>
   <article className="panel"><span className="eyebrow">ACTIVE CHARACTER</span><h2>{current?.name||"Your character"}</h2>{current?<><div className="facts"><div><small>REGION</small><b>{current.region}</b></div><div><small>CLASS</small><b>{current.class}</b></div><div><small>LEVEL</small><b>{current.level}</b></div><div><small>FACTION</small><b>{current.faction||"—"}</b></div><div><small>RACE</small><b>{current.race||"—"}</b></div><div><small>SPEC</small><b>{current.spec||"Not exposed"}</b></div></div><p className="muted"><a href={current.url} target="_blank" rel="noreferrer">Open official Blizzard Armory profile ↗</a></p>
    <div className="gearhead"><b>Equipped gear</b><span>{gear.length} slots returned</span></div>{gear.length?<div className="gearlist">{gear.map((g,i)=><div className="gearrow" key={g.id||i}><span>{g.slot}</span><b>{g.name}</b><small>{g.item_level?("iLvl "+g.item_level):"—"}</small></div>)}</div>:<p className="muted">No equipped items returned yet. Configure Blizzard API credentials in Render to enable character profile endpoints.</p>}
   </>:<p className="muted">Enter your region and full character name to look up your public Armory profile.</p>}</article>
  </section>
  <section className="panel professions"><div className="sectiontop"><div><span className="eyebrow">PROFESSION PROGRESSION</span><h2>Level your professions</h2><p className="muted">Track each skill from 1–300, see the next training breakpoint, and open a WoW Forever-specific leveling reference. Progress is saved per character in this browser.</p></div><span className="skillcap">300 MAX SKILL</span></div>
   {!current?<div className="empty"><b>Select or scan a character first</b><p>Skill values are editable and saved locally for each character.</p></div>:<><div className="filterrow"><span className="muted">Show</span><select value={professionFilter} onChange={e=>setProfessionFilter(e.target.value)}><option>All</option><option>Crafting</option><option>Gathering</option><option>Secondary</option></select><span className="muted">Two primary professions + all three secondary skills</span></div><div className="professiongrid">{displayed.map(prof=>{const skill=Number(currentSkills[prof]??current.professions?.find(p=>p.name===prof)?.skill??0),info=rankInfo(skill);return <div className="professioncard" key={prof}><div className="profline"><div><b>{prof}</b><small>{TYPES[prof]}</small></div><strong>{skill}<small> / 300</small></strong></div><div className="progress"><i style={{width:(skill/300*100)+"%"}}/></div><div className="profmeta"><span>{info.rank}</span><span>{skill>=300?"MAXED":info.next?("Next: "+info.next+" skill"):"Train Journeyman at 50"}</span></div><label className="skillinput">CURRENT SKILL<input type="number" min="0" max="300" value={skill} onChange={e=>setSkill(prof,e.target.value)}/></label><a className="guide" href={SOURCES[prof]} target="_blank" rel="noreferrer">Open {prof} leveling guide ↗</a></div>})}</div><p className="ranknote">Rank caps: Apprentice 75 · Journeyman 150 · Expert 225 · Artisan 300. Train new ranks at skill 50, 125 and 200; character-level requirements may also apply.</p></>}
  </section>
  <section className="panel recommendations"><span className="eyebrow">FARMING INTELLIGENCE</span><h2>Dungeon recommendations</h2><div className="empty"><b>Awaiting verified gear and loot data</b><p>Dungeon rankings will appear only after equipped slots can be compared against sourced dungeon drops and reliable drop rates. No placeholder rankings or invented upgrades are shown.</p></div></section>
  <footer>WoW Forever Dungeon Advisor · Profiles and profession progress saved locally in this browser</footer>
 </main>
}
import {useEffect,useState} from "react";
const KEY="wow-forever-advisor-profiles";
const REGION_KEY="wow-forever-advisor-region";
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]").filter(p=>p&&p.name&&p.class&&p.class!=="Unknown"&&Number.isFinite(p.level))}catch{return []}};
export default function App(){
 const [profiles,setProfiles]=useState(read);
 const [region,setRegion]=useState(()=>localStorage.getItem(REGION_KEY)||"us");
 const [name,setName]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [active,setActive]=useState(0);
 useEffect(()=>localStorage.setItem(KEY,JSON.stringify(profiles)),[profiles]);
 useEffect(()=>localStorage.setItem(REGION_KEY,region),[region]);
 async function scan(){
  if(name.trim().split(/\s+/).length!==2){setMessage("Enter the character's first name and surname.");return}
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({region,name:name.trim()})});
   const d=await r.json();if(!r.ok)throw new Error(d.detail||"Character lookup failed.");
   const profile={...d.character,id:crypto.randomUUID(),url:d.source_url,status:d.scan_status,scannedAt:new Date().toISOString()};
   setProfiles(old=>[profile,...old.filter(p=>!(p.region===profile.region&&p.name?.toLowerCase()===profile.name.toLowerCase()))]);
   setActive(0);setName("");setMessage(d.message);
  }catch(e){setMessage(e.message||"Could not find that character.")}finally{setBusy(false)}
 }
 const current=profiles[active];
 return <main className="shell">
  <header><div className="logo">⚔</div><div><b>FOREVER</b><small>DUNGEON ADVISOR</small></div><span className="free">FREE BUILD</span></header>
  <section className="hero"><span className="eyebrow">LOOT SMARTER. RUN LESS.</span><h1>Find your next<br/><em>best upgrade.</em></h1><p>Analyze your character and plan dungeon farming around meaningful gear upgrades—not just item level.</p>
   <div className="scan"><label>FIND YOUR WOW FOREVER CHARACTER</label><div className="scanrow">
    <select aria-label="Region" value={region} onChange={e=>setRegion(e.target.value)}><option value="us">United States</option><option value="eu">Europe</option><option value="kr">Korea</option><option value="tw">Taiwan</option></select>
    <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="First name + surname" autoComplete="off"/>
    <button disabled={busy} onClick={scan}>{busy?"SEARCHING…":"FIND MY CHARACTER"}</button>
   </div><small>Enter the exact two-part character name. Region is remembered on this device. Public profiles generally appear after level 10 and a logout.</small></div>
  </section>
  {message&&<div className="notice" role="status">{message}</div>}
  <section className="grid"><article className="panel"><span className="eyebrow">CHARACTER ROSTER</span><h2>Profiles</h2>{profiles.length===0?<p className="muted">No verified characters saved yet.</p>:profiles.map((p,i)=><button className={"profile "+(i===active?"selected":"")} onClick={()=>setActive(i)} key={p.id}><b>{p.name}</b><small>{p.region} · {p.class} · Level {p.level}</small></button>)}</article>
   <article className="panel"><span className="eyebrow">ACTIVE CHARACTER</span><h2>{current?.name||"Your character"}</h2>{current?<><div className="facts"><div><small>REGION</small><b>{current.region}</b></div><div><small>CLASS</small><b>{current.class}</b></div><div><small>LEVEL</small><b>{current.level}</b></div><div><small>FACTION</small><b>{current.faction||"—"}</b></div><div><small>RACE</small><b>{current.race||"—"}</b></div><div><small>RULESET</small><b>{current.ruleset||"—"}</b></div></div><p className="muted"><a href={current.url} target="_blank" rel="noreferrer">Open official Blizzard Armory profile ↗</a></p></>:<p className="muted">Enter your region and full character name to look up your public Armory profile.</p>}<p className="muted">Character identity is verified against Blizzard's embedded profile. Equipped items and specialization are still being integrated; recommendations stay disabled until that data is verified.</p></article>
  </section>
  <section className="panel recommendations"><span className="eyebrow">FARMING INTELLIGENCE</span><h2>Dungeon recommendations</h2><div className="empty"><b>Awaiting verified gear and loot data</b><p>Dungeon rankings will not appear until equipped slots can be compared against sourced dungeon drops and drop rates. No placeholder rankings or invented upgrades are shown.</p></div></section>
  <footer>WoW Forever Dungeon Advisor · No paid API keys · Local browser profiles</footer>
 </main>
}

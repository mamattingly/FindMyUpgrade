import {useEffect,useState} from "react";
const KEY="wow-forever-advisor-profiles";
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||"[]")}catch{return []}};
export default function App(){
 const [profiles,setProfiles]=useState(read),[url,setUrl]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[active,setActive]=useState(0);
 useEffect(()=>localStorage.setItem(KEY,JSON.stringify(profiles)),[profiles]);
 async function scan(){
  if(!url.trim()){setMessage("Paste a ForeverBuilds character URL first.");return}
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:url.trim()})});
   const d=await r.json();if(!r.ok)throw new Error(d.detail||"Scan failed.");
   const profile={...d.character,id:crypto.randomUUID(),url:d.source_url,status:d.scan_status,scannedAt:new Date().toISOString()};
   setProfiles(old=>[profile,...old]);setActive(0);setMessage(d.message);
  }catch(e){setMessage(e.message||"Could not scan profile.")}finally{setBusy(false)}
 }
 const current=profiles[active];
 return <main className="shell">
  <header><div className="logo">⚔</div><div><b>FOREVER</b><small>DUNGEON ADVISOR</small></div><span className="free">FREE BUILD</span></header>
  <section className="hero"><span className="eyebrow">LOOT SMARTER. RUN LESS.</span><h1>Find your next<br/><em>best upgrade.</em></h1><p>Analyze your character and plan dungeon farming around meaningful gear upgrades—not just item level.</p>
   <div className="scan"><label>FOREVERBUILDS CHARACTER URL</label><div className="scanrow"><input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="https://www.foreverbuilds.io/..."/><button disabled={busy} onClick={scan}>{busy?"SCANNING…":"EXAMINE WEBSITE NOW"}</button></div><small>Manual scan only. Profiles are saved in this browser.</small></div>
  </section>
  {message&&<div className="notice">{message}</div>}
  <section className="grid"><article className="panel"><span className="eyebrow">CHARACTER ROSTER</span><h2>Profiles</h2>{profiles.length===0?<p className="muted">No characters scanned yet.</p>:profiles.map((p,i)=><button className={"profile "+(i===active?"selected":"")} onClick={()=>setActive(i)} key={p.id}><b>{p.name||"Unknown character"}</b><small>{p.class} · Level {p.level??"?"}</small></button>)}</article>
   <article className="panel"><span className="eyebrow">ACTIVE CHARACTER</span><h2>{current?.name||"Your character"}</h2>{current?<div className="facts"><div><small>CLASS</small><b>{current.class}</b></div><div><small>LEVEL</small><b>{current.level??"—"}</b></div><div><small>FACTION</small><b>{current.faction}</b></div><div><small>SPEC</small><b>{current.spec||"Unknown"}</b></div></div>:<p className="muted">Scan a ForeverBuilds profile to see its details here.</p>}<p className="muted">Gear extraction is not yet verified. The scanner will not invent missing equipped items.</p></article>
  </section>
  <section className="panel recommendations"><span className="eyebrow">FARMING INTELLIGENCE</span><h2>Dungeon recommendations</h2><div className="empty"><b>Awaiting verified character and loot data</b><p>Rankings will use useful slot upgrades, class/spec eligibility, sourced drop rates, boss coverage, and run time. Unknown drop rates remain unknown.</p></div></section>
  <footer>WoW Forever Dungeon Advisor · No paid API keys · Local browser profiles</footer>
 </main>
}

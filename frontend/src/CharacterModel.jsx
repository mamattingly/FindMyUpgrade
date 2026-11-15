import {useEffect,useMemo,useState} from "react";
import {buildArmoryProfileUrl} from "./armoryProfile.js";

export default function CharacterModel({
 modelData,
 armoryRenderUrl,
 name,
 region,
 ruleset,
 refreshKey
}){
 const profileUrl=useMemo(
  ()=>buildArmoryProfileUrl(name,region,ruleset),
  [name,region,ruleset]
 );
 const frameKey=profileUrl ? profileUrl+"?refresh="+encodeURIComponent(refreshKey||"") : "no-profile";
 const [loaded,setLoaded]=useState(false);
 const [failed,setFailed]=useState(false);

 useEffect(()=>{
  setLoaded(false);
  setFailed(false);
 },[frameKey]);

 const fallbackUrl=armoryRenderUrl
  ? (armoryRenderUrl.startsWith("http")?armoryRenderUrl:"https://"+armoryRenderUrl)
  : null;

 return <div className="character-model-canvas armory-embed-canvas">
  {profileUrl&&!failed&&<div className="armory-frame-viewport">
   <iframe
    key={frameKey}
    className="armory-frame"
    src={profileUrl+"#model3d"}
    title={name?name+" interactive 3D character preview":"Interactive 3D WoW character preview"}
    loading="eager"
    scrolling="no"
    allow="fullscreen"
    referrerPolicy="strict-origin-when-cross-origin"
    onLoad={()=>setLoaded(true)}
    onError={()=>setFailed(true)}
   />
  </div>}
  {(!profileUrl||failed)&&fallbackUrl&&<div className="armory-render-fallback">
   <img src={fallbackUrl} alt={name?name+" official character render":"Official character render"}/>
  </div>}
  {(!profileUrl||failed)&&!fallbackUrl&&<div className="model-fallback">
   <span>{name?.split(/\s+/).map(part=>part[0]).join("").slice(0,2)||"WoW"}</span>
   <small>3D preview unavailable</small>
  </div>}
  {profileUrl&&!loaded&&!failed&&<div className="model-status" role="status">Opening the Armory 3D model…</div>}
  {profileUrl&&loaded&&!failed&&<span className="model-hint">3D ARMORY MODEL · DRAG TO ROTATE</span>}
  {modelData?.items?.length>0&&profileUrl&&<span className="model-gear-count">{modelData.items.length} equipped appearances mapped</span>}
 </div>;
}

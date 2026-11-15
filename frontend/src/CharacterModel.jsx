import {useEffect,useId,useState} from "react";

const scriptLoads=new Map();

function loadScript(src){
 if(scriptLoads.has(src))return scriptLoads.get(src);
 const promise=new Promise((resolve,reject)=>{
  const existing=[...document.scripts].find(s=>s.src===src);
  if(existing){if(existing.dataset.loaded==="true"){resolve();return;}existing.addEventListener("load",resolve,{once:true});existing.addEventListener("error",()=>reject(new Error("Could not load the WoW model viewer script.")),{once:true});return;}
  const script=document.createElement("script");
  script.src=src;script.async=true;
  script.onload=()=>{script.dataset.loaded="true";resolve();};
  script.onerror=()=>{scriptLoads.delete(src);reject(new Error("Could not load the WoW model viewer script."));};
  document.head.appendChild(script);
 });
 scriptLoads.set(src,promise);
 return promise;
}

const FIELD_BY_OPTION={
 "Face":"face","Skin Color":"skin","Hair Style":"hairStyle","Hair Color":"hairColor",
 "Facial Hair":"facialStyle","Mustache":"facialStyle","Beard":"facialStyle",
 "Sideburns":"facialStyle","Ears":"ears","Fur Color":"furColor","Snout":"snout"
};

function getViewerCustomization(modelData,fullOptions){
 const values={};
 for(const entry of modelData.customizations||[]){
  const option=fullOptions?.Options?.find(x=>Number(x.Id)===Number(entry.option_id));
  if(!option)continue;
  const field=FIELD_BY_OPTION[option.Name];
  if(!field)continue;
  const choiceIndex=(option.Choices||[]).findIndex(x=>Number(x.Id)===Number(entry.choice_id));
  if(choiceIndex>=0)values[field]=choiceIndex;
 }
 return values;
}

export default function CharacterModel({modelData,armoryRenderUrl,name}){
 const id="wow-armory-model-"+useId().replace(/[^a-zA-Z0-9_-]/g,"");
 const [status,setStatus]=useState("loading");
 const [detail,setDetail]=useState("");
 const [loadedCount,setLoadedCount]=useState(0);
 useEffect(()=>{
  let disposed=false,viewer=null;
  const host=document.getElementById(id);
  if(!host)return;
  host.innerHTML="";
  async function boot(){
   if(!modelData||!Number(modelData.race)||!Number.isInteger(Number(modelData.gender))){
    setStatus("missing");setDetail("Refresh character data to retrieve the Armory appearance.");return;
   }
   if(!Array.isArray(modelData.items)||!modelData.items.length){
    setStatus("error");setDetail("The Armory profile did not provide usable equipped-item display data.");return;
   }
   setStatus("loading");setDetail("Loading the character's actual appearance and equipped gear…");
   try{
    window.CONTENT_PATH=window.location.origin+"/api/modelviewer/classic/";
    window.WOTLK_TO_RETAIL_DISPLAY_ID_API=undefined;
    const jqueryModule=await import("jquery");
    window.jQuery=window.$=jqueryModule.default;
    await loadScript(window.CONTENT_PATH+"viewer/viewer.min.js");
    const library=await import("wow-model-viewer");
    // The Classic model metadata uses its own customization and equipment tables.
    window.WOTLK_TO_RETAIL_DISPLAY_ID_API=undefined;
    const fullOptions=await library.findRaceGenderOptions(Number(modelData.race),Number(modelData.gender));
    const character={
     race:Number(modelData.race),
     gender:Number(modelData.gender),
     ...getViewerCustomization(modelData,fullOptions),
     items:modelData.items
    };
    viewer=await library.generateModels(1.45,"#"+id,character,"classic");
    if(disposed){viewer?.destroy?.();return;}
    setLoadedCount(modelData.items.length);
    setStatus("ready");setDetail("");
   }catch(error){
    if(disposed)return;
    setStatus("error");
    setDetail(error?.message||"The Classic 3D character model could not be loaded.");
   }
  }
  boot();
  return ()=>{disposed=true;try{viewer?.destroy?.();}catch{}host.innerHTML="";};
 },[id,modelData]);
 return <div className="character-model-canvas">
  <div id={id} className="wow-armory-viewer" aria-label={name?name+" 3D Armory character model":"3D Armory character model"}/>
  {status!=="ready"&&armoryRenderUrl&&<div className="armory-render-fallback"><img src={armoryRenderUrl.startsWith("http")?armoryRenderUrl:"https://"+armoryRenderUrl} alt={name?name+" official Armory character render":"Official Armory character render"}/></div>}
  {status!=="ready"&&<div className="model-status" role="status">{status==="loading"?"Loading Armory model…":detail}</div>}
  {status==="ready"&&<span className="model-hint">3D ARMORY MODEL · DRAG TO ROTATE</span>}
  {status==="ready"&&<span className="model-gear-count">{loadedCount} equipped appearances</span>}
 </div>;
}

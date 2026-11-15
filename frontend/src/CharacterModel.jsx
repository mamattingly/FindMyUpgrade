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
 "Sideburns":"facialStyle","Face Shape":"facialStyle","Eyebrow":"facialStyle","Eyebrows":"facialStyle",
 "Ears":"ears","Fur Color":"furColor","Snout":"snout",
 "Primary Color":"primaryColor","Secondary Color":"secondaryColor",
 "Secondary Color Strength":"secondaryColorStrength","Horn Color":"hornColor",
 "Horns":"horns","Body Size":"bodySize"
};

function getViewerCustomization(modelData){
 const values={skin:0,face:0,hairStyle:0,hairColor:0,facialStyle:0,ears:0,furColor:0,snout:0,
  primaryColor:0,secondaryColor:0,secondaryColorStrength:0,hornColor:0,horns:0,bodySize:0};
 for(const entry of modelData.customizations||[]){
  const field=FIELD_BY_OPTION[entry.option_name];
  const displayOrder=Number(entry.display_order);
  if(field&&Number.isInteger(displayOrder)&&displayOrder>=0)values[field]=displayOrder;
 }
 return values;
}

export default function CharacterModel({modelData,armoryRenderUrl,name}){
 const id="wow-armory-model-"+useId().replace(/[^a-zA-Z0-9_-]/g,"");
 const [status,setStatus]=useState("loading");
 const [detail,setDetail]=useState("");
 const [loadedCount,setLoadedCount]=useState(0);
 const [showFallback,setShowFallback]=useState(true);
 useEffect(()=>{
  let disposed=false,viewer=null,stabilityTimer=null,observer=null,contextLostHandler=null;
  const host=document.getElementById(id);
  if(!host)return;
  host.innerHTML="";
  setShowFallback(true);
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
    const toViewerSlot=(slot)=>slot===16?21:slot===17?22:slot;
    const character={
     race:Number(modelData.race),
     gender:Number(modelData.gender),
     ...getViewerCustomization(modelData),
     // wow-model-viewer reserves 21/22 for main-hand/off-hand display slots.
     items:modelData.items.map(([slot,displayId])=>[toViewerSlot(Number(slot)),Number(displayId)])
    };
    viewer=await library.generateModels(1.45,"#"+id,character,"classic");
    viewer?.setDistance?.(1.15);
    if(disposed){viewer?.destroy?.();return;}
    // The library's public API does not expose renderer.actors. The old
    // check inspected an undocumented internal field and rejected valid models.
    // Confirm the documented model handle and an actual canvas instead.
    if(!viewer||typeof viewer.setDistance!=="function"||!host.querySelector("canvas")){
     viewer?.destroy?.();
     throw new Error("The 3D viewer did not produce a renderable character. The official Armory render is shown instead.");
    }
    setLoadedCount(modelData.items.length);
    // Keep the official Armory render visible until the WebGL canvas has
    // remained mounted for a few seconds. Failed loads can briefly create
    // a canvas before tearing it down.
    const canvas=host.querySelector("canvas");
    contextLostHandler=(event)=>{event.preventDefault();if(!disposed){setStatus("error");setDetail("The 3D viewer lost its graphics context. Showing the official Armory render.");setShowFallback(true);}};
    canvas.addEventListener("webglcontextlost",contextLostHandler,{once:true});
    observer=new MutationObserver(()=>{
     if(!disposed&&!host.querySelector("canvas")){
      clearTimeout(stabilityTimer);
      setStatus("error");setDetail("The 3D model stopped rendering. Showing the official Armory render.");setShowFallback(true);
     }
    });
    observer.observe(host,{childList:true,subtree:true});
    stabilityTimer=setTimeout(()=>{
     if(disposed)return;
     if(host.querySelector("canvas")){setStatus("ready");setDetail("");setShowFallback(false);}
     else{setStatus("error");setDetail("The 3D model did not remain visible. Showing the official Armory render.");setShowFallback(true);}
    },3500);
   }catch(error){
    if(disposed)return;
    setStatus("error");
    setDetail(error?.message||"The Classic 3D character model could not be loaded.");
   }
  }
  boot();
  return ()=>{disposed=true;clearTimeout(stabilityTimer);observer?.disconnect();try{const canvas=host.querySelector("canvas");if(canvas&&contextLostHandler)canvas.removeEventListener("webglcontextlost",contextLostHandler);viewer?.destroy?.();}catch{}host.innerHTML="";};
 },[id,modelData]);
 return <div className="character-model-canvas">
  <div id={id} className="wow-armory-viewer" aria-label={name?name+" 3D Armory character model":"3D Armory character model"}/>
  {showFallback&&armoryRenderUrl&&<div className="armory-render-fallback"><img src={armoryRenderUrl.startsWith("http")?armoryRenderUrl:"https://"+armoryRenderUrl} alt={name?name+" official Armory character render":"Official Armory character render"}/></div>}
  {status!=="ready"&&<div className="model-status" role="status">{status==="loading"?"Loading Armory model…":detail}</div>}
  {status==="ready"&&<span className="model-hint">3D ARMORY MODEL · DRAG TO ROTATE</span>}
  {status==="ready"&&<span className="model-gear-count">{loadedCount} / {modelData?.equipped_visual_item_count||loadedCount} gear pieces rendered</span>}
 </div>;
}

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

export default function CharacterModel({modelData,armoryRenderUrl,name,previewItem=null}){
 const id="wow-armory-model-"+useId().replace(/[^a-zA-Z0-9_-]/g,"");
 const [status,setStatus]=useState("loading");
 const [detail,setDetail]=useState("");
 const [loadedCount,setLoadedCount]=useState(0);
 const [showFallback,setShowFallback]=useState(true);
 useEffect(()=>{
  let disposed=false,viewer=null,observer=null,resizeObserver=null,mutationObserver=null;
  let booting=false,attempt=0,stabilityTimer=null,retryTimer=null,contextCanvas=null;
  const host=document.getElementById(id);
  if(!host)return;
  host.innerHTML="";
  setShowFallback(true);
  const character={
   race:Number(modelData?.race),gender:Number(modelData?.gender),
   ...getViewerCustomization(modelData||{}),
   items:(modelData?.items||[]).map(([slot,displayId])=>[slot===16?21:slot===17?22:Number(slot),Number(displayId)])
  };
  if(previewItem?.display_id&&previewItem?.slot){
   const slotIds={"Head":0,"Neck":1,"Shoulders":2,"Shirt":3,"Chest":4,"Waist":5,"Legs":6,"Feet":7,"Wrist":8,"Hands":9,"Ring":10,"Trinket":12,"Back":14,"Main Hand":21,"Off Hand":22,"Ranged":18};
   const target=slotIds[previewItem.slot];
   if(target!==undefined){
    const existing=character.items.findIndex(([slot])=>slot===target);
    if(existing>=0)character.items[existing]=[target,Number(previewItem.display_id)];
    else character.items.push([target,Number(previewItem.display_id)]);
   }
  }
  function refreshCanvas(){
   if(disposed||!viewer)return;
   const canvas=host.querySelector("canvas");
   if(canvas){canvas.style.display="block";canvas.style.width="100%";canvas.style.height="100%";}
   try{viewer.setDistance?.(1.15);}catch{}
   window.dispatchEvent(new Event("resize"));
  }
  function scheduleRecovery(reason){
   if(disposed||booting)return;
   setStatus("recovering");setDetail(reason||"Restoring the 3D view…");setShowFallback(true);
   clearTimeout(retryTimer);
   retryTimer=setTimeout(()=>{if(!disposed&&host.isConnected&&host.getBoundingClientRect().width>0)boot();},250);
  }
  async function boot(){
   if(disposed||booting)return;
   if(!modelData||!character.race||!Number.isInteger(character.gender)){
    setStatus("missing");setDetail("Refresh character data to retrieve the Armory appearance.");return;
   }
   if(!Array.isArray(modelData.items)||!modelData.items.length){
    setStatus("error");setDetail("The Armory profile did not provide usable equipped-item display data.");return;
   }
   booting=true;attempt++;
   clearTimeout(stabilityTimer);
   setStatus("loading");setDetail("Loading character appearance…");
   try{
    if(viewer){try{viewer.destroy?.();}catch{}viewer=null;}
    host.innerHTML="";
    window.CONTENT_PATH=window.location.origin+"/api/modelviewer/classic/";
    window.WOTLK_TO_RETAIL_DISPLAY_ID_API=undefined;
    const jqueryModule=await import("jquery");
    if(disposed)return;
    window.jQuery=window.$=jqueryModule.default;
    await loadScript(window.CONTENT_PATH+"viewer/viewer.min.js");
    if(disposed)return;
    const library=await import("wow-model-viewer");
    if(disposed)return;
    viewer=await library.generateModels(1.45,"#"+id,character,"classic");
    if(disposed){viewer?.destroy?.();return;}
    if(!viewer||typeof viewer.setDistance!=="function"||!host.querySelector("canvas"))
     throw new Error("The viewer did not create a character canvas.");
    contextCanvas=host.querySelector("canvas");
    contextCanvas.addEventListener("webglcontextlost",onContextLost);
    contextCanvas.addEventListener("webglcontextrestored",onContextRestored);
    setLoadedCount(modelData.items.length);
    stabilityTimer=setTimeout(()=>{
     if(disposed)return;
     if(host.querySelector("canvas")){setStatus("ready");setDetail("");setShowFallback(false);refreshCanvas();}
     else scheduleRecovery("The model view was interrupted. Rebuilding it…");
    },900);
   }catch(error){
    if(!disposed){
     setStatus("error");
     setDetail((error?.message||"The 3D character could not be loaded.")+" The official Armory image remains available.");
     setShowFallback(true);
    }
   }finally{booting=false;}
  }
  function onContextLost(event){
   event.preventDefault();
   if(!disposed){setStatus("recovering");setDetail("Graphics paused; restoring the model…");setShowFallback(true);}
  }
  function onContextRestored(){
   if(disposed)return;
   refreshCanvas();setStatus("ready");setDetail("");setShowFallback(false);
  }
  function onVisibility(){
   if(document.visibilityState==="visible"&&host.getBoundingClientRect().width>0){
    if(host.querySelector("canvas"))refreshCanvas();
    else scheduleRecovery("Restoring the character after returning to the page…");
   }
  }
  document.addEventListener("visibilitychange",onVisibility);
  observer=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){
    if(!host.querySelector("canvas"))scheduleRecovery("Restoring the 3D model…");
    else refreshCanvas();
   }
  },{rootMargin:"180px"});
  observer.observe(host);
  resizeObserver=new ResizeObserver(()=>{if(host.getBoundingClientRect().width>0)refreshCanvas();});
  resizeObserver.observe(host);
  mutationObserver=new MutationObserver(()=>{
   if(!disposed&&!booting&&!host.querySelector("canvas"))
    scheduleRecovery("The model renderer stopped. Rebuilding the 3D view…");
  });
  mutationObserver.observe(host,{childList:true,subtree:true});
  boot();
  return ()=>{
   disposed=true;clearTimeout(stabilityTimer);clearTimeout(retryTimer);
   observer?.disconnect();resizeObserver?.disconnect();mutationObserver?.disconnect();
   document.removeEventListener("visibilitychange",onVisibility);
   try{
    if(contextCanvas){contextCanvas.removeEventListener("webglcontextlost",onContextLost);contextCanvas.removeEventListener("webglcontextrestored",onContextRestored);}
    viewer?.destroy?.();
   }catch{}
   host.innerHTML="";
  };
 },[id,modelData,previewItem?.item_id,previewItem?.display_id,previewItem?.slot]);
 return <div className="character-model-canvas">
  <div id={id} className="wow-armory-viewer" aria-label={name?name+" 3D Armory character model":"3D Armory character model"}/>
  {showFallback&&armoryRenderUrl&&<div className="armory-render-fallback"><img src={armoryRenderUrl.startsWith("http")?armoryRenderUrl:"https://"+armoryRenderUrl} alt={name?name+" official Armory character render":"Official Armory character render"}/></div>}
  {status!=="ready"&&<div className="model-status" role="status">{status==="loading"?"Loading Armory model…":detail}</div>}
  {status==="ready"&&<span className="model-hint">{previewItem?.display_id?"PREVIEWING ITEM · DRAG TO ROTATE":"3D ARMORY MODEL · DRAG TO ROTATE"}</span>}
  {status==="ready"&&<span className="model-gear-count">{loadedCount} / {modelData?.equipped_visual_item_count||loadedCount} gear pieces rendered</span>}
 </div>;
}

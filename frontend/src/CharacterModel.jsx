import {useEffect,useRef,useState} from "react";

const CLASS_COLORS={
 Priest:0x8c9eb7,Mage:0x6f9ed0,Warlock:0x9b75b8,Druid:0x8ba96e,
 Shaman:0x6d9dc4,Paladin:0xd6bd83,Hunter:0x87a96b,Rogue:0xb4b9c2,Warrior:0xb87b68
};

export default function CharacterModel({race,className,spec}){
 const host=useRef(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let renderer,observer,raf,disposed=false;
  const mount=host.current;
  if(!mount)return;
  import("three").then(THREE=>{
   if(disposed)return;
   try{
    const scene=new THREE.Scene();
    scene.background=null;
    const width=Math.max(180,mount.clientWidth),height=Math.max(200,mount.clientHeight);
    const camera=new THREE.PerspectiveCamera(34,width/height,0.1,100);
    camera.position.set(0,1.05,4.25);
    camera.lookAt(0,1.02,0);
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});
    renderer.setClearColor(0x000000,0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
    renderer.setSize(width,height);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    const group=new THREE.Group();scene.add(group);
    const armor=CLASS_COLORS[className]||0x8796a6;
    const metal=0x9aa6b2,skin=0xb98e72,dark=0x27313b;
    scene.add(new THREE.HemisphereLight(0xdce8f4,0x26313d,2.0));
    const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(4,6,7);scene.add(key);
    const rim=new THREE.DirectionalLight(0x8ba8c0,1.4);rim.position.set(-4,2,-4);scene.add(rim);
    const mat=(color,roughness=.72,metalness=.08)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
    const armorMat=mat(armor),trimMat=mat(metal,.38,.55),skinMat=mat(skin),darkMat=mat(dark);
    const add=(geometry,material,x,y,z,rx=0,ry=0,rz=0)=>{
     const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,rz);group.add(mesh);return mesh;
    };
    const capsule=(radius,length,material,x,y,z,rx=0)=>add(new THREE.CapsuleGeometry(radius,length,5,9),material,x,y,z,rx);
    // Stylized armored adventurer: distinct class colors and weapon silhouettes.
    capsule(.39,.78,armorMat,0,1.18,0);
    add(new THREE.SphereGeometry(.28,20,16),skinMat,0,2.05,0);
    add(new THREE.CylinderGeometry(.34,.47,.5,12,1,true),trimMat,0,.72,0);
    add(new THREE.CylinderGeometry(.38,.52,.52,12,1,true),armorMat,0,.72,0);
    capsule(.105,.57,armorMat,-.53,1.25,0,-.22);
    capsule(.105,.57,armorMat,.53,1.25,0,.22);
    add(new THREE.SphereGeometry(.13,12,10),skinMat,-.53,.88,.02);
    add(new THREE.SphereGeometry(.13,12,10),skinMat,.53,.88,.02);
    capsule(.13,.62,darkMat,-.19,.1,0,-.06);
    capsule(.13,.62,darkMat,.19,.1,0,.06);
    add(new THREE.BoxGeometry(.23,.18,.16),trimMat,-.19,-.28,.02);
    add(new THREE.BoxGeometry(.23,.18,.16),trimMat,.19,-.28,.02);
    // Simple shoulder plates and chest crest.
    add(new THREE.SphereGeometry(.2,12,10),trimMat,-.48,1.62,0);
    add(new THREE.SphereGeometry(.2,12,10),trimMat,.48,1.62,0);
    add(new THREE.BoxGeometry(.13,.27,.035),trimMat,0,1.27,.405);
    // Race cues are intentionally subtle; this is a themed preview, not an exact Armory model.
    const r=String(race||"").toLowerCase();
    if(/orc|troll|tauren/.test(r)){
     add(new THREE.ConeGeometry(.065,.27,8),skinMat,-.16,2.29,.01,0,0,.28);
     add(new THREE.ConeGeometry(.065,.27,8),skinMat,.16,2.29,.01,0,0,-.28);
    }else if(/night elf|blood elf/.test(r)){
     add(new THREE.ConeGeometry(.045,.38,8),skinMat,-.24,2.2,0,0,0,.12);
     add(new THREE.ConeGeometry(.045,.38,8),skinMat,.24,2.2,0,0,0,-.12);
    }else if(/dwarf|gnome/.test(r)){
     add(new THREE.SphereGeometry(.18,12,10),armorMat,0,1.83,.13);
    }
    const weaponGroup=new THREE.Group();group.add(weaponGroup);
    const weaponClass=["Priest","Mage","Warlock","Druid","Shaman"].includes(className);
    if(weaponClass){
     const staff=add(new THREE.CylinderGeometry(.035,.045,2.0,8),trimMat,.86,.95,0,0,0,-.12);
     add(new THREE.SphereGeometry(.16,14,12),mat(armor),.98,2.02,0);
    }else{
     add(new THREE.BoxGeometry(.09,1.15,.055),trimMat,.84,1.22,0,0,0,-.12);
     add(new THREE.BoxGeometry(.28,.12,.09),trimMat,.84,.7,0,0,0,-.12);
     add(new THREE.ConeGeometry(.11,.3,4),trimMat,.91,1.92,0,0,0,-.12);
    }
    const base=add(new THREE.CylinderGeometry(1.15,1.15,.08,48),mat(0x202a34),0,-.52,0);
    base.receiveShadow=false;
    let dragging=false,lastX=0;
    const down=e=>{dragging=true;lastX=e.clientX;renderer.domElement.setPointerCapture?.(e.pointerId)};
    const move=e=>{if(!dragging)return;group.rotation.y+=(e.clientX-lastX)*.012;lastX=e.clientX};
    const up=()=>{dragging=false};
    renderer.domElement.addEventListener("pointerdown",down);
    renderer.domElement.addEventListener("pointermove",move);
    renderer.domElement.addEventListener("pointerup",up);
    renderer.domElement.addEventListener("pointercancel",up);
    const resize=()=>{
     if(!mount||disposed)return;
     const w=Math.max(180,mount.clientWidth),h=Math.max(200,mount.clientHeight);
     camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
    };
    observer=new ResizeObserver(resize);observer.observe(mount);
    const render=()=>{if(disposed)return;raf=requestAnimationFrame(render);renderer.render(scene,camera)};
    render();
    mount._cleanup=()=>{renderer.domElement.removeEventListener("pointerdown",down);renderer.domElement.removeEventListener("pointermove",move);renderer.domElement.removeEventListener("pointerup",up);renderer.domElement.removeEventListener("pointercancel",up);};
   }catch(e){setFailed(true)}
  }).catch(()=>setFailed(true));
  return ()=>{disposed=true;cancelAnimationFrame(raf);observer?.disconnect();mount?._cleanup?.();if(renderer){renderer.dispose();renderer.domElement.remove();}};
 },[race,className,spec]);
 return <div className="character-model-canvas" ref={host} aria-label={`3D ${race||"fantasy"} ${className||""} character preview`}>
  {failed&&<div className="model-fallback"><span>{(className||"W").slice(0,1)}</span><small>3D preview unavailable</small></div>}
  <span className="model-hint">DRAG TO ROTATE</span>
 </div>;
}

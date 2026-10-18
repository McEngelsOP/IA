import { decodeTopology } from './online-geo.js'
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),status=document.querySelector('#status')
const session=new URLSearchParams(location.hash.slice(1)).get('session'),d3=window.d3
let features=[],config={},selected=null,lon=-25,lat=10,zoom=1,drag=null,width=1,height=1,dirty=true,last=0,round=null
let projection=null,path=null,graticule=null
function send(action,detail={}){parent.postMessage({type:'esan:geoduelo-map',session,action,...detail},location.origin)}
function configure(m){
 const wasRevealed=config.revealed
 config=m.config||{};selected=m.selected||null
 if(round!==m.round){round=m.round;const center=config.center||[-25,10];lon=center[0];lat=center[1];zoom=config.highlight?1.6:1
   if(config.markers?.length===2){const a=config.markers[0].point,b=config.markers[1].point,p=d3.geo.interpolate(a,b)(.5);lon=p[0];lat=p[1]}
 }
 if(config.target&&config.revealed&&!wasRevealed){lon=config.target[0];lat=config.target[1]}
 document.querySelector('#select').hidden=!config.interactive||config.disabled
 dirty=true
}
window.addEventListener('message',e=>{const m=e.data;if(e.source===parent&&e.origin===location.origin&&m?.type==='esan:geoduelo-map'&&m.session===session&&m.action==='configure')configure(m)})
function resize(){const r=canvas.getBoundingClientRect();width=r.width;height=r.height;const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);dirty=true}
new ResizeObserver(resize).observe(canvas)
function draw(){
 if(!projection)return
 const radius=Math.min(width,height)*.40*zoom
 projection.translate([width/2,height/2]).scale(radius).rotate([-lon,-lat])
 ctx.clearRect(0,0,width,height)
 const g=ctx.createRadialGradient(width/2-radius*.3,height/2-radius*.35,radius*.05,width/2,height/2,radius)
 g.addColorStop(0,'#d9edf5');g.addColorStop(1,'#8badc0');ctx.fillStyle=g;ctx.beginPath();path({type:'Sphere'});ctx.fill()
 ctx.save();ctx.beginPath();path({type:'Sphere'});ctx.clip()
 ctx.strokeStyle='#8baabb';ctx.lineWidth=.6;ctx.beginPath();path(graticule);ctx.stroke()
 for(const f of features){ctx.beginPath();path(f);ctx.fillStyle=f.id===(config.targetCountry||config.highlight)?'#e69156':'#e1e6d3';ctx.fill();ctx.strokeStyle='#536d79';ctx.lineWidth=.65;ctx.stroke()}
 for(const marker of [...(config.markers||[]),...(selected?[{point:selected,label:'Tu marca',own:true}]:[]),...(config.target?[{point:config.target,label:'Respuesta',correct:true}]:[])]){
  if(d3.geo.distance([lon,lat],marker.point)>Math.PI/2)continue
  const p=projection(marker.point);ctx.beginPath();ctx.arc(p[0],p[1],marker.own?5:6,0,Math.PI*2);ctx.fillStyle=marker.correct?'#15754a':marker.own?'#c24e0a':'#1d6ec2';ctx.fill();ctx.strokeStyle='#fbfcfd';ctx.lineWidth=2;ctx.stroke()
  ctx.font="600 13px 'Hanken Grotesk',sans-serif";ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='#e9eef2';ctx.strokeText(marker.label,p[0]+10,p[1]-8);ctx.fillStyle='#0c1a26';ctx.fillText(marker.label,p[0]+10,p[1]-8)
 }
 ctx.restore()
 if(config.interactive&&!config.disabled){const x=width/2,y=height/2;ctx.strokeStyle='#0c1a26';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x-7,y);ctx.lineTo(x+7,y);ctx.moveTo(x,y-7);ctx.lineTo(x,y+7);ctx.stroke()}
}
function choose(point){if(!config.interactive||config.disabled||!features.length)return;selected=point;dirty=true;send('point',{point,round})}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,lon,lat,moved:false}})
canvas.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)drag.moved=true;lon=drag.lon-dx*.3/zoom;lat=Math.max(-85,Math.min(85,drag.lat+dy*.3/zoom));dirty=true})
canvas.addEventListener('pointerup',e=>{if(projection&&drag&&!drag.moved){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,rad=projection.scale();if(Math.hypot(x-width/2,y-height/2)<=rad){const p=projection.invert([x,y]);if(p?.every(Number.isFinite))choose(p)}}drag=null})
canvas.addEventListener('pointercancel',()=>{drag=null})
canvas.addEventListener('lostpointercapture',()=>{drag=null})
function changeZoom(delta){zoom=Math.max(.8,Math.min(5,zoom*delta));dirty=true}
canvas.addEventListener('wheel',e=>{e.preventDefault();changeZoom(e.deltaY<0?1.15:1/1.15)},{passive:false})
canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','+','-','='].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')lon-=8/zoom;if(e.key==='ArrowRight')lon+=8/zoom;if(e.key==='ArrowUp')lat=Math.min(85,lat+8/zoom);if(e.key==='ArrowDown')lat=Math.max(-85,lat-8/zoom);if(e.key==='Enter')choose([(((lon+180)%360)+360)%360-180,lat]);if(e.key==='+'||e.key==='=')changeZoom(1.2);if(e.key==='-')changeZoom(1/1.2);dirty=true}})
document.querySelector('#in').onclick=()=>changeZoom(1.25);document.querySelector('#out').onclick=()=>changeZoom(.8);document.querySelector('#select').onclick=()=>choose([(((lon+180)%360)+360)%360-180,lat])
async function load(){
 status.hidden=false;status.textContent='Cargando globo…';document.querySelector('#retry').hidden=true
 try{if(!d3)throw Error('d3');if(!projection){projection=d3.geo.orthographic().clipAngle(90);path=d3.geo.path().projection(projection).context(ctx);graticule=d3.geo.graticule()()}const r=await fetch('./world.json',{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('map');features=decodeTopology(await r.json());for(const f of features)if(d3.geo.area(f)>Math.PI*2){const reverse=rs=>rs.map(r=>r.slice().reverse());f.geometry.coordinates=f.geometry.type==='Polygon'?reverse(f.geometry.coordinates):f.geometry.coordinates.map(reverse)}status.hidden=true;dirty=true;send('ready')}
 catch{status.textContent='No se pudo cargar el globo. Reintenta para responder.';document.querySelector('#retry').hidden=false;send('error')}
}
document.querySelector('#retry').onclick=()=>{if(!d3)location.reload();else load()}
function frame(now){requestAnimationFrame(frame);if(document.hidden||!dirty||now-last<33)return;last=now;dirty=false;draw()}
resize();requestAnimationFrame(frame);load()

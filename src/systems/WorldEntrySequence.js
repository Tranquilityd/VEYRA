import { ROADS } from '../world/cityMap.js';
import { clamp, lerp } from '../core/util.js';

export const CITY_START_SPAWN={id:'CITY_START_SPAWN',x:1600,y:1580};
const ease=(v)=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
const onRoad=(x,y,r=34)=>ROADS.some(q=>x+r>q.x&&x-r<q.x+q.w&&y+r>q.y&&y-r<q.y+q.h);

export function resolveCityStartSpawn(model){
 const offsets=[[0,0],[80,0],[-80,0],[0,80],[0,-80],[120,80],[-120,80],[120,-80],[-120,-80],[180,0],[-180,0]];
 for(const [dx,dy] of offsets){const x=CITY_START_SPAWN.x+dx,y=CITY_START_SPAWN.y+dy;if(onRoad(x,y))continue;const hit=model.world.collide(x,y,model.player.radius+12);if(Math.hypot(hit.x-x,hit.y-y)>.5)continue;if((model.npcs||[]).some(n=>Math.hypot(n.x-x,n.y-y)<90))continue;return{x,y};}
 // Minimal safe fallback retains the long-standing, collision-tested game spawn.
 const hit=model.world.collide(CITY_START_SPAWN.x,CITY_START_SPAWN.y,model.player.radius);return{x:hit.x,y:hit.y};
}

export class WorldEntrySequence{
 constructor(game,play,startedAt=performance.now()){
  this.game=game;this.play=play;this.active=true;this.cleaned=false;this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.duration=this.reduced?1:3.6;this.controlAt=this.reduced?1:3.1;this.elapsed=Math.max(0,(performance.now()-startedAt)/1000);
  this.spawn=resolveCityStartSpawn(play.model);this.particles=[];
  const p=play.model.player;p.x=this.spawn.x;p.y=this.spawn.y;p.depthY=p.y;p.vx=p.vy=0;p.moving=false;p.seated=null;p.entryVisibility=0;p.entryYOffset=0;p.entryGlow=0;
  game.input.reset();
  play.camera.setZoomForView(game.view.w,game.view.h);this.normalZoom=play.camera.zoom;play.camera.zoom=this.normalZoom*(this.reduced?.96:.82);play.camera.snapTo(this.spawn.x,this.spawn.y-(this.reduced?65:190));
  const count=this.reduced?8:28;for(let i=0;i<count;i++){const a=(i/count)*Math.PI*2,r=12+(i*17)%48;this.particles.push({a,r,s:18+(i*13)%34,z:(i*19)%30,size:1+(i%3)*.6});}
 }
 get controlsLocked(){return this.active&&this.elapsed<this.controlAt;}
 update(dt){
  if(!this.active)return;
  try{
   this.elapsed+=Math.min(dt,.05);const t=this.elapsed,p=this.play.model.player;
   if(this.reduced){const show=ease((t-.35)/.45);p.entryVisibility=show;p.entryYOffset=(1-show)*5;p.entryGlow=Math.sin(show*Math.PI);}
   else{const show=ease((t-1.35)/.7);p.entryVisibility=show;p.entryYOffset=(1-show)*9;if(t>=2.05&&t<2.7)p.entryYOffset=-Math.sin((t-2.05)/.65*Math.PI)*1.5;p.entryGlow=t<2.7?Math.sin(clamp((t-.9)/1.8,0,1)*Math.PI):0;}
   const cameraStart=this.reduced?0:.35,cameraEnd=this.controlAt,k=ease((t-cameraStart)/(cameraEnd-cameraStart));
   this.play.camera.x=lerp(this.spawn.x,this.spawn.x,k);this.play.camera.y=lerp(this.spawn.y-(this.reduced?65:190),this.spawn.y-26,k);this.play.camera.zoom=lerp(this.normalZoom*(this.reduced?.96:.82),this.normalZoom,k);this.play.camera.clampToWorld(this.game.view);
   if(t>=this.controlAt){p.entryVisibility=1;p.entryYOffset=0;p.entryGlow=0;}
   if(t>=this.duration)this.cleanup();
  }catch{this.cleanup(true);}
 }
 cleanup(failed=false){if(this.cleaned)return;this.cleaned=true;const p=this.play.model?.player;if(p){p.entryVisibility=1;p.entryYOffset=0;p.entryGlow=0;p.vx=p.vy=0;}this.particles.length=0;this.active=false;this.game.input.reset();if(failed&&this.play.camera&&p){this.play.camera.setZoomForView(this.game.view.w,this.game.view.h);this.play.camera.snapTo(p.x,p.y-26);}}
 render(ctx,view){if(!this.active)return;const t=this.elapsed,c=this.play.camera,s=this.spawn;
  // World-space arrival accents: a restrained ground ring, rising motes and light streaks.
  if(t>this.reduced?.35:.9){const build=ease((t-(this.reduced?.35:.9))/(this.reduced?.35:.45)),fade=1-ease((t-(this.reduced?.72:2.55))/(this.reduced?.28:1.05)),alpha=clamp(build*fade,0,1);ctx.save();c.apply(ctx,view);ctx.globalAlpha=alpha*.72;ctx.strokeStyle='#FFE800';ctx.lineWidth=2/c.zoom;ctx.beginPath();ctx.ellipse(s.x,s.y+4,46+build*24,15+build*7,0,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='rgba(122,107,178,.72)';ctx.lineWidth=1/c.zoom;ctx.beginPath();ctx.ellipse(s.x,s.y+4,28+build*18,9+build*5,0,0,Math.PI*2);ctx.stroke();for(let i=0;i<this.particles.length;i++){const q=this.particles[i],life=(t*q.s*.035+i*.17)%1,x=s.x+Math.cos(q.a)*q.r*(.55+life*.55),y=s.y-q.z-life*58;ctx.globalAlpha=alpha*(1-life)*.72;ctx.fillStyle=i%4===0?'#FF6100':i%3===0?'#7A6BB2':'#FFE800';ctx.beginPath();ctx.arc(x,y,q.size/c.zoom,0,Math.PI*2);ctx.fill();}if(!this.reduced&&t<2.15){ctx.globalAlpha=alpha*.13;const g=ctx.createLinearGradient(s.x,s.y-130,s.x,s.y+5);g.addColorStop(0,'transparent');g.addColorStop(.6,'#FFE800');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(s.x-8,s.y-135,16,142);}ctx.restore();}
  // Environment reveal and compact Lester title are screen-space and unobtrusive.
  const reveal=this.reduced?ease(t/.5):ease((t-.0)/.9);if(reveal<1){ctx.save();ctx.fillStyle=`rgba(5,2,16,${(1-reveal)*.92})`;ctx.fillRect(0,0,view.w,view.h);ctx.restore();}
  if(!this.reduced&&t>=2.55&&t<=3.35){const a=Math.min(ease((t-2.55)/.22),1-ease((t-3.08)/.27));ctx.save();ctx.globalAlpha=clamp(a,0,1);ctx.textAlign='center';ctx.fillStyle='#FFE800';ctx.font='400 19px Audiowide,system-ui,sans-serif';ctx.shadowColor='rgba(255,97,0,.45)';ctx.shadowBlur=9;ctx.fillText('LESTER',view.w/2,view.h*.72);ctx.shadowBlur=0;ctx.fillStyle='#fff';ctx.font='500 11px Exo 2,system-ui,sans-serif';ctx.fillText('Welcome to Veyra',view.w/2,view.h*.72+20);ctx.restore();}
 }
}

// Veyra landmarks: original city fountain + Entertainment Plaza Litecoin treasure monument.
import { Entity } from '../world/Entity.js';
import { SpriteCache } from '../visuals/SpriteCache.js';
import { TAU } from '../core/util.js';
import { ltcPrice } from '../systems/ltcPrice.js';
import { btcPrice } from '../systems/btcPrice.js';

export class Fountain extends Entity {
  constructor(x,y,kind='fountain'){
    super(x,y);this.type='fountain';this.kind=kind;this.sprite=kind==='fountain'?SpriteCache.prop('fountain',0):null;
    this.bx=-90;this.by=-145;this.bw=180;this.bh=155;
    if(kind==='litecoin-treasure')ltcPrice.start();
    if(kind==='bitcoin-treasure')btcPrice.start();
  }
  render(ctx,time){if(this.kind==='litecoin-treasure')this._treasure(ctx,time);else if(this.kind==='bitcoin-treasure')this._bitcoin(ctx,time);else this._fountain(ctx,time);}
  _fountain(ctx,time){
    const s=this.sprite;ctx.drawImage(s.canvas,this.x-s.ax,this.y-s.ay);const wy=this.y-30;
    for(let i=0;i<3;i++){const r=((time*20+i*20)%56),a=.34*(1-r/56);ctx.strokeStyle=`rgba(255,255,255,${a.toFixed(3)})`;ctx.lineWidth=1.6;ctx.beginPath();ctx.ellipse(this.x,wy,r*1.5+6,(r*1.5+6)*.38,0,0,TAU);ctx.stroke();}
    ctx.fillStyle='rgba(230,250,255,.85)';const topY=this.y-100;
    for(let i=0;i<12;i++){const t=(time*1.05+i*.083)%1,ang=i/12*TAU,px=this.x+Math.cos(ang)*t*30,py=topY-(t*42-t*t*78),sz=2.6*(1-t*.6);ctx.globalAlpha=.9*(1-t);ctx.beginPath();ctx.arc(px,py,sz,0,TAU);ctx.fill();}
    ctx.globalAlpha=1;ctx.fillStyle='rgba(240,252,255,.7)';ctx.fillRect(this.x-2,topY-14,4,16);ctx.fillStyle='rgba(255,255,255,.2)';ctx.beginPath();ctx.ellipse(this.x,wy,20,7,0,0,TAU);ctx.fill();
  }
  _bitcoin(ctx,time){
    const x=this.x,y=this.y,p=.5+.5*Math.sin(time*1.18),turn=Math.sin(time*.42)*.075,cy=y-132;
    ctx.save();
    // Layered ambient illumination and restrained volumetric rays.
    let g=ctx.createRadialGradient(x,cy,18,x,y-55,175);g.addColorStop(0,`rgba(255,220,105,${(.28+.09*p).toFixed(3)})`);g.addColorStop(.48,'rgba(241,164,42,.11)');g.addColorStop(1,'rgba(210,120,20,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y-60,176,112,0,0,TAU);ctx.fill();
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';for(let i=0;i<9;i++){const a=-2.82+i*.27,len=84+16*Math.sin(time*.35+i*1.7);ctx.strokeStyle=`rgba(255,224,140,${(.035+.025*p).toFixed(3)})`;ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*35,cy+Math.sin(a)*22);ctx.lineTo(x+Math.cos(a)*len,cy+Math.sin(a)*len*.72);ctx.stroke();}ctx.restore();
    // Grounded legendary dais: shadow, carved stone, gold collars and inset discs.
    ctx.fillStyle='rgba(20,12,8,.4)';ctx.beginPath();ctx.ellipse(x+7,y+8,105,33,0,0,TAU);ctx.fill();
    g=ctx.createLinearGradient(x-95,y-44,x+90,y+5);g.addColorStop(0,'#3d3026');g.addColorStop(.25,'#a47b42');g.addColorStop(.52,'#ead18c');g.addColorStop(.76,'#71502e');g.addColorStop(1,'#271f1d');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y-10,96,34,0,0,TAU);ctx.fill();ctx.strokeStyle='#f7d77a';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#302522';ctx.beginPath();ctx.ellipse(x,y-18,80,26,0,0,TAU);ctx.fill();ctx.strokeStyle='rgba(255,222,133,.85)';ctx.lineWidth=4;ctx.stroke();
    ctx.fillStyle='#b9812f';ctx.beginPath();ctx.ellipse(x,y-23,66,19,0,0,TAU);ctx.fill();ctx.strokeStyle='#fff0ae';ctx.lineWidth=1.3;ctx.stroke();
    // Counter-rotating engraved energy rings.
    for(let j=0;j<2;j++){ctx.save();ctx.translate(x,y-20);ctx.rotate((j?-.31:.24)*time);ctx.setLineDash(j?[10,7]:[18,9]);ctx.lineDashOffset=time*(j?11:-15);ctx.strokeStyle=j?'rgba(255,249,211,.48)':`rgba(255,191,57,${(.62+.16*p).toFixed(3)})`;ctx.lineWidth=j?1.5:3;ctx.beginPath();ctx.ellipse(0,0,88-j*13,28-j*7,0,0,TAU);ctx.stroke();ctx.restore();}ctx.setLineDash([]);
    // Faceted support column with fine treasure engravings.
    g=ctx.createLinearGradient(x-42,y-99,x+44,y-34);g.addColorStop(0,'#31241e');g.addColorStop(.2,'#8e642f');g.addColorStop(.48,'#f3d17a');g.addColorStop(.7,'#8b5d2b');g.addColorStop(1,'#281f1d');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(x-36,y-101);ctx.lineTo(x+36,y-101);ctx.lineTo(x+45,y-34);ctx.lineTo(x-45,y-34);ctx.closePath();ctx.fill();ctx.strokeStyle='#f6d57d';ctx.lineWidth=2;ctx.stroke();
    ctx.strokeStyle='rgba(83,48,20,.75)';ctx.lineWidth=1;for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(x+i*9,y-92);ctx.lineTo(x+i*11,y-43);ctx.stroke();}
    ctx.fillStyle='#201a19';ctx.beginPath();ctx.ellipse(x,y-99,45,13,0,0,TAU);ctx.fill();ctx.strokeStyle='#e8b94f';ctx.lineWidth=3;ctx.stroke();
    // Thick polished Bitcoin medallion: dark rear extrusion then moving gold face.
    ctx.save();ctx.translate(x,cy);ctx.transform(1,turn,turn*.18,1,0,0);const sx=.94+.035*Math.sin(time*.42);ctx.scale(sx,1);
    ctx.fillStyle='#5b3515';for(let d=10;d>=2;d-=2){ctx.beginPath();ctx.arc(d,5,52,0,TAU);ctx.fill();}
    g=ctx.createRadialGradient(-17,-20,3,0,0,54);g.addColorStop(0,'#fff6be');g.addColorStop(.18,'#ffd96b');g.addColorStop(.48,'#d89422');g.addColorStop(.75,'#f1b83f');g.addColorStop(1,'#6d3b12');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,53,0,TAU);ctx.fill();ctx.strokeStyle='#fff0a3';ctx.lineWidth=4;ctx.stroke();
    ctx.strokeStyle='rgba(85,45,13,.78)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,44,0,TAU);ctx.stroke();for(let i=0;i<24;i++){const a=i/24*TAU;ctx.beginPath();ctx.moveTo(Math.cos(a)*46,Math.sin(a)*46);ctx.lineTo(Math.cos(a)*49,Math.sin(a)*49);ctx.stroke();}
    ctx.fillStyle='#fff0a6';ctx.shadowColor='rgba(255,190,45,.95)';ctx.shadowBlur=14;ctx.font='900 66px Georgia,serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('₿',0,2);ctx.shadowBlur=0;
    // Traveling specular reflection and occasional face sparkle.
    ctx.save();ctx.beginPath();ctx.arc(0,0,49,0,TAU);ctx.clip();g=ctx.createLinearGradient(-65+((time*23)%130),-55, -35+((time*23)%130),55);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.5,'rgba(255,255,225,.32)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(-60,-60,120,120);ctx.restore();ctx.restore();
    // Elegant pulse rings, rising motes and rare bright sparks.
    for(let i=0;i<3;i++){const u=(time*.28+i/3)%1,r=57+u*72;ctx.strokeStyle=`rgba(255,198,65,${(.25*(1-u)).toFixed(3)})`;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y-18,r,r*.34,0,0,TAU);ctx.stroke();}
    for(let i=0;i<16;i++){const phase=time*(.24+(i%4)*.025)+i*.71,rr=46+(i%5)*15,px=x+Math.cos(phase)*rr,py=cy+38+Math.sin(phase*1.3)*30-((time*10+i*17)%68),bright=i%6===0;ctx.fillStyle=bright?'rgba(255,250,190,.85)':'rgba(255,199,70,.46)';ctx.beginPath();ctx.arc(px,py,bright?2.6:1.5,0,TAU);ctx.fill();}
    // Live BTC/USD treasure plaque, visually connected to the front of the base.
    const q=btcPrice.snapshot(),pw=154,ph=39,py=y+8;g=ctx.createLinearGradient(x-pw/2,py,x+pw/2,py+ph);g.addColorStop(0,'rgba(30,22,19,.97)');g.addColorStop(.5,'rgba(91,57,21,.97)');g.addColorStop(1,'rgba(28,22,22,.97)');ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x-pw/2,py,pw,ph,11);ctx.fill();ctx.strokeStyle=`rgba(255,214,105,${(.76+.16*p).toFixed(3)})`;ctx.lineWidth=2;ctx.stroke();ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#eabf55';ctx.font='900 9px system-ui,sans-serif';ctx.fillText(q.status==='live'?'₿  BTC · LIVE':'₿  BTC · USD',x,py+10);let label='LOADING PRICE…';if(q.price!=null)label='$'+q.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});else if(q.status==='error')label='PRICE UNAVAILABLE';ctx.fillStyle=q.status==='error'?'#ddc9ad':'#fff4cb';ctx.font='900 15px system-ui,sans-serif';ctx.shadowColor='rgba(255,188,48,.75)';ctx.shadowBlur=q.status==='live'?6:0;ctx.fillText(label,x,py+27);ctx.shadowBlur=0;
    ctx.restore();
  }
  _treasure(ctx,time){
    const x=this.x,y=this.y,pulse=.5+.5*Math.sin(time*1.35),spin=time*.34;
    ctx.save();
    // warm landmark light cast over the surrounding garden paving
    let g=ctx.createRadialGradient(x,y-58,8,x,y-45,145);g.addColorStop(0,`rgba(255,238,170,${(.18+.07*pulse).toFixed(3)})`);g.addColorStop(.5,'rgba(255,196,70,.08)');g.addColorStop(1,'rgba(255,184,45,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y-38,150,72,0,0,TAU);ctx.fill();
    // restrained rays behind the relic
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';
    for(let i=0;i<7;i++){const a=-2.75+i*.32,len=68+10*Math.sin(time*.55+i);ctx.strokeStyle=`rgba(255,235,165,${(.045+.025*pulse).toFixed(3)})`;ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*44,y-104+Math.sin(a)*25);ctx.lineTo(x+Math.cos(a)*len,y-104+Math.sin(a)*len*.6);ctx.stroke();}
    ctx.restore();
    // ancient stone treasure dais
    ctx.fillStyle='rgba(28,18,20,.34)';ctx.beginPath();ctx.ellipse(x+5,y+3,91,27,0,0,TAU);ctx.fill();
    g=ctx.createLinearGradient(x,y-43,x,y+2);g.addColorStop(0,'#b99a62');g.addColorStop(.42,'#766044');g.addColorStop(1,'#342b27');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y-10,82,29,0,0,TAU);ctx.fill();ctx.strokeStyle='#e7c77b';ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle='#4a3b32';ctx.beginPath();ctx.ellipse(x,y-16,65,20,0,0,TAU);ctx.fill();ctx.strokeStyle='rgba(255,224,145,.48)';ctx.lineWidth=1.5;ctx.stroke();
    // rotating golden/white energy around the base
    ctx.save();ctx.translate(x,y-15);ctx.rotate(spin);ctx.setLineDash([18,11]);ctx.lineDashOffset=-time*14;ctx.strokeStyle=`rgba(255,211,104,${(.55+.17*pulse).toFixed(3)})`;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,72,22,0,0,TAU);ctx.stroke();ctx.rotate(-spin*1.8);ctx.strokeStyle='rgba(245,250,255,.35)';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,0,57,16,0,0,TAU);ctx.stroke();ctx.restore();ctx.setLineDash([]);
    // engraved support and collar
    g=ctx.createLinearGradient(x-35,y-82,x+36,y-22);g.addColorStop(0,'#5f5144');g.addColorStop(.5,'#d1b676');g.addColorStop(1,'#463a32');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(x-29,y-78);ctx.lineTo(x+29,y-78);ctx.lineTo(x+39,y-24);ctx.lineTo(x-39,y-24);ctx.closePath();ctx.fill();ctx.strokeStyle='#f0d28a';ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle='#2d2727';ctx.beginPath();ctx.ellipse(x,y-77,37,11,0,0,TAU);ctx.fill();ctx.strokeStyle='#d8bb72';ctx.stroke();
    // legendary Litecoin medallion and halo
    const cy=y-112,r=43+pulse*2.2;ctx.save();ctx.globalCompositeOperation='lighter';g=ctx.createRadialGradient(x,cy,20,x,cy,67);g.addColorStop(0,'rgba(255,255,235,.32)');g.addColorStop(.55,'rgba(255,215,106,.18)');g.addColorStop(1,'rgba(255,196,60,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,cy,67,0,TAU);ctx.fill();ctx.restore();
    g=ctx.createRadialGradient(x-14,cy-16,4,x,cy,r);g.addColorStop(0,'#fffef0');g.addColorStop(.32,'#e9edf0');g.addColorStop(.68,'#b6bdc5');g.addColorStop(1,'#645b55');ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,cy,r,0,TAU);ctx.fill();ctx.strokeStyle=`rgba(255,221,132,${(.86+.12*pulse).toFixed(3)})`;ctx.lineWidth=4;ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,.72)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,cy,r-7,0,TAU);ctx.stroke();
    ctx.fillStyle='#f7f7f2';ctx.font=`900 ${Math.round(55+pulse*2)}px system-ui,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(255,210,95,.85)';ctx.shadowBlur=12;ctx.fillText('Ł',x,cy+2);ctx.shadowBlur=0;
    // floating treasure motes: stateless and capped for mobile
    for(let i=0;i<10;i++){const phase=time*(.28+i%3*.035)+i*.83,rad=52+(i%4)*11,px=x+Math.cos(phase)*rad,py=cy+Math.sin(phase*1.17)*34+(i%3)*9,alpha=.32+.28*Math.sin(phase*2.1);ctx.fillStyle=`rgba(${i%2?'255,221,130':'245,252,255'},${Math.max(.08,alpha).toFixed(3)})`;ctx.beginPath();ctx.arc(px,py,1.4+(i%3)*.45,0,TAU);ctx.fill();}
    // live LTC/USD plaque directly beneath the relic
    const price=ltcPrice.snapshot(),pw=142,ph=35,py=y-52;g=ctx.createLinearGradient(x-pw/2,py,x+pw/2,py+ph);g.addColorStop(0,'rgba(35,27,25,.96)');g.addColorStop(.5,'rgba(70,48,25,.96)');g.addColorStop(1,'rgba(31,25,27,.96)');ctx.fillStyle=g;ctx.beginPath();ctx.roundRect(x-pw/2,py,pw,ph,10);ctx.fill();ctx.strokeStyle=`rgba(255,218,125,${(.68+.18*pulse).toFixed(3)})`;ctx.lineWidth=1.7;ctx.stroke();
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#e9c979';ctx.font='800 8px system-ui,sans-serif';ctx.fillText(price.status==='live'?'LITECOIN · LIVE':'LITECOIN · USD',x,py+9);
    let label='LOADING PRICE…';if(price.price!=null)label='$'+price.price.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:price.price<1?4:2});else if(price.status==='error')label='PRICE UNAVAILABLE';ctx.fillStyle=price.status==='error'?'#d6c9b6':'#fff8dd';ctx.font='900 14px system-ui,sans-serif';ctx.shadowColor='rgba(255,210,100,.65)';ctx.shadowBlur=price.status==='live'?5:0;ctx.fillText(label,x,py+23);ctx.shadowBlur=0;
    ctx.restore();
  }
}

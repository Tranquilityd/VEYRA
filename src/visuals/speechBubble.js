// Responsive fantasy/adventure speech bubble shared by every NPC.
import { roundRectPath } from '../core/util.js';
const MAX_W=230,MIN_W=142,PAD_X=15,PAD_Y=11;
const FONT='700 12.5px "Trebuchet MS", Georgia, serif';
const IMPORTANT=/^(Litecoin|LTC|LitVM|LiteForge|zkLTC|84|84 million|EVM|Web3)$/i;
function wrap(ctx,text,maxW){const words=String(text).split(/\s+/),lines=[];let cur='';for(const w of words){const test=cur?cur+' '+w:w;if(cur&&ctx.measureText(test).width>maxW){lines.push(cur);cur=w;}else cur=test;}if(cur)lines.push(cur);return lines;}
function richLine(ctx,line,x,y,accent){let at=x;for(const token of line.split(/(\s+)/)){const clean=token.replace(/[^\wŁ-]/g,'');ctx.fillStyle=IMPORTANT.test(clean)?accent:'#fff9e9';ctx.font=IMPORTANT.test(clean)?'900 12.5px "Trebuchet MS", Georgia, serif':FONT;ctx.fillText(token,at,y);at+=ctx.measureText(token).width;}}
export function drawTextBubble(ctx,x,y,text,time=0,accent='#e9c66b',age=1){
 if(!text)return 0;ctx.save();ctx.font=FONT;const maxText=MAX_W-PAD_X*2,lines=wrap(ctx,text,maxText),lh=17;
 const widest=Math.max(...lines.map(l=>ctx.measureText(l).width));const bw=Math.max(MIN_W,Math.min(MAX_W,widest+PAD_X*2)),bh=lines.length*lh+PAD_Y*2;
 const intro=Math.min(1,Math.max(0,age)/.24),ease=1-Math.pow(1-intro,3),bob=Math.sin(time*1.85)*1.15;
 const bx=x-bw/2,by=y-bh-13+bob;ctx.globalAlpha=ease;ctx.translate(x,by+bh);ctx.scale(.9+.1*ease,.9+.1*ease);ctx.translate(-x,-(by+bh));
 ctx.shadowColor='rgba(8,5,12,.58)';ctx.shadowBlur=11;ctx.shadowOffsetY=5;
 const grad=ctx.createLinearGradient(bx,by,bx,by+bh);grad.addColorStop(0,'rgba(48,37,49,.97)');grad.addColorStop(1,'rgba(18,22,30,.97)');ctx.fillStyle=grad;roundRectPath(ctx,bx,by,bw,bh,13);ctx.fill();ctx.shadowColor='transparent';
 ctx.strokeStyle='rgba(239,207,126,.78)';ctx.lineWidth=1.5;roundRectPath(ctx,bx+.75,by+.75,bw-1.5,bh-1.5,12);ctx.stroke();
 // gold-edged tail points directly to the speaker
 ctx.fillStyle='rgba(20,23,31,.98)';ctx.beginPath();ctx.moveTo(x-8,by+bh-1);ctx.lineTo(x+8,by+bh-1);ctx.lineTo(x,by+bh+10);ctx.closePath();ctx.fill();ctx.strokeStyle='rgba(239,207,126,.78)';ctx.beginPath();ctx.moveTo(x-8,by+bh);ctx.lineTo(x,by+bh+10);ctx.lineTo(x+8,by+bh);ctx.stroke();
 ctx.fillStyle=accent;ctx.beginPath();ctx.arc(bx+10,by+10,2.5,0,Math.PI*2);ctx.fill();
 ctx.textAlign='left';ctx.textBaseline='top';lines.forEach((line,i)=>richLine(ctx,line,bx+PAD_X,by+PAD_Y+i*lh,accent));ctx.restore();return bh+13;
}

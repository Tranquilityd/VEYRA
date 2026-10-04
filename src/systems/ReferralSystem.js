// Phase 15 referral-link capture. Codes and rewards remain backend-authoritative.
const KEY='veyra:pending-referral';
const valid=code=>/^VEYRA-[A-Z2-9]{6}$/.test(code);
export class ReferralSystem{
 constructor(events){this.events=events;this.pending=null;this.busy=false;try{const incoming=new URLSearchParams(location.search).get('ref')?.trim().toUpperCase();if(incoming&&valid(incoming))localStorage.setItem(KEY,incoming);this.pending=localStorage.getItem(KEY);}catch{}events.on('litvm:wallet',s=>{if(s?.state==='connected')this.redeemPending();});}
 getCode(){return null;}
 async redeemPending(){if(this.busy||!this.pending||!valid(this.pending))return null;let token;try{token=sessionStorage.getItem('veyra:api-session');}catch{}if(!token)return null;this.busy=true;try{const r=await fetch('/api/referrals',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({code:this.pending})}),d=await r.json();if(!r.ok&&!['CONFLICT','NOT_FOUND'].includes(d.error))throw new Error(d.error||'Referral redemption failed');try{localStorage.removeItem(KEY);}catch{}this.pending=null;this.events.emit('referral:redeemed',d.referral||null);return d;}finally{this.busy=false;}}
 redeem(code){const clean=String(code||'').trim().toUpperCase();if(!valid(clean))return{ok:false,message:'That code does not look like a Veyra referral code.'};this.pending=clean;try{localStorage.setItem(KEY,clean);}catch{}this.redeemPending().catch(()=>{});return{ok:true,message:'Referral will be verified after wallet authentication.'};}
}

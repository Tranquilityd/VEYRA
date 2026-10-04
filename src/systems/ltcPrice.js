const state={status:'loading',price:null,updatedAt:null,error:null};let timer=0,started=false;
const emit=()=>window.dispatchEvent(new CustomEvent('veyra:ltc-price',{detail:{...state}}));
async function refresh(){try{const r=await fetch('/api/ltc-price',{cache:'no-store'}),d=await r.json();if(!r.ok||!(Number(d.price)>0))throw new Error('Live price temporarily unavailable');state.status='live';state.price=Number(d.price);state.updatedAt=d.updatedAt;state.error=null;}catch(e){state.status=state.price==null?'error':'stale';state.error=e.message;}emit();}
export const ltcPrice={
 start(){if(started)return;started=true;refresh();timer=window.setInterval(refresh,60_000);},
 snapshot(){return{...state};},
 refresh,
 stop(){if(timer)clearInterval(timer);timer=0;started=false;},
};

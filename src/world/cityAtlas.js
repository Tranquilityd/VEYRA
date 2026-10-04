// Canonical master-city coordinate system. The existing 2600×3800 playable
// world is mounted unchanged inside this atlas; future districts can become
// playable by adding world mounts without rebuilding the map UI.
export const CITY_ATLAS={
 width:7200,height:5600,
 playableAreas:[{id:'garden-core',name:'Garden District & Veyra Core',atlasX:2300,atlasY:900,worldX:0,worldY:0,width:2600,height:3800,status:'playable'}],
 districts:[
  {id:'old-town',name:'Old Town',x:300,y:350,w:1800,h:1450,color:'#9d7653',status:'future'},
  {id:'market',name:'Marketplace',x:2200,y:250,w:1750,h:850,color:'#d39a50',status:'future'},
  {id:'treasury',name:'Litecoin Treasury',x:4050,y:250,w:1550,h:1450,color:'#c6af69',status:'future'},
  {id:'residential',name:'Residential District',x:5650,y:450,w:1250,h:2100,color:'#8fab79',status:'future'},
  {id:'city-center',name:'City Center',x:2300,y:900,w:2600,h:1800,color:'#7293a8',status:'playable'},
  {id:'garden',name:'Garden District',x:2300,y:2700,w:2600,h:2000,color:'#6d9b68',status:'playable'},
  {id:'entertainment',name:'Entertainment District',x:850,y:1950,w:1350,h:1750,color:'#8a69a0',status:'future'},
  {id:'industrial',name:'Forgeworks',x:350,y:3900,w:1700,h:1250,color:'#766f68',status:'future'},
  {id:'waterfront',name:'Riverside & Waterfront',x:2200,y:4750,w:4650,h:600,color:'#4f8b9e',status:'future'},
 ],
 roads:[
  {points:[[150,1850],[7050,1850]],kind:'avenue',name:'Founders Avenue'},
  {points:[[2150,100],[2150,5300]],kind:'avenue',name:'West Ring'},
  {points:[[5050,100],[5050,5300]],kind:'avenue',name:'Silver Boulevard'},
  {points:[[200,3800],[6900,3800]],kind:'avenue',name:'Garden Way'},
  {points:[[1050,1800],[1050,3900]],kind:'street'},
  {points:[[3950,250],[3950,5200]],kind:'street'},
  {points:[[5600,450],[5600,5000]],kind:'street'},
  {points:[[300,5200],[6900,5200]],kind:'promenade',name:'Moonwater Promenade'},
 ],
 river:{points:[[150,5000],[1100,4880],[2100,5050],[3200,4920],[4400,5100],[5600,4910],[7050,5030]]},
 landmarks:[
  {id:'old-gate',name:'Old Town Gate',x:1650,y:1650,icon:'tower',status:'future'},
  {id:'market-hall',name:'Grand Market Hall',x:3050,y:650,icon:'shop',status:'future'},
  {id:'treasury',name:'Litecoin Treasury',x:4750,y:850,icon:'litecoin',status:'future'},
  {id:'station',name:'Central Station',x:3600,y:1550,icon:'station',status:'future'},
  {id:'bitcoin-monument',name:'Bitcoin Treasure Monument',x:3600,y:1840,icon:'bitcoin',status:'playable'},
  {id:'garden',name:'Veyra Gardens',x:2730,y:2380,icon:'garden',status:'playable'},
  {id:'statue',name:'Litecoin Treasure Monument',x:3600,y:3520,icon:'litecoin',status:'playable'},
  {id:'casino',name:'Veyra Casino',x:3100,y:3520,icon:'game',status:'playable'},
  {id:'arcade',name:'Veyra Arcade',x:4100,y:3520,icon:'game',status:'playable'},
  {id:'tower',name:'Veyra Tower',x:3100,y:1600,icon:'tower',status:'playable'},
  {id:'cafe',name:'Café Lumen',x:2600,y:1600,icon:'shop',status:'playable'},
  {id:'waterfall',name:'Moonfall Terrace',x:3600,y:4260,icon:'water',status:'playable'},
  {id:'docks',name:'Silverlight Docks',x:5900,y:5000,icon:'water',status:'future'},
  {id:'forge',name:'LiteForge Works',x:1200,y:4450,icon:'forge',status:'future'},
 ],
};
export function worldToAtlas(x,y,areaId='garden-core'){const a=CITY_ATLAS.playableAreas.find(v=>v.id===areaId)||CITY_ATLAS.playableAreas[0];return{x:a.atlasX+(x-a.worldX),y:a.atlasY+(y-a.worldY)};}

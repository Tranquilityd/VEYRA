// Veyra — Plaza District map data (original layout, modern city)
export const WORLD = { w: 2600, h: 3800 };
export const FRONT_Y = 700;                 // building front line (north row)

export const GROUND_RECTS = [
  { t: 'pavement', x: 60,   y: 0,    w: 1050, h: 700 },   // Civic Block
  { t: 'pavement', x: 1490, y: 0,    w: 1050, h: 700 },   // Neon Block
  { t: 'grass',    x: 0,    y: 1130, w: 1110, h: 670 },   // Veyra Gardens
  { t: 'plaza',    x: 1490, y: 1130, w: 1110, h: 670 },   // South Plaza
  { t: 'sidewalk', x: 0,    y: 700,  w: 2600, h: 120 },
  { t: 'sidewalk', x: 0,    y: 1060, w: 2600, h: 70 },
  { t: 'sidewalk', x: 1110, y: 0,    w: 70,   h: 1800 },
  { t: 'sidewalk', x: 1420, y: 0,    w: 70,   h: 1800 },
  // ---- Phase 2: Garden District ----
  { t: 'sidewalk', x: 0,    y: 1750, w: 2600, h: 50 },
  { t: 'sidewalk', x: 0,    y: 1960, w: 2600, h: 60 },
  { t: 'sidewalk', x: 320,  y: 1960, w: 70,   h: 1520 },
  { t: 'sidewalk', x: 2210, y: 1960, w: 70,   h: 1520 },
  { t: 'sidewalk', x: 120,  y: 3410, w: 2360, h: 70 },
  { t: 'sidewalk', x: 0,    y: 1960, w: 120,  h: 1720 },
  { t: 'sidewalk', x: 2480, y: 1960, w: 120,  h: 1720 },
  { t: 'sidewalk', x: 120,  y: 3680, w: 2360, h: 120 },
  { t: 'grass',    x: 390,  y: 2020, w: 1820, h: 1390 },
  { t: 'pavement', x: 1150, y: 2020, w: 300,  h: 600 },   // promenade
  { t: 'pavement', x: 1110, y: 2860, w: 70,   h: 200 },
  { t: 'pavement', x: 1420, y: 2860, w: 70,   h: 200 },
  { t: 'pavement', x: 820,  y: 3380, w: 960,  h: 80 },   // waterfall terrace
  { t: 'gravel',   x: 430,  y: 2760, w: 600,  h: 540 },   // rock garden pad
  { t: 'gravel',   x: 1540, y: 2760, w: 560,  h: 560 },   // rose garden pad
  { t: 'gravel',   x: 120,  y: 3540, w: 2360, h: 46 },   // south promenade path
  { t: 'parking',  x: 200,  y: 3690, w: 450,  h: 100 },
  { t: 'parking',  x: 1950, y: 3690, w: 450,  h: 100 },
  { t: 'rockpad',  x: 700,  y: 3060, w: 1200, h: 220 },
];

export const ROADS = [
  { x: 0,    y: 820, w: 2600, h: 240 },
  { x: 1180, y: 0,   w: 240,  h: 1800 },
  // ---- Phase 2: ring road + central garden road ----
  { x: 0,    y: 1800, w: 2600, h: 160 },
  { x: 120,  y: 1960, w: 200,  h: 1520 },
  { x: 2280, y: 1960, w: 200,  h: 1520 },
  { x: 120,  y: 3480, w: 580,  h: 200 },
  { x: 1900, y: 3480, w: 580,  h: 200 },
  { x: 1180, y: 2860, w: 240,  h: 200 },
];
export const ROUNDABOUT = { x: 1300, y: 940, r: 150, island: 78 };
export const POND = { x: 430, y: 1480, rx: 190, ry: 110 };
export const COURT = { x: 1750, y: 1250, w: 420, h: 300 };

// ---- Phase 2: garden district features ----
export const PLAZA = { x: 1300, y: 2620, r: 260 };
export const POOL = { x: 1300, y: 3320, rx: 280, ry: 58 };
export const WATERFALL = { x: 1300, y: 3260, top: 3060, w: 1200 };
export const STREAMS = [
  { x: 390,  y: 3300, w: 630, h: 40 },
  { x: 1580, y: 3300, w: 500, h: 40 },
];
export const BEDS = [
  { x: 1060, y: 2080, w: 80,  h: 460, theme: 0 },
  { x: 1460, y: 2080, w: 80,  h: 460, theme: 1 },
  { x: 1560, y: 2780, w: 200, h: 110, theme: 2 },
  { x: 1880, y: 2780, w: 200, h: 110, theme: 3 },
  { x: 1560, y: 3010, w: 200, h: 110, theme: 1 },
  { x: 1880, y: 3010, w: 200, h: 110, theme: 0 },
  { x: 240,  y: 3610, w: 2120, h: 26, theme: 3 },       // south border flower bed
];
export const HEDGES = [
  { x: 1540, y: 2740, w: 560, h: 14 },
  { x: 1540, y: 3320, w: 240, h: 14 },
  { x: 1860, y: 3320, w: 240, h: 14 },
  { x: 1526, y: 2740, w: 14,  h: 594 },
  { x: 2100, y: 2740, w: 14,  h: 594 },
  { x: 1080, y: 2060, w: 14,  h: 520 },
  { x: 1506, y: 2060, w: 14,  h: 520 },
];
export const FENCES = [
  { dir: 'v', x: 390,  y: 2020, len: 540 },
  { dir: 'v', x: 390,  y: 2680, len: 620 },
  { dir: 'v', x: 2210, y: 2020, len: 540 },
  { dir: 'v', x: 2210, y: 2680, len: 620 },
  { dir: 'h', x: 390,  y: 2020, len: 690 },
  { dir: 'h', x: 1520, y: 2020, len: 690 },
  { dir: 'h', x: 390,  y: 3410, len: 430 },
  { dir: 'h', x: 1780, y: 3410, len: 430 },
];
export const PARK_PATHS = [
  { x: 60,  y: 1377, w: 1050, h: 46 },
  { x: 577, y: 1130, w: 46,  h: 670 },
];

export const BUILDINGS = [
  { id: 'cafe',   name: 'CAFÉ LUMEN',  cx: 300,  w: 380, facadeH: 240, roofD: 90,  style: 'cafe'   },
  { id: 'tower',  name: 'VEYRA TOWER', cx: 800,  w: 420, facadeH: 340, roofD: 110, style: 'glass'  },
  { id: 'arcade', name: 'NEON ARCADE', cx: 1780, w: 560, facadeH: 300, roofD: 100, style: 'neon'   },
  { id: 'cinema', name: 'CINEPLEX 8',  cx: 2280, w: 400, facadeH: 260, roofD: 95,  style: 'cinema' },
  // Phase 2 major entertainment buildings — face each other across the central road
  { id: 'casino',  name: 'VEYRA CASINO', cx: 800,  w: 520, facadeH: 330, roofD: 105, style: 'casino', frontY: 2620, venue: 'casino' },
  { id: 'arcade2', name: 'VEYRA ARCADE', cx: 1800, w: 520, facadeH: 330, roofD: 105, style: 'neon',   frontY: 2620, venue: 'arcade' },
];

export const DOORS = [
  { id: 'door-cafe',   buildingId: 'cafe',   x: 300,  y: FRONT_Y },
  { id: 'door-tower',  buildingId: 'tower',  x: 800,  y: FRONT_Y },
  { id: 'door-arcade', buildingId: 'arcade', x: 1780, y: FRONT_Y },
  { id: 'door-cinema', buildingId: 'cinema', x: 2280, y: FRONT_Y },
  { id: 'door-casino', buildingId: 'casino', x: 800,  y: 2620 },
  { id: 'door-arcade2', buildingId: 'arcade2', x: 1800, y: 2620 },
];

// type, position, variant / flags
export const PROPS = [
  // street lamps — north sidewalk
  ...[150, 500, 850, 1550, 1900, 2250, 2500].map((x) => ({ t: 'lamp', x, y: 760 })),
  // street lamps — south sidewalk
  ...[250, 700, 1000, 1600, 2050, 2400].map((x) => ({ t: 'lamp', x, y: 1100 })),
  // street lamps — vertical sidewalks
  ...[250, 500, 1300, 1600].map((y) => ({ t: 'lamp', x: 1140, y })),
  ...[250, 500, 1300, 1600].map((y) => ({ t: 'lamp', x: 1460, y })),
  // park trees
  ...[[150, 1250], [320, 1200], [620, 1220], [900, 1250], [1000, 1450], [180, 1650],
     [700, 1700], [950, 1650], [350, 1750], [850, 1750], [520, 1300]].map(([x, y], i) => ({ t: 'tree', x, y, v: i % 3 })),
  // south plaza trees
  ...[[1560, 1200], [2450, 1200], [1560, 1700], [2450, 1700], [2000, 1720]].map(([x, y], i) => ({ t: 'tree', x, y, v: i % 3 })),
  // palms — park accents (island kept clear for the fountain)
  ...[[250, 1400], [640, 1560], [1020, 1220]].map(([x, y]) => ({ t: 'palm', x, y })),
  // benches
  ...[[500, 1260], [780, 1430], [300, 1600], [860, 1600], [1650, 1180], [2350, 1180],
     [420, 790], [2050, 790], [760, 1095], [1850, 1095]].map(([x, y]) => ({ t: 'bench', x, y })),
  // planters along storefronts
  ...[[180, 720], [420, 720], [660, 720], [1600, 720], [1960, 720], [2200, 720], [2440, 720]].map(([x, y], i) => ({ t: 'planter', x, y, v: i % 3 })),
  ...[[770, 780], [1830, 780], [1240, 1100], [2100, 1095]].map(([x, y]) => ({ t: 'bin', x, y })),
  { t: 'hydrant', x: 980, y: 1095 },
  { t: 'bike', x: 2160, y: 760 },
  ...[[170, 780], [255, 780], [340, 780]].map(([x, y]) => ({ t: 'parasol', x, y })),
  { t: 'busstop', x: 650, y: 1085 },
  ...[[320, 855, 0], [420, 855, 1], [540, 855, 2]].map(([x, y, v]) => ({ t: 'car', x, y, v })),
  ...[[1950, 1025, 1], [2060, 1025, 0]].map(([x, y, v]) => ({ t: 'car', x, y, v, flip: true })),
  { t: 'gazebo', x: 860, y: 1420 },
  { t: 'dock', x: 430, y: 1592 },
  ...[[1760, 1400], [2140, 1400]].map(([x, y]) => ({ t: 'hoop', x, y })),
  { t: 'arch', x: 1300, y: 1730 },

  // ================= Phase 2: Garden District =================
  // promenade bollard lights + parterre topiary
  ...[2100, 2260, 2420, 2580].map((y) => ({ t: 'bollard', x: 1140, y })),
  ...[2100, 2260, 2420, 2580].map((y) => ({ t: 'bollard', x: 1460, y })),
  ...[[1000, 2160], [1000, 2320], [1000, 2480], [1600, 2160], [1600, 2320], [1600, 2480]].map(([x, y]) => ({ t: 'topiary', x, y })),
  // plaza ring: lamps, benches, topiary
  ...[[1080, 2460], [1520, 2460], [1080, 2780], [1520, 2780]].map(([x, y]) => ({ t: 'lamp', x, y })),
  ...[[1150, 2430], [1450, 2430], [1150, 2810], [1450, 2810]].map(([x, y]) => ({ t: 'bench', x, y })),
  ...[[1060, 2620], [1540, 2620], [1130, 2400], [1470, 2400], [1130, 2840], [1470, 2840]].map(([x, y]) => ({ t: 'topiary', x, y })),
  { t: 'bin', x: 1075, y: 2700 }, { t: 'bin', x: 1525, y: 2700 },
  // venue plaza forecourt: planters flank the steps, seating + litter points off-axis
  ...[[620, 2760], [980, 2760], [1620, 2760], [1980, 2760]].map(([x, y], i) => ({ t: 'planter', x, y, v: i % 3 })),
  { t: 'bench', x: 660, y: 2830 }, { t: 'bench', x: 1940, y: 2830 },
  { t: 'bin', x: 1180, y: 2760 }, { t: 'bike', x: 2120, y: 2770 },
  // central road: lamps + street trees
  ...[[1140, 2900], [1140, 3100], [1460, 2900], [1460, 3100]].map(([x, y]) => ({ t: 'lamp', x, y })),
  ...[[1145, 2980], [1455, 2980], [1145, 3160], [1455, 3160]].map(([x, y], i) => ({ t: 'tree', x, y, v: i % 3 })),
  // waterfall terrace: lamps, benches facing the falls, topiary, bins
  ...[[860, 3400], [1740, 3400]].map(([x, y]) => ({ t: 'lamp', x, y })),
  ...[[1000, 3420], [1300, 3425], [1600, 3420]].map(([x, y]) => ({ t: 'bench', x, y })),
  ...[[880, 3455], [1720, 3455]].map(([x, y]) => ({ t: 'topiary', x, y })),
  { t: 'bin', x: 840, y: 3455 }, { t: 'bin', x: 1760, y: 3455 },
  // rock garden: intentional boulder composition + shrubs + bench + bollards
  ...[[520, 2860, 0], [660, 2960, 1], [800, 2850, 2], [940, 3000, 0], [600, 3120, 2], [860, 3180, 1]].map(([x, y, v]) => ({ t: 'rock', x, y, v })),
  ...[[580, 2900], [740, 3020], [900, 2900], [660, 3200], [960, 3120]].map(([x, y]) => ({ t: 'shrub', x, y })),
  ...[[480, 2800], [980, 2820]].map(([x, y]) => ({ t: 'topiary', x, y })),
  { t: 'bench', x: 700, y: 3060 },
  ...[[1020, 2820], [1020, 3020], [1020, 3220]].map(([x, y]) => ({ t: 'bollard', x, y })),
  // rose garden: pergola, benches, sculpture at the cross path, bollards, shrubs
  { t: 'pergola', x: 2020, y: 3230 },
  ...[[1700, 2955], [1920, 2955]].map(([x, y]) => ({ t: 'bench', x, y })),
  { t: 'sculpture', x: 1820, y: 2955 },
  ...[[1560, 2955], [2080, 2955]].map(([x, y]) => ({ t: 'bollard', x, y })),
  ...[[1560, 2780], [2080, 2780], [1560, 3120], [2080, 3120], [1760, 2780], [1760, 3120]].map(([x, y]) => ({ t: 'shrub', x, y })),
  // stream banks: shrubs + pool-edge rocks + bridges
  ...[[480, 3270], [700, 3270], [920, 3270], [1660, 3270], [1980, 3270]].map(([x, y]) => ({ t: 'shrub', x, y })),
  ...[[1060, 3268, 1], [1540, 3268, 2], [410, 3352, 0], [2060, 3352, 1]].map(([x, y, v]) => ({ t: 'rock', x, y, v })),
  { t: 'bridge', x: 560, y: 3320 },
  { t: 'bridge', x: 1830, y: 3320 },
  // side strips + corner groves
  ...[[460, 2140], [460, 2460], [2140, 2140], [2140, 2460]].map(([x, y], i) => ({ t: 'tree', x, y, v: i % 3 })),
  ...[[600, 2100], [680, 2180], [560, 2220], [2000, 2100], [1920, 2180], [2040, 2220]].map(([x, y], i) => ({ t: 'tree', x, y, v: i % 3 })),
  // ring road lighting
  ...[2100, 2500, 2900, 3300].map((y) => ({ t: 'lamp', x: 150, y })),
  ...[2100, 2500, 2900, 3300].map((y) => ({ t: 'lamp', x: 2450, y })),
  ...[2200, 2600, 3000, 3400].map((y) => ({ t: 'lamp', x: 355, y })),
  ...[2200, 2600, 3000, 3400].map((y) => ({ t: 'lamp', x: 2245, y })),
  ...[500, 900, 1700, 2100].map((x) => ({ t: 'lamp', x, y: 1990 })),
  ...[450, 2150].map((x) => ({ t: 'lamp', x, y: 3445 })),
  // south promenade tree row + shrubs
  ...[[400, 3650], [800, 3650], [1200, 3650], [1600, 3650], [2000, 3650]].map(([x, y], i) => ({ t: 'tree', x, y, v: i % 3 })),
  ...[[600, 3595], [1400, 3595], [2200, 3595]].map(([x, y]) => ({ t: 'shrub', x, y })),
  // city backdrop towers beyond the ring road
  ...[[60, 2200, 0], [60, 2650, 1], [60, 3100, 2], [2540, 2200, 1], [2540, 2650, 2], [2540, 3100, 0], [350, 3780, 2], [2250, 3780, 1]].map(([x, y, v]) => ({ t: 'tower', x, y, v })),
  // parking areas
  ...[[255, 3740, 0], [395, 3740, 2], [535, 3740, 1]].map(([x, y, v]) => ({ t: 'car', x, y, v })),
  ...[[1985, 3740, 1], [2125, 3740, 0], [2265, 3740, 2]].map(([x, y, v]) => ({ t: 'car', x, y, v, flip: true })),
];

// collision specs per prop type: r = rect [dx,dy,w,h], c = circle radius
export const PROP_SOLID = {
  tree:    { c: 10 },
  palm:    { c: 8  },
  lamp:    { c: 6  },
  bench:   { r: [-34, -12, 68, 16] },
  planter: { r: [-26, -14, 52, 26] },
  bin:     { c: 9  },
  hydrant: { c: 7  },
  bike:    { c: 12 },
  parasol: { c: 11 },
  busstop: { r: [-60, -16, 120, 14] },
  car:     { r: [-55, -20, 110, 40] },
  hoop:    { c: 8  },
  rock:    { c: 16 },
  topiary: { c: 12 },
  shrub:   { c: 10 },
  bollard: { c: 5  },
  pergola: { r: [-60, -14, 120, 20] },
  sculpture: { c: 14 },
  tower:   { r: [-60, -40, 120, 80] },
};

export const ZONES = [
  // Phase 2 district (checked first)
  { name: 'Waterfall Terrace',   x: 820,  y: 3300, w: 960,  h: 180 },
  { name: 'Entertainment Plaza', circle: { x: 1300, y: 2620, r: 340 } },
  { name: 'Rose Garden',         x: 1540, y: 2740, w: 560,  h: 594 },
  { name: 'Rock Garden',         x: 430,  y: 2740, w: 620,  h: 594 },
  { name: 'Garden Promenade',    x: 1060, y: 2020, w: 480,  h: 600 },
  { name: 'Garden Ring Road',    x: 0,    y: 1750, w: 2600, h: 270 },
  { name: 'Garden Ring Road',    x: 120,  y: 1960, w: 270,  h: 1520 },
  { name: 'Garden Ring Road',    x: 2210, y: 1960, w: 270,  h: 1520 },
  { name: 'Garden Ring Road',    x: 120,  y: 3410, w: 2360, h: 390 },
  // Phase 1
  { name: 'Veyra Gardens',    x: 0,    y: 1130, w: 1110, h: 670 },
  { name: 'South Plaza',      x: 1490, y: 1130, w: 1110, h: 670 },
  { name: 'Civic Block',      x: 60,   y: 0,    w: 1050, h: 700 },
  { name: 'Neon Block',       x: 1490, y: 0,    w: 1050, h: 700 },
  { name: 'Roundabout Plaza', circle: { x: 1300, y: 940, r: 300 } },
  { name: 'Veyra Avenue',     x: 0,    y: 700,  w: 2600, h: 430 },
  { name: 'Veyra Avenue',     x: 1110, y: 1130, w: 380,  h: 670 },
];

// Phase 4: stroll destinations for residents (open, walkable spots per area)
export const WAYPOINTS = [
  { x: 1150, y: 2500 }, { x: 1450, y: 2500 }, { x: 1150, y: 2740 }, { x: 1450, y: 2740 },
  { x: 1300, y: 2360 }, { x: 1300, y: 2790 }, { x: 1060, y: 2620 }, { x: 1540, y: 2620 },
  { x: 1300, y: 2150 }, { x: 1300, y: 2300 }, { x: 1180, y: 2200 }, { x: 1420, y: 2200 },
  { x: 1000, y: 3435 }, { x: 1600, y: 3435 }, { x: 1200, y: 3435 }, { x: 1400, y: 3435 },
  { x: 1820, y: 2880 }, { x: 1820, y: 3020 }, { x: 1740, y: 2950 }, { x: 1900, y: 2950 },
  { x: 700, y: 2950 }, { x: 620, y: 2880 }, { x: 780, y: 3020 },
  { x: 300, y: 2600 }, { x: 2300, y: 2600 }, { x: 1300, y: 3560 }, { x: 700, y: 3560 }, { x: 1900, y: 3560 },
  { x: 1100, y: 940 }, { x: 1500, y: 940 }, { x: 1300, y: 1200 },
];

// Phase 4+: stroll destinations in the Phase 1 city (sidewalks & plazas)
export const WAYPOINTS_CITY = [
  { x: 400, y: 1095 }, { x: 700, y: 1095 }, { x: 1000, y: 1095 }, { x: 1600, y: 1095 }, { x: 1900, y: 1095 }, { x: 2200, y: 1095 },
  { x: 500, y: 790 }, { x: 900, y: 790 }, { x: 1700, y: 790 }, { x: 2100, y: 790 },
  { x: 1120, y: 760 }, { x: 1480, y: 760 }, { x: 1120, y: 1120 }, { x: 1480, y: 1120 },
  { x: 1150, y: 400 }, { x: 1450, y: 400 }, { x: 1150, y: 1500 }, { x: 1450, y: 1500 },
  { x: 430, y: 1330 }, { x: 1750, y: 1100 },
];

// Veyra — Phase 4: diverse human NPC painter.
// Every NPC is a parameter set (skin tone, face shape, hair style & color,
// body shape, clothing, accessories) drawn as clean flat vector people in the
// city's art style. Parameters are generated per-NPC (seeded) so no two
// residents are clones. Faces stay human & respectful: variation comes from
// proportions, hair, skin tone and accessories — never caricature.
// reference resident height in world px (feet → top of head, bodyH = 1)
export const NPC_HEIGHT = 46;
export const SKINS = [
  ['#f3d3b3', '#e0b896'],   // light
  ['#e8be96', '#d3a67e'],   // light-medium
  ['#c98d5e', '#b17847'],   // medium
  ['#a4683c', '#8d5730'],   // tan
  ['#7c4a26', '#683d1e'],   // brown
  ['#54301a', '#452613'],   // deep brown
];
export const HAIR_STYLES = ['short', 'afro', 'bun', 'ponytail', 'long', 'curly', 'bald', 'headwrap'];
export const HAIR_COLORS = ['#1d1712', '#3a2a1c', '#5d4024', '#8a6132', '#c9a24b', '#b8b8b8', '#7d2f2f', '#26364a'];
const SHIRTS = ['#d95d4e', '#3f7fbf', '#4da36b', '#e2a13c', '#7a5fb5', '#2ea3a8', '#d977a0', '#5b6470', '#e8e3d8', '#37475a'];
const PANTS = ['#37475a', '#4a3b2c', '#5b6470', '#2f3a45', '#6b4a3a', '#3a4a3a', '#701f2b', '#d8d3c8'];
const ACCENTS = ['#ff8c42', '#35e0ff', '#ffd166', '#8fd18f', '#f2f0e6'];

// deterministic appearance from a seed integer
export function makeAppearance(seed) {
  const r = mul(seed);
  const skin = SKINS[(r() * SKINS.length) | 0];
  const hairStyle = HAIR_STYLES[(r() * HAIR_STYLES.length) | 0];
  const hairColor = HAIR_COLORS[(r() * HAIR_COLORS.length) | 0];
  return {
    skin: skin[0], skinD: skin[1],
    hairStyle,
    hairColor: hairStyle === 'bald' ? null : hairColor,
    shirt: SHIRTS[(r() * SHIRTS.length) | 0],
    shirt2: ACCENTS[(r() * ACCENTS.length) | 0],
    pants: PANTS[(r() * PANTS.length) | 0],
    shoe: r() < 0.5 ? '#f2efe6' : '#2c333c',
    bodyW: 0.88 + r() * 0.34,          // slim … broad
    bodyH: 0.92 + r() * 0.16,          // height variety
    headW: 0.9 + r() * 0.24,           // face structure variety
    eyeGap: 0.85 + r() * 0.35,
    glasses: r() < 0.28,
    beard: r() < 0.22,
    earrings: r() < 0.25,
    bag: r() < 0.3,
    cap: hairStyle === 'bald' && r() < 0.4,
    dress: r() < 0.22,
    wrapColor: ACCENTS[(r() * ACCENTS.length) | 0],
  };
}
function mul(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// pose: { phase, moving, seated, talk, gesture, breath }
export function drawPerson(ctx, a, pose) {
  const ph = pose.phase || 0;
  const moving = pose.moving;
  const swing = moving ? Math.sin(ph) : 0;
  const bob = moving ? Math.abs(Math.cos(ph)) * 1.5 : Math.sin((pose.breath || 0)) * 0.6;
  const W = a.bodyW, H = a.bodyH;
  ctx.save();
  ctx.scale(W, H);
  ctx.translate(0, -bob);

  // shadow
  ctx.fillStyle = 'rgba(28,20,44,0.26)';
  ctx.beginPath(); ctx.ellipse(2, bob + 1, 10, 4, 0, 0, Math.PI * 2); ctx.fill();

  const seated = pose.seated;
  // ---- legs ----
  if (seated) {
    ctx.fillStyle = a.pants;
    ctx.fillRect(-6, -15, 5, 9); ctx.fillRect(1, -15, 5, 9);
    ctx.fillStyle = a.shoe;
    ctx.fillRect(-6.6, -7, 6.4, 3); ctx.fillRect(0.6, -7, 6.4, 3);
  } else if (a.dress) {
    ctx.fillStyle = a.pants;
    const l = swing * 3;
    ctx.fillRect(-4.4 + l * 0.4, -16, 3.6, 14); ctx.fillRect(0.8 - l * 0.4, -16, 3.6, 14);
    ctx.fillStyle = a.shoe;
    ctx.fillRect(-5 + l * 0.6, -3, 5.4, 3); ctx.fillRect(0.4 - l * 0.6, -3, 5.4, 3);
  } else {
    const l = swing * 4.2;
    ctx.fillStyle = a.pants;
    ctx.fillRect(-5.6 + l * 0.5, -16, 4.6, 14 - Math.max(0, l) * 0.3);
    ctx.fillStyle = shade(a.pants, -14);
    ctx.fillRect(1.0 - l * 0.5, -16, 4.6, 14 - Math.max(0, -l) * 0.3);
    ctx.fillStyle = a.shoe;
    ctx.fillRect(-6.2 + l * 0.8, -2.8, 6.2, 3); 
    ctx.fillStyle = shade(a.shoe, -18);
    ctx.fillRect(0.2 - l * 0.8, -2.8, 6.2, 3);
  }

  // ---- torso ----
  const ty = seated ? -28 : -30;
  if (a.dress && !seated) {
    ctx.fillStyle = a.shirt;
    ctx.beginPath();
    ctx.moveTo(-6.4, ty + 2); ctx.quadraticCurveTo(-7.4, -18, -8.6, -14);
    ctx.lineTo(8.6, -14); ctx.quadraticCurveTo(7.4, -18, 6.4, ty + 2);
    ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = a.shirt;
    ctx.beginPath();
    ctx.moveTo(-7.4, ty + 3); ctx.quadraticCurveTo(-7.4, ty, -4, ty);
    ctx.lineTo(4, ty); ctx.quadraticCurveTo(7.4, ty, 7.4, ty + 3);
    ctx.lineTo(6.8, -13); ctx.lineTo(-6.8, -13);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(a.shirt, -16);                    // side shade
    ctx.fillRect(3.6, ty + 2, 3.2, -ty - 15);
    ctx.fillStyle = a.shirt2;                              // collar / stripe detail
    ctx.fillRect(-3.2, ty + 1.4, 6.4, 2.2);
  }
  if (a.bag) {                                             // crossbody strap
    ctx.strokeStyle = shade(a.pants, -10); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-6, ty + 3); ctx.lineTo(5.6, -15); ctx.stroke();
  }

  // ---- arms ----
  const armSw = moving ? Math.sin(ph + Math.PI) * 3.6 : 0;
  const gest = pose.gesture || 0;                          // 0..1 waving arm
  ctx.fillStyle = a.shirt;
  ctx.save(); ctx.translate(-8.2, ty + 3); ctx.rotate(-armSw * 0.06 - gest * 2.2);
  ctx.fillRect(-1.8, 0, 3.8, 12 - gest * 4); ctx.fillStyle = a.skin;
  ctx.beginPath(); ctx.arc(0.1, 13 - gest * 4.6, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = shade(a.shirt, -14);
  ctx.save(); ctx.translate(8.2, ty + 3); ctx.rotate(armSw * 0.06 + (pose.talk ? 0.5 + Math.sin(ph * 2) * 0.15 : 0) * (pose.talk ? 1 : 0));
  ctx.fillRect(-2, 0, 3.8, 12); ctx.fillStyle = a.skinD;
  ctx.beginPath(); ctx.arc(-0.1, 13, 2, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  // ---- head ----
  const hy = ty - 6.4;
  const hw = 6.2 * a.headW;
  ctx.fillStyle = a.skin;
  ctx.beginPath(); ctx.ellipse(0, hy, hw, 6.6, 0, 0, Math.PI * 2); ctx.fill();
  // hair (behind-ish styles drawn first)
  const hc = a.hairColor || '#3a2a1c';
  if (a.hairStyle === 'long' || a.hairStyle === 'ponytail') {
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.ellipse(0, hy + 2.4, hw + 1.4, 7.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = a.skin;
    ctx.beginPath(); ctx.ellipse(0, hy, hw, 6.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = hc;
  switch (a.hairStyle) {
    case 'short':
      ctx.beginPath(); ctx.ellipse(0, hy - 2.2, hw + 0.5, 4.6, 0, Math.PI, 0); ctx.fill(); break;
    case 'afro':
      ctx.beginPath(); ctx.arc(0, hy - 2.6, hw + 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = a.skin;
      ctx.beginPath(); ctx.ellipse(0, hy + 0.8, hw, 5.6, 0, 0, Math.PI * 2); ctx.fill(); break;
    case 'bun':
      ctx.beginPath(); ctx.ellipse(0, hy - 2.4, hw + 0.4, 4.4, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.arc(0, hy - 7.6, 2.6, 0, Math.PI * 2); ctx.fill(); break;
    case 'ponytail':
      ctx.beginPath(); ctx.ellipse(0, hy - 2.4, hw + 0.4, 4.4, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-hw - 1.2, hy + 2, 2.2, 5, 0.3, 0, Math.PI * 2); ctx.fill(); break;
    case 'long':
      ctx.beginPath(); ctx.ellipse(0, hy - 2.2, hw + 0.6, 4.8, 0, Math.PI, 0); ctx.fill();
      ctx.fillRect(-hw - 0.8, hy - 2, 2.4, 9); ctx.fillRect(hw - 1.6, hy - 2, 2.4, 9); break;
    case 'curly':
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * (hw * 0.42), hy - 3.6 - Math.cos(i) * 1.4, 2.6, 0, Math.PI * 2); ctx.fill(); } break;
    case 'headwrap':
      ctx.fillStyle = a.wrapColor;
      ctx.beginPath(); ctx.ellipse(0, hy - 2.6, hw + 1.2, 5.2, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.arc(hw * 0.5, hy - 6.4, 2.2, 0, Math.PI * 2); ctx.fill(); break;
    case 'bald': break;
  }
  if (a.cap) {
    ctx.fillStyle = a.shirt2;
    ctx.beginPath(); ctx.ellipse(0, hy - 3, hw + 0.8, 3.6, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(2, hy - 4, hw + 2.4, 1.8);
  }
  // face: eyes, brows, optional beard / glasses / lips / earrings
  const eg = 2.5 * a.eyeGap;
  ctx.fillStyle = '#20180f';
  ctx.beginPath(); ctx.arc(-eg, hy - 0.4, 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(eg, hy - 0.4, 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,12,0.55)'; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.moveTo(-eg - 1.4, hy - 2.2); ctx.lineTo(-eg + 1.4, hy - 2.2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(eg - 1.4, hy - 2.2); ctx.lineTo(eg + 1.4, hy - 2.2); ctx.stroke();
  if (a.glasses) {
    ctx.strokeStyle = '#2b3442'; ctx.lineWidth = 0.9;
    ctx.strokeRect(-eg - 1.7, hy - 1.8, 3.4, 2.8); ctx.strokeRect(eg - 1.7, hy - 1.8, 3.4, 2.8);
    ctx.beginPath(); ctx.moveTo(-eg + 1.7, hy - 0.6); ctx.lineTo(eg - 1.7, hy - 0.6); ctx.stroke();
  }
  if (a.beard) {
    ctx.fillStyle = hc;
    ctx.beginPath(); ctx.ellipse(0, hy + 3.4, hw * 0.78, 3.2, 0, 0, Math.PI); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(120,50,50,0.5)';
    ctx.fillRect(-1.1, hy + 2.8, 2.2, 0.9);
  }
  if (a.earrings) {
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(-hw + 0.4, hy + 2.2, 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hw - 0.4, hy + 2.2, 0.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

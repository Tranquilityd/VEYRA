// Veyra — Phase 4: lightweight conversation pairing for NPCs.
// Two residents nearby may stop and chat for a while; the speaker alternates
// (drives the dialogue bubble). No dialogue content yet — LitVM comes later.
export class ConversationSystem {
  constructor(maxConcurrent = 3) {
    this.convs = [];
    this.max = maxConcurrent;
    this.cooldown = 2;
  }

  update(dt) {
    this.cooldown -= dt;
    for (const c of this.convs) {
      c.t -= dt;
      c.spT -= dt;
      if (c.spT <= 0) { c.speaker = c.speaker === c.a ? c.b : c.a; c.spT = 1.8 + Math.random() * 2.4; }
      if (c.t <= 0) {
        c.live = false;
        if (c.a.conv === c) c.a.conv = null;
        if (c.b.conv === c) c.b.conv = null;
      }
    }
    this.convs = this.convs.filter((c) => c.live);
  }

  tryStart(npc, force = false) {
    if (this.convs.length >= this.max) return false;
    if (npc.conv || npc.seated || npc.state === 'walk') return false;
    if (!force) {
      if (this.cooldown > 0) return false;
      if (Math.random() > npc.sociable * 0.12) return false;
    }
    const pool = npc.config.crowd || [];
    let best = null, bd = 95;
    for (const o of pool) {
      if (o === npc || o.conv || o.seated || o.state === 'walk') continue;
      const d = Math.hypot(o.x - npc.x, o.y - npc.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) return false;
    const conv = {
      a: npc, b: best, live: true,
      t: 6 + Math.random() * 9,
      spT: 1 + Math.random() * 2,
      speaker: Math.random() < 0.5 ? npc : best,
      other: (self) => (self === conv.a ? conv.b : conv.a),
    };
    npc.conv = conv; best.conv = conv;
    npc.state = 'talk'; best.state = 'talk';
    this.convs.push(conv);
    this.cooldown = 2.5 + Math.random() * 4;
    return true;
  }
}

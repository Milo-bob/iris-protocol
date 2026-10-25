import * as THREE from 'three';
import { clone as cloneSkel } from './jsm/utils/SkeletonUtils.js';
import { loadGLB } from './assets.js';
import { CELL, N, RING, EDGE, rnd, rr, pick, districtAt } from './city.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------------------
// NPCs: citizens, prisoners, guards, robots, drones. All have number names.
// Detection is shown by a small eye icon above the head (no vision cones).
// ---------------------------------------------------------------------------

const TYPES = {
  citizen:  { prefix: 'Citizen',  digits: 5, hp: 30,  walk: 1.4, run: 4.6, tint: 0x80868e, scale: 0.97, model: 'soldier', pause: 0.5, choke: 1.3 },
  prisoner: { prefix: 'Prisoner', digits: 3, hp: 30,  walk: 1.3, run: 4.4, tint: 0xe8863a, scale: 0.98, model: 'soldier', pause: 0.6, choke: 1.3 },
  guard:    { prefix: 'Guard',    digits: 4, hp: 70,  walk: 1.9, run: 5.0, tint: 0x8e2a2a, scale: 1.02, model: 'soldier', range: 17, fov: 110, pause: 0.25, atk: { range: 2.0, wind: 0.4, dmg: 14, cd: 1.0 }, gun: { range: 16, wind: 0.55, cd: 1.7 }, choke: 1.6 },
  robot:    { prefix: 'Unit',     digits: 4, hp: 170, walk: 1.5, run: 3.7, tint: 0xffffff, emissive: 0x4a0a00, scale: 1.12, model: 'xbot', range: 20, fov: 100, pause: 0.15, atk: { range: 2.4, wind: 0.75, dmg: 20, cd: 1.9 }, armor: { fist: 0.35, gun: 0.55 }, choke: 2.6 },
  drone:    { prefix: 'Drone',    digits: 4, hp: 40,  walk: 3.0, run: 6.5, range: 18, fov: 130, pause: 0 },
};
const HOSTILE = new Set(['guard', 'robot', 'drone']);
const AGGRO = new Set(['chase', 'attack', 'shoot']);
const CALM = new Set(['patrol', 'post', 'idle']);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

class Grid {   // spatial buckets for colliders
  constructor(colliders, cs = 8) {
    this.cs = cs; this.map = new Map(); this.empty = [];
    for (const c of colliders) {
      for (let gx = Math.floor((c.minX - 1) / cs); gx <= Math.floor((c.maxX + 1) / cs); gx++)
        for (let gz = Math.floor((c.minZ - 1) / cs); gz <= Math.floor((c.maxZ + 1) / cs); gz++) {
          const k = gx + ',' + gz; let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(c);
        }
    }
  }
  near(x, z) { return this.map.get(Math.floor(x / this.cs) + ',' + Math.floor(z / this.cs)) || this.empty; }
}

// ----- icons -----
function eyeIcon(open, iris, extra) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d'), h = 40 * open;
  g.beginPath(); g.moveTo(8, 32); g.quadraticCurveTo(64, 32 - h * 1.6, 120, 32); g.quadraticCurveTo(64, 32 + h * 1.6, 8, 32); g.closePath();
  g.fillStyle = open < 0.2 ? 'rgba(0,0,0,0)' : '#f5e3c0'; g.fill();
  if (open >= 0.2) { g.save(); g.clip(); g.fillStyle = iris; g.beginPath(); g.arc(64, 32, 8 + 14 * open, 0, 7); g.fill(); g.fillStyle = '#120202'; g.beginPath(); g.ellipse(64, 32, 4, 6 + 12 * open, 0, 0, 7); g.fill(); g.restore(); }
  g.lineWidth = 5; g.strokeStyle = extra || '#2a0a05'; g.stroke();
  if (open < 0.2) { g.strokeStyle = '#b8862a'; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 32); g.quadraticCurveTo(64, 44, 118, 32); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glyph(ch, color) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.font = 'bold 56px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#1a0202'; g.strokeText(ch, 32, 34); g.fillStyle = color; g.fillText(ch, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const ICONS = {};
function icons() {
  if (!ICONS.closed) {
    ICONS.closed = eyeIcon(0.05, '#000'); ICONS.half = eyeIcon(0.45, '#ff8a1a'); ICONS.open = eyeIcon(1, '#ff3a12');
    ICONS.alert = glyph('!', '#ff2a1a'); ICONS.search = glyph('?', '#ffd23a');
  }
  return ICONS;
}
function nameTexture(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 40;
  const g = c.getContext('2d'); g.font = 'bold 26px Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 5; g.strokeStyle = '#000'; g.strokeText(text, 128, 21); g.fillStyle = '#ffd9a0'; g.fillText(text, 128, 21);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function pad(n, d) { return String(n).padStart(d, '0'); }

let modelPromise = null;
export function getModels() {
  if (!modelPromise) modelPromise = (async () => {
    const [soldier, xbot] = await Promise.all([loadGLB('soldier'), loadGLB('Xbot')]);
    const out = {};
    for (const [name, gltf, fix] of [['soldier', soldier, Math.PI], ['xbot', xbot, 0]]) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      out[name] = { gltf, fix, height: box.max.y - box.min.y, minY: box.min.y };
    }
    return out;
  })();
  return modelPromise;
}

export class NPCManager {
  constructor(scene, colliders, fx, cbs, director) {
    this.scene = scene; this.grid = new Grid(colliders); this.fx = fx; this.cb = cbs; this.dir = director;
    this.hideSpots = []; this.bodies = []; this.visits = new Map();
    this.npcs = []; this.nodes = []; this.nodeMap = new Map(); this.models = {};
    this.projectiles = []; this.alarm = 0; this.chasers = 0; this.time = 0; this.spawnPoint = { x: 0, z: 0 };
    this.custom = false; this.droneH = 3.2; this.droneLow = 2.2; this.dead = false;
    this.root = new THREE.Group(); scene.add(this.root);
  }

  // ----- world queries -----
  blocked(x, z, r = 0.4, minH = 0.6) {
    for (const c of this.grid.near(x, z)) if (c.h > minH && x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
    return false;
  }
  resolve(pos, r = 0.4) {
    for (let pass = 0; pass < 2; pass++) for (const c of this.grid.near(pos.x, pos.z)) {
      if (c.h < 0.6) continue;
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX)), cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 < 1e-8) { const l = pos.x - c.minX, rr_ = c.maxX - pos.x, t = pos.z - c.minZ, b = c.maxZ - pos.z, m = Math.min(l, rr_, t, b); if (m === l) pos.x = c.minX - r; else if (m === rr_) pos.x = c.maxX + r; else if (m === t) pos.z = c.minZ - r; else pos.z = c.maxZ + r; }
        else { const d = Math.sqrt(d2), k = (r - d) / d; pos.x += dx * k; pos.z += dz * k; }
      }
    }
  }
  los(x0, z0, x1, z1, minH = 1.9) {
    const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz), steps = Math.min(30, Math.ceil(d / 1.2));
    for (let s = 1; s < steps; s++) { const t = s / steps; if (this.blocked(x0 + dx * t, z0 + dz * t, 0.05, minH)) return false; }
    return true;
  }

  clear(x0, z0, x1, z1, r = 0.5) {   // can something with radius r walk straight from A to B?
    const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz); if (d > 30) return false;
    const steps = Math.ceil(d / 0.5);
    for (let s = 1; s <= steps; s++) { const t = s / steps; if (this.blocked(x0 + dx * t, z0 + dz * t, r, 0.6)) return false; }
    return true;
  }
  route(x0, z0, x1, z1) {   // breadth-first search over the patrol graph
    const A = this.nearestNode(x0, z0), B = this.nearestNode(x1, z1); if (!A || !B) return null; if (A === B) return [A];
    const prev = new Map([[A, null]]), q = [A];
    for (let qi = 0; qi < q.length; qi++) { const n = q[qi]; if (n === B) break; for (const m of n.n) if (!prev.has(m)) { prev.set(m, n); q.push(m); } }
    if (!prev.has(B)) return null;
    const out = []; for (let n = B; n; n = prev.get(n)) out.push(n); return out.reverse();
  }
  // walk an agent (needs x, z, moveToward) toward a point, around corners via the patrol graph
  navTo(a, tx, tz, speed, dt, free = false) {
    if (free) return a.moveToward(tx, tz, speed, dt, true);
    a.clrT = (a.clrT || 0) - dt;
    if (a.clrT <= 0) { a.clr = this.clear(a.x, a.z, tx, tz); a.clrT = 0.12; }
    if (a.clr) { a.path = null; return a.moveToward(tx, tz, speed, dt); }
    a.pathT = (a.pathT || 0) - dt;
    if (!a.path || a.pathT <= 0) { a.path = this.route(a.x, a.z, tx, tz); a.pi = 0; a.pathT = 0.8; }
    if (a.path && a.path.length) {
      while (a.pi < a.path.length - 1 && Math.hypot(a.path[a.pi].x - a.x, a.path[a.pi].z - a.z) < 1.8) a.pi++;
      const wp = a.path[a.pi];
      if (a.pi === a.path.length - 1 && Math.hypot(wp.x - a.x, wp.z - a.z) < 1.8) return a.moveToward(tx, tz, speed, dt);
      a.moveToward(wp.x, wp.z, speed, dt); return Math.hypot(tx - a.x, tz - a.z);
    }
    return a.moveToward(tx, tz, speed, dt);
  }

  // ----- patrol graph on the street grid -----
  buildGraph() {
    const key = (i, j) => i + ',' + j;
    for (let i = -N - 1; i <= N; i++) for (let j = -N - 1; j <= N; j++) {
      const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
      if (Math.abs(x) > EDGE - 1.5 || Math.abs(z) > EDGE - 1.5) continue;
      if (this.blocked(x, z, 0.8, 0.3)) continue;
      const n = { x, z, i, j, n: [] }; this.nodes.push(n); this.nodeMap.set(key(i, j), n);
    }
    const free = (x0, z0, x1, z1) => { for (let t = 0.15; t < 0.9; t += 0.15) if (this.blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.6, 0.3)) return false; return true; };
    for (const a of this.nodes) for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = this.nodeMap.get(key(a.i + di, a.j + dj));
      if (b && free(a.x, a.z, b.x, b.z)) { a.n.push(b); b.n.push(a); }
    }
  }
  nearestNode(x, z) {
    let best = null, bd = 1e9;
    if (this.custom) { for (const n of this.nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (n.n.length && d < bd) { bd = d; best = n; } } return best; }
    const i0 = Math.round(x / CELL - 0.5), j0 = Math.round(z / CELL - 0.5);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      const n = this.nodeMap.get((i0 + di) + ',' + (j0 + dj)); if (!n || !n.n.length) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // ----- creation -----
  async init(spawn) {
    this.spawnPoint = spawn;
    this.models = await getModels();
    icons();
    this.buildGraph();
    this.spawnAll();
  }
  // interior floors: patrol graph + spawn list come from the floor generator
  async initFloor(spawn, nodes) {
    this.spawnPoint = spawn; this.custom = true; this.nodes = nodes; this.droneH = 2.7; this.droneLow = 1.9;
    this.models = await getModels();
    icons();
  }
  destroy() { this.scene.remove(this.root); this.npcs.length = 0; this.projectiles.length = 0; this.dead = true; }

  nodesIn(district) { return this.nodes.filter((n) => n.n.length && districtAt(n.x, n.z) === district); }
  farNode(list, minDist = 28) {
    for (let t = 0; t < 40; t++) { const n = pick(list); if (Math.hypot(n.x - this.spawnPoint.x, n.z - this.spawnPoint.z) > minDist) return n; }
    return pick(list);
  }
  spawnAll() {
    const by = {}; for (const d of ['prison', 'residential', 'market', 'industry', 'avenue']) by[d] = this.nodesIn(d);
    const patrol = (type, d, count, minDist) => { for (let k = 0; k < count; k++) { if (!by[d].length) return; const n = this.farNode(by[d], minDist); this.add(type, n.x, n.z, { node: n }); } };
    patrol('guard', 'prison', 4, 34); patrol('guard', 'avenue', 3, 20); patrol('guard', 'residential', 2); patrol('guard', 'market', 2); patrol('guard', 'industry', 3);
    patrol('robot', 'industry', 4); patrol('robot', 'avenue', 2); patrol('robot', 'prison', 1, 45);
    patrol('citizen', 'residential', 12, 0); patrol('citizen', 'market', 14, 0); patrol('citizen', 'industry', 5, 0); patrol('citizen', 'avenue', 4, 0);
    patrol('prisoner', 'prison', 5, 22);
    for (let k = 0; k < 10; k++) { const d = pick(['prison', 'residential', 'market', 'industry', 'avenue']); if (by[d].length) { const n = this.farNode(by[d], 20); this.add('drone', n.x, n.z, { node: n }); } }
    // posts at the ring gates
    const g = RING + 2.4, gi = RING - 2.6;
    for (const [x, z] of [[0, g], [0, -g], [g, 0], [-g, 0], [0, gi], [0, -gi], [gi, 0], [-gi, 0]]) this.add('guard', x + rr(-1.5, 1.5), z + rr(-1.5, 1.5), { post: true });
    this.add('robot', 12, 12, { post: true }); this.add('robot', -12, -12, { post: true });
  }
  add(type, x, z, opts = {}) { const n = new NPC(this, type, x, z, opts); this.npcs.push(n); return n; }

  buildVisual(npc) {
    const cfg = npc.cfg, holder = new THREE.Group(); holder.rotation.order = 'YXZ';
    if (npc.type === 'drone') {
      const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c32, metalness: 0.8, roughness: 0.35 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), dark); body.scale.y = 0.6; body.castShadow = true; holder.add(body);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.05, 8, 24), new THREE.MeshStandardMaterial({ color: 0x555a62, metalness: 0.8, roughness: 0.4 })); ring.rotation.x = Math.PI / 2; holder.add(ring);
      npc.lens = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); npc.lens.position.set(0, 0.02, 0.4); holder.add(npc.lens);
      npc.rotors = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.015, 14), new THREE.MeshBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.35 }));
        r.position.set(sx * 0.55, 0.12, sz * 0.55); holder.add(r); npc.rotors.push(r);
      }
      npc.headY = 0.9; npc.mats = [dark];
    } else {
      const m = this.models[cfg.model], model = cloneSkel(m.gltf.scene);
      const sc = cfg.scale * (npc.opts.scale || 1), tint = npc.opts.tint ?? cfg.tint, k = 1.8 * sc / m.height;
      model.scale.setScalar(k); model.position.y = -m.minY * k; model.rotation.y = m.fix;
      npc.mats = [];
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.frustumCulled = false;
        o.material = o.material.clone();
        if (tint !== 0xffffff) o.material.color.setHex(tint);
        if (cfg.emissive) o.material.emissive.setHex(cfg.emissive);
        o.material.userData.baseEm = o.material.emissive.clone();
        npc.mats.push(o.material);
      });
      holder.add(model); npc.model = model;
      npc.mixer = new THREE.AnimationMixer(model); npc.actions = {};
      for (const clip of m.gltf.animations) npc.actions[clip.name.toLowerCase()] = npc.mixer.clipAction(clip);
      npc.headY = 1.8 * sc + 0.55;
    }
    // icon, hp bar, name
    const I = icons();
    npc.iconMat = new THREE.SpriteMaterial({ map: I.closed, transparent: true, depthWrite: false, opacity: 0 });
    npc.icon = new THREE.Sprite(npc.iconMat); npc.icon.scale.set(0.9, 0.45, 1); npc.icon.position.y = npc.headY; holder.add(npc.icon);
    npc.nameMat = new THREE.SpriteMaterial({ map: nameTexture(npc.name), transparent: true, depthWrite: false, opacity: 0 });
    npc.nameSprite = new THREE.Sprite(npc.nameMat); npc.nameSprite.scale.set(2.2, 0.34, 1); npc.nameSprite.position.y = npc.headY + 0.45; holder.add(npc.nameSprite);
    npc.hpMat = new THREE.SpriteMaterial({ color: 0xff3a2a, transparent: true, depthWrite: false, opacity: 0 });
    npc.hpBar = new THREE.Sprite(npc.hpMat); npc.hpBar.scale.set(0.9, 0.07, 1); npc.hpBar.position.y = npc.headY - 0.28; holder.add(npc.hpBar);
    this.root.add(holder);
    return holder;
  }

  // ----- alerts, noise & projectiles -----
  alertNearby(x, z, radius, to) {
    for (const n of this.npcs) {
      if (!HOSTILE.has(n.type) || n.state === 'ko' || n.state === 'choked' || AGGRO.has(n.state)) continue;
      if (Math.hypot(n.x - x, n.z - z) < radius) n.hear(to.x, to.z, 9, 0.7);
    }
  }
  // a sound at (x, z): calm hostiles in earshot go and look (through walls the radius is cut down)
  makeNoise(x, z, radius) {
    let heard = 0;
    for (const n of this.npcs) {
      if (!HOSTILE.has(n.type) || n.state === 'ko' || n.state === 'choked' || AGGRO.has(n.state)) continue;
      const d = Math.hypot(n.x - x, n.z - z), r = this.los(n.x, n.z, x, z, 1.9) ? radius : radius * 0.55;
      if (d < r) { n.hear(x, z, 11, 0.55); heard++; }
    }
    this.cb.onNoise?.(x, z, radius);
    return heard;
  }
  fire(from, P, spread = 0) {
    const geo = this._pg || (this._pg = new THREE.SphereGeometry(0.17, 8, 6)), mat = this._pm || (this._pm = new THREE.MeshBasicMaterial({ color: 0xff4a24 }));
    const m = new THREE.Mesh(geo, mat); m.position.set(from.x, from.y, from.z);
    const tx = P.x + (rnd() - 0.5) * spread, tz = P.z + (rnd() - 0.5) * spread;
    const dx = tx - from.x, dy = 1.1 - from.y, dz = tz - from.z, d = Math.hypot(dx, dy, dz), sp = 15;
    this.root.add(m); this.projectiles.push({ m, vx: dx / d * sp, vy: dy / d * sp, vz: dz / d * sp, life: 3 });
    sfx.zap(this.vol(from.x, from.z, P));
  }
  vol(x, z, P) { return Math.max(0.1, 1 - Math.hypot(x - P.x, z - P.z) / 30); }

  // fists: everything in the arc in front of the player
  meleeHit(P, yaw, { range = 2.4, half = 0.95, dmg = 13, src = 'fist' } = {}) {
    const hits = [];
    for (const n of this.npcs) {
      if (!n.active || n.state === 'ko' || n.state === 'choked') continue;
      const dx = n.x - P.x, dz = n.z - P.z, d = Math.hypot(dx, dz);
      if (d > range + 0.2 || (n.type === 'drone' && n.y > 3.4)) continue;
      if (d > 1.0 && Math.abs(angDiff(Math.atan2(dx, dz), yaw)) > half) continue;
      n.takeHit(dmg, dx / (d || 1), dz / (d || 1), src, P, false);
      hits.push({ n });
    }
    return hits;
  }
  punchTarget(P, yaw, range = 2.4, half = 0.95) {   // someone who already hunts the player and stands within fist reach
    for (const n of this.npcs) {
      if (!n.active || !AGGRO.has(n.state) || (n.type === 'drone' && n.y > 3.4)) continue;
      const dx = n.x - P.x, dz = n.z - P.z, d = Math.hypot(dx, dz);
      if (d <= range && (d < 1.0 || Math.abs(angDiff(Math.atan2(dx, dz), yaw)) <= half)) return n;
    }
    return null;
  }
  // silent takedown: a calm, unaware target within arm's reach and the player behind its back
  takedownTarget(P, yaw) {
    let best = null, bd = 1e9;
    for (const n of this.npcs) {
      if (!n.active || n.type === 'drone' || n.stagger > 0 || !(CALM.has(n.state) || n.state === 'search') || n.meter > 0.5) continue;
      const dx = P.x - n.x, dz = P.z - n.z, d = Math.hypot(dx, dz);
      if (d > (n.type === 'robot' ? 2.3 : 2.0)) continue;
      if ((Math.sin(n.yaw) * dx + Math.cos(n.yaw) * dz) / (d || 1) > -0.3) continue;                   // must be behind it
      if (Math.abs(angDiff(Math.atan2(-dx, -dz), yaw)) > 1.0) continue;                              // and the player must face it
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  // bullet: first NPC or wall along the ray
  hitscan(ox, oy, oz, dx, dy, dz, maxD, t0 = 0) {
    let wallT = maxD;
    if (dy < -1e-4) wallT = Math.min(wallT, -oy / dy);
    for (let t = Math.max(0.5, t0); t < wallT; t += 0.4) { if (this.blocked(ox + dx * t, oz + dz * t, 0.05, oy + dy * t)) { wallT = t; break; } }
    let best = null, bt = wallT, head = false;
    const h2 = dx * dx + dz * dz;
    if (h2 > 1e-6) for (const n of this.npcs) {
      if (!n.active || n.state === 'ko') continue;
      const cx = n.x - ox, cz = n.z - oz, s = (cx * dx + cz * dz) / h2;
      if (s < t0 || s > bt) continue;
      const ex = cx - dx * s, ez = cz - dz * s, rad = n.type === 'drone' ? 0.7 : 0.55;
      if (ex * ex + ez * ez > rad * rad) continue;
      const y = oy + dy * s, base = n.type === 'drone' ? n.y - 0.4 : n.y;
      if (y < base || y > base + (n.type === 'drone' ? 0.9 : 1.95)) continue;
      best = n; bt = s; head = n.type !== 'drone' && y > base + 1.55;
    }
    return { n: best, t: bt, head, x: ox + dx * bt, y: oy + dy * bt, z: oz + dz * bt, wall: !best && bt < maxD - 0.01 };
  }
  noteVisit(P) { const n = this.nearestNode(P.x, P.z); if (n) this.visits.set(n, (this.visits.get(n) || 0) + 1); }
  removeBody(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); b.found = true; }

  reset() {
    this.alarm = 0;
    for (const n of this.npcs) if (n.state !== 'ko') {
      n.meter = 0; n.knowsHide = null; n.checkSpot = null;
      if (AGGRO.has(n.state) || n.state === 'search' || n.state === 'choked') { n.state = n.post ? 'post' : 'patrol'; n.holder.rotation.x = 0; n.cur = null; n.target = null; }
    }
  }

  update(dt, P) {
    this.time += dt; this.chasers = 0;
    for (const n of this.npcs) { n.update(dt, P); if (AGGRO.has(n.state)) this.chasers++; }
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const p = this.projectiles[k]; p.life -= dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      let kill = p.life <= 0 || p.m.position.y < 0.05 || this.blocked(p.m.position.x, p.m.position.z, 0.1, p.m.position.y + 0.05);
      if (!kill && P.alive && !P.hidden && !P.dashing && Math.hypot(p.m.position.x - P.x, p.m.position.z - P.z) < 0.7 && Math.abs(p.m.position.y - (P.y + 1.0)) < 1.1) { this.cb.hitPlayer(11, p.m.position.x - p.vx, p.m.position.z - p.vz); kill = true; }
      if (kill) { this.fx.emit(p.m.position.x, p.m.position.y, p.m.position.z, 6, 0xff7a3a, 3, 0.3); this.root.remove(p.m); this.projectiles.splice(k, 1); }
    }
    if (this.chasers > 0) this.alarm = Math.min(100, this.alarm + dt * 9 * Math.min(3, this.chasers)); else this.alarm = Math.max(0, this.alarm - dt * 6);
  }
}

export class NPC {
  constructor(mgr, type, x, z, opts) {
    this.mgr = mgr; this.type = type; this.cfg = TYPES[type]; this.opts = opts; this.censor = !!opts.censor;
    this.name = opts.name || this.cfg.prefix + (type === 'robot' || type === 'drone' ? '-' : '') + pad(Math.floor(rnd() * Math.pow(10, this.cfg.digits)), this.cfg.digits);
    this.x = x; this.z = z; this.y = type === 'drone' ? mgr.droneH : 0; this.yaw = rnd() * 6.28; this.post = !!opts.post;
    this.hp = this.maxHp = opts.hp || this.cfg.hp; this.state = this.post ? 'post' : 'patrol'; this.meter = 0;
    this.cur = opts.node || null; this.prev = null; this.target = null; this.waitT = rr(0, 3);
    this.lastSeen = new THREE.Vector2(x, z); this.lostT = 0; this.searchT = 0; this.fleeT = 0; this.atkCd = 0; this.windT = 0; this.shotCd = rr(0, 2);
    this.rate = 0; this.sees = false; this.percT = rnd() * 0.2; this.stagger = 0; this.flash = 0; this.kx = 0; this.kz = 0;
    this._sph = new THREE.Sphere(); this._v = new THREE.Vector3(); this.koT = 0; this.vy = 0; this.anim = ''; this.active = true; this.stuckT = 0; this.sidestepT = 0; this.sideDir = 1; this.reported = false; this.postBase = this.yaw;
    this.postX = x; this.postZ = z; this.knowsHide = null; this.checkSpot = null; this.checked = new Set(); this.lookT = 0; this.inspT = 0; this.turnT = 0; this.turnDir = 1;
    this.bodyT = rnd() * 0.4; this.found = false; this.unconscious = false; this.path = null; this.pi = 0; this.pathT = 0;
    this.holder = mgr.buildVisual(this);
    this.setAnim('idle');
  }

  setAnim(name, ts = 1) {
    if (!this.actions) return;
    const a = this.actions[name] || this.actions.idle; if (!a) return;
    a.timeScale = ts; if (name === this.anim) return;
    const old = this.actions[this.anim];
    if (old && old !== a) { a.reset().fadeIn(0.2).play(); old.fadeOut(0.2); } else a.reset().play();   // first clip without fade
    this.anim = name;
  }
  hostile() { return HOSTILE.has(this.type); }

  // How fast this NPC notices the player (meter units per second); sets this.sees when it has a clear view.
  perceive(P) {
    const cfg = this.cfg, dir = this.mgr.dir; this.sees = false;
    if (!cfg.range || !P.alive || P.cutscene || P.hidden) return 0;
    const dx = P.x - this.x, dz = P.z - this.z, d = Math.hypot(dx, dz); let rate = 0;
    const ears = 1 + 0.3 * (dir ? dir.ears : 0);
    if (P.noise > 0 && d < P.noise * ears) rate = 0.55 * (1 - d / (P.noise * ears));
    const alert = AGGRO.has(this.state) || this.state === 'search';   // an alerted enemy looks all around and sees farther
    const sneakMul = P.sneaking ? 0.5 + 0.3 * (dir ? dir.sneakWise : 0) : P.sprinting ? 1.25 : 1;
    const range = cfg.range * (alert ? 1.25 : 1) * sneakMul * (P.moving || P.sprinting ? 1 : 0.85) * (0.75 + 0.25 * (P.lit ?? 1));
    // crouched and keeping still, or creeping along a wall / through shadow: invisible unless someone nearly bumps into you
    const unseen = P.crouch && (!P.moving || P.cover) && d > 1.2;
    if (d < range && !unseen) {
      const dot = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / (d || 1);
      const near = d < (alert ? 6 : P.sneaking ? 1.6 : 3.4);   // peripheral awareness: anyone this close is noticed even from the side
      const fovCos = alert ? -0.35 : Math.cos(cfg.fov * Math.PI / 360);
      if ((near || dot > fovCos) && this.mgr.los(this.x, this.z, P.x, P.z, this.type === 'drone' ? 2.6 : 1.9)) {
        this.sees = true; rate = Math.max(rate, 2.4 * (1 - 0.5 * d / range) + (near ? 1.5 : 0));
      }
    }
    return rate;
  }

  // ----- movement -----
  moveToward(tx, tz, speed, dt, free = false) {
    let dx = tx - this.x, dz = tz - this.z; const d = Math.hypot(dx, dz); if (d < 0.02) return d;
    dx /= d; dz /= d; let cdx = dx, cdz = dz;
    if (!free) {
      let found = false;
      for (const a of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
        const aa = a * this.sideDir, c = Math.cos(aa), s = Math.sin(aa), ex = dx * c - dz * s, ez = dx * s + dz * c;
        if (!this.mgr.blocked(this.x + ex * 0.9, this.z + ez * 0.9, 0.4)) { cdx = ex; cdz = ez; found = true; break; }
      }
      if (!found) { this.stuckT += dt; if (this.stuckT > 0.6) { this.sideDir *= -1; this.stuckT = 0; } return d; }
    }
    const step = Math.min(speed * dt, d + 0.5);
    this.x += cdx * step; this.z += cdz * step;
    if (!free) { const p = { x: this.x, z: this.z }; this.mgr.resolve(p, 0.4); this.x = p.x; this.z = p.z; }
    this.yaw += angDiff(Math.atan2(cdx, cdz), this.yaw) * Math.min(1, dt * 9);
    return d;
  }
  face(tx, tz, dt, rate = 7) { this.yaw += angDiff(Math.atan2(tx - this.x, tz - this.z), this.yaw) * Math.min(1, dt * rate); }

  chooseNode() {
    if (!this.cur) { this.cur = this.mgr.nearestNode(this.x, this.z); if (!this.cur) return null; this.target = this.cur; return this.target; }
    const opts = this.cur.n.filter((n) => n !== this.prev); const list = opts.length ? opts : this.cur.n;
    return list.length ? pick(list) : null;
  }
  patrolMove(dt, speed, animWalk) {
    const vig = this.mgr.dir ? this.mgr.dir.vigilance : 0;
    if (this.turnT > 0) { this.turnT -= dt; this.yaw += dt * 2.7 * this.turnDir; this.setAnim('idle'); return; }   // glance over the shoulder
    if (this.post || !this.cur && !this.mgr.nearestNode(this.x, this.z)) { // stand guard and scan
      if (this.post && Math.hypot(this.postX - this.x, this.postZ - this.z) > 1.0) { this.mgr.navTo(this, this.postX, this.postZ, speed * 1.2, dt); this.setAnim(animWalk, 1); return; }
      this.yaw = this.postBase + Math.sin(this.mgr.time * 0.45 + this.postBase * 7) * Math.min(2.6, (this.scanAmp || 1.1) * (1 + 0.8 * vig)); this.setAnim('idle');
      if (vig > 0.4 && this.type !== 'drone' && rnd() < dt * 0.05 * vig) { this.turnT = rr(1.0, 1.6); this.turnDir = rnd() < 0.5 ? -1 : 1; }
      return;
    }
    if (this.waitT > 0) { this.waitT -= dt; this.setAnim('idle'); return; }
    if (!this.target) { this.target = this.chooseNode(); if (!this.target) { this.waitT = 2; return; } }
    const d = this.moveToward(this.target.x, this.target.z, speed, dt, this.type === 'drone');
    this.setAnim(animWalk, speed < 2 ? 0.9 : 1);
    if (d < 0.9) {
      this.prev = this.cur; this.cur = this.target; this.target = null; if (rnd() < this.cfg.pause) this.waitT = rr(1, 4);
      if (this.type !== 'drone' && rnd() < 0.12 + 0.45 * vig) { this.turnT = rr(1.1, 2.0); this.turnDir = rnd() < 0.5 ? -1 : 1; }   // alert guards check behind them
    }
  }

  // ----- reactions -----
  hear(x, z, dur = 10, meter = 0.55) {   // heard something: go and look
    if (!this.hostile() || this.state === 'ko' || this.state === 'choked' || AGGRO.has(this.state)) return;
    this.lastSeen.set(x, z); this.meter = Math.max(this.meter, meter);
    if (this.state !== 'search') { this.state = 'search'; this.searchT = dur; this.checked.clear(); this.checkSpot = null; this.lookT = 0; }
    else this.searchT = Math.max(this.searchT, dur * 0.7);
  }
  pickSpot() {   // after the player used a hiding place once, guards start checking them
    const m = this.mgr; if (!m.dir || m.dir.hideWise < 0.1) return null;
    let best = null, bd = 16;
    for (const s of m.hideSpots) { if (this.checked.has(s.id)) continue; const d = Math.hypot(s.x - this.lastSeen.x, s.z - this.lastSeen.y); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  resolveHide(spot, P, sure) {   // opens a hiding place: is the player inside?
    const m = this.mgr; this.checked.add(spot.id);
    if (P.hidden && P.hideId === spot.id && (sure || this.knowsHide === spot || rnd() < 0.25 + 0.55 * (m.dir ? m.dir.hideWise : 0) + 0.15 * Math.min(2, m.dir ? m.dir.spotCount(spot.id) : 0))) { m.cb.foundHidden?.(spot, this); return true; }
    return false;
  }
  discoverBody(b) {
    const m = this.mgr; m.removeBody(b);
    this.state = 'search'; this.lastSeen.set(b.x, b.z); this.searchT = 15; this.meter = Math.max(this.meter, 0.7); this.checked.clear(); this.checkSpot = null; this.lookT = 0;
    m.alertNearby(this.x, this.z, 24, { x: b.x, z: b.z }); m.dir?.onBodyFound(); m.cb.onBodyFound?.(b); sfx.alert(m.vol(this.x, this.z, m.lastP || { x: this.x, z: this.z }));
  }
  seesBody() {
    const m = this.mgr; if (!m.bodies.length) return null;
    const half = Math.cos((this.cfg.fov || 110) * Math.PI / 360);
    for (const b of m.bodies) {
      if (b.found) continue;
      const dx = b.x - this.x, dz = b.z - this.z, d = Math.hypot(dx, dz);
      if (d < 13 && (d < 2.5 || (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / (d || 1) > half) && m.los(this.x, this.z, b.x, b.z, 0.9)) return b;
    }
    return null;
  }

  // ----- combat -----
  takeHit(dmg, dx, dz, src, P, crit) {
    if (this.state === 'ko') return;
    const ar = this.cfg.armor && this.cfg.armor[src]; if (ar) dmg *= ar;
    const gun = src === 'gun';
    this.hp -= dmg; this.flash = 0.18; this.stagger = src === 'fist' ? 0 : gun ? 0.12 : this.type === 'robot' ? 0.15 : 0.35;   // fists never stun-lock
    const kb = gun ? 1.5 : src === 'fist' ? 1.2 : this.type === 'robot' ? 2 : 5; this.kx = dx * kb; this.kz = dz * kb;
    const m = this.mgr, fx = m.fx, y = this.y + (this.type === 'drone' ? 0 : 1.2);
    if (this.type === 'robot' || this.type === 'drone') { fx.emit(this.x, y, this.z, 20, 0xffa040, 5, 0.5); sfx.metal(m.vol(this.x, this.z, P)); }
    else fx.emit(this.x, y, this.z, 12, 0xfff0c0, 3.5, 0.35, 5);
    sfx.hit(m.vol(this.x, this.z, P));
    m.cb.onHit?.(this, !!crit);
    if (this.hp <= 0) { this.die(P); return; }
    if (this.type === 'citizen' || this.type === 'prisoner') this.flee(P.x, P.z);
    else if (!AGGRO.has(this.state)) this.startChase(P);
  }
  flee(x, z) { this.state = 'flee'; this.fleeT = 6; this.fleeFrom = { x, z }; if (!this.reported && this.hostile() === false) { this.reported = true; this.mgr.alertNearby(this.x, this.z, 30, { x: this.x, z: this.z }); } }
  startChase(P) {
    if (AGGRO.has(this.state) || this.state === 'ko' || this.state === 'choked') return;
    this.state = 'chase'; this.meter = 1; this.lostT = 0; this.lastSeen.set(P.x, P.z); this.checkSpot = null; this.path = null;
    this.mgr.alertNearby(this.x, this.z, 28, P); this.mgr.cb.onSpotted?.(this);
    sfx.alert(this.mgr.vol(this.x, this.z, P));
  }
  beginChoke() { this.state = 'choked'; this.path = null; this.checkSpot = null; this.meter = 0; this.sees = false; }
  endChoke(P, knockedOut) {
    if (this.state !== 'choked') return;
    if (knockedOut) { this.die(P, true); return; }
    this.holder.rotation.x = 0; this.holder.rotation.z = 0; this.state = 'patrol'; this.startChase(P);   // struggles free
  }
  die(P, quiet = false) {
    this.state = 'ko'; this.koT = 0; this.hp = 0; this.icon.visible = false; this.nameSprite.visible = false; this.hpBar.visible = false;
    this.unconscious = quiet; this.found = false; this.path = null;
    if (!quiet) sfx.ko(this.mgr.vol(this.x, this.z, P)); else sfx.thud?.(0.6);
    if (this.type !== 'drone') this.mgr.bodies.push(this);
    this.mgr.cb.onKill?.(this, quiet);
    if (this.type === 'drone') { this.vy = 0; this.fx0 = true; }
  }
  updateKO(dt) {
    this.koT += dt;
    if (this.type === 'drone') {
      this.vy -= 18 * dt; this.y = Math.max(0.3, this.y + this.vy * dt); this.holder.rotation.z += dt * 6; this.holder.rotation.x += dt * 4;
      if (this.y <= 0.3 && this.fx0) { this.fx0 = false; this.mgr.fx.emit(this.x, 0.4, this.z, 30, 0xffa040, 6, 0.6); sfx.metal(0.7); }
      if (this.koT > 2.5) this.holder.visible = false;
    } else {
      this.holder.rotation.x += (-Math.PI / 2 - this.holder.rotation.x) * Math.min(1, dt * 6);
      this.holder.rotation.z *= Math.max(0, 1 - dt * 8);
      this.holder.position.y = Math.max(0.12, this.holder.position.y - dt * 0.5);
      if (this.type === 'robot' && this.koT < 2 && rnd() < dt * 8 && !this.unconscious) this.mgr.fx.emit(this.x + rr(-0.3, 0.3), 0.4, this.z + rr(-0.3, 0.3), 3, 0xffa040, 2.5, 0.4);
      this.mixer?.update(dt * 0.0);
      if (this.koT > 120) { this.holder.visible = false; if (!this.found) this.mgr.removeBody(this); }
    }
    this.holder.position.x = this.x; this.holder.position.z = this.z; if (this.type === 'drone') this.holder.position.y = this.y;
  }

  // ----- main update -----
  update(dt, P) {
    const m = this.mgr, dPlayer = Math.hypot(this.x - P.x, this.z - P.z); m.lastP = P;
    this.active = this.state === 'ko' ? this.holder.visible : dPlayer < 52;
    if (this.state === 'ko') { if (this.holder.visible) this.updateKO(dt); return; }
    this.holder.visible = this.active && (!m.frustum || m.frustum.intersectsSphere(this._sph.set(this._v.set(this.x, this.y + 1, this.z), 2.4))); if (!this.active) return;

    this.atkCd -= dt; this.shotCd -= dt;
    if (this.state === 'choked') {   // held by the player: struggles, leans back
      this.holder.rotation.x += (-0.42 - this.holder.rotation.x) * Math.min(1, dt * 5); this.holder.rotation.z = Math.sin(m.time * 36) * 0.07;
      this.setAnim('idle'); this.sync(dt, dPlayer, P); return;
    }
    // staggered: knockback, no actions
    if (this.stagger > 0) {
      this.stagger -= dt; const p = { x: this.x + this.kx * dt, z: this.z + this.kz * dt }; if (this.type !== 'drone') m.resolve(p, 0.4); this.x = p.x; this.z = p.z; this.kx *= 0.88; this.kz *= 0.88;
      this.setAnim('idle'); this.sync(dt, dPlayer, P); return;
    }
    // perception (10 Hz)
    this.percT -= dt; if (this.percT <= 0) { this.rate = this.perceive(P); this.percT = 0.1; }
    const cfg = this.cfg;

    if (this.type === 'citizen' || this.type === 'prisoner') {
      if (this.state === 'flee') {
        this.fleeT -= dt; const ax = this.x - this.fleeFrom.x, az = this.z - this.fleeFrom.z, l = Math.hypot(ax, az) || 1;
        this.moveToward(this.x + ax / l * 5, this.z + az / l * 5, cfg.run, dt); this.setAnim('run');
        if (this.fleeT <= 0) { this.state = 'patrol'; this.reported = false; this.cur = null; this.target = null; }
      } else {
        this.bodyT -= dt;
        let b = null; if (this.bodyT <= 0) { this.bodyT = 0.5; b = this.seesBody(); }
        if (b) { m.removeBody(b); this.flee(b.x, b.z); }   // a citizen finds a body: runs and reports
        else if (P.attackedAt > m.time - 1.2 && dPlayer < 16 && P.alive && !P.hidden && m.los(this.x, this.z, P.x, P.z)) this.flee(P.x, P.z);
        else this.patrolMove(dt, cfg.walk, 'walk');
      }
      this.sync(dt, dPlayer, P); return;
    }

    // hostile AI
    const st = this.state;
    if (st === 'patrol' || st === 'post' || st === 'idle') {
      if (this.rate > 0) this.meter = Math.min(1.1, this.meter + this.rate * dt); else this.meter = Math.max(0, this.meter - 0.3 * dt);
      this.bodyT -= dt; let b = null; if (this.bodyT <= 0) { this.bodyT = 0.4; b = this.seesBody(); }
      if (this.meter >= 1) this.startChase(P);
      else if (b) this.discoverBody(b);
      else if (this.meter > 0.35 && this.rate > 0) { this.face(P.x, P.z, dt); this.setAnim('idle'); this.lastSeen.set(P.x, P.z); this.turnT = 0; }
      else this.patrolMove(dt, cfg.walk, 'walk');
    } else if (st === 'search') {
      this.searchT -= dt;
      if (this.rate > 0) { this.meter = Math.min(1.1, this.meter + this.rate * dt); if (this.meter >= 1) this.startChase(P); if (this.sees) this.lastSeen.set(P.x, P.z); }
      this.bodyT -= dt; if (this.bodyT <= 0) { this.bodyT = 0.5; const b = this.seesBody(); if (b) this.discoverBody(b); }
      if (this.state === 'search') {
        if (this.checkSpot) {
          const s = this.checkSpot, d = Math.hypot(s.x - this.x, s.z - this.z);
          if (d > 1.9) { m.navTo(this, s.x, s.z, cfg.walk * 1.6, dt); this.setAnim('walk', 1.3); }
          else { this.face(s.x, s.z, dt); this.setAnim('idle'); this.inspT -= dt; if (this.inspT <= 0) { this.resolveHide(s, P, false); this.checkSpot = null; this.lookT = 0; } }
        } else {
          const d = Math.hypot(this.lastSeen.x - this.x, this.lastSeen.y - this.z), fast = 1.5 + 0.4 * (m.dir ? m.dir.gunWise : 0);
          if (d > 1.4) { m.navTo(this, this.lastSeen.x, this.lastSeen.y, cfg.walk * fast, dt, this.type === 'drone'); this.setAnim('walk', 1.2); }
          else {
            this.yaw += dt * 1.6; this.setAnim('idle'); this.lookT += dt;
            if (this.lookT > 2.2 && this.type !== 'drone') { this.lookT = 0; if (this.checked.size < 3) { const s = this.pickSpot(); if (s) { this.checkSpot = s; this.inspT = 1.3; } } }
          }
        }
        if (this.searchT <= 0) { this.state = this.post ? 'post' : 'patrol'; this.meter = 0.25; this.target = null; this.cur = null; this.checked.clear(); this.checkSpot = null; }
      }
    } else if (st === 'chase') {
      const kh = this.knowsHide && P.hidden && P.hideId === this.knowsHide.id ? this.knowsHide : null; if (!kh) this.knowsHide = null;
      if (this.sees || this.rate > 0.3 || kh) { if (kh) this.lastSeen.set(kh.x, kh.z); else this.lastSeen.set(P.x, P.z); this.lostT = 0; } else this.lostT += dt;
      if (!P.alive) { this.state = 'search'; this.searchT = 4; }
      else if (this.lostT > 4) { this.state = 'search'; this.searchT = 12; this.meter = 0.6; this.checked.clear(); this.checkSpot = null; this.lookT = 0; }   // loses the trail
      else if (this.type === 'drone') this.droneChase(dt, P);
      else {
        const d = Math.hypot(this.lastSeen.x - this.x, this.lastSeen.y - this.z), g = cfg.gun;
        if (kh && d < 1.8) { this.face(kh.x, kh.z, dt, 10); this.setAnim('idle'); this.inspT += dt; if (this.inspT > 0.5) { this.inspT = 0; this.resolveHide(kh, P, true); } }
        else if (this.sees && dPlayer < cfg.atk.range && this.atkCd <= 0) { this.state = 'attack'; this.windT = cfg.atk.wind; this.setAnim('idle'); }
        else if (g && this.sees && dPlayer > cfg.atk.range + 1.5 && dPlayer < g.range && this.shotCd <= 0) { this.state = 'shoot'; this.windT = g.wind; this.setAnim('idle'); }
        else if (g && this.sees && dPlayer < 9 && dPlayer > 4) { this.face(P.x, P.z, dt, 8); this.setAnim('idle'); }   // holds ground and fights from range
        else if (d > 1.2) { m.navTo(this, this.lastSeen.x, this.lastSeen.y, cfg.run, dt); this.setAnim('run', cfg.run < 4 ? 0.9 : 1); }
        else { this.face(P.x, P.z, dt); this.setAnim('idle'); }
      }
    } else if (st === 'shoot') {
      this.windT -= dt; this.face(P.x, P.z, dt, 12); this.flash = Math.max(this.flash, 0.04 + 0.08 * Math.sin(this.windT * 30) ** 2);
      if (this.windT <= 0) {
        this.state = 'chase'; this.shotCd = cfg.gun.cd + rr(0, 0.7);
        if (P.alive && !P.hidden) m.fire({ x: this.x + Math.sin(this.yaw) * 0.6, y: 1.35, z: this.z + Math.cos(this.yaw) * 0.6 }, P, Math.hypot(P.x - this.x, P.z - this.z) * 0.16);
      }
    } else if (st === 'attack') {
      this.windT -= dt; this.face(P.x, P.z, dt, 10); this.flash = Math.max(this.flash, 0.05 + 0.1 * Math.sin(this.windT * 30) ** 2);
      if (this.windT <= 0) {
        this.atkCd = cfg.atk.cd; this.state = 'chase';
        const d = Math.hypot(P.x - this.x, P.z - this.z);
        if (d < cfg.atk.range + 0.7 && P.alive && !P.hidden && !P.dashing && Math.abs(P.y - this.y) < 1.2) m.cb.hitPlayer(cfg.atk.dmg, this.x, this.z);
        sfx.swing(); this.x += Math.sin(this.yaw) * 0.4; this.z += Math.cos(this.yaw) * 0.4;
      }
    }
    this.sync(dt, dPlayer, P);
  }
  // Drones are the Dictator's sentries: they watch and raise the alarm, but never attack. They can be knocked out.
  droneChase(dt, P) {
    const tx = P.x + Math.sin(this.mgr.time * 0.8 + this.postBase) * 6, tz = P.z + Math.cos(this.mgr.time * 0.8 + this.postBase) * 6;
    this.moveToward(tx, tz, this.cfg.run * 0.8, dt, true); this.face(P.x, P.z, dt, 8);
  }

  // visual sync + icon logic
  sync(dt, dPlayer, P) {
    const h = this.holder; this.mixer?.update(dt);
    if (this.type === 'drone') {
      const wantY = this.state === 'chase' ? this.mgr.droneLow : this.mgr.droneH; this.y += (wantY - this.y) * Math.min(1, dt * 2); h.position.set(this.x, this.y + Math.sin(this.mgr.time * 2 + this.postBase) * 0.15, this.z);
      for (const r of this.rotors) r.rotation.y += dt * 40;
      const st = this.state; this.lens.material.color.setHex(st === 'chase' || st === 'attack' ? 0xff1a0a : st === 'search' || this.meter > 0.35 ? 0xffc02a : 0x66ff88);
    } else h.position.set(this.x, 0, this.z);
    h.rotation.y = this.yaw;
    // hit flash / telegraph
    if (this.flash > 0) this.flash -= dt;
    const f = Math.max(0, this.flash * 5);
    for (const mt of this.mats) { if (mt.emissive) { mt.emissive.copy(mt.userData.baseEm || mt.emissive); if (f > 0) mt.emissive.addScalar(Math.min(1, f) * 0.8); } }
    // icon + name + hp
    const I = icons(), st = this.state;
    const show = st === 'choked' ? false : this.hostile() ? (dPlayer < 26) : (st === 'flee' && dPlayer < 20);
    let map = null, scale = [0.9, 0.45];
    if (this.hostile()) {
      if (AGGRO.has(st)) { map = I.alert; scale = [0.55, 0.55]; }
      else if (st === 'search') { map = I.search; scale = [0.55, 0.55]; }
      else map = this.meter > 0.6 ? I.open : this.meter > 0.12 ? I.half : I.closed;
    }
    this.iconMat.opacity += ((show && map ? 1 : 0) - this.iconMat.opacity) * Math.min(1, dt * 8);
    if (map) { if (this.iconMat.map !== map) { this.iconMat.map = map; this.iconMat.needsUpdate = true; } this.icon.scale.set(scale[0], scale[1], 1); this.icon.position.y = this.headY + (scale[0] < 0.6 ? 0.08 : 0); }
    this.nameMat.opacity += ((dPlayer < 13 && P.alive && st !== 'choked' ? 0.9 : 0) - this.nameMat.opacity) * Math.min(1, dt * 6);
    const hurt = this.hp < this.maxHp;
    this.hpMat.opacity += ((hurt && dPlayer < 16 ? 0.9 : 0) - this.hpMat.opacity) * Math.min(1, dt * 6);
    this.hpBar.scale.x = 0.9 * Math.max(0.02, this.hp / this.maxHp);
  }
}

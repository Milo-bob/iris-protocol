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
  citizen:  { prefix: 'Citizen',  digits: 5, hp: 30,  walk: 1.4, run: 4.6, tint: 0x80868e, scale: 0.97, model: 'soldier', pause: 0.5 },
  prisoner: { prefix: 'Prisoner', digits: 3, hp: 30,  walk: 1.3, run: 4.4, tint: 0xe8863a, scale: 0.98, model: 'soldier', pause: 0.6 },
  guard:    { prefix: 'Guard',    digits: 4, hp: 70,  walk: 1.9, run: 5.0, tint: 0x8e2a2a, scale: 1.02, model: 'soldier', range: 17, fov: 110, pause: 0.25, atk: { range: 2.0, wind: 0.45, dmg: 9, cd: 1.2 } },
  robot:    { prefix: 'Unit',     digits: 4, hp: 170, walk: 1.5, run: 3.7, tint: 0xffffff, emissive: 0x4a0a00, scale: 1.12, model: 'xbot', range: 20, fov: 100, pause: 0.15, atk: { range: 2.4, wind: 0.75, dmg: 20, cd: 1.9 } },
  drone:    { prefix: 'Drone',    digits: 4, hp: 40,  walk: 3.0, run: 6.5, range: 18, fov: 130, pause: 0 },
};
const HOSTILE = new Set(['guard', 'robot', 'drone']);
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
  constructor(scene, colliders, fx, cbs) {
    this.scene = scene; this.grid = new Grid(colliders); this.fx = fx; this.cb = cbs;
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

  // ----- alerts & projectiles -----
  alertNearby(x, z, radius, to) {
    for (const n of this.npcs) {
      if (!HOSTILE.has(n.type) || n.state === 'ko' || n.state === 'chase' || n.state === 'attack') continue;
      if (Math.hypot(n.x - x, n.z - z) < radius) { n.lastSeen.set(to.x, to.z); n.state = 'search'; n.searchT = 9; n.meter = Math.max(n.meter, 0.7); }
    }
  }
  fire(from, P) {
    const geo = this._pg || (this._pg = new THREE.SphereGeometry(0.17, 8, 6)), mat = this._pm || (this._pm = new THREE.MeshBasicMaterial({ color: 0xff4a24 }));
    const m = new THREE.Mesh(geo, mat); m.position.set(from.x, from.y, from.z);
    const dx = P.x - from.x, dy = 1.1 - from.y, dz = P.z - from.z, d = Math.hypot(dx, dy, dz), sp = 15;
    this.root.add(m); this.projectiles.push({ m, vx: dx / d * sp, vy: dy / d * sp, vz: dz / d * sp, life: 3 });
    sfx.zap(this.vol(from.x, from.z, P));
  }
  vol(x, z, P) { return Math.max(0.1, 1 - Math.hypot(x - P.x, z - P.z) / 30); }

  meleeHit(P, yaw, { range = 2.7, half = 1.0, dmg = 22 } = {}) {
    const hits = [];
    for (const n of this.npcs) {
      if (!n.active || n.state === 'ko') continue;
      const dx = n.x - P.x, dz = n.z - P.z, d = Math.hypot(dx, dz);
      if (d > range + 0.2 || (n.type === 'drone' && n.y > 3.4)) continue;
      if (d > 1.0 && Math.abs(angDiff(Math.atan2(dx, dz), yaw)) > half) continue;
      const unaware = ['patrol', 'post', 'idle'].includes(n.state) && n.meter < 0.35;
      const behind = Math.sin(n.yaw) * (P.x - n.x) + Math.cos(n.yaw) * (P.z - n.z) < 0;
      const back = unaware && behind && HOSTILE.has(n.type);
      n.takeHit(dmg * (back ? 4 : 1), dx / (d || 1), dz / (d || 1), back, P);
      hits.push({ n, back });
    }
    return hits;
  }

  reset() {
    this.alarm = 0;
    for (const n of this.npcs) if (n.state !== 'ko') { n.meter = 0; if (n.state === 'chase' || n.state === 'attack' || n.state === 'search') n.state = n.post ? 'post' : 'patrol'; }
  }

  update(dt, P) {
    this.time += dt; this.chasers = 0;
    for (const n of this.npcs) { n.update(dt, P); if (n.state === 'chase' || n.state === 'attack') this.chasers++; }
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const p = this.projectiles[k]; p.life -= dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      let kill = p.life <= 0 || p.m.position.y < 0.05 || this.blocked(p.m.position.x, p.m.position.z, 0.1, p.m.position.y + 0.05);
      if (!kill && P.alive && !P.dashing && Math.hypot(p.m.position.x - P.x, p.m.position.z - P.z) < 0.7 && Math.abs(p.m.position.y - (P.y + 1.0)) < 1.1) { this.cb.hitPlayer(7, p.m.position.x - p.vx, p.m.position.z - p.vz); kill = true; }
      if (kill) { this.fx.emit(p.m.position.x, p.m.position.y, p.m.position.z, 6, 0xff7a3a, 3, 0.3); this.root.remove(p.m); this.projectiles.splice(k, 1); }
    }
    if (this.chasers > 0) this.alarm = Math.min(100, this.alarm + dt * 9 * Math.min(3, this.chasers)); else this.alarm = Math.max(0, this.alarm - dt * 6);
  }
}

class NPC {
  constructor(mgr, type, x, z, opts) {
    this.mgr = mgr; this.type = type; this.cfg = TYPES[type]; this.opts = opts; this.censor = !!opts.censor;
    this.name = opts.name || this.cfg.prefix + (type === 'robot' || type === 'drone' ? '-' : '') + pad(Math.floor(rnd() * Math.pow(10, this.cfg.digits)), this.cfg.digits);
    this.x = x; this.z = z; this.y = type === 'drone' ? mgr.droneH : 0; this.yaw = rnd() * 6.28; this.post = !!opts.post;
    this.hp = this.maxHp = opts.hp || this.cfg.hp; this.state = this.post ? 'post' : 'patrol'; this.meter = 0;
    this.cur = opts.node || null; this.prev = null; this.target = null; this.waitT = rr(0, 3);
    this.lastSeen = new THREE.Vector2(x, z); this.lostT = 0; this.searchT = 0; this.fleeT = 0; this.atkCd = 0; this.windT = 0; this.shotCd = rr(0, 2);
    this.rate = 0; this.sees = false; this.percT = rnd() * 0.2; this.stagger = 0; this.flash = 0; this.kx = 0; this.kz = 0;
    this._sph = new THREE.Sphere(); this._v = new THREE.Vector3(); this.koT = 0; this.vy = 0; this.anim = ''; this.active = true; this.stuckT = 0; this.sidestepT = 0; this.sideDir = 1; this.reported = false; this.postBase = this.yaw;
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

  perceive(P) {
    const cfg = this.cfg; this.sees = false;
    if (!cfg.range || !P.alive || P.cutscene) return 0;
    const dx = P.x - this.x, dz = P.z - this.z, d = Math.hypot(dx, dz); let rate = 0;
    if (P.noise > 0 && d < P.noise) rate = 0.55 * (1 - d / P.noise);
    const range = cfg.range * (P.sneaking ? 0.45 : P.sprinting ? 1.2 : 1);
    if (d < range) {
      const dot = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / (d || 1);
      if ((d < 3 || dot > Math.cos(cfg.fov * Math.PI / 360)) && this.mgr.los(this.x, this.z, P.x, P.z, this.type === 'drone' ? 2.6 : 1.9)) {
        this.sees = true; rate = Math.max(rate, 1.25 * (1 - 0.65 * d / range) + (d < 3 ? 1.5 : 0));
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
    if (this.post || !this.cur && !this.mgr.nearestNode(this.x, this.z)) { // stand guard and scan
      this.yaw = this.postBase + Math.sin(this.mgr.time * 0.45 + this.postBase * 7) * (this.scanAmp || 1.1); this.setAnim('idle'); return;
    }
    if (this.waitT > 0) { this.waitT -= dt; this.setAnim('idle'); return; }
    if (!this.target) { this.target = this.chooseNode(); if (!this.target) { this.waitT = 2; return; } }
    const d = this.moveToward(this.target.x, this.target.z, speed, dt, this.type === 'drone');
    this.setAnim(animWalk, speed < 2 ? 0.9 : 1);
    if (d < 0.9) { this.prev = this.cur; this.cur = this.target; this.target = null; if (rnd() < this.cfg.pause) this.waitT = rr(1, 4); }
  }

  // ----- combat -----
  takeHit(dmg, dx, dz, back, P) {
    if (this.state === 'ko') return;
    this.hp -= dmg; this.flash = 0.18; this.stagger = this.type === 'robot' ? 0.15 : 0.35; this.kx = dx * (this.type === 'robot' ? 2 : 5); this.kz = dz * (this.type === 'robot' ? 2 : 5);
    const m = this.mgr, fx = m.fx, y = this.y + (this.type === 'drone' ? 0 : 1.2);
    if (this.type === 'robot' || this.type === 'drone') { fx.emit(this.x, y, this.z, 20, 0xffa040, 5, 0.5); sfx.metal(m.vol(this.x, this.z, P)); }
    else fx.emit(this.x, y, this.z, 12, 0xfff0c0, 3.5, 0.35, 5);
    sfx.hit(m.vol(this.x, this.z, P));
    m.cb.onHit?.(this, back);
    if (this.hp <= 0) { this.die(P); return; }
    if (this.type === 'citizen' || this.type === 'prisoner') this.flee(P.x, P.z);
    else if (this.state !== 'chase' && this.state !== 'attack') this.startChase(P);
  }
  flee(x, z) { this.state = 'flee'; this.fleeT = 6; this.fleeFrom = { x, z }; if (!this.reported && this.hostile() === false) { this.reported = true; this.mgr.alertNearby(this.x, this.z, 30, { x: this.x, z: this.z }); } }
  startChase(P) {
    if (this.state === 'chase' || this.state === 'attack') return;
    this.state = 'chase'; this.meter = 1; this.lostT = 0; this.lastSeen.set(P.x, P.z);
    this.mgr.alertNearby(this.x, this.z, 28, P); this.mgr.cb.onSpotted?.(this);
    sfx.alert(this.mgr.vol(this.x, this.z, P));
  }
  die(P) {
    this.state = 'ko'; this.koT = 0; this.hp = 0; this.icon.visible = false; this.nameSprite.visible = false; this.hpBar.visible = false;
    sfx.ko(this.mgr.vol(this.x, this.z, P)); this.mgr.cb.onKill?.(this);
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
      this.holder.position.y = Math.max(0.12, this.holder.position.y - dt * 0.5);
      if (this.type === 'robot' && this.koT < 2 && rnd() < dt * 8) this.mgr.fx.emit(this.x + rr(-0.3, 0.3), 0.4, this.z + rr(-0.3, 0.3), 3, 0xffa040, 2.5, 0.4);
      this.mixer?.update(dt * 0.0);
      if (this.koT > 25) this.holder.visible = false;
    }
    this.holder.position.x = this.x; this.holder.position.z = this.z; if (this.type === 'drone') this.holder.position.y = this.y;
  }

  // ----- main update -----
  update(dt, P) {
    const m = this.mgr, dPlayer = Math.hypot(this.x - P.x, this.z - P.z);
    this.active = this.state === 'ko' ? this.holder.visible : dPlayer < 52;
    if (this.state === 'ko') { if (this.holder.visible) this.updateKO(dt); return; }
    this.holder.visible = this.active && (!m.frustum || m.frustum.intersectsSphere(this._sph.set(this._v.set(this.x, this.y + 1, this.z), 2.4))); if (!this.active) return;

    this.atkCd -= dt;
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
        if (this.fleeT <= 0) { this.state = 'patrol'; this.reported = false; }
      } else {
        if (P.attackedAt > m.time - 1.2 && dPlayer < 16 && P.alive && m.los(this.x, this.z, P.x, P.z)) this.flee(P.x, P.z);
        else this.patrolMove(dt, cfg.walk, 'walk');
      }
      this.sync(dt, dPlayer, P); return;
    }

    // hostile AI
    if (this.state === 'patrol' || this.state === 'post' || this.state === 'idle') {
      if (this.rate > 0) this.meter = Math.min(1.1, this.meter + this.rate * dt); else this.meter = Math.max(0, this.meter - 0.3 * dt);
      if (this.meter >= 1) this.startChase(P);
      else if (this.meter > 0.35 && this.rate > 0) { this.face(P.x, P.z, dt); this.setAnim('idle'); this.lastSeen.set(P.x, P.z); }
      else this.patrolMove(dt, this.type === 'drone' ? cfg.walk : cfg.walk, 'walk');
    } else if (this.state === 'search') {
      this.searchT -= dt;
      if (this.rate > 0) { this.meter = Math.min(1.1, this.meter + this.rate * dt); if (this.meter >= 1) this.startChase(P); }
      const d = Math.hypot(this.lastSeen.x - this.x, this.lastSeen.y - this.z);
      if (d > 1.4) { this.moveToward(this.lastSeen.x, this.lastSeen.y, cfg.walk * 1.5, dt, this.type === 'drone'); this.setAnim('walk', 1.2); }
      else { this.yaw += dt * 1.6; this.setAnim('idle'); }
      if (this.searchT <= 0) { this.state = this.post ? 'post' : 'patrol'; this.meter = 0.25; this.target = null; }
    } else if (this.state === 'chase') {
      if (this.sees || this.rate > 0.3) { this.lastSeen.set(P.x, P.z); this.lostT = 0; } else this.lostT += dt;
      if (!P.alive) { this.state = 'search'; this.searchT = 4; }
      else if (this.lostT > 3.5) { this.state = 'search'; this.searchT = 7; this.meter = 0.6; }
      else if (this.type === 'drone') this.droneChase(dt, P);
      else {
        const d = Math.hypot(this.lastSeen.x - this.x, this.lastSeen.y - this.z);
        if (this.sees && d < cfg.atk.range && this.atkCd <= 0) { this.state = 'attack'; this.windT = cfg.atk.wind; this.setAnim('idle'); }
        else if (d > 1.2) { this.moveToward(this.lastSeen.x, this.lastSeen.y, cfg.run, dt); this.setAnim('run', cfg.run < 4 ? 0.9 : 1); }
        else { this.face(P.x, P.z, dt); this.setAnim('idle'); }
      }
    } else if (this.state === 'attack') {
      this.windT -= dt; this.face(P.x, P.z, dt, 10); this.flash = Math.max(this.flash, 0.05 + 0.1 * Math.sin(this.windT * 30) ** 2);
      if (this.windT <= 0) {
        this.atkCd = cfg.atk.cd; this.state = 'chase';
        const d = Math.hypot(P.x - this.x, P.z - this.z);
        if (d < cfg.atk.range + 0.7 && P.alive && !P.dashing && Math.abs(P.y - this.y) < 1.2) m.cb.hitPlayer(cfg.atk.dmg, this.x, this.z);
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
    const show = this.hostile() ? (dPlayer < 26) : (st === 'flee' && dPlayer < 20);
    let map = null, scale = [0.9, 0.45];
    if (this.hostile()) {
      if (st === 'chase' || st === 'attack') { map = I.alert; scale = [0.55, 0.55]; }
      else if (st === 'search') { map = I.search; scale = [0.55, 0.55]; }
      else map = this.meter > 0.6 ? I.open : this.meter > 0.12 ? I.half : I.closed;
    }
    this.iconMat.opacity += ((show && map ? 1 : 0) - this.iconMat.opacity) * Math.min(1, dt * 8);
    if (map) { if (this.iconMat.map !== map) { this.iconMat.map = map; this.iconMat.needsUpdate = true; } this.icon.scale.set(scale[0], scale[1], 1); this.icon.position.y = this.headY + (scale[0] < 0.6 ? 0.08 : 0); }
    this.nameMat.opacity += ((dPlayer < 13 && P.alive ? 0.9 : 0) - this.nameMat.opacity) * Math.min(1, dt * 6);
    const hurt = this.hp < this.maxHp;
    this.hpMat.opacity += ((hurt && dPlayer < 16 ? 0.9 : 0) - this.hpMat.opacity) * Math.min(1, dt * 6);
    this.hpBar.scale.x = 0.9 * Math.max(0.02, this.hp / this.maxHp);
  }
}

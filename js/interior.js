import * as THREE from 'three';
import { mergeGeometries } from './jsm/utils/BufferGeometryUtils.js';
import { pbr, instanced } from './assets.js';
import { bannerTexture, eyeTexture } from './city.js';
import { chalkMesh, dirYaw } from './tutorial.js';

// ---------------------------------------------------------------------------
// Tower interior: procedurally generated floors (BSP rooms + corridors), themed per floor.
// ---------------------------------------------------------------------------
export const CS = 3;            // grid cell size (m)
export const WALL_H = 3.8;
const GW = 30, GH = 30;

export const FLOORS = [
  { id: 1, name: 'LOBBY & REGISTRY',   sub: 'Present your papers, citizen',      theme: 'lobby',   lock: null },
  { id: 2, name: 'RECORDS ARCHIVE',    sub: 'Every life is a file',              theme: 'records', lock: 'file' },
  { id: 3, name: 'PROPAGANDA STUDIOS', sub: 'The truth is whatever we broadcast', theme: 'studio',  lock: null },
  { id: 4, name: 'MACHINE WORKS',      sub: 'Obedience, manufactured',           theme: 'machine', lock: null },
  { id: 5, name: 'SURVEILLANCE FLOOR', sub: 'Nothing is unseen',                 theme: 'surveil', lock: 'censor' },
];

const THEMES = {
  lobby:   { wall: 'precast_concrete_wall', wt: 0xe0d0c8, floor: 'concrete_floor_worn_001', ft: 0xb8a8a0, light: 0xffd9a0, fog: 0x240c0c, n: { guard: 4, drone: 1, robot: 0, citizen: 4 } },
  records: { wall: 'plastered_wall_03',     wt: 0xf0e0b0, floor: 'concrete_floor_worn_001', ft: 0xd0b890, light: 0xffe0a0, fog: 0x22100a, n: { guard: 5, drone: 2, robot: 1, citizen: 2 } },
  studio:  { wall: 'dark_brick_wall',       wt: 0xf0b0a0, floor: 'painted_concrete',        ft: 0xa08090, light: 0xff9a60, fog: 0x2a0a0c, n: { guard: 5, drone: 3, robot: 2, citizen: 4 } },
  machine: { wall: 'metal_plate',           wt: 0xe0a080, floor: 'rusty_metal_sheet',       ft: 0xc09068, light: 0xff7a2a, fog: 0x2a0e08, n: { guard: 3, drone: 3, robot: 4, citizen: 2 } },
  surveil: { wall: 'concrete_wall_008',     wt: 0xb8a0b0, floor: 'precast_concrete_wall',   ft: 0x988090, light: 0xff4a3a, fog: 0x260808, n: { guard: 5, drone: 4, robot: 3, citizen: 0 } },
};

const matCache = new Map();
function wallMat(name, tint) { const k = 'w' + name + tint; if (!matCache.has(k)) matCache.set(k, pbr(name, { color: tint })); return matCache.get(k); }
function vcMat(name, o = {}) { const k = 'v' + name; if (!matCache.has(k)) matCache.set(k, pbr(name, { vertexColors: true, ...o })); return matCache.get(k); }

function rngFor(s) { let a = s >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const _c = new THREE.Color();
function colored(g, hex) { _c.set(hex); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function boxG(w, h, d, x, y, z, tile, hex) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  g.translate(x, y + h / 2, z); return colored(g, hex);
}
function cylG(r1, r2, h, x, y, z, seg, hex, rotZ = false, rotX = false) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg, 1);
  if (rotZ) g.rotateZ(Math.PI / 2);
  if (rotX) g.rotateX(Math.PI / 2);
  g.translate(x, y + (rotZ || rotX ? 0 : h / 2), z); return colored(g, hex);
}

// ----- screens (emissive textures) -----
const screenTex = {};
function screenTexture(kind) {
  if (screenTex[kind]) return screenTex[kind];
  const c = document.createElement('canvas'); c.width = 256; c.height = 144;
  const g = c.getContext('2d');
  if (kind === 'eye') {
    g.fillStyle = '#3a0606'; g.fillRect(0, 0, 256, 144);
    g.strokeStyle = '#ffc233'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 136);
    g.save(); g.translate(128, 62); g.beginPath(); g.moveTo(-60, 0); g.quadraticCurveTo(0, -52, 60, 0); g.quadraticCurveTo(0, 52, -60, 0); g.closePath(); g.fillStyle = '#ffd36b'; g.fill();
    g.fillStyle = '#ff5a1a'; g.beginPath(); g.arc(0, 0, 22, 0, 7); g.fill(); g.fillStyle = '#100'; g.beginPath(); g.ellipse(0, 0, 5, 19, 0, 0, 7); g.fill(); g.restore();
    g.fillStyle = '#ffc233'; g.font = 'bold 20px Impact, sans-serif'; g.textAlign = 'center'; g.fillText('THE IRIS SEES ALL', 128, 126);
  } else if (kind === 'cam') {
    g.fillStyle = '#04160a'; g.fillRect(0, 0, 256, 144);
    for (let y = 0; y < 144; y += 4) { g.fillStyle = `rgba(80,255,120,${0.05 + Math.random() * 0.12})`; g.fillRect(0, y, 256, 2); }
    g.fillStyle = '#4aff7a'; g.font = '16px Consolas, monospace'; g.fillText('CAM ' + String(Math.floor(Math.random() * 90 + 10)), 10, 20); g.fillText('REC â—', 190, 20);
    g.fillStyle = 'rgba(80,255,120,0.5)'; g.beginPath(); g.arc(128, 90, 18, 0, 7); g.fill(); g.fillRect(110, 106, 36, 38);
  } else {
    g.fillStyle = '#7a1608'; g.fillRect(0, 0, 256, 144);
    g.fillStyle = '#ffc233'; g.fillRect(0, 100, 256, 44); g.fillStyle = '#240404'; g.font = 'bold 18px Impact, sans-serif'; g.textAlign = 'center';
    g.fillText('CITIZEN OF THE MONTH', 128, 120); g.fillText('CITIZEN 24689 - LOYAL', 128, 138);
    g.fillStyle = '#ffd36b'; g.font = 'bold 30px Impact, sans-serif'; g.fillText('OBEY', 128, 50); g.fillText('& BE SEEN', 128, 86);
  }
  const t = new THREE.CanvasTexture(g.canvas); t.colorSpace = THREE.SRGBColorSpace; screenTex[kind] = t; return t;
}

// ---------------------------------------------------------------------------
export function buildFloor(index, P) {
  const def = FLOORS[index], theme = THEMES[def.theme], rnd = rngFor(1000 + index * 77);
  const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
  const grid = new Uint8Array(GW * GH), rooms = [], links = [];
  const at = (i, j) => (i < 0 || j < 0 || i >= GW || j >= GH ? 0 : grid[j * GW + i]);
  const wx = (i) => (i + 0.5 - GW / 2) * CS, wz = (j) => (j + 0.5 - GH / 2) * CS;
  const carveRect = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && i < GW && j >= 0 && j < GH) grid[j * GW + i] = 1; };

  function bsp(x, y, w, h, depth) {
    if (depth === 0 || (w < 13 && h < 13)) {   // rooms stay small (max 9 cells): less open space to get lost in
      const rw = ri(5, Math.min(w - 3, 9)), rh = ri(5, Math.min(h - 3, 9)), rx = x + ri(1, w - rw - 1), ry = y + ri(1, h - rh - 1);
      const room = { id: rooms.length, x: rx, y: ry, w: rw, h: rh, cx: rx + rw / 2, cy: ry + rh / 2 }; carveRect(rx, ry, rw, rh); rooms.push(room); return room;
    }
    const vertical = w > h ? true : h > w ? false : rnd() < 0.5;
    let a, b;
    if (vertical) { const s = ri(Math.floor(w * 0.4), Math.floor(w * 0.6)); a = bsp(x, y, s, h, depth - 1); b = bsp(x + s, y, w - s, h, depth - 1); }
    else { const s = ri(Math.floor(h * 0.4), Math.floor(h * 0.6)); a = bsp(x, y, w, s, depth - 1); b = bsp(x, y + s, w, h - s, depth - 1); }
    // L-shaped 2-wide corridor from room a to room b
    const ax = Math.floor(a.cx), ay = Math.floor(a.cy), bx = Math.floor(b.cx), by = Math.floor(b.cy);
    carveRect(Math.min(ax, bx), ay, Math.abs(bx - ax) + 2, 2); carveRect(bx, Math.min(ay, by), 2, Math.abs(by - ay) + 2);
    links.push({ a, b, corner: { i: bx, j: ay } });
    return rnd() < 0.5 ? a : b;
  }
  bsp(1, 1, GW - 2, GH - 2, 3);

  const roomW = (r) => ({ x0: (r.x - GW / 2) * CS, x1: (r.x + r.w - GW / 2) * CS, z0: (r.y - GH / 2) * CS, z1: (r.y + r.h - GH / 2) * CS, cx: (r.cx - GW / 2) * CS, cz: (r.cy - GH / 2) * CS });
  rooms.forEach((r) => { r.m = roomW(r); });
  const startRoom = rooms[0];
  let exitRoom = rooms[1], best = -1;
  for (const r of rooms) { const d = Math.hypot(r.cx - startRoom.cx, r.cy - startRoom.cy); if (d > best) { best = d; exitRoom = r; } }

  const group = new THREE.Group();
  const colliders = [], lights = [], decoSolid = [], decoGlow = [], walls = [];
  const place = { barrel: [], trash: [], cardboard: [], barrier: [], cam01: [], lamp02: [] };
  const sprites = [], hideSpots = [], ammo = [];
  const screens = [];   // {x,y,z,w,h,ry,kind}
  const addCol = (x, z, w, d, h) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  const box = (w, h, d, x, y, z, hex, collide = true) => { decoSolid.push(boxG(w, h, d, x, y, z, 2, hex)); if (collide) addCol(x, z, w, d, y + h); };
  const glow = (w, h, d, x, y, z, hex) => decoGlow.push(boxG(w, h, d, x, y, z, 2, hex));

  // walls
  const wallCells = [];
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    if (at(i, j)) continue;
    let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) if (at(i + di, j + dj)) { near = true; break; }
    if (!near) continue;
    walls.push(boxG(CS, WALL_H, CS, wx(i), 0, wz(j), 3, 0xffffff)); addCol(wx(i), wz(j), CS, CS, WALL_H); wallCells.push({ i, j });
  }

  // fixtures + lights along rooms and corridors
  const fixture = (x, z) => { glow(0.35, 0.08, 2.0, x, WALL_H - 0.1, z, theme.light); lights.push({ x, y: WALL_H - 1.2, z, color: theme.light, intensity: 55, dist: 18 }); };
  for (const r of rooms) { const m = r.m; fixture(m.cx, m.cz); if (r.w >= 8) { fixture(m.x0 + 3, m.cz); fixture(m.x1 - 3, m.cz); } else if (r.h >= 8) { fixture(m.cx, m.z0 + 3); fixture(m.cx, m.z1 - 3); } }
  for (const l of links) {
    const ax = wx(Math.floor(l.a.cx)) + CS / 2, az = wz(Math.floor(l.a.cy)) + CS / 2, bx = wx(Math.floor(l.b.cx)) + CS / 2, bz = wz(Math.floor(l.b.cy)) + CS / 2;
    const cxp = wx(l.corner.i) + CS / 2, czp = wz(l.corner.j) + CS / 2;
    for (let t = 0.3; t < 0.8; t += 0.5) { fixture(ax + (cxp - ax) * t, az + (czp - az) * t); fixture(cxp + (bx - cxp) * t, czp + (bz - czp) * t); }
  }

  // ----- decoration: themed set pieces + general room dressing -----
  const acc = theme.light;
  const pk = (arr) => arr[Math.floor(rnd() * arr.length)];
  const cyl = (r, h, x, y, z, hex, seg = 12, collide = false) => { decoSolid.push(cylG(r, r, h, x, y, z, seg, hex)); if (collide) addCol(x, z, r * 2, r * 2, y + h); };
  const pipeX = (len, r, x, y, z, hex) => decoSolid.push(cylG(r, r, len, x, y, z, 10, hex, true));
  const pipeZ = (len, r, x, y, z, hex) => decoSolid.push(cylG(r, r, len, x, y, z, 10, hex, false, true));
  const gSphere = (r, x, y, z, hex) => { const g = new THREE.SphereGeometry(r, 16, 12); g.translate(x, y, z); decoGlow.push(colored(g, hex)); };
  const gRing = (R, t, x, y, z, hex) => { const g = new THREE.TorusGeometry(R, t, 8, 36); g.rotateX(Math.PI / 2); g.translate(x, y, z); decoGlow.push(colored(g, hex)); };
  const decals = [];
  const monitor = (x, y, z, ry, kind, w = 1.0, h = 0.6) => screens.push({ x, y, z, w, h, ry, kind });
  const chair = (x, z, hex = 0x2a2a30) => { box(0.5, 0.45, 0.5, x, 0, z, hex, false); box(0.5, 0.55, 0.1, x, 0.45, z + 0.22, hex, false); };
  const desk = (x, z, w, d, hex = 0x4a3a34) => box(w, 0.8, d, x, 0, z, hex);
  const rack = (x, z, hex = 0x26262c) => { box(0.9, 2.2, 0.7, x, 0, z, hex); for (let k = 0; k < 5; k++) glow(0.7, 0.05, 0.03, x, 0.4 + k * 0.38, z + 0.37, pk([0x40ff80, 0xff3a2a, 0xffc233])); };
  const plant = (x, z) => { cyl(0.28, 0.45, x, 0, z, 0x3a2a20, 10, false); decoSolid.push(cylG(0.03, 0.55, 1.0, x, 0.45, z, 7, 0x2f5a2a)); };
  const spot = (x, z, hex, i = 34) => lights.push({ x, y: 2.4, z, color: hex, intensity: i, dist: 11 });

  const SETS = {
    lobby: {
      desk: (x, z) => { desk(x, z, 4.5, 1.1, 0x5a4a44); glow(4.0, 0.04, 0.8, x, 0.8, z, 0xff9a40); monitor(x, 1.5, z - 0.4, Math.PI, 'cam'); chair(x, z + 1.1); chair(x + 1.4, z + 1.1); },
      statue: (x, z) => {
        box(2.2, 0.7, 2.2, x, 0, z, 0x3a3034);
        box(0.5, 1.1, 0.45, x - 0.22, 0.7, z, 0x15151a, false); box(0.5, 1.1, 0.45, x + 0.22, 0.7, z, 0x15151a, false);
        box(1.05, 1.0, 0.55, x, 1.8, z, 0x15151a, false); glow(0.12, 0.6, 0.04, x, 1.95, z + 0.3, 0xc4180a);
        box(0.5, 0.5, 0.5, x, 2.8, z, 0x15151a, false); glow(0.32, 0.1, 0.04, x, 3.0, z + 0.27, 0xff3a1a);
        spot(x + 1, z + 1, 0xffd9a0, 40);
      },
      benches: (x, z) => { for (let k = -1; k <= 1; k++) { box(2.0, 0.45, 0.6, x, 0, z + k * 1.3, 0x4a3a30); box(2.0, 0.6, 0.1, x, 0.45, z + k * 1.3 + 0.3, 0x3a2a24, false); } },
      vending: (x, z) => { box(1.0, 2.0, 0.8, x, 0, z, 0x7a1c12); glow(0.8, 1.2, 0.05, x, 0.6, z + 0.43, 0xffd9a0); spot(x, z + 1.2, 0xffc080, 26); box(1.0, 2.0, 0.8, x + 1.1, 0, z, 0x1c3a5a); glow(0.8, 1.2, 0.05, x + 1.1, 0.6, z + 0.43, 0x9ad0ff); },
      plants: (x, z) => { plant(x - 1, z); plant(x + 1, z); plant(x, z + 1.2); box(2.8, 0.12, 1.0, x, 0, z - 0.4, 0x2a2428, false); },
      turnstiles: (x, z) => { for (let k = -1; k <= 1; k++) { box(0.15, 1.0, 1.0, x + k * 1.6, 0, z, 0x888890); glow(0.05, 0.05, 0.9, x + k * 1.6, 1.05, z, 0x40ff80); } },
    },
    records: {
      shelves: (x, z) => { for (let k = -1; k <= 1; k++) { box(0.7, 2.7, 5, x + k * 1.9, 0, z, pk([0x6a4a34, 0x5a4030, 0x7a5a3a])); if (rnd() < 0.6) place.cardboard.push({ x: x + k * 1.9 + 0.6, z: z + rnd() * 3 - 1.5, ry: rnd() * 6, s: 1.5 }); } },
      reading: (x, z) => { desk(x, z, 2.8, 1.3, 0x6a4a34); glow(0.5, 0.35, 0.3, x - 0.8, 0.8, z, 0xffe0a0); chair(x - 0.7, z + 1.1); chair(x + 0.7, z + 1.1); chair(x, z - 1.1); spot(x, z, 0xffe0a0, 30); box(0.5, 0.05, 0.4, x + 0.6, 0.8, z, 0xe8e0d0, false); },
      cabinets: (x, z) => { for (let k = -2; k <= 1; k++) { box(0.9, 1.7, 0.6, x + k * 1.0 + 0.5, 0, z, 0x4a4e54); glow(0.7, 0.05, 0.03, x + k * 1.0 + 0.5, 1.0, z + 0.32, 0xffc233); glow(0.7, 0.05, 0.03, x + k * 1.0 + 0.5, 0.5, z + 0.32, 0xffc233); } box(4.0, 0.25, 0.7, x, 1.7, z, 0x6a4a34, false); },
      cart: (x, z) => { box(1.3, 0.9, 0.8, x, 0.2, z, 0x4a4e54); for (let k = 0; k < 4; k++) box(0.5, 0.2, 0.4, x - 0.4 + (k % 2) * 0.8, 1.1 + Math.floor(k / 2) * 0.2, z, 0xe8e0d0, false); box(0.1, 0.2, 0.1, x - 0.5, 0, z - 0.3, 0x111111, false); box(0.1, 0.2, 0.1, x + 0.5, 0, z + 0.3, 0x111111, false); },
    },
    studio: {
      newsdesk: (x, z) => { desk(x, z, 3.8, 1.1, 0x2a2024); glow(3.6, 0.05, 0.05, x, 0.82, z + 0.58, 0xffc233); monitor(x, 0.55, z + 0.56, 0, 'eye', 1.4, 0.6); chair(x - 0.8, z - 1.1); chair(x + 0.8, z - 1.1); spot(x, z + 2, 0xffd9a0, 40); },
      camera: (x, z) => { cyl(0.35, 0.15, x, 0, z, 0x222226, 10); cyl(0.07, 1.1, x, 0.15, z, 0x333338, 8); box(0.7, 0.5, 1.0, x, 1.25, z, 0x1a1a1e, false); glow(0.1, 0.1, 0.04, x + 0.2, 1.6, z + 0.5, 0xff2a1a); cyl(0.2, 0.3, x, 1.3, z + 0.6, 0x111114, 10); },
      greenscreen: (x, z) => { glow(5.0, 2.8, 0.06, x, 0.2, z - 1.2, 0x20b048); box(0.1, 3.0, 0.1, x - 2.5, 0, z - 1.2, 0x222226, false); box(0.1, 3.0, 0.1, x + 2.5, 0, z - 1.2, 0x222226, false); cyl(0.05, 2.0, x - 1.8, 0, z + 1.2, 0x333338, 8); glow(0.5, 0.35, 0.3, x - 1.8, 2.0, z + 1.2, 0xffffff); box(1.0, 0.7, 0.6, x + 1.8, 0, z + 1.4, 0x2a2a30); },
      booth: (x, z) => { desk(x, z, 4.6, 1.2, 0x1e1e24); for (let k = 0; k < 8; k++) glow(0.18, 0.04, 0.12, x - 1.8 + k * 0.5, 0.82, z + 0.2, pk([0xff3a2a, 0x40ff80, 0xffc233])); for (let k = 0; k < 3; k++) monitor(x - 1.4 + k * 1.4, 1.6, z - 0.4, Math.PI, k % 2 ? 'cam' : 'news', 1.2, 0.7); chair(x - 1, z + 1.1); chair(x + 1, z + 1.1); },
      rig: (x, z) => { for (let k = -2; k <= 2; k++) { box(0.2, 0.2, 5, x + k * 1.4, WALL_H - 0.9, z, 0x222226, false); glow(0.35, 0.25, 0.35, x + k * 1.4, WALL_H - 1.15, z - 1.5, 0xffd9a0); glow(0.35, 0.25, 0.35, x + k * 1.4, WALL_H - 1.15, z + 1.5, 0xffd9a0); } spot(x, z, 0xffe0b0, 40); },
    },
    machine: {
      conveyor: (x, z) => { box(7, 0.8, 1.2, x, 0, z, 0x2a2a30); glow(6.8, 0.05, 0.3, x, 0.82, z, 0xff7a1a); for (let k = -2; k <= 2; k++) { box(0.7, 0.6, 0.6, x + k * 1.3, 0.85, z, 0x3a3a42, false); glow(0.22, 0.06, 0.04, x + k * 1.3, 1.2, z + 0.31, 0xff2a1a); } spot(x, z + 1.2, 0xff8a40, 36); },
      arm: (x, z) => { cyl(0.7, 0.5, x, 0, z, 0x2a2a30, 14, true); box(0.4, 1.8, 0.4, x, 0.5, z, 0x6a5a40, false); gSphere(0.28, x, 2.35, z, 0xff7a1a); box(1.9, 0.35, 0.35, x + 0.9, 2.2, z, 0x6a5a40, false); gSphere(0.22, x + 1.85, 2.2, z, 0xff3a1a); box(0.2, 0.9, 0.2, x + 1.9, 1.35, z, 0x4a4a52, false); },
      tanks: (x, z) => { for (const s of [-1, 1]) { cyl(1.2, 3.2, x + s * 1.7, 0, z, 0x4a3a34, 18, true); glow(0.15, 2.0, 0.05, x + s * 1.7, 0.5, z + 1.22, 0xff7a1a); } pipeX(3.4, 0.14, x, 2.6, z, 0x6a5a50); spot(x, z + 1.5, 0xff8a40, 30); },
      bins: (x, z) => { for (let k = 0; k < 4; k++) place.barrel.push({ x: x + (k % 2) * 0.7, z: z + Math.floor(k / 2) * 0.7, ry: 0, s: 1.2 }); box(1.4, 0.9, 1.2, x + 2.2, 0, z, 0x5a4a3a); box(1.4, 0.9, 1.2, x + 2.2, 0.9, z + 0.1, 0x6a5a48, false); box(1.0, 0.6, 1.0, x - 1.8, 0, z, 0x3a3a42); glow(0.5, 0.05, 0.03, x - 1.8, 0.3, z + 0.52, 0xff3a1a); },
    },
    surveil: {
      desks: (x, z) => { for (let a = -1; a <= 1; a += 2) for (let b = 0; b < 2; b++) { desk(x + a * 1.6, z + b * 2.4, 2.4, 1.0, 0x24242c); monitor(x + a * 1.6 - 0.5, 1.15, z + b * 2.4 - 0.2, Math.PI, 'cam', 0.8, 0.5); monitor(x + a * 1.6 + 0.5, 1.15, z + b * 2.4 - 0.2, Math.PI, 'cam', 0.8, 0.5); chair(x + a * 1.6, z + b * 2.4 + 0.9); } spot(x, z + 1, 0xff4a3a, 28); },
      hologram: (x, z) => { cyl(1.0, 0.4, x, 0, z, 0x2a2a30, 20, true); gRing(1.0, 0.03, x, 0.45, z, 0xff4a3a); gSphere(0.75, x, 1.9, z, 0xff3a2a); gRing(1.15, 0.025, x, 1.9, z, 0xffc233); glow(0.12, 0.05, 0.12, x, 2.6, z, 0xffffff); spot(x, z, 0xff3a2a, 55); },
      racks: (x, z) => { for (let k = -2; k <= 1; k++) rack(x + k * 1.1 + 0.55, z); },
      wallmon: (x, z) => { for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) monitor(x - 2 + a * 2, 1.2 + b * 1.1, z - 1.2, 0, 'cam', 1.8, 1.0); box(5.6, 0.7, 0.2, x, 0, z - 1.25, 0x1e1e24, false); },
    },
  };

  for (const r of rooms) {
    const m = r.m, w = m.x1 - m.x0, d = m.z1 - m.z0, isStart = r === startRoom, isExit = r === exitRoom;
    place.cam01.push({ x: m.x0 + 0.15, y: WALL_H - 0.9, z: m.z0 + 0.15, ry: Math.atan2(m.cx - m.x0, m.cz - m.z0), s: 1.7 });
    // corner pilasters with glow bands, ceiling beams
    for (const sx of [0, 1]) for (const sz of [0, 1]) { const px = sx ? m.x1 - 0.3 : m.x0 + 0.3, pz = sz ? m.z1 - 0.3 : m.z0 + 0.3; box(0.55, WALL_H - 0.1, 0.55, px, 0, pz, 0x3a3236); glow(0.62, 0.12, 0.62, px, 2.7, pz, acc); }
    for (let x = m.x0 + 3; x < m.x1 - 1; x += 6) box(0.45, 0.4, d - 0.6, x, WALL_H - 0.4, m.cz, 0x2a2226, false);
    if (isStart || isExit) { plant(m.x0 + 1.4, m.z1 - 1.4); plant(m.x1 - 1.4, m.z1 - 1.4); box(3, 0.45, 0.7, m.cx + 5, 0, m.z0 + 2.6, 0x3a3030, false); continue; }
    pipeX(w - 1.2, 0.1, m.cx, 3.15, m.z0 + 0.35, 0x5a4a44);
    if (def.theme === 'machine') { for (const [bx, bz, bw, bd] of [[m.cx, m.z0 + 0.6, w - 1.5, 0.25], [m.cx, m.z1 - 0.6, w - 1.5, 0.25]]) glow(bw, 0.02, bd, bx, 0.01, bz, 0xffc233); }
    else if (rnd() < 0.8) glow(Math.min(w - 5, 9), 0.03, Math.min(d - 5, 7), m.cx, 0.0, m.cz, pk([0x5a1812, 0x3a2a4a, 0x1a3a3a, 0x4a3a12]));   // rug
    if (def.theme === 'lobby' || def.theme === 'studio' || def.theme === 'surveil') decals.push({ x: m.cx, z: m.cz, w: 9, d: 4.5 });
    // 3-4 set pieces at jittered anchors
    const pieces = SETS[def.theme], names = Object.keys(pieces);
    const anchors = [[-0.27, -0.25], [0.27, -0.25], [-0.27, 0.25], [0.27, 0.25], [0, 0]].sort(() => rnd() - 0.5).slice(0, 3 + (rnd() < 0.5 ? 1 : 0));
    anchors.forEach((a) => pieces[pk(names)](m.cx + a[0] * w, m.cz + a[1] * d));
    // lockers along the north wall: hiding places (E)
    for (let k = 0, nl = 1 + (rnd() < 0.6 ? 1 : 0); k < nl; k++) {
      const lx = m.x0 + 2.4 + rnd() * Math.max(0.5, w - 4.8), lz = m.z0 + 0.62;
      box(0.95, 2.05, 0.7, lx, 0, lz, 0x4e545c); glow(0.82, 0.04, 0.02, lx, 0.35, lz + 0.36, 0x07070a);
      for (let v = 0; v < 4; v++) glow(0.5, 0.035, 0.02, lx, 1.55 + v * 0.1, lz + 0.36, 0x07070a);
      glow(0.05, 0.22, 0.03, lx + 0.32, 1.0, lz + 0.37, 0x9a9aa2);
      hideSpots.push({ id: 'f' + index + '_' + hideSpots.length, x: lx, z: lz, yaw: 0, kind: 'locker', r: 2.1 });
    }
    if (rnd() < 0.55) ammo.push({ x: m.cx + (rnd() - 0.5) * (w - 6), z: m.cz + (rnd() - 0.5) * (d - 6) });
    // equipment along the west wall
    if (rnd() < 0.7) for (let k = 0; k < 3; k++) rack(m.x0 + 0.7, m.cz + (k - 1) * 1.3);
    spot(m.cx + (rnd() - 0.5) * w * 0.4, m.cz + (rnd() - 0.5) * d * 0.4, pk([0xff4a3a, 0xffc233, 0x80b0ff]), 26);
  }

  // corridors: overhead pipes and dashed guide lines on the floor
  for (const l of links) {
    const ax = wx(Math.floor(l.a.cx)) + CS / 2, az = wz(Math.floor(l.a.cy)) + CS / 2, bx = wx(Math.floor(l.b.cx)) + CS / 2, bz = wz(Math.floor(l.b.cy)) + CS / 2;
    const cxp = wx(l.corner.i) + CS / 2, czp = wz(l.corner.j) + CS / 2;
    const lx = Math.abs(cxp - ax), lz = Math.abs(bz - czp);
    if (lx > 6) { pipeX(lx - 4, 0.11, (ax + cxp) / 2, 3.1, az + 1.9, 0x5a4a44); for (let t = 4; t < lx - 3; t += 3) glow(0.9, 0.02, 0.14, Math.min(ax, cxp) + t, 0.01, az, acc); }
    if (lz > 6) { pipeZ(lz - 4, 0.11, cxp + 1.9, 3.1, (czp + bz) / 2, 0x5a4a44); for (let t = 4; t < lz - 3; t += 3) glow(0.14, 0.02, 0.9, cxp, 0.01, Math.min(czp, bz) + t, acc); }
  }

  // propaganda banners + eyes on walls facing rooms
  const banTex = [bannerTexture('SEE ALL BE SEEN', '#8e1408'), bannerTexture('THE IRIS PROTECTS', '#c4220f'), bannerTexture('OBEY AND BE KNOWN', '#8e1408')];
  const banGeo = new THREE.PlaneGeometry(1.5, 3.0);
  const DIRS = [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]];   // [di, dj, rotY] facing out of the wall into the room
  let nb = 0;
  const eyeMat = new THREE.SpriteMaterial({ map: eyeTexture(), depthWrite: false });
  for (const wc of wallCells) {
    if (rnd() > 0.1) continue;
    const dir = DIRS.find(([di, dj]) => at(wc.i + di, wc.j + dj) && at(wc.i + di * 2, wc.j + dj * 2));
    if (!dir) continue;
    const x = wx(wc.i) + dir[0] * (CS / 2 + 0.04), z = wz(wc.j) + dir[1] * (CS / 2 + 0.04);
    if (nb < 40 && rnd() < 0.6) { const m = new THREE.Mesh(banGeo, new THREE.MeshBasicMaterial({ map: banTex[nb % 3], color: 0xbbbbbb })); m.position.set(x, 2.0, z); m.rotation.y = dir[2]; group.add(m); nb++; }
    else { const sp = new THREE.Sprite(eyeMat); sp.position.set(x + dir[0] * 0.1, rnd() * 1.4 + 1.4, z + dir[1] * 0.1); sp.scale.set(1.6, 0.8, 1); group.add(sp); }
  }

  // the Dictator seeps into the tower: black veins with eyes crawl up the walls, thicker on every floor
  if (index >= 1 && wallCells.length) {
    const tubes = [], tm = new THREE.MeshStandardMaterial({ color: 0x07030a, roughness: 0.35, emissive: 0x16041e });
    for (let k = 0, nT = 6 + index * 7; k < nT; k++) {
      const wc = wallCells[Math.floor(rnd() * wallCells.length)];
      const dir = DIRS.find(([di, dj]) => at(wc.i + di, wc.j + dj) && at(wc.i + di * 2, wc.j + dj * 2)); if (!dir) continue;
      const bx = wx(wc.i) + dir[0] * (CS / 2 + 0.05), bz = wz(wc.j) + dir[1] * (CS / 2 + 0.05), h = 1.2 + rnd() * 2.4, side = rnd() * 6, pts = [];
      for (let s = 0; s <= 6; s++) { const u = s / 6, w = Math.sin(u * 6 + side) * 0.35, off = 0.04 + 0.1 * Math.abs(Math.sin(u * 4 + side)); pts.push(new THREE.Vector3(bx + dir[0] * off + (dir[1] ? w : 0), u * h, bz + dir[1] * off + (dir[0] ? w : 0))); }
      tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.06 + rnd() * 0.08, 5, false));
      if (k % 2 === 0) { const sp = new THREE.Sprite(eyeMat); sp.position.set(bx + dir[0] * 0.14, 0.7 + rnd() * 1.6, bz + dir[1] * 0.14); sp.scale.set(0.9, 0.45, 1); group.add(sp); }
    }
    if (tubes.length) group.add(new THREE.Mesh(mergeGeometries(tubes, false), tm));
  }

  // elevators
  const elev = (r, label) => {
    const m = r.m, x = m.cx, z = m.z0 + 0.35;
    decoSolid.push(boxG(0.4, 3.4, 0.6, x - 1.6, 0, z, 2, 0x2a2a30), boxG(0.4, 3.4, 0.6, x + 1.6, 0, z, 2, 0x2a2a30), boxG(3.6, 0.5, 0.6, x, 3.2, z, 2, 0x2a2a30));
    glow(2.8, 3.0, 0.05, x, 0, z + 0.3, 0xff8a2a); addCol(x, m.z0 + 0.3, 3.8, 0.6, 3.4);
    lights.push({ x, y: 2.4, z: z + 1.5, color: 0xff9a40, intensity: 45, dist: 12 });
    return { x, z: m.z0 + 2.4 };
  };
  const startElev = elev(startRoom), exitElev = elev(exitRoom);

  // file cabinet (records floor): in the room farthest from the exit that is not the start
  let file = null, fileRoom = null;
  if (def.lock === 'file') {
    const cands = rooms.filter((r) => r !== startRoom && r !== exitRoom).sort((a, b) => Math.hypot(b.cx - exitRoom.cx, b.cy - exitRoom.cy) - Math.hypot(a.cx - exitRoom.cx, a.cy - exitRoom.cy));
    const r = cands[0], m = r.m; fileRoom = r;
    box(1.1, 2.0, 0.8, m.cx, 0, m.cz, 0x4a3030); glow(0.9, 0.12, 0.05, m.cx, 1.6, m.cz + 0.43, 0xff3a1a); glow(0.9, 0.12, 0.05, m.cx, 1.2, m.cz + 0.43, 0xffc233);
    lights.push({ x: m.cx, y: 1.8, z: m.cz + 1.2, color: 0xff3a1a, intensity: 55, dist: 10 });
    file = { x: m.cx, z: m.cz + 1.5 };
  }

  // merge geometry
  const wallMesh = new THREE.Mesh(mergeGeometries(walls, false), wallMat(theme.wall, theme.wt)); wallMesh.receiveShadow = false; group.add(wallMesh);
  if (decoSolid.length) { const m = new THREE.Mesh(mergeGeometries(decoSolid, false), vcMat('rusty_metal_sheet', { metalness: 0.4, roughness: 0.8 })); group.add(m); }
  if (decoGlow.length) { const m = new THREE.Mesh(mergeGeometries(decoGlow, false), new THREE.MeshBasicMaterial({ vertexColors: true })); group.add(m); }
  // floor & ceiling
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(GW * CS, GH * CS), pbr(theme.floor, { repeat: [GW * CS / 4, GH * CS / 4], color: theme.ft, roughness: 0.8 }));
  fl.rotation.x = -Math.PI / 2; group.add(fl);
  if (location.search.includes('dbgmat')) { fl.material = new THREE.MeshStandardMaterial({ color: 0xff3030 }); const wm = wallMesh.material; wallMesh.material = new THREE.MeshStandardMaterial({ map: wm.map, color: 0xffffff }); console.log('DBGMAT wall map image', wm.map && wm.map.image ? wm.map.image.width : 'NOIMG', wm.map && wm.map.image && wm.map.image.complete); }
  const ce = new THREE.Mesh(new THREE.PlaneGeometry(GW * CS, GH * CS), new THREE.MeshStandardMaterial({ color: 0x1a1214, roughness: 1 }));
  ce.rotation.x = Math.PI / 2; ce.position.y = WALL_H; group.add(ce);
  // screens
  for (const s of screens) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: screenTexture(s.kind), color: 0xe0e0e0 }));
    m.position.set(s.x, s.y, s.z); m.rotation.y = s.ry; group.add(m);
  }
  // floor emblems
  if (decals.length) { const dm = new THREE.MeshBasicMaterial({ map: eyeTexture(), transparent: true, opacity: 0.55, depthWrite: false }); for (const dc of decals) { const m = new THREE.Mesh(new THREE.PlaneGeometry(dc.w, dc.d), dm); m.rotation.x = -Math.PI / 2; m.position.set(dc.x, 0.03, dc.z); group.add(m); } }
  // GLB props
  const add = (parts, list, shadow = false) => { if (parts && list.length) group.add(instanced(parts, list, { shadow })); };
  add(P.barrel, place.barrel); add(P.trashClean, place.trash); add(P.cardboard, place.cardboard); add(P.barrier, place.barrier); add(P.cam01, place.cam01);

  // navigation nodes: room centers + corridor corners
  const nodes = [], nodeOf = new Map();
  const mk = (key, x, z) => { if (!nodeOf.has(key)) { const n = { x, z, n: [] }; nodeOf.set(key, n); nodes.push(n); } return nodeOf.get(key); };
  for (const r of rooms) mk('r' + r.id, r.m.cx, r.m.cz);
  for (const l of links) {
    const A = nodeOf.get('r' + l.a.id), B = nodeOf.get('r' + l.b.id);
    const C = mk('c' + l.a.id + '_' + l.b.id, wx(l.corner.i) + CS / 2, wz(l.corner.j) + CS / 2);
    for (const [p, q] of [[A, C], [C, B]]) { p.n.push(q); q.n.push(p); }
  }

  // chalk trail left by earlier prisoners: arrows along the route, a burning file, the elevator
  {
    const nStart = nodeOf.get('r' + startRoom.id), nExit = nodeOf.get('r' + exitRoom.id);
    const route = (a, b) => { const prev = new Map([[a, null]]), q = [a]; while (q.length) { const n = q.shift(); if (n === b) break; for (const m of n.n) if (!prev.has(m)) { prev.set(m, n); q.push(m); } } const out = []; for (let n = b; n; n = prev.get(n)) out.push(n); return out.reverse(); };
    const trail = (path, kind, skipFirst = 5) => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
        for (let t = i === 0 ? skipFirst : 4; t < L - 3; t += 20) group.add(chalkMesh(kind, a.x + dx / L * t, a.z + dz / L * t, dirYaw(dx, dz), 1.7));
      }
    };
    if (fileRoom) {
      const nFile = nodeOf.get('r' + fileRoom.id);
      trail(route(nStart, nFile), 'arrow'); trail(route(nFile, nExit), 'arrowUp', 3);
      group.add(chalkMesh('file', file.x, file.z + 0.9, dirYaw(0, -1), 2.0));
    } else trail(route(nStart, nExit), 'arrow');
    group.add(chalkMesh('enter', exitElev.x, exitElev.z + 1.4, dirYaw(0, -1), 2.2));
  }

  // enemy plan
  const spawn = [], others = rooms.filter((r) => r !== startRoom);
  const room = () => others[Math.floor(rnd() * others.length)];
  const posIn = (r) => ({ x: r.m.cx + (rnd() - 0.5) * 2, z: r.m.cz + (rnd() - 0.5) * 2 });
  for (const [type, count] of Object.entries(theme.n)) {
    for (let k = 0; k < count; k++) {
      const r = room(), p = posIn(r), node = nodeOf.get('r' + r.id);
      if (type === 'guard' || type === 'robot') spawn.push({ type, x: p.x, z: p.z, opts: k % 2 === 0 ? { node } : { post: true } });
      else spawn.push({ type, x: p.x, z: p.z, opts: { node } });
    }
  }
  if (def.lock === 'censor') { const r = exitRoom, p = posIn(r); spawn.push({ type: 'robot', x: p.x, z: p.z, opts: { post: true, hp: 300, tint: 0xe0a030, scale: 1.25, name: 'CHIEF CENSOR', censor: true } }); }

  const sp = { x: startRoom.m.cx, z: startRoom.m.cz + 0.5 };
  return {
    group, colliders, lights, nodes, spawn, def, theme, fog: theme.fog, hideSpots, ammo,
    start: sp, startYaw: 0, startElev, exitElev, file, exitRoom: exitRoom.m, bounds: { w: GW * CS, h: GH * CS },
  };
}
function pickC(rnd, a) { return a[Math.floor(rnd() * a.length)]; }

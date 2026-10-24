import * as THREE from 'three';
import { mergeGeometries } from './jsm/utils/BufferGeometryUtils.js';
import { pbr, instanced } from './assets.js';

export const CELL = 13;          // block center to block center
export const BLOCK = 9;          // block size, streets are CELL - BLOCK = 4 wide
export const N = 7;              // cells -N..N in x and z
export const EDGE = N * CELL + CELL / 2;
export const RING = CELL * 1.5;  // half size of the security ring around the tower
export const TOWER_H = 190;
export const TOWER_R = 11;

let seed = 1337;
export function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
export const rr = (a, b) => a + rnd() * (b - a);
export const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

export const ZONES = {
  prison:      { name: 'DETENTION SECTOR 7',   sub: 'Inmates are always watched', camScale: 1.15 },
  residential: { name: 'RESIDENTIAL BLOCK 12', sub: 'Every window is an eye',      camScale: 1.0 },
  market:      { name: 'MARKET QUARTER',       sub: 'Buy. Obey. Smile.',           camScale: 1.0 },
  industry:    { name: 'INDUSTRIAL ZONE 3',    sub: 'Work is loyalty',             camScale: 1.0 },
  avenue:      { name: 'THE AVENUES',          sub: 'Keep moving, citizen',        camScale: 1.2 },
  ring:        { name: 'SECURITY RING',        sub: 'Authorized personnel only',   camScale: 1.25 },
};
function districtOfCell(i, j) {
  if (i === 0 || j === 0) return 'avenue';
  if (i < 0 && j < 0) return 'residential';
  if (i > 0 && j < 0) return 'market';
  if (i < 0 && j > 0) return 'industry';
  return 'prison';
}
export function districtAt(x, z) {
  const i = Math.round(x / CELL), j = Math.round(z / CELL);
  if (Math.abs(i) <= 1 && Math.abs(j) <= 1) return 'ring';
  return districtOfCell(i, j);
}

// ---------------------------------------------------------------------------
// geometry helpers (world-space boxes with per-meter UVs and vertex colors)
// ---------------------------------------------------------------------------
const _c = new THREE.Color();
function colored(g, hex) {
  _c.set(hex);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function boxG(w, h, d, x, y, z, tile, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  g.translate(x, y + h / 2, z);
  return colored(g, hex);
}
function cylG(r1, r2, h, x, y, z, seg, hex, tile = 3) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg, 1);
  const uv = g.attributes.uv, u = (Math.PI * (r1 + r2)) / tile, v = h / tile;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  g.translate(x, y + h / 2, z);
  return colored(g, hex);
}
function mergeMesh(list, material, { shadow = true } = {}) {
  if (!list.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
  mesh.castShadow = shadow; mesh.receiveShadow = true;
  return mesh;
}

// procedural lit windows in the fragment shader (no extra geometry): grid in world space on vertical faces
function windowed(mat, key, cfg) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWin = { value: new THREE.Vector4(cfg.w, cfg.h, cfg.minY, cfg.lit) };
    sh.uniforms.uWinGlow = { value: cfg.glow };
    sh.uniforms.uC0 = { value: new THREE.Color(cfg.colors[0]) };
    sh.uniforms.uC1 = { value: new THREE.Color(cfg.colors[1]) };
    sh.uniforms.uC2 = { value: new THREE.Color(cfg.colors[2]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = position;\nvWNor = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNor;
        uniform vec4 uWin; uniform float uWinGlow; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 N = normalize(vWNor);
          if (abs(N.y) < 0.35 && vWPos.y > uWin.z) {
            vec2 T = normalize(vec2(-N.z, N.x));
            vec2 g = vec2(dot(vWPos.xz, T) / uWin.x, vWPos.y / uWin.y);
            vec2 cell = floor(g); vec2 f = fract(g);
            vec2 lo = smoothstep(vec2(0.27, 0.3), vec2(0.3, 0.33), f);
            vec2 hi = 1.0 - smoothstep(vec2(0.7, 0.74), vec2(0.73, 0.77), f);
            float win = lo.x * lo.y * hi.x * hi.y;
            float r = h21(cell + vec2(N.x * 13.0 + N.z * 7.0, 3.0));
            float lit = step(1.0 - uWin.w, r) * win;
            float k = h21(cell + vec2(5.0, N.x * 3.0 + N.z * 11.0));
            vec3 col = k < 0.45 ? uC0 : (k < 0.8 ? uC1 : uC2);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.1, win);
            totalEmissiveRadiance += col * lit * uWinGlow;
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'win_' + key;
  return mat;
}

// canvas textures: propaganda banners, eyes
export function eyeTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.moveTo(4, 32); g.quadraticCurveTo(64, -10, 124, 32); g.quadraticCurveTo(64, 74, 4, 32); g.closePath();
  g.fillStyle = '#f5e3c0'; g.fill();
  g.save(); g.clip();
  g.fillStyle = '#ff3a12'; g.beginPath(); g.arc(64, 32, 21, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#120202'; g.beginPath(); g.ellipse(64, 32, 5, 17, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  g.lineWidth = 5; g.strokeStyle = '#140303'; g.beginPath(); g.moveTo(4, 32); g.quadraticCurveTo(64, -10, 124, 32); g.quadraticCurveTo(64, 74, 4, 32); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function bannerTexture(text, bg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 256, 512);
  g.strokeStyle = '#ffc233'; g.lineWidth = 10; g.strokeRect(10, 10, 236, 492);
  g.save(); g.translate(128, 190);
  g.beginPath(); g.moveTo(-90, 0); g.quadraticCurveTo(0, -80, 90, 0); g.quadraticCurveTo(0, 80, -90, 0); g.closePath();
  g.fillStyle = '#ffd36b'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#2a0504'; g.stroke();
  g.fillStyle = '#ff7a1a'; g.beginPath(); g.arc(0, 0, 32, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#120202'; g.beginPath(); g.ellipse(0, 0, 8, 28, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  g.fillStyle = '#ffc233'; g.font = 'bold 34px Impact, Arial Black, sans-serif'; g.textAlign = 'center';
  text.split(' ').forEach((w, i) => g.fillText(w, 128, 340 + i * 44));
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function chainlinkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#9aa0a6'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64);
  g.moveTo(32, -32); g.lineTo(96, 32); g.moveTo(-32, 32); g.lineTo(32, 96);
  g.moveTo(-32, 32); g.lineTo(32, -32); g.moveTo(32, 96); g.lineTo(96, 32);
  g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

const FACES = [
  { nx: 0, nz: 1, rot: 0 },
  { nx: 0, nz: -1, rot: Math.PI },
  { nx: 1, nz: 0, rot: Math.PI / 2 },
  { nx: -1, nz: 0, rot: -Math.PI / 2 },
];
function onFace(b, f, u, y, out) {
  const F = FACES[f], len = F.nz !== 0 ? b.w : b.d, along = u * len;
  return {
    x: b.x + (F.nx !== 0 ? F.nx * (b.w / 2 + out) : along), y,
    z: b.z + (F.nz !== 0 ? F.nz * (b.d / 2 + out) : along), ry: F.rot,
  };
}

// ---------------------------------------------------------------------------
// the city
// ---------------------------------------------------------------------------
export function buildCity(scene, P) {
  const root = new THREE.Group(); scene.add(root);
  const colliders = [];     // {minX,maxX,minZ,maxZ,h}
  const lights = [];        // light sources for the pooled point lights
  const blds = [];          // {x,z,w,d,h,dist}
  const place = { lamp01: [], lamp02: [], cam01: [], cam02: [], barrier: [], barrier2: [], trashClean: [], trashRust: [], barrel: [], stove: [], aircon: [], shutter: [], secLight: [], cardboard: [] };
  const fences = [];        // chain-link panels {x,z,len,rot}
  const wire = [];          // razor-wire coil positions

  // materials
  const W = {
    prison: windowed(pbr('concrete_wall_008', { vertexColors: true }), 'prison', { w: 2.4, h: 3.4, minY: 3.0, lit: 0.14, glow: 0.9, colors: [0xcfe4ff, 0xa8c8ff, 0xdfe8ff] }),
    residential: windowed(pbr('dark_brick_wall', { vertexColors: true }), 'resi', { w: 2.4, h: 3.1, minY: 2.4, lit: 0.42, glow: 1.7, colors: [0xffb24a, 0xff8a30, 0xffe0a0] }),
    market: windowed(pbr('plastered_wall_03', { vertexColors: true }), 'market', { w: 2.6, h: 3.0, minY: 3.2, lit: 0.5, glow: 1.7, colors: [0xff9a4a, 0xff4a6a, 0xffd860] }),
    industry: windowed(pbr('rusty_corrugated_iron', { vertexColors: true }), 'industry', { w: 3.4, h: 3.8, minY: 3.4, lit: 0.3, glow: 1.8, colors: [0xff6a1a, 0xff3a1a, 0xffc070] }),
    avenue: windowed(pbr('precast_concrete_wall', { vertexColors: true }), 'avenue', { w: 2.8, h: 3.2, minY: 2.8, lit: 0.3, glow: 1.6, colors: [0xff4a2a, 0xffc233, 0xff8a30] }),
  };
  const trimMat = pbr('painted_concrete', { vertexColors: true });
  const darkMat = pbr('rusty_metal_sheet', { vertexColors: true, metalness: 0.5, roughness: 0.8 });
  const L = { prison: [], residential: [], market: [], industry: [], avenue: [], trim: [], dark: [], glowDark: [] };
  const TINTS = {
    prison: [0x9aa4ad, 0x8892a0, 0xa8b0b8], residential: [0xb08a78, 0x9a7a6a, 0xc09a80, 0x8a6a62],
    market: [0xd9a066, 0xc87a5a, 0xd8b46a, 0x7aa59a, 0xb86a8a], industry: [0x8a7468, 0x6a5a52, 0x9a6a4a],
    avenue: [0x7a6a6e, 0x6a5a5e],
  };
  const TILE = { prison: 3.5, residential: 2.5, market: 3, industry: 3, avenue: 3 };

  const addCollider = (x, z, w, d, h) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });

  function building(x, z, w, d, h, dist, { clutter = true, setback = true, collide = true } = {}) {
    const b = { x, z, w, d, h, dist };
    L[dist].push(boxG(w, h, d, x, 0, z, TILE[dist], pick(TINTS[dist])));
    L.trim.push(boxG(w + 0.35, 0.4, d + 0.35, x, h, z, 3, 0x6a6460));      // roof slab / parapet
    if (collide) addCollider(x, z, w, d, h);
    let top = h + 0.4;
    if (setback && h > 13 && rnd() < 0.5) {
      const h2 = rr(3, 6), w2 = w * rr(0.55, 0.75), d2 = d * rr(0.55, 0.75);
      L[dist].push(boxG(w2, h2, d2, x, top, z, TILE[dist], pick(TINTS[dist])));
      L.trim.push(boxG(w2 + 0.3, 0.35, d2 + 0.3, x, top + h2, z, 3, 0x6a6460));
      top += h2 + 0.35;
    }
    if (clutter && w > 3) {
      for (let k = 0; k < 2; k++) if (rnd() < 0.7) L.dark.push(boxG(rr(0.8, 1.6), rr(0.6, 1.4), rr(0.8, 1.6), x + rr(-w, w) * 0.3, top, z + rr(-d, d) * 0.3, 2, 0x8a7a70));
      if (dist === 'residential' && rnd() < 0.5) {   // water tank on stilts
        const tx = x + rr(-w, w) * 0.25, tz = z + rr(-d, d) * 0.25;
        L.dark.push(cylG(0.9, 0.9, 1.6, tx, top + 0.8, tz, 14, 0x7a6a60), cylG(0.05, 1.0, 0.5, tx, top + 2.4, tz, 14, 0x5a4a44));
        for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) L.dark.push(boxG(0.08, 0.8, 0.08, tx + sx, top, tz + sz, 1, 0x4a3a34));
      }
      if (rnd() < 0.45) {   // antenna with red tip
        const ax = x + rr(-w, w) * 0.3, az = z + rr(-d, d) * 0.3, ah = rr(3, 7);
        L.dark.push(cylG(0.04, 0.05, ah, ax, top, az, 6, 0x333333));
        L.glowDark.push({ x: ax, y: top + ah, z: az });
      }
    }
    blds.push(b);
    return b;
  }

  // ----- ground -----
  const sidewalk = (cx, cz, s = BLOCK + 1.4) => L.trim.push(boxG(s, 0.1, s, cx, 0, cz, 3, 0x4a4442));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), pbr('asphalt_02', { repeat: [320, 320], color: 0x7a6a66, roughness: 0.75 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; root.add(ground);
  function groundPatch(x0, x1, z0, z1, mat, y = 0.02) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mat);
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; root.add(m);
  }
  const rep = (s) => [s / 6, s / 6];
  groundPatch(CELL / 2, EDGE, CELL / 2, EDGE, pbr('concrete_wall_008', { repeat: rep(EDGE - CELL / 2), color: 0x707880, roughness: 0.9 }));                 // prison: cold concrete
  groundPatch(-EDGE, -CELL / 2, -EDGE, -CELL / 2, pbr('worn_brick_wall', { repeat: rep(EDGE - CELL / 2), color: 0x7a5a50 }));                                  // residential: brick pavement
  groundPatch(CELL / 2, EDGE, -EDGE, -CELL / 2, pbr('plastered_wall_03', { repeat: rep(EDGE - CELL / 2), color: 0xa88a60 }));                                  // market: sandy
  groundPatch(-EDGE, -CELL / 2, CELL / 2, EDGE, pbr('metal_plate', { repeat: rep(EDGE - CELL / 2), color: 0x6a4a3a, metalness: 0.4, roughness: 0.8 }));        // industry: steel plates

  // ----- blocks -----
  const yardCells = [];
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
    const cx = i * CELL, cz = j * CELL, d = districtOfCell(i, j);
    sidewalk(cx, cz);
    if (d === 'avenue') {
      const off = 4.7, wd = 2.6;
      if (i === 0) { building(cx - off, cz, wd, BLOCK, rr(5, 11), 'avenue'); building(cx + off, cz, wd, BLOCK, rr(5, 11), 'avenue'); }
      else { building(cx, cz - off, BLOCK, wd, rr(5, 11), 'avenue'); building(cx, cz + off, BLOCK, wd, rr(5, 11), 'avenue'); }
    } else if (d === 'residential') {
      const lot = 4.2, off = 2.4;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { if (rnd() < 0.05) continue; building(cx + sx * off, cz + sz * off, lot, lot, rr(9, 26), d); }
    } else if (d === 'market') {
      const lot = 4.2, off = 2.4;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const b = building(cx + sx * off, cz + sz * off, lot, lot, rr(4.5, 8.5), d, { setback: false });
        const col = pick([0xd9531e, 0xe6a21f, 0xb3200f, 0x2a8a7a, 0xc0407a]);
        const f = rnd() < 0.5 ? (sz > 0 ? 0 : 1) : (sx > 0 ? 2 : 3);
        const a = onFace(b, f, 0, 3.0, 0.7);
        L.trim.push(boxG(f < 2 ? lot : 1.4, 0.18, f < 2 ? 1.4 : lot, a.x, 2.9, a.z, 1, col));            // awning
        const s = onFace(b, f, rr(-0.25, 0.25), 0, 0.03); place.shutter.push({ ...s, s: 1.2 });
        if (rnd() < 0.5) { const c = onFace(b, f, rr(-0.35, 0.35), 0, 0.5); place.cardboard.push({ ...c, s: 1.6 }); }
      }
    } else if (d === 'industry') {
      const b = building(cx, cz, BLOCK, BLOCK, rr(7, 12), d, { setback: false });
      const sx = rnd() < 0.5 ? -1 : 1, sz = rnd() < 0.5 ? -1 : 1;
      L.dark.push(cylG(1.1, 0.8, rr(18, 28), cx + sx * 2.5, b.h + 0.4, cz + sz * 2.5, 14, 0x4a3a34));
      L.glowDark.push({ x: cx + sx * 2.5, y: b.h + 0.4 + 20, z: cz + sz * 2.5, big: true });
      L.dark.push(cylG(2.4, 2.4, 4, cx - sx * 2.2, b.h + 0.4, cz - sz * 2.2, 18, 0x6a4a3a));   // tank
      for (let k = 0; k < 2; k++) { const s = onFace(b, Math.floor(rnd() * 4), rr(-0.3, 0.3), 0, 0.7); place.barrel.push({ ...s, s: 1.2 }); }
      if (rnd() < 0.5) { const s = onFace(b, Math.floor(rnd() * 4), rr(-0.3, 0.3), 0, 0.7); place.stove.push({ ...s, s: 1.4 }); lights.push({ x: s.x, y: 1.1, z: s.z, color: 0xff6a1a, intensity: 30, dist: 12 }); }
    } else {   // prison
      const isYard = (i + j) % 3 === 0;
      if (isYard) {
        yardCells.push({ i, j, cx, cz });
        // chain-link fence panels with a 3 m gap in the middle of each side
        for (const [ax, az, along] of [[0, 1, 'x'], [0, -1, 'x'], [1, 0, 'z'], [-1, 0, 'z']]) {
          const wx = cx + ax * (BLOCK / 2), wz = cz + az * (BLOCK / 2), seg = (BLOCK - 3) / 2;
          for (const s of [-1, 1]) {
            const mx = along === 'x' ? wx + s * (1.5 + seg / 2) : wx, mz = along === 'z' ? wz + s * (1.5 + seg / 2) : wz;
            fences.push({ x: mx, z: mz, len: seg, rot: along === 'x' ? 0 : Math.PI / 2 });
            addCollider(mx, mz, along === 'x' ? seg : 0.2, along === 'x' ? 0.2 : seg, 2.6);
          }
        }
        // floodlight pole + barriers
        L.dark.push(cylG(0.12, 0.1, 6.5, cx + 3, 0, cz - 3, 8, 0x4a4a4e));
        place.secLight.push({ x: cx + 3, y: 6.3, z: cz - 3 + 0.05, ry: Math.PI, s: 1.6, tilt: true });
        lights.push({ x: cx + 3, y: 6, z: cz - 2.5, color: 0xdfe8ff, intensity: 60, dist: 22 });
        place.barrier.push({ x: cx - 2.5, z: cz + 2.5, ry: rr(0, Math.PI), s: 1.5 });
        addCollider(cx - 2.5, cz + 2.5, 2.4, 1.2, 1.2);
        if (rnd() < 0.6) place.trashClean.push({ x: cx + 3.2, z: cz + 3.2, ry: rr(0, 6), s: 1 });
      } else {
        const b = building(cx, cz, BLOCK, BLOCK, rr(7, 12), d, { setback: false, clutter: false });
        const f = Math.floor(rnd() * 4);
        const s = onFace(b, f, rr(-0.3, 0.3), 5.2, 0.02); place.secLight.push({ ...s, s: 1.5 });
        const p = onFace(b, f, 0, 5.0, 1); lights.push({ x: p.x, y: 5, z: p.z, color: 0xdfe8ff, intensity: 45, dist: 18 });
        for (let k = 0; k < 2; k++) { const c = onFace(b, Math.floor(rnd() * 4), rr(-0.35, 0.35), 4.2, 0.05); place.cam01.push({ ...c, s: 1.5 }); }
      }
    }
  }

  // ----- prison perimeter (walls with razor wire, gates, watchtowers) -----
  function wall(x, z, w, d, h = 5.5) {
    L.trim.push(boxG(w, h, d, x, 0, z, 3, 0x7a7e84));
    addCollider(x, z, w, d, h);
    const along = w > d ? 'x' : 'z', len = along === 'x' ? w : d;
    for (let t = -len / 2 + 0.3; t < len / 2; t += 0.5) wire.push({ x: along === 'x' ? x + t : x, y: h + 0.3, z: along === 'z' ? z + t : z, along });
  }
  function tower(x, z, hgt = 10) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) L.dark.push(boxG(0.3, hgt, 0.3, x + sx * 1.1, 0, z + sz * 1.1, 2, 0x55585e));
    L.trim.push(boxG(3.6, 2.2, 3.6, x, hgt, z, 3, 0x6a6e74), boxG(4.2, 0.35, 4.2, x, hgt + 2.2, z, 3, 0x3a3a3e));
    L.dark.push(cylG(0.02, 2.9, 1.4, x, hgt + 2.55, z, 4, 0x3a3030));
    addCollider(x, z, 3.2, 3.2, hgt);
    place.secLight.push({ x, y: hgt + 1.3, z: z + 1.85, ry: 0, s: 1.8 });
    lights.push({ x, y: hgt + 1.0, z: z + 2.4, color: 0xffd8a0, intensity: 70, dist: 24 });
  }
  const PW = 0.9, GATE = 2.6;
  const gateAt = 2.5 * CELL;   // the gates sit on the street between rows 2 and 3
  const zStart = RING, zEnd = EDGE;
  wall(CELL / 2 + PW / 2, (zStart + gateAt - GATE) / 2, PW, gateAt - GATE - zStart);
  wall(CELL / 2 + PW / 2, (gateAt + GATE + zEnd) / 2, PW, zEnd - gateAt - GATE);
  wall((zStart + gateAt - GATE) / 2, CELL / 2 + PW / 2, gateAt - GATE - zStart, PW);
  wall((gateAt + GATE + zEnd) / 2, CELL / 2 + PW / 2, zEnd - gateAt - GATE, PW);
  tower(CELL / 2 + 1.8, gateAt - GATE - 1.8); tower(CELL / 2 + 1.8, gateAt + GATE + 1.8);
  tower(gateAt - GATE - 1.8, CELL / 2 + 1.8); tower(gateAt + GATE + 1.8, CELL / 2 + 1.8);
  tower(CELL / 2 + 1.8, RING + 1.8);
  for (const [gx, gz] of [[CELL / 2 + PW / 2, gateAt], [gateAt, CELL / 2 + PW / 2]]) {
    for (const s of [-1, 1]) { L.trim.push(boxG(gx === CELL / 2 + PW / 2 ? PW + 0.6 : 0.6, 0.5, gx === CELL / 2 + PW / 2 ? 0.6 : PW + 0.6, gx + (gx !== CELL / 2 + PW / 2 ? s * GATE : 0), 5.5, gz + (gx === CELL / 2 + PW / 2 ? s * GATE : 0), 1, 0xffc233)); }
  }

  // ----- security ring around the tower -----
  {
    const R = RING, th = 1.4, h = 6.5, gate = 3.0, len = R - gate;
    const seg = (x, z, w, d) => { L.avenue.push(boxG(w, h, d, x, 0, z, 3, 0x5a4a4e)); L.trim.push(boxG(w + 0.3, 0.4, d + 0.3, x, h, z, 3, 0x6a6460)); addCollider(x, z, w, d, h);
      const along = w > d ? 'x' : 'z', l = along === 'x' ? w : d; for (let t = -l / 2 + 0.3; t < l / 2; t += 0.5) wire.push({ x: along === 'x' ? x + t : x, y: h + 0.7, z: along === 'z' ? z + t : z, along }); };
    for (const s of [-1, 1]) {
      seg(-R + len / 2, s * R, len, th); seg(R - len / 2, s * R, len, th);
      seg(s * R, -R + len / 2, th, len); seg(s * R, R - len / 2, th, len);
      for (const g of [-gate, gate]) {
        L.trim.push(boxG(0.7, 0.5, th + 0.3, g, h + 0.4, s * R, 1, 0xffc233), boxG(th + 0.3, 0.5, 0.7, s * R, h + 0.4, g, 1, 0xffc233));
      }
      // cameras on the ring wall
      for (const t of [-0.5, 0.5]) { place.cam01.push({ x: t * len + (t < 0 ? -gate : gate) * 0.4, y: h - 0.8, z: s * (R + th / 2 + 0.05), ry: s > 0 ? 0 : Math.PI, s: 1.8 }); place.cam01.push({ x: s * (R + th / 2 + 0.05), y: h - 0.8, z: t * len + (t < 0 ? -gate : gate) * 0.4, ry: s > 0 ? Math.PI / 2 : -Math.PI / 2, s: 1.8 }); }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      L.avenue.push(boxG(3.6, 13, 3.6, sx * R, 0, sz * R, 3, 0x4a3a3e)); L.trim.push(boxG(4.2, 0.5, 4.2, sx * R, 13, sz * R, 3, 0x6a6460)); addCollider(sx * R, sz * R, 3.6, 3.6, 13);
      L.glowDark.push({ x: sx * R, y: 14, z: sz * R });
      lights.push({ x: sx * R, y: 11, z: sz * R, color: 0xff4a20, intensity: 60, dist: 24 });
      place.barrier.push({ x: sx * 12, z: sz * 15, ry: rr(0, 3), s: 1.8 }); addCollider(sx * 12, sz * 15, 2.8, 1.2, 1.4);
      place.barrier.push({ x: sx * 15, z: sz * 12, ry: rr(0, 3), s: 1.8 }); addCollider(sx * 15, sz * 12, 2.8, 1.2, 1.4);
    }
    addCollider(0, 0, 17, 17, TOWER_H);
    // glowing floor rings
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a, side: THREE.DoubleSide, fog: true });
    for (const [a, b] of [[12.6, 12.95], [16.2, 16.45]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(a, b, 96), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; root.add(ring);
    }
    groundPatch(-R, R, -R, R, pbr('painted_concrete', { repeat: [R / 3, R / 3], color: 0x555050, roughness: 0.7 }), 0.04);
  }

  // ----- street lamps, wall lamps, props on building faces -----
  for (const b of blds) {
    if (b.h < 4) continue;
    if (rnd() < 0.35) { const f = Math.floor(rnd() * 4); const p = onFace(b, f, rr(-0.35, 0.35), 3.6, 0.02); place.lamp02.push({ ...p, s: 1.3 });
      const q = onFace(b, f, p.x === b.x ? 0 : 0, 3.4, 0.9); lights.push({ x: p.x + FACES[f].nx * 0.7, y: 3.4, z: p.z + FACES[f].nz * 0.7, color: b.dist === 'market' ? 0xffa050 : b.dist === 'prison' ? 0xdfe8ff : 0xffb070, intensity: 28, dist: 14 }); }
    if (b.dist === 'residential' && rnd() < 0.55) { const p = onFace(b, Math.floor(rnd() * 4), rr(-0.35, 0.35), rr(3, Math.max(4, b.h - 2)), 0.2); place.aircon.push({ ...p, s: 1.4 }); }
    if ((b.dist === 'residential' || b.dist === 'avenue') && rnd() < 0.2) { const p = onFace(b, Math.floor(rnd() * 4), rr(-0.3, 0.3), rr(4, b.h - 1), 0.05); place.cam02.push({ ...p, s: 2.0 }); }
    if (rnd() < 0.18) { const p = onFace(b, Math.floor(rnd() * 4), rr(-0.4, 0.4), 0, 0.5); (rnd() < 0.5 ? place.trashClean : place.trashRust).push({ ...p, s: 1.1 }); }
    if (b.dist === 'industry' && rnd() < 0.4) { const p = onFace(b, Math.floor(rnd() * 4), rr(-0.3, 0.3), 0, 0.02); place.shutter.push({ ...p, s: 2.0 }); }
  }

  // ----- hiding places: dumpsters against building walls (the player can climb inside, E) -----
  const hideSpots = [];
  const overlaps = (x, z, hw, hd) => colliders.some((c) => c.h > 0.5 && x + hw > c.minX && x - hw < c.maxX && z + hd > c.minZ && z - hd < c.maxZ);
  for (const b of blds) {
    if (b.h < 4 || b.dist === 'avenue' || Math.random() > 0.2) continue;
    const f = Math.floor(Math.random() * 4), F = FACES[f], p = onFace(b, f, (Math.random() - 0.5) * 0.7, 0, 0.58);
    const w = F.nz !== 0 ? 1.9 : 1.0, d = F.nz !== 0 ? 1.0 : 1.9;
    if (overlaps(p.x, p.z, w / 2 + 0.1, d / 2 + 0.1) || overlaps(p.x + F.nx * 1.5, p.z + F.nz * 1.5, 0.45, 0.45)) continue;
    L.dark.push(boxG(w, 1.1, d, p.x, 0, p.z, 2, 0x4f7a5c), boxG(w + 0.12, 0.1, d + 0.12, p.x, 1.1, p.z, 2, 0x6a8a74), boxG(F.nz !== 0 ? 1.7 : 0.05, 0.05, F.nz !== 0 ? 0.05 : 1.7, p.x + F.nx * 0.5, 1.0, p.z + F.nz * 0.5, 1, 0x050505));
    addCollider(p.x, p.z, w, d, 1.2);
    hideSpots.push({ id: 'c' + hideSpots.length, x: p.x, z: p.z, yaw: Math.atan2(F.nx, F.nz), kind: 'dumpster', r: 2.1 });
  }
  // ammo crates in the prison yards
  const ammo = yardCells.filter((y, i) => y.cx !== 3 * CELL && i % 2 === 0).map((y) => ({ x: y.cx - 3.2, z: y.cz - 3.4 }));
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      if (rnd() > 0.28) continue;
      const x = i * CELL + sx * (BLOCK / 2 + 0.45), z = j * CELL + sz * (BLOCK / 2 + 0.45);
      place.lamp01.push({ x, z, ry: rr(0, 6.28), s: 1.1 });
      const d = districtOfCell(i, j);
      lights.push({ x, y: 4.1, z, color: d === 'prison' ? 0xdfe8ff : d === 'industry' ? 0xff7a30 : 0xffa860, intensity: 55, dist: 20 });
    }
  }

  // ----- propaganda banners, posters, eyes -----
  const bannerMats = [
    new THREE.MeshBasicMaterial({ map: bannerTexture('SEE ALL BE SEEN', '#8e1408'), color: 0xcfcfcf }),
    new THREE.MeshBasicMaterial({ map: bannerTexture('THE IRIS PROTECTS', '#c4220f'), color: 0xcfcfcf }),
    new THREE.MeshBasicMaterial({ map: bannerTexture('OBEY AND BE KNOWN', '#8e1408'), color: 0xcfcfcf }),
    new THREE.MeshBasicMaterial({ map: bannerTexture('SILENCE IS ORDER', '#5a0a08'), color: 0xcfcfcf }),
  ];
  const eyeMat = new THREE.SpriteMaterial({ map: eyeTexture(), depthWrite: false });
  let nb = 0, ne = 0;
  const bannerGeo = new THREE.PlaneGeometry(1.7, 3.4), posterGeo = new THREE.PlaneGeometry(0.9, 1.8);
  for (const b of blds) {
    if (b.h >= 9 && nb < 140 && rnd() < 0.5) {
      const p = onFace(b, Math.floor(rnd() * 4), rr(-0.2, 0.2), b.h - 3.4 - rnd() * 2, 0.08);
      const m = new THREE.Mesh(bannerGeo, bannerMats[nb % 4]); m.position.set(p.x, p.y, p.z); m.rotation.y = p.ry; root.add(m); nb++;
    }
    if (b.h >= 4 && rnd() < 0.5) {
      const p = onFace(b, Math.floor(rnd() * 4), rr(-0.4, 0.4), 1.5 + 0.9, 0.06);
      const m = new THREE.Mesh(posterGeo, bannerMats[(nb + 1) % 4]); m.position.set(p.x, p.y, p.z); m.rotation.y = p.ry; root.add(m); nb++;
    }
    if (ne < 60 && rnd() < 0.15) {
      const p = onFace(b, Math.floor(rnd() * 4), rr(-0.3, 0.3), rr(2, b.h - 1), 0.14);
      const sp = new THREE.Sprite(eyeMat); sp.position.set(p.x, p.y, p.z); sp.scale.set(2.2, 1.1, 1); root.add(sp); ne++;
    }
  }

  // ----- barbed-wire fence around the whole city -----
  {
    const FY = EDGE + 0.6, FH = 4.4, n = Math.ceil(2 * FY / 6), len = 2 * FY / n, TOP = FH + 1.2;
    for (let k = 0; k < n; k++) {
      const t = -FY + len * (k + 0.5);
      fences.push({ x: t, z: -FY, len, rot: 0, h: FH }); fences.push({ x: t, z: FY, len, rot: 0, h: FH });
      fences.push({ x: -FY, z: t, len, rot: Math.PI / 2, h: FH }); fences.push({ x: FY, z: t, len, rot: Math.PI / 2, h: FH });
    }
    const sides = [[0, -FY, 2 * FY, 0.6, 0, 1], [0, FY, 2 * FY, 0.6, Math.PI, -1], [-FY, 0, 0.6, 2 * FY, Math.PI / 2, 1], [FY, 0, 0.6, 2 * FY, -Math.PI / 2, -1]];
    for (const [x, z, w, d] of sides) { L.trim.push(boxG(w, 0.7, d, x, 0, z, 3, 0x5a5458)); addCollider(x, z, w, d, 6); }
    // barbed strands with little barbs, razor coils on top, floodlights and warning plates
    const lp = [];
    const strand = (x0, z0, x1, z1, y) => {
      lp.push(x0, y, z0, x1, y, z1);
      const dx = x1 - x0, dz = z1 - z0, Ls = Math.hypot(dx, dz), ux = -dz / Ls, uz = dx / Ls, nb = Math.floor(Ls / 0.45);
      for (let i = 0; i < nb; i++) { const t = i / nb, bx = x0 + dx * t, bz = z0 + dz * t, a = rnd() * 6.28, o = Math.cos(a) * 0.1, up = Math.sin(a) * 0.1; lp.push(bx - ux * o, y - up, bz - uz * o, bx + ux * o, y + up, bz + uz * o); }
    };
    for (const y of [FH + 0.2, FH + 0.55, FH + 0.9, FH + 1.25]) { strand(-FY, -FY, FY, -FY, y); strand(-FY, FY, FY, FY, y); strand(-FY, -FY, -FY, FY, y); strand(FY, -FY, FY, FY, y); }
    for (let t = -FY + 0.3; t < FY; t += 0.6) { const y = TOP + 0.35; wire.push({ x: t, y, z: -FY, along: 'x' }, { x: t, y, z: FY, along: 'x' }, { x: -FY, y, z: t, along: 'z' }, { x: FY, y, z: t, along: 'z' }); }
    for (let t = -FY + 12; t < FY - 6; t += 26) for (const [x, z, ry, inx, inz] of [[t, -FY, 0, 0, 1], [t, FY, Math.PI, 0, -1], [-FY, t, Math.PI / 2, 1, 0], [FY, t, -Math.PI / 2, -1, 0]]) {
      place.secLight.push({ x: x + inx * 0.4, y: TOP - 0.5, z: z + inz * 0.4, ry, s: 2.0 });
      if (Math.abs(t) < 70) lights.push({ x: x + inx * 1.5, y: TOP - 1.5, z: z + inz * 1.5, color: 0xffd8a0, intensity: 55, dist: 22 });
      L.trim.push(boxG(Math.abs(inz) ? 1.0 : 0.06, 0.7, Math.abs(inz) ? 0.06 : 1.0, x + inx * 0.2, 2.2, z + inz * 0.2, 1, 0xffc233));
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xb4b8bc })); lines.frustumCulled = false; root.add(lines);
  }

  // ----- merged meshes -----
  for (const d of ['prison', 'residential', 'market', 'industry', 'avenue']) { const m = mergeMesh(L[d], W[d]); if (m) root.add(m); }
  { const m = mergeMesh(L.trim, trimMat); if (m) root.add(m); }
  { const m = mergeMesh(L.dark, darkMat); if (m) root.add(m); }

  // glowing tips (antennas red, chimneys orange)
  {
    const sg = new THREE.SphereGeometry(1, 10, 8);
    const mesh = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0xffffff }), L.glowDark.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    L.glowDark.forEach((g, k) => { p.set(g.x, g.y, g.z); s.setScalar(g.big ? 0.9 : 0.13); m.compose(p, q, s); mesh.setMatrixAt(k, m); mesh.setColorAt(k, col.set(g.big ? 0xff7a2a : 0xff2a1a)); });
    mesh.frustumCulled = false; root.add(mesh);
    for (const g of L.glowDark) if (g.big) lights.push({ x: g.x, y: g.y - 2, z: g.z, color: 0xff6a20, intensity: 40, dist: 22 });
  }

  // chain-link fences
  if (fences.length) {
    const fm = new THREE.MeshStandardMaterial({ map: chainlinkTexture(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
    const geos = [];
    for (const f of fences) {
      const H = f.h || 2.6, g = new THREE.PlaneGeometry(f.len, H);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * f.len / 0.18, uv.getY(i) * H / 0.18);
      g.rotateY(f.rot); g.translate(f.x, H / 2 + (f.h ? 0.6 : 0), f.z); geos.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), fm); mesh.castShadow = false; root.add(mesh);
    const posts = [];
    for (const f of fences) for (const s of [-1, 1]) posts.push(cylG(f.h ? 0.09 : 0.05, f.h ? 0.09 : 0.05, f.h ? f.h + 1.2 : 2.8, f.x + Math.cos(f.rot) * s * f.len / 2, 0, f.z - Math.sin(f.rot) * s * f.len / 2, 6, 0x6a6e74));
    root.add(mergeMesh(posts, darkMat));
  }

  // razor wire coils
  if (wire.length) {
    const g = new THREE.TorusGeometry(0.3, 0.016, 3, 9);
    const mx = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.35 }), wire.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), qa = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    wire.forEach((w, k) => { q.copy(w.along === 'x' ? qa : q.identity()); p.set(w.x, w.y, w.z); m.compose(p, q, s); mx.setMatrixAt(k, m); });
    mx.frustumCulled = false; root.add(mx);
  }

  // market string lights
  {
    const pts = [];
    for (let i = 1; i <= N; i++) for (let j = -N; j <= -1; j++) {
      const cx = i * CELL, cz = j * CELL;
      for (let k = 0; k < 9; k++) {
        const t = (k + 0.5) / 9, sag = Math.sin(t * Math.PI) * 0.35;
        pts.push({ x: cx + BLOCK / 2 + t * (CELL - BLOCK), y: 3.6 - sag, z: cz + rr(-1.5, 1.5) * 0 + 0.0 });
        pts.push({ x: cx + 0, y: 3.6 - sag, z: cz + BLOCK / 2 + t * (CELL - BLOCK) });
      }
    }
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), pts.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    pts.forEach((p, k) => { m.makeTranslation(p.x, p.y, p.z); mesh.setMatrixAt(k, m); mesh.setColorAt(k, col.set(pick([0xffc060, 0xff7a40, 0xff5a8a, 0xffe090]))); });
    mesh.frustumCulled = false; root.add(mesh);
  }

  // GLB props (Poly Haven, CC0)
  const add = (parts, list, shadow = true) => { if (parts && list.length) root.add(instanced(parts, list, { shadow })); };
  add(P.lamp01, place.lamp01); add(P.lamp02, place.lamp02); add(P.cam01, place.cam01, false); add(P.cam02, place.cam02, false);
  add(P.barrier, place.barrier); add(P.trashClean, place.trashClean); add(P.trashRust, place.trashRust); add(P.barrel, place.barrel);
  add(P.stove, place.stove); add(P.aircon, place.aircon, false); add(P.shutter, place.shutter, false); add(P.secLight, place.secLight, false); add(P.cardboard, place.cardboard, false);

  // prison start yard: the player starts in cell (3,3)
  const spawn = { x: 3 * CELL, z: 3 * CELL };
  return { root, colliders, lights, spawn, hideSpots, ammo };
}

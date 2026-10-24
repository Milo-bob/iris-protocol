import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The Dictator's body: a pulsing mass of black matter, many eyes that follow you, and tentacles.
// Used for the sky above the tower, the final boss and (smaller) for the hunter that stalks the floors.
// Performance: one draw call for all eyes (instanced), one for all tentacle segments, one for the body.
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2, Z = new THREE.Vector3(0, 0, 1);

// equirectangular eyeball: the iris sits at the +z pole of a sphere (u = 0.25, v = 0.5)
const eyeTex = new Map();
function eyeTexture(irisHex) {
  if (eyeTex.has(irisHex)) return eyeTex.get(irisHex);
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e9cdb0'; g.fillRect(0, 0, 512, 256); g.lineCap = 'round';
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `rgba(${150 + Math.random() * 80},20,15,${0.25 + Math.random() * 0.4})`; g.lineWidth = 1 + Math.random() * 2;
    let x = Math.random() * 512, y = Math.random() * 256; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); }
    g.stroke();
  }
  const col = '#' + irisHex.toString(16).padStart(6, '0');
  g.fillStyle = '#2a0a05'; g.beginPath(); g.arc(128, 128, 54, 0, TAU); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(128, 128, 49, 0, TAU); g.fill();
  g.fillStyle = '#0a0101'; g.beginPath(); g.ellipse(128, 128, 9, 40, 0, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; eyeTex.set(irisHex, t); return t;
}

let segGeo = null, eyeGeo = null;

// Many tentacles in one InstancedMesh: each is a chain of stretched spheres along a cubic bezier.
export class Tentacles {
  constructor(count, segs, material) {
    this.count = count; this.segs = segs;
    segGeo = segGeo || new THREE.SphereGeometry(1, 7, 5);
    this.mesh = new THREE.InstancedMesh(segGeo, material, Math.max(1, count * segs));
    this.mesh.frustumCulled = false; this.mesh.castShadow = false;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._t = new THREE.Vector3();
  }
  set(i, p0, p1, p2, p3, r0, r1, floorY = -1e9) {
    const n = this.segs, base = i * n, segLen = (p0.distanceTo(p1) + p1.distanceTo(p2) + p2.distanceTo(p3)) / (n - 1), t = this._t;
    for (let s = 0; s < n; s++) {
      const u = s / (n - 1), v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
      this._p.set(a * p0.x + b * p1.x + c * p2.x + d * p3.x, Math.max(floorY, a * p0.y + b * p1.y + c * p2.y + d * p3.y), a * p0.z + b * p1.z + c * p2.z + d * p3.z);
      t.set(3 * v * v * (p1.x - p0.x) + 6 * v * u * (p2.x - p1.x) + 3 * u * u * (p3.x - p2.x),
        3 * v * v * (p1.y - p0.y) + 6 * v * u * (p2.y - p1.y) + 3 * u * u * (p3.y - p2.y),
        3 * v * v * (p1.z - p0.z) + 6 * v * u * (p2.z - p1.z) + 3 * u * u * (p3.z - p2.z));
      if (t.lengthSq() < 1e-8) t.set(0, -1, 0); t.normalize();
      this._q.setFromUnitVectors(Z, t);
      const r = r0 + (r1 - r0) * Math.pow(u, 0.85);
      this._s.set(r, r, Math.max(r * 1.1, segLen * 0.85));
      this._m.compose(this._p, this._q, this._s); this.mesh.setMatrixAt(base + s, this._m);
    }
  }
  commit() { this.mesh.instanceMatrix.needsUpdate = true; }
  tip(i, out) { this.mesh.getMatrixAt(i * this.segs + this.segs - 1, this._m); return out.setFromMatrixPosition(this._m); }
}

export function blobMaterial(R, { fog = true, wobble = 0.06 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x050307, roughness: 0.3, metalness: 0.15, emissive: 0x16041e, fog });
  const uni = { uTime: { value: 0 }, uAmp: { value: R * wobble } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uni.uTime; sh.uniforms.uAmp = uni.uAmp;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 q = normalize(position);
        float n = sin(q.x * 5.0 + uTime * 1.1) * sin(q.y * 6.0 - uTime * 0.9) * sin(q.z * 5.5 + uTime * 1.3) + 0.5 * sin(q.y * 13.0 + q.x * 9.0 + uTime * 2.1);
        transformed += normal * n * uAmp;`);
  };
  mat.customProgramCacheKey = () => 'blob';
  return { mat, uni };
}

const _o = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _tl = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const A0 = new THREE.Vector3(), A1 = new THREE.Vector3(), A2 = new THREE.Vector3(), A3 = new THREE.Vector3();

export function createMass(o = {}) {
  const { R = 3.4, tentacles = 12, tentLen = 10, segs = 16, eyes = 16, eyeSize = 0.45, bigEye = 0.55, glowSize = 0, fog = true, wobble = 0.06, tipEyes = true, tentEvery = 1 } = o;
  const group = new THREE.Group(), core = new THREE.Group(); group.add(core);
  const eyeMat = new THREE.MeshBasicMaterial({ map: eyeTexture(0xff3a10), fog });
  let curIris = 0xff3a10;
  const { mat: bodyMat, uni } = blobMaterial(R, { fog, wobble });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 3), bodyMat); body.castShadow = true; core.add(body);
  if (glowSize > 0) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,90,30,0.9)'); rg.addColorStop(0.35, 'rgba(255,60,20,0.3)'); rg.addColorStop(1, 'rgba(255,40,10,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.set(glowSize, glowSize, 1); core.add(glow);
  }
  // eyes: data only, drawn as one InstancedMesh
  const eyeList = [];
  if (bigEye > 0) eyeList.push({ pos: new THREE.Vector3(0, R * 0.08, R * 0.82), out: new THREE.Vector3(0, 0, 1), size: R * bigEye, bl: -3, gap: 4, tip: -1, fixed: true });
  for (let tries = 0, n = 0; n < eyes && tries < 600; tries++) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    if (dir.lengthSq() > 1 || dir.lengthSq() < 0.05) continue; dir.normalize();
    if (bigEye > 0 && dir.z > 0.62) continue;
    if (eyeList.some((e) => e.tip < 0 && e.out.dot(dir) > 0.9)) continue;
    eyeList.push({ pos: dir.clone().multiplyScalar(R * 0.97), out: dir, size: eyeSize * (0.55 + Math.random() * 0.9), bl: -Math.random() * 4, gap: 2 + Math.random() * 5, tip: -1, fixed: false }); n++;
  }
  // tentacles
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x08040a, roughness: 0.3, metalness: 0.1, emissive: 0x1a0620, fog });
  const tset = tentacles > 0 ? new Tentacles(tentacles, segs, tentMat) : null;
  if (tset) group.add(tset.mesh);
  const tents = [];
  for (let i = 0; i < tentacles; i++) {
    const a = (i / tentacles) * TAU + (Math.random() - 0.5) * 0.4, e = -0.85 + Math.random() * 0.8;
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
    const t = { dir, out: new THREE.Vector3(dir.x, 0, dir.z).normalize(), ph: Math.random() * 6.28, len: tentLen * (0.7 + Math.random() * 0.6) };
    if (tipEyes && i % 3 === 0) eyeList.push({ pos: new THREE.Vector3(), out: dir, size: Math.max(0.3, R * 0.17), bl: -Math.random() * 4, gap: 2 + Math.random() * 5, tip: i, fixed: false });
    tents.push(t);
  }
  eyeGeo = eyeGeo || new THREE.SphereGeometry(1, 12, 8);
  const eyeMesh = new THREE.InstancedMesh(eyeGeo, eyeMat, Math.max(1, eyeList.length)); eyeMesh.frustumCulled = false; group.add(eyeMesh);

  let time = 0, frame = 0;
  const api = {
    group, core, big: eyeList[0], eyes: eyeList, tentacles: tset,
    // compatibility with the boss code: mats.iris.color.setHex(hex)
    mats: { iris: { color: { setHex(hex) { if (hex !== curIris) { curIris = hex; eyeMat.map = eyeTexture(hex); } } } } },
    setIris(hex) { api.mats.iris.color.setHex(hex); },
    lookAt(v) { core.lookAt(v); },
    update(dt, target) {
      time += dt; uni.uTime.value = time; frame++;
      group.updateWorldMatrix(true, false); core.updateWorldMatrix(false, false);
      const floorY = -group.position.y + 0.2;
      // tentacles hang and writhe
      if (tset && (tentEvery <= 1 || frame % tentEvery === 0)) {
        for (let i = 0; i < tents.length; i++) {
          const t = tents[i], L = t.len, ph = t.ph, w1 = Math.sin(time * 1.1 + ph), w2 = Math.sin(time * 0.8 + ph * 1.3), w3 = Math.cos(time * 0.9 + ph * 0.7);
          A0.copy(t.dir).multiplyScalar(R * 0.8);
          A1.copy(A0).addScaledVector(t.out, L * 0.22).setY(A0.y - L * 0.04); A1.x += w1 * L * 0.04; A1.z += w3 * L * 0.04;
          A2.copy(A0).addScaledVector(t.out, L * 0.38).setY(A0.y - L * 0.42); A2.x += w1 * L * 0.12 + w2 * L * 0.05; A2.z += w3 * L * 0.12;
          A3.copy(A0).addScaledVector(t.out, L * 0.22).setY(A0.y - L * 0.88); A3.x += w2 * L * 0.16 + w3 * L * 0.05; A3.z += w1 * L * 0.16;
          tset.set(i, A0, A1, A2, A3, R * 0.17, Math.max(0.07, R * 0.025), floorY);
        }
        tset.commit();
      }
      // eyes follow the target; the ones on the far side only glance sideways
      if (target) { _inv.copy(group.matrixWorld).invert(); _tl.copy(target).applyMatrix4(_inv); }
      const cq = core.quaternion;
      for (let i = 0; i < eyeList.length; i++) {
        const e = eyeList[i];
        e.bl -= dt; if (e.bl < -e.gap) { e.bl = 0.2; e.gap = 2 + Math.random() * 5; }
        const sq = e.bl > 0 ? Math.sin((1 - e.bl / 0.2) * Math.PI) : 0;
        if (e.tip >= 0) tset.tip(e.tip, _p); else _p.copy(e.pos).applyQuaternion(cq);
        _o.copy(e.out).applyQuaternion(cq);
        if (e.fixed || !target) _d.copy(_o);
        else { _t.copy(_tl).sub(_p).normalize(); if (e.tip >= 0) _d.copy(_t); else _d.copy(_o).multiplyScalar(_o.dot(_t) < -0.3 ? 1 : 0.6).add(_t).normalize(); }
        _q.setFromUnitVectors(Z, _d); _s.set(e.size, e.size * (1 - 0.93 * sq), e.size);
        _m.compose(_p, _q, _s); eyeMesh.setMatrixAt(i, _m);
      }
      eyeMesh.instanceMatrix.needsUpdate = true;
    },
  };
  return api;
}

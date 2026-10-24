import * as THREE from 'three';
import { pbr } from './assets.js';
import { TOWER_H, TOWER_R, EDGE, rnd, rr, pick } from './city.js';
import { createMass } from './mass.js';

const radiusAt = (y) => TOWER_R + (0.6 - TOWER_R) * (y / TOWER_H);

function eyeTexture() {
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

function scleraTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e9cdb0'; g.fillRect(0, 0, 512, 256);
  g.lineCap = 'round';
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(${150 + Math.random() * 80},20,15,${0.25 + Math.random() * 0.4})`; g.lineWidth = 0.8 + Math.random() * 1.8;
    let x = Math.random() * 512, y = Math.random() * 256; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 36; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildTower(scene) {
  const tower = new THREE.Group(); scene.add(tower);
  const geo = new THREE.CylinderGeometry(0.6, TOWER_R, TOWER_H, 4, 12);
  geo.rotateY(Math.PI / 4); geo.translate(0, TOWER_H / 2, 0);
  const mat = pbr('metal_plate', { repeat: [8, 36], color: 0x5a4a4c, metalness: 0.75, roughness: 0.55 });
  mat.emissive = new THREE.Color(0x2a0806);
  const body = new THREE.Mesh(geo, mat); body.castShadow = true; tower.add(body);

  // glowing frame
  const pts = [];
  const corner = (r, k) => { const a = Math.PI / 4 + k * Math.PI / 2; return [Math.sin(a) * r, Math.cos(a) * r]; };
  for (let y = 4; y < TOWER_H - 2; y += 6.5) {
    const r = radiusAt(y);
    for (let k = 0; k < 4; k++) { const a = corner(r, k), b = corner(r, k + 1); pts.push(a[0], y, a[1], b[0], y, b[1]); }
  }
  for (let k = 0; k < 4; k++) { const a = corner(TOWER_R + 0.15, k), b = corner(0.75, k); pts.push(a[0], 0, a[1], b[0], TOWER_H, b[1]); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  tower.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xff6a1a })));

  // Mordor-style spikes along the edges + a crown cradling the eye
  const spikeGeo = new THREE.ConeGeometry(0.55, 5.5, 8); spikeGeo.translate(0, 2.75, 0);
  const spikes = [];
  for (let y = 10; y < TOWER_H - 14; y += 9) for (let k = 0; k < 4; k++) spikes.push({ y, k, s: 1 + (1 - y / TOWER_H) * 0.9 });
  const sm = new THREE.InstancedMesh(spikeGeo, new THREE.MeshStandardMaterial({ color: 0x1a1214, roughness: 0.45, metalness: 0.7 }), spikes.length + 12);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), ax = new THREE.Vector3();
  let si = 0;
  for (const sp of spikes) {
    const r = radiusAt(sp.y), [cx, cz] = corner(r, sp.k), len = Math.hypot(cx, cz), dx = cx / len, dz = cz / len;
    ax.set(dz, 0, -dx); Q.setFromAxisAngle(ax, 0.62);
    P.set(cx, sp.y, cz); S.set(sp.s, sp.s, sp.s); M.compose(P, Q, S); sm.setMatrixAt(si++, M);
  }
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    ax.set(dz, 0, -dx); Q.setFromAxisAngle(ax, 0.55);
    P.set(dx * 1.6, TOWER_H - 12, dz * 1.6); S.set(2.2, 3.8, 2.2); M.compose(P, Q, S); sm.setMatrixAt(si++, M);
  }
  sm.count = si; sm.frustumCulled = false; tower.add(sm);

  // lit windows
  const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), 600);
  const tc = new THREE.Color();
  for (let k = 0; k < 600; k++) {
    const y = rr(6, TOWER_H - 10), r = radiusAt(y), ap = r * Math.SQRT1_2, f = Math.floor(rnd() * 4), ang = f * Math.PI / 2;
    const nx = Math.sin(ang), nz = Math.cos(ang), tx = nz, tz = -nx, u = rr(-0.7, 0.7) * ap;
    P.set(nx * (ap + 0.08) + tx * u, y, nz * (ap + 0.08) + tz * u);
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang); S.set(0.9, 1.2, 0.1);
    M.compose(P, Q, S); wm.setMatrixAt(k, M);
    wm.setColorAt(k, tc.set(pick([0xffcc55, 0xff8a2a, 0xff5a1a, 0xffd98a])));
  }
  wm.frustumCulled = false; tower.add(wm);

  // eyes all over the tower
  const eyeMat = new THREE.SpriteMaterial({ map: eyeTexture(), depthWrite: false });
  for (let k = 0; k < 80; k++) {
    const y = rr(14, TOWER_H - 14), r = radiusAt(y), ap = r * Math.SQRT1_2, f = Math.floor(rnd() * 4), ang = f * Math.PI / 2;
    const nx = Math.sin(ang), nz = Math.cos(ang), u = rr(-0.75, 0.75) * ap;
    const sp = new THREE.Sprite(eyeMat);
    sp.position.set(nx * (ap + 0.4) + nz * u, y, nz * (ap + 0.4) - nx * u);
    const sz = 2.5 + (1 - y / TOWER_H) * 3.5; sp.scale.set(sz, sz / 2, 1);
    tower.add(sp);
  }

  // tentacles climbing the tower
  const tentMat = new THREE.MeshStandardMaterial({ color: 0x4a1a3a, roughness: 0.4, metalness: 0.1, emissive: 0x1a0414 });
  for (let t = 0; t < 8; t++) {
    const a0 = (t / 8) * Math.PI * 2 + rnd() * 0.4, turns = rr(0.6, 1.4), top = rr(0.35, 0.85), pts3 = [];
    for (let k = 0; k <= 80; k++) {
      const u = k / 80, y = Math.pow(u, 1.1) * TOWER_H * top + 0.6;
      const ang = a0 + u * turns * Math.PI * 2 + Math.sin(u * 9 + t) * 0.12;
      const rad = radiusAt(y) * 0.95 + 1.0 + Math.pow(1 - u, 4) * 20 + Math.sin(u * 13 + t * 2) * 0.35;
      pts3.push(new THREE.Vector3(Math.sin(ang) * rad, y, Math.cos(ang) * rad));
    }
    const curve = new THREE.CatmullRomCurve3(pts3);
    tower.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 1.1, 12, false), tentMat));
  }

  // the Dictator: a mass of black matter hanging over the tower, many eyes, tentacles reaching down
  const eyeBase = new THREE.Vector3(0, TOWER_H + 24, 0);
  const mass = createMass({ R: 11, tentacles: 12, tentLen: 60, segs: 18, tentEvery: 2, eyes: 28, eyeSize: 1.4, bigEye: 0.55, glowSize: 110, wobble: 0.05 });
  const eye = mass.group; eye.position.copy(eyeBase); scene.add(eye);
  const gazeTgt = new THREE.Vector3();

  const gaze = { target: new THREE.Vector3(0, 0, 80), current: new THREE.Vector3(0, 0, 80), timer: 0, speed: 10 };
  let override = null;
  function update(dt, playerPos) {
    gaze.timer -= dt;
    if (override) { gaze.target.copy(override); gaze.timer = 0.5; gaze.speed = 4; }
    else if (gaze.timer <= 0) {
      if (rnd() < 0.3) gaze.target.copy(playerPos); else gaze.target.set(rr(-EDGE, EDGE), 0, rr(-EDGE, EDGE));
      gaze.timer = rnd() < 0.35 ? rr(0.15, 0.4) : rr(1.0, 3.2);   // quick twitch or long stare
      gaze.speed = rr(6, 18);
    }
    gaze.current.lerp(gaze.target, 1 - Math.exp(-dt * gaze.speed));
    eye.position.copy(eyeBase); eye.position.y += Math.sin(performance.now() / 900) * 0.8;
    mass.lookAt(gaze.current); mass.update(dt, gazeTgt.set(playerPos.x, 1.5, playerPos.z));
  }
  return { tower, eye, update, setOverride: (v) => { override = v; } };
}

// Reusable eye (used for the final boss). Local +z is the viewing direction.
export function createEye(R = 4, glowSize = 30) {
  const eye = new THREE.Group();
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), new THREE.MeshStandardMaterial({ map: scleraTexture(), emissive: 0x8a2412, emissiveIntensity: 0.8, roughness: 0.35 }));
  const irisGeo = new THREE.SphereGeometry(R * 1.01, 40, 14, 0, Math.PI * 2, 0, 0.62); irisGeo.rotateX(Math.PI / 2);
  const pupilGeo = new THREE.SphereGeometry(R * 1.02, 28, 10, 0, Math.PI * 2, 0, 0.3); pupilGeo.rotateX(Math.PI / 2);
  const irisMat = new THREE.MeshBasicMaterial({ color: 0xff3a10 });
  const iris = new THREE.Mesh(irisGeo, irisMat);
  const pupil = new THREE.Mesh(pupilGeo, new THREE.MeshBasicMaterial({ color: 0x0a0101 })); pupil.scale.x = 0.32;
  eye.add(sclera, iris, pupil);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,90,30,0.9)'); rg.addColorStop(0.35, 'rgba(255,60,20,0.3)'); rg.addColorStop(1, 'rgba(255,40,10,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  glow.scale.set(glowSize, glowSize, 1); eye.add(glow);
  return { group: eye, irisMat, pupil, glow };
}

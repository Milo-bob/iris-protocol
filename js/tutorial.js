import * as THREE from 'three';
import { instanced } from './assets.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------------------
// Chalk drawings left by earlier prisoners: they teach the controls (jump, sneak, back-stab, strike, dash, sprint)
// and mark the way (arrows, the tower, danger, the entrance, the file, the elevator).
// There is no instruction text anywhere.
// ---------------------------------------------------------------------------

const rnd = (a, b) => a + Math.random() * (b - a);

function chalk(draw) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = 'rgba(238,232,215,0.95)'; g.fillStyle = 'rgba(238,232,215,0.95)'; g.lineWidth = 11;
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1 + rnd(-2, 2), y1 + rnd(-2, 2)); g.quadraticCurveTo((x1 + x2) / 2 + rnd(-5, 5), (y1 + y2) / 2 + rnd(-5, 5), x2 + rnd(-2, 2), y2 + rnd(-2, 2)); g.stroke(); };
  const circle = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); };
  const figure = (x, y, s, p = {}) => {
    const hip = [x, y + s * 1.0], neck = [x, y + s * 0.3];
    circle(x, y, s * 0.28); line(neck[0], neck[1], hip[0], hip[1]);
    const L = (o, d) => line(o[0], o[1], o[0] + d[0] * s, o[1] + d[1] * s);
    L([x, y + s * 0.5], p.armL || [-0.5, 0.5]); L([x, y + s * 0.5], p.armR || [0.5, 0.5]);
    L(hip, p.legL || [-0.35, 0.9]); L(hip, p.legR || [0.35, 0.9]);
  };
  const arrow = (x1, y1, x2, y2) => { line(x1, y1, x2, y2); const a = Math.atan2(y2 - y1, x2 - x1); line(x2, y2, x2 - 26 * Math.cos(a - 0.5), y2 - 26 * Math.sin(a - 0.5)); line(x2, y2, x2 - 26 * Math.cos(a + 0.5), y2 - 26 * Math.sin(a + 0.5)); };
  const dashed = (pts) => { g.setLineDash([16, 18]); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], pts[i][2], pts[i][3]); g.stroke(); g.setLineDash([]); };
  const eye = (x, y, w) => { g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x, y - w * 0.7, x + w, y); g.quadraticCurveTo(x, y + w * 0.7, x - w, y); g.stroke(); circle(x, y, w * 0.28); };
  draw({ g, S, line, circle, figure, arrow, dashed, eye });
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.55})`; g.fillRect(Math.random() * S, Math.random() * S, rnd(1, 4), rnd(1, 4)); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

const DRAW = {
  jump: ({ g, line, figure, dashed }) => {
    line(40, 440, 470, 440); g.strokeRect(190, 350, 130, 90);
    figure(255, 190, 70, { armL: [-0.6, -0.5], armR: [0.6, -0.5], legL: [-0.7, 0.55], legR: [0.7, 0.55] });
    dashed([[60, 380, 120, 250], [190, 130, 255, 120], [330, 130, 395, 250], [450, 380, 470, 400]]);
  },
  sneak: ({ g, line, figure, arrow, dashed }) => {
    g.lineWidth = 16; line(150, 160, 150, 440); g.lineWidth = 11;
    figure(80, 290, 46, { armL: [-0.4, 0.8], armR: [0.6, 0.8], legL: [-0.5, 0.7], legR: [0.5, 0.7] });
    figure(360, 200, 62); line(332, 150, 388, 150); arrow(380, 130, 450, 130);
    g.beginPath(); g.moveTo(330, 80); g.quadraticCurveTo(360, 50, 392, 80); g.stroke(); line(335, 70, 330, 56); line(360, 62, 360, 46); line(386, 70, 392, 56);
    dashed([[180, 340, 260, 360, 300, 330]]);
  },
  stab: ({ g, line, figure }) => {
    figure(330, 190, 66); line(300, 135, 360, 135);
    figure(150, 190, 66, { armL: [-0.5, 0.5], armR: [1.2, -0.1] }); line(260, 238, 300, 250);
    for (const a of [-0.9, -0.3, 0.3, 0.9]) line(330 + 70 * Math.cos(a), 270 + 70 * Math.sin(a), 330 + 105 * Math.cos(a), 270 + 105 * Math.sin(a));
    line(330, 440, 330, 400);
  },
  strike: ({ g, line, figure }) => {
    figure(130, 200, 66, { armL: [-0.5, 0.5], armR: [1.3, -0.4] }); line(215, 246, 270, 205);
    line(390, 40, 390, 150); g.strokeRect(355, 150, 70, 150);
    for (const a of [-0.6, 0, 0.6]) line(330 + 20 * Math.cos(a), 225 + 60 * Math.sin(a), 330 - 10 * Math.cos(a), 225 + 60 * Math.sin(a));
    g.beginPath(); g.arc(150, 260, 140, -0.8, 0.5); g.stroke();
  },
  dash: ({ line, figure }) => {
    figure(190, 200, 70, { armL: [-0.9, 0.2], armR: [0.9, 0.2], legL: [-1.0, 0.6], legR: [0.8, 0.8] });
    for (const x of [300, 380]) { line(x, 150, x + 55, 220); line(x + 55, 220, x, 290); }
    line(40, 200, 110, 200); line(30, 250, 100, 250); line(50, 300, 120, 300);
  },
  sprint: ({ line, figure }) => {
    figure(300, 190, 72, { armL: [-0.9, 0.0], armR: [0.7, 0.6], legL: [-0.8, 0.8], legR: [0.95, 0.5] });
    for (let i = 0; i < 4; i++) line(30 + i * 15, 170 + i * 45, 190 + i * 15, 170 + i * 45);
  },
  arrow: ({ line, arrow }) => { arrow(256, 470, 256, 90); },
  arrowUp: ({ g, line, arrow }) => { arrow(256, 470, 256, 220); g.strokeRect(170, 40, 170, 150); line(256, 70, 215, 130); line(256, 70, 297, 130); },   // arrow toward an elevator
  tower: ({ g, line, circle, eye }) => {                          // the tower with the eye above it
    line(256, 130, 190, 470); line(256, 130, 322, 470); line(190, 470, 322, 470);
    for (const y of [220, 300, 380]) line(256 - (y - 130) * 0.19, y, 256 + (y - 130) * 0.19, y);
    eye(256, 70, 70);
    for (const a of [-1.1, -0.55, 0, 0.55, 1.1]) line(256 + 115 * Math.sin(a), 70 - 75 * Math.cos(a) + 30, 256 + 150 * Math.sin(a), 70 - 100 * Math.cos(a) + 30);
  },
  enter: ({ g, line, figure, arrow }) => {                        // a door with a figure stepping in
    g.beginPath(); g.moveTo(170, 460); g.lineTo(170, 190); g.quadraticCurveTo(256, 60, 342, 190); g.lineTo(342, 460); g.stroke();
    figure(256, 250, 56, { legL: [-0.5, 0.8], legR: [0.55, 0.85] }); arrow(40, 360, 150, 360);
  },
  danger: ({ g, line, eye }) => { eye(256, 250, 150); line(120, 120, 392, 380); line(392, 120, 120, 380); },   // watched / guarded
  file: ({ g, line }) => {                                        // a burning file
    g.strokeRect(160, 170, 190, 270); for (const y of [230, 280, 330, 380]) line(190, y, 320, y);
    for (const x of [185, 240, 295, 335]) { line(x, 170, x - 12, 110); line(x - 12, 110, x + 6, 70); }
  },
};

const cache = {};
function getChalk(kind) {
  if (!cache[kind]) cache[kind] = { geo: null, mat: new THREE.MeshBasicMaterial({ map: chalk(DRAW[kind]), transparent: true, depthWrite: false, opacity: 1.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }) };
  return cache[kind];
}
// A chalk drawing lying on the floor. The drawing's "up" points along (-sin yaw, -cos yaw).
export function chalkMesh(kind, x, z, yaw, size = 2.7, y = 0.06) {
  const c = getChalk(kind), mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), c.mat);
  mesh.rotation.order = 'YXZ'; mesh.rotation.x = -Math.PI / 2; mesh.rotation.y = yaw; mesh.position.set(x, y, z); return mesh;
}
export const dirYaw = (dx, dz) => Math.atan2(-dx, -dz);

export function buildTutorial(scene, city, P0, cityColliders, fx) {
  const group = new THREE.Group(); scene.add(group);
  const cx = city.spawn.x, cz = city.spawn.z;
  const decal = (kind, x, z, yaw, size = 2.7) => { group.add(chalkMesh(kind, x, z, yaw, size)); };
  const faceMinusX = Math.PI / 2, faceMinusZ = 0, facePlusX = -Math.PI / 2;

  // 1) jump: the west gap of the yard is blocked by concrete barriers
  if (P0.barrier) group.add(instanced(P0.barrier, [{ x: cx - 4.55, z: cz - 0.85, ry: Math.PI / 2, s: 1.5 }, { x: cx - 4.55, z: cz + 0.85, ry: Math.PI / 2, s: 1.5 }]));
  cityColliders.push({ minX: cx - 5.2, maxX: cx - 3.9, minZ: cz - 1.8, maxZ: cz + 1.8, h: 1.25 });
  decal('jump', cx - 2.7, cz, faceMinusX);
  decal('dash', cx - 7.0, cz - 3.4, faceMinusX);
  decal('sprint', cx - 7.0, cz + 3.2, faceMinusX);

  // 2) strike: punching bag + chalk figure hitting it
  const bag = new THREE.Group(); bag.position.set(cx - 2.7, 2.4, cz - 2.55); group.add(bag);
  {
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.6, roughness: 0.5 });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), dark); stand.position.set(cx - 2.7, 1.2, cz - 3.05); group.add(stand);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.55), dark); arm.position.set(cx - 2.7, 2.4, cz - 2.8); group.add(arm);
    const leather = new THREE.MeshStandardMaterial({ color: 0x6a1c14, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.1, 14), leather); body.position.y = -0.85; body.castShadow = true; bag.add(body);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), dark); chain.position.y = -0.15; bag.add(chain);
    cityColliders.push({ minX: cx - 3.1, maxX: cx - 2.3, minZ: cz - 3.3, maxZ: cz - 2.2, h: 2.0 });
  }
  decal('strike', cx - 0.6, cz - 2.6, facePlusX + Math.PI);

  // 3) sneak + back-stab beside the north gap, the guard with his back turned
  decal('sneak', cx, cz - 7.2, faceMinusZ, 3.4);
  decal('stab', cx + 3.6, cz - 6.5, facePlusX, 3.0);

  // 4) the way out: chalk arrows from the yard through the gate, down the avenue, through the ring to the tower door
  const arrowAt = (x, z, dx, dz, size = 2.4) => decal('arrow', x, z, dirYaw(dx, dz), size);
  const walk = (x0, z0, x1, z1, step, skip) => { const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); for (let t = step / 2; t < L; t += step) { const x = x0 + dx / L * t, z = z0 + dz / L * t; if (!skip || !skip(x, z)) arrowAt(x + rnd(-0.3, 0.3), z + rnd(-0.3, 0.3), dx, dz, 2.5 + rnd(-0.2, 0.4)); } };
  const gz = 32.5;                                                  // the street that leads to the prison gate
  arrowAt(cx, cz - 2.2, 0, -1, 1.8);                                // inside the yard, toward the open north gap
  arrowAt(cx - 5.8, cz - 0.2, 0, -1, 1.8); arrowAt(cx - 5.8, cz - 3.4, 0, -1, 1.8);   // beyond the barrier, around the corner
  walk(cx, gz, 1.5, gz, 5, (x) => x > cx - 2);                      // west along the street, through the gate
  decal('tower', 14.5, gz, dirYaw(-1, 0), 3.2);
  decal('tower', 0, 27.5, dirYaw(0, -1), 3.2);
  walk(0, gz - 1, 0, 20, 5, (x, z) => Math.abs(z - 27.5) < 2.2);   // north along the avenue to the ring gate
  decal('danger', -3.9, 24, dirYaw(0, -1), 1.7); decal('danger', 3.9, 24, dirYaw(0, -1), 1.7);   // the guards at the ring gate
  walk(0, 17.5, 0, 12.6, 4, null);                                  // inside the ring
  decal('enter', 0, 13.6, dirYaw(0, -1), 2.4);                      // the tower door

  // bag physics
  const swing = { ax: 0, az: 0, vx: 0, vz: 0 };
  return {
    group,
    hitDummies(P, yaw, range, half) {
      const bx = cx - 2.7, bz = cz - 2.55, dx = bx - P.x, dz = bz - P.z, d = Math.hypot(dx, dz);
      if (d > range + 0.4) return false;
      const da = Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw));
      if (d > 1.0 && Math.abs(da) > half + 0.2) return false;
      swing.vx += (dz / (d || 1)) * -5.5; swing.vz += (dx / (d || 1)) * 5.5;
      fx.emit(bx, 1.5, bz, 10, 0xfff0c0, 3.5, 0.3, 5); sfx.hit(0.8);
      return true;
    },
    update(dt) {
      swing.vx += -swing.ax * 18 * dt; swing.vz += -swing.az * 18 * dt; swing.vx *= Math.exp(-1.1 * dt); swing.vz *= Math.exp(-1.1 * dt);
      swing.ax += swing.vx * dt; swing.az += swing.vz * dt; bag.rotation.x = swing.ax; bag.rotation.z = swing.az;
    },
  };
}

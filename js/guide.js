import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Objective guidance: world markers (beam + gem), screen markers with distance (clamped to the screen edge with an arrow),
// a route of cyan chevrons on the ground that follows the real walkable path (A* on a grid of the level's colliders)
// and a minimap (N toggles a full-level map).
// ---------------------------------------------------------------------------
const CYAN = 0x4ff0ff, MAX_T = 4, N_CHEV = 28, CHEV_GAP = 2.4;

const css = document.createElement('style');
css.textContent = `
  #guideHud { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .mk { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); text-align: center; color: #aef8ff; text-shadow: 0 0 6px #000, 0 0 2px #000; white-space: nowrap; font-size: clamp(10px, 1.3vw, 14px); letter-spacing: 2px; display: none; }
  .mk .gem { width: 14px; height: 14px; margin: 0 auto 4px; background: #4ff0ff; transform: rotate(45deg); box-shadow: 0 0 12px 3px rgba(79, 240, 255, .75); border: 1px solid #fff; }
  .mk.sec { opacity: .75; } .mk.sec .gem { width: 10px; height: 10px; }
  .mk .arr { position: absolute; left: 50%; top: 50%; width: 0; height: 0; margin: -34px 0 0 -9px; border: 9px solid transparent; border-bottom: 16px solid #4ff0ff; border-top: 0; display: none; filter: drop-shadow(0 0 4px #000); }
  .mk.edge .arr { display: block; }
  .mk .dst { color: #fff; font-size: .9em; }
  #stage #minimap { position: absolute; right: 12px; top: 10px; width: clamp(110px, 14vw, 168px); height: auto; aspect-ratio: 1; border: 1px solid #5a2a1a; background: rgba(10, 2, 4, .6); border-radius: 50%; box-shadow: 0 0 12px #000; }
  #stage #minimap.big { width: clamp(240px, 36vw, 420px); border-radius: 6px; z-index: 6; }
  #mapkey { position: absolute; right: 12px; top: calc(10px + clamp(110px, 14vw, 168px) + 4px); font-size: clamp(9px, 1.1vw, 12px); color: #ffb36b; opacity: .8; text-shadow: 0 0 4px #000; letter-spacing: 2px; }
`;
document.head.appendChild(css);

// ----- walkable grid + A* -----
class NavGrid {
  constructor(colliders, half, cs = 1.0, r = 0.6) {
    this.half = half; this.cs = cs; this.n = Math.ceil(2 * half / cs); this.blk = new Uint8Array(this.n * this.n);
    const n = this.n;
    for (const c of colliders) {
      if (c.h <= 1.8) continue;   // the player can climb onto anything lower
      const i0 = Math.max(0, Math.floor((c.minX - r + half) / cs)), i1 = Math.min(n - 1, Math.floor((c.maxX + r + half) / cs));
      const j0 = Math.max(0, Math.floor((c.minZ - r + half) / cs)), j1 = Math.min(n - 1, Math.floor((c.maxZ + r + half) / cs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * cs - half, z = (j + 0.5) * cs - half;
        if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) this.blk[j * n + i] = 1;
      }
    }
  }
  cell(x, z) { const i = Math.floor((x + this.half) / this.cs), j = Math.floor((z + this.half) / this.cs); return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i; }
  free(x, z) { const c = this.cell(x, z); return c >= 0 && !this.blk[c]; }
  nearestFree(x, z, maxR = 8) {   // the start or goal may sit inside an obstacle's margin: use the closest free cell
    const c0 = this.cell(x, z); if (c0 < 0) return -1; if (!this.blk[c0]) return c0;
    const n = this.n, i0 = c0 % n, j0 = (c0 / n) | 0; let best = -1, bd = 1e9;
    for (let j = Math.max(0, j0 - maxR); j <= Math.min(n - 1, j0 + maxR); j++) for (let i = Math.max(0, i0 - maxR); i <= Math.min(n - 1, i0 + maxR); i++) {
      if (this.blk[j * n + i]) continue; const d = (i - i0) ** 2 + (j - j0) ** 2; if (d < bd) { bd = d; best = j * n + i; }
    }
    return best;
  }
  center(c) { const n = this.n; return { x: ((c % n) + 0.5) * this.cs - this.half, z: (((c / n) | 0) + 0.5) * this.cs - this.half }; }
  clearLine(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), steps = Math.ceil(d / (this.cs * 0.4));
    for (let s = 1; s < steps; s++) if (!this.free(a.x + dx * s / steps, a.z + dz * s / steps)) return false;
    return true;
  }
  path(x0, z0, x1, z1) {
    const s = this.nearestFree(x0, z0), g = this.nearestFree(x1, z1); if (s < 0 || g < 0) return null;
    const n = this.n, N = n * n, gs = new Float32Array(N).fill(1e9), par = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const gi = g % n, gj = (g / n) | 0, h = (c) => { const dx = Math.abs((c % n) - gi), dz = Math.abs(((c / n) | 0) - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const heap = [], push = (f, c) => { heap.push([f, c]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let l = 2 * k + 1, r = l + 1, m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top[1]; };
    gs[s] = 0; push(h(s), s);
    while (heap.length) {
      const c = pop(); if (closed[c]) continue; closed[c] = 1; if (c === g) break;
      const ci = c % n, cj = (c / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nc = nj * n + ni; if (this.blk[nc] || closed[nc]) continue;
        if (di && dj && (this.blk[cj * n + ni] || this.blk[nj * n + ci])) continue;   // no cutting corners
        const ng = gs[c] + (di && dj ? 1.414 : 1); if (ng < gs[nc]) { gs[nc] = ng; par[nc] = c; push(ng + h(nc), nc); }
      }
    }
    if (!closed[g]) return null;
    const cells = []; for (let c = g; c >= 0; c = par[c]) cells.push(this.center(c)); cells.reverse();
    const out = [cells[0]]; let anchor = 0;   // string pulling: keep only the corners
    while (anchor < cells.length - 1) { let far = anchor + 1; for (let k = cells.length - 1; k > anchor + 1; k--) if (this.clearLine(cells[anchor], cells[k])) { far = k; break; } out.push(cells[far]); anchor = far; }
    return out;
  }
}

export class Guide {
  constructor(scene, camera, stage) {
    this.scene = scene; this.camera = camera; this.stage = stage;
    this.worlds = new Map(); this.w = null; this.targets = []; this.tKey = ''; this.t = 0;
    this.path = null; this.pathLen = 0; this.pathFrom = { x: 1e9, z: 1e9 }; this.routeT = 0; this.visible = true; this.big = false; this.mapT = 0;
    // 3D markers
    const beamMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const gemMat = new THREE.MeshBasicMaterial({ color: CYAN, fog: false }), ringMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.m3 = [];
    for (let i = 0; i < MAX_T; i++) {
      const g = new THREE.Group(), beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 90, 10, 1, true), beamMat); beam.position.y = 45;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.85, 40), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12;
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), gemMat);
      g.add(beam, ring, gem); g.visible = false; g.userData = { beam, ring, gem }; scene.add(g); this.m3.push(g);
    }
    // route chevrons on the ground
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.6, -0.55, 0, -0.35, 0, 0, -0.05, 0, 0, 0.6, 0, 0, -0.05, 0.55, 0, -0.35], 3));
    this.chev = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }), N_CHEV);
    this.chev.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_CHEV * 3), 3); this.chev.frustumCulled = false; this.chev.count = 0; scene.add(this.chev);
    // screen markers
    this.hud = document.createElement('div'); this.hud.id = 'guideHud'; this.hud.className = 'hudgame'; stage.appendChild(this.hud);
    this.mk = [];
    for (let i = 0; i < MAX_T; i++) {
      const el = document.createElement('div'); el.className = 'mk'; el.innerHTML = '<div class="arr"></div><div class="gem"></div><div class="lbl"></div><div class="dst"></div>';
      this.hud.appendChild(el); this.mk.push({ el, lbl: el.querySelector('.lbl'), dst: el.querySelector('.dst'), arr: el.querySelector('.arr') });
    }
    // minimap
    this.cv = document.createElement('canvas'); this.cv.id = 'minimap'; this.cv.className = 'hudgame'; this.cv.width = this.cv.height = 360; stage.appendChild(this.cv);
    this.cx = this.cv.getContext('2d');
    this.key = document.createElement('div'); this.key.id = 'mapkey'; this.key.className = 'hudgame'; this.key.textContent = 'N: MAP'; stage.appendChild(this.key);
  }

  // colliders = the level's solid boxes, half = half the level's width in meters; key = cache id (null: open arena, no route)
  setWorld(key, colliders, half) {
    if (!key) { this.w = null; this.path = null; this.chev.count = 0; return; }
    let w = this.worlds.get(key);
    if (!w) {
      const nav = new NavGrid(colliders, half), ppm = half > 60 ? 3 : 4, size = Math.ceil(2 * half * ppm), layer = document.createElement('canvas'); layer.width = layer.height = size;
      const g = layer.getContext('2d'); g.fillStyle = '#1c0d10'; g.fillRect(0, 0, size, size);
      for (const c of colliders) { if (c.h <= 0.9) continue; g.fillStyle = c.h > 3 ? '#6a4c52' : '#3e2c30'; g.fillRect((c.minX + half) * ppm, (c.minZ + half) * ppm, Math.max(1, (c.maxX - c.minX) * ppm), Math.max(1, (c.maxZ - c.minZ) * ppm)); }
      w = { nav, half, ppm, layer }; this.worlds.set(key, w);
    }
    this.w = w; this.path = null; this.pathFrom = { x: 1e9, z: 1e9 }; this.routeT = 0;
  }
  // list of {id, x, z, label, primary, y}; the primary one gets the route
  setTargets(list) {
    this.targets = list.slice(0, MAX_T); const k = this.targets.map((t) => t.id + (t.primary ? '*' : '')).join('|');
    if (k !== this.tKey) { this.tKey = k; this.routeT = 0; this.pathFrom = { x: 1e9, z: 1e9 }; this.path = null; }
  }
  setVisible(v) { this.visible = v; for (const g of this.m3) if (!v) g.visible = false; if (!v) this.chev.count = 0; }
  toggleMap() { this.big = !this.big; this.cv.classList.toggle('big', this.big); this.mapT = 0; this.key.style.display = this.big ? 'none' : 'block'; }

  route(pos) {
    const pr = this.targets.find((t) => t.primary); this.pathLen = 0;
    if (!pr || !this.w) { this.path = null; return; }
    this.path = this.w.nav.path(pos.x, pos.z, pr.x, pr.z);
    if (this.path) {
      this.path.unshift({ x: pos.x, z: pos.z });
      if (this.path.length > 1 && Math.hypot(this.path[1].x - pos.x, this.path[1].z - pos.z) < 1.5) this.path.splice(1, 1);
      this.path[this.path.length - 1] = { x: pr.x, z: pr.z };
      for (let i = 1; i < this.path.length; i++) this.pathLen += Math.hypot(this.path[i].x - this.path[i - 1].x, this.path[i].z - this.path[i - 1].z);
    }
  }
  layoutChevrons() {
    const p = this.path, ms = this.chev; if (!p || p.length < 2) { ms.count = 0; return; }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    let seg = 0, segStart = 0, n = 0; const off = (this.t * 2.6) % CHEV_GAP;
    for (let k = 0; k < N_CHEV; k++) {
      const d = 2.5 + off + k * CHEV_GAP;
      while (seg < p.length - 2 && d > segStart + Math.hypot(p[seg + 1].x - p[seg].x, p[seg + 1].z - p[seg].z)) { segStart += Math.hypot(p[seg + 1].x - p[seg].x, p[seg + 1].z - p[seg].z); seg++; }
      const a = p[seg], b = p[seg + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, u = d - segStart; if (u > L) break;
      if (this.pathLen - d < 1.5) break;
      pos.set(a.x + (b.x - a.x) * u / L, 0.14, a.z + (b.z - a.z) * u / L); q.setFromAxisAngle(up, Math.atan2(b.x - a.x, b.z - a.z));
      m.compose(pos, q, sc); ms.setMatrixAt(n, m);
      const f = Math.max(0.12, 1 - d / 62) * (0.75 + 0.25 * Math.sin(this.t * 5 - k * 0.7)); col.setRGB(0.04 * f, 0.7 * f, 0.9 * f); ms.setColorAt(n, col); n++;
    }
    ms.count = n; ms.instanceMatrix.needsUpdate = true; ms.instanceColor.needsUpdate = true;
  }

  // returns the walking distance to the primary target (or null)
  update(dt, pos, camYaw, hidden) {
    this.t += dt;
    const cam = this.camera; cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const pr = this.targets.find((t) => t.primary);
    this.routeT -= dt;
    if (pr && this.w && (this.routeT <= 0 || Math.hypot(pos.x - this.pathFrom.x, pos.z - this.pathFrom.z) > 5)) { this.route(pos); this.pathFrom = { x: pos.x, z: pos.z }; this.routeT = 2; }
    if (!pr || !this.visible) this.chev.count = 0; else this.layoutChevrons();
    // markers
    const v4 = new THREE.Vector4(); let primaryDist = null;
    for (let i = 0; i < MAX_T; i++) {
      const t = this.targets[i], g = this.m3[i], mk = this.mk[i];
      if (!t || !this.visible) { g.visible = false; mk.el.style.display = 'none'; continue; }
      const y = t.y ?? 3.4, straight = Math.hypot(t.x - pos.x, t.z - pos.z), dist = t.primary && this.path ? this.pathLen : straight;
      if (t.primary) primaryDist = dist;
      g.visible = true; g.position.set(t.x, 0, t.z);
      const { ring, gem, beam } = g.userData; gem.position.y = y + Math.sin(this.t * 2.2 + i) * 0.25; gem.rotation.y = this.t * 1.6;
      ring.scale.setScalar(1 + 0.18 * Math.sin(this.t * 3 + i)); beam.visible = !t.noBeam;
      v4.set(t.x, y + 1.0, t.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
      let nx = v4.x / v4.w, ny = v4.y / v4.w; const behind = v4.w <= 0; if (behind) { nx = -nx; ny = -ny; }
      let edge = behind || Math.abs(nx) > 0.8 || Math.abs(ny) > 0.82;
      if (edge) { if (behind && Math.abs(nx) < 0.05 && Math.abs(ny) < 0.05) ny = -1; const s = Math.min(0.8 / (Math.abs(nx) || 1e-6), 0.82 / (Math.abs(ny) || 1e-6)); nx *= s; ny *= s; }
      mk.el.style.display = 'block'; mk.el.style.left = (nx * 0.5 + 0.5) * 100 + '%'; mk.el.style.top = (0.5 - ny * 0.5) * 100 + '%';
      mk.el.classList.toggle('edge', edge); mk.el.classList.toggle('sec', !t.primary); mk.arr.style.transform = `rotate(${Math.atan2(nx, ny)}rad)`;
      if (mk.lbl.textContent !== t.label) mk.lbl.textContent = t.label;
      mk.dst.textContent = Math.round(dist) + ' m';
    }
    this.mapT -= dt; if (this.mapT <= 0) { this.mapT = 0.1; this.drawMap(pos, camYaw); }
    return primaryDist;
  }

  drawMap(pos, yaw) {
    const c = this.cx, S = this.cv.width, w = this.w; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, S, S);
    if (!w) return;
    // world -> canvas: x' = a*X + cc*Z + e, y' = b*X + d*Z + f
    let a, b, cc, d, e, f;
    if (this.big) { const s = S / (2 * w.half); a = s; b = 0; cc = 0; d = s; e = S / 2; f = S / 2; }
    else {
      const s = S / 2 / 40, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      a = s * rx; cc = s * rz; b = -s * fx; d = -s * fz; e = S / 2 - s * (rx * pos.x + rz * pos.z); f = S / 2 + s * (fx * pos.x + fz * pos.z);
      c.save(); c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, 7); c.clip();
    }
    c.setTransform(a, b, cc, d, e, f); c.save(); c.translate(-w.half, -w.half); c.scale(1 / w.ppm, 1 / w.ppm); c.drawImage(w.layer, 0, 0); c.restore();
    const px = (X, Z) => ({ x: a * X + cc * Z + e, y: b * X + d * Z + f });
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (this.path && this.path.length > 1) { c.strokeStyle = '#4ff0ff'; c.lineWidth = this.big ? 3 : 2.5; c.beginPath(); this.path.forEach((p, i) => { const q = px(p.x, p.z); i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y); }); c.stroke(); }
    for (const t of this.targets) {
      let q = px(t.x, t.z);
      if (!this.big) { const dx = q.x - S / 2, dy = q.y - S / 2, r = Math.hypot(dx, dy), lim = S / 2 - 14; if (r > lim) { q = { x: S / 2 + dx / r * lim, y: S / 2 + dy / r * lim }; } }
      const R = t.primary ? 9 : 6; c.fillStyle = '#4ff0ff'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(q.x, q.y - R); c.lineTo(q.x + R, q.y); c.lineTo(q.x, q.y + R); c.lineTo(q.x - R, q.y); c.closePath(); c.fill(); c.stroke();
      if (this.big) { c.fillStyle = '#fff'; c.font = '14px Consolas, monospace'; c.textAlign = 'center'; c.fillText(t.label, q.x, q.y - R - 4); }
    }
    const me = this.big ? px(pos.x, pos.z) : { x: S / 2, y: S / 2 };
    c.translate(me.x, me.y); c.rotate(this.big ? Math.atan2(-Math.sin(yaw), Math.cos(yaw)) : 0);   // big map is north-up: turn the arrow to the view direction
    c.fillStyle = '#ffd36b'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -11); c.lineTo(7.5, 8); c.lineTo(0, 4); c.lineTo(-7.5, 8); c.closePath(); c.fill(); c.stroke();
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (!this.big) c.restore();
  }
}

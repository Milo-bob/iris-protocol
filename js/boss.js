import * as THREE from 'three';
import { clone as cloneSkel } from './jsm/utils/SkeletonUtils.js';
import { pbr } from './assets.js';
import { getModels } from './npc.js';
import { createEye } from './tower.js';
import { eyeTexture } from './city.js';
import { sfx } from './audio.js';

export const ARENA_R = 24;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const rr = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------
// Final boss "The Iris": phase 1 = the businessman, phase 2 = the eldritch eye.
// ---------------------------------------------------------------------------
export class Boss {
  constructor(scene, fx, cb) {
    this.scene = scene; this.fx = fx; this.cb = cb;
    this.phase = 0; this.state = 'idle'; this.t = 0; this.time = 0; this.x = 0; this.z = -8; this.yaw = 0;
    this.suitMax = 480; this.eyeMax = 440; this.hp = this.suitMax; this.maxHp = this.suitMax;
    this.cd = 2; this.flash = 0; this.waves = []; this.tents = []; this.ringTele = null;
    this.s66 = false; this.s33 = false; this.vulnerable = false; this.destroyed = 0; this.patIdx = 0; this.beamAng = 0; this.beamDir = 1; this.beamHit = 0;
    this.group = new THREE.Group(); scene.add(this.group); this.colliders = []; this.lights = [];
    this.dashDir = { x: 0, z: 1 };
  }

  async init() {
    const models = await getModels();
    this.buildArena();
    // businessman: the Xbot in a black suit with a red tie and an eye on the forehead
    const m = models.xbot, model = cloneSkel(m.gltf.scene), k = 2.4 / m.height;
    model.scale.setScalar(k); model.position.y = -m.minY * k; model.rotation.y = m.fix;
    this.suitMats = [];
    model.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.frustumCulled = false; o.material = o.material.clone(); o.material.color.setHex(0x16161a); o.material.metalness = 0.5; o.material.roughness = 0.45; o.material.userData.baseEm = new THREE.Color(0x000000); this.suitMats.push(o.material); });
    this.suit = new THREE.Group(); this.suit.rotation.order = 'YXZ'; this.suit.add(model);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.62, 0.05), new THREE.MeshStandardMaterial({ color: 0xc4180a, emissive: 0x400400, roughness: 0.5 })); tie.position.set(0, 1.62, 0.27); this.suit.add(tie);
    const eyeSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTexture(), depthWrite: false })); eyeSp.scale.set(0.7, 0.35, 1); eyeSp.position.set(0, 2.32, 0.3); this.suit.add(eyeSp);
    this.mixer = new THREE.AnimationMixer(model); this.actions = {};
    for (const clip of m.gltf.animations) this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
    this.anim = ''; this.setAnim('idle');
    this.group.add(this.suit);
    // the eye (phase 2)
    this.eyeObj = createEye(3.8, 26); this.eye = this.eyeObj.group; this.eye.visible = false; this.eye.position.set(0, -6, 0); this.group.add(this.eye);
    this.eyeLight = new THREE.PointLight(0xff3a20, 0, 40, 2); this.eye.add(this.eyeLight);
    // shared meshes
    this.ringGeo = new THREE.RingGeometry(0.96, 1, 64);
    this.waveGeo = new THREE.RingGeometry(0.88, 1, 64);
    const beamGeo = new THREE.BoxGeometry(ARENA_R, 0.5, 0.9); beamGeo.translate(ARENA_R / 2, 0, 0);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); this.beam.position.y = 0.45; this.beam.visible = false; this.group.add(this.beam);
    // tentacle pool
    const tm = new THREE.MeshStandardMaterial({ color: 0x4a1a3a, roughness: 0.4, emissive: 0x240818 });
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group(), spheres = [];
      for (let s = 0; s < 10; s++) { const sp = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), tm); sp.castShadow = true; g.add(sp); spheres.push(sp); }
      const tele = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })); tele.rotation.x = -Math.PI / 2; tele.position.y = 0.06; tele.scale.setScalar(1.8); g.add(tele);
      g.visible = false; this.group.add(g);
      this.tents.push({ g, spheres, tele, state: 'off', t: 0, x: 0, z: 0, hp: 35, h: 0, struck: false, contactCd: 0, phase: Math.random() * 6 });
    }
    this.setPose();
  }

  buildArena() {
    const R = ARENA_R, g = this.group;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 2, 72), pbr('metal_plate', { repeat: [14, 14], color: 0x9a7476, metalness: 0.3, roughness: 0.7 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a, side: THREE.DoubleSide });
    for (const [a, b] of [[R - 1.3, R - 0.95], [14, 14.25], [7, 7.2]]) { const r = new THREE.Mesh(new THREE.RingGeometry(a, b, 96), glowMat); r.rotation.x = -Math.PI / 2; r.position.y = 0.04; g.add(r); }
    // eye emblem on the floor
    const emblem = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: eyeTexture(), transparent: true, opacity: 0.55, depthWrite: false })); emblem.rotation.x = -Math.PI / 2; emblem.position.y = 0.05; g.add(emblem);
    const pm = new THREE.MeshStandardMaterial({ color: 0x1c1416, metalness: 0.7, roughness: 0.4 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, x = Math.cos(a) * (R + 0.2), z = Math.sin(a) * (R + 0.2);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 14, 8), pm); p.position.set(x, 7, z); p.castShadow = true; g.add(p);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5a1a })); cap.position.set(x, 14.4, z); g.add(cap);
      this.colliders.push({ minX: x - 1, maxX: x + 1, minZ: z - 1, maxZ: z + 1, h: 14 });
      if (i % 2 === 0) this.lights.push({ x: x * 0.85, y: 4, z: z * 0.85, color: 0xff6a2a, intensity: 70, dist: 26 });
    }
    // braziers
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3, x = Math.cos(a) * 15, z = Math.sin(a) * 15;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.4, 1.0, 10), pm); b.position.set(x, 0.5, z); g.add(b);
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 8), new THREE.MeshBasicMaterial({ color: 0xff7a1a })); f.position.set(x, 1.6, z); g.add(f);
      this.lights.push({ x, y: 2, z, color: 0xff6a20, intensity: 50, dist: 18 });
    }
    // banners on the pillars' inner side
    this.lights.push({ x: 0, y: 6, z: 0, color: 0xff3a20, intensity: 60, dist: 30 });
  }

  setAnim(name, ts = 1) {
    const a = this.actions[name] || this.actions.idle; if (!a) return; a.timeScale = ts; if (name === this.anim) return;
    const old = this.actions[this.anim]; if (old && old !== a) { a.reset().fadeIn(0.25).play(); old.fadeOut(0.25); } else a.reset().play(); this.anim = name;
  }
  setPose() { this.suit.position.set(this.x, 0, this.z); this.suit.rotation.y = this.yaw; }

  begin() { this.phase = 1; this.state = 'walk'; this.cd = 1.5; this.maxHp = this.suitMax; this.hp = this.suitMax; }
  get alive() { return this.phase >= 1 && this.phase < 4; }
  get name() { return this.phase >= 3 ? 'THE IRIS' : 'THE DEAR LEADER'; }

  // ----- player attacks -----
  hitTest(P, yaw, { range = 2.7, half = 1.0, dmg = 22 } = {}) {
    let hits = 0;
    const inArc = (x, z, extra = 0) => { const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz); return d < range + extra && (d < 1.2 || Math.abs(angDiff(Math.atan2(dx, dz), yaw)) < half + 0.2); };
    if (this.phase === 1 && inArc(this.x, this.z, 0.9)) { this.damage(dmg); hits++; }
    for (const t of this.tents) {
      if ((t.state === 'up' || t.state === 'rise') && inArc(t.x, t.z, 0.8)) {
        t.hp -= dmg; hits++; this.fx.emit(t.x, 1.4, t.z, 10, 0xc040a0, 4, 0.4); sfx.hit(0.8);
        if (t.hp <= 0) { this.killTent(t); }
      }
    }
    if (this.phase === 3 && this.eye.visible) {
      const d = Math.hypot(this.eye.position.x - P.x, this.eye.position.z - P.z);
      if (this.vulnerable && d < 3.8 + range + 0.3) { this.damage(dmg * 1.1); hits++; }
      else if (d < 3.8 + range && this.eye.position.y < 4) { this.fx.emit(P.x + Math.sin(yaw) * 1.6, 1.4, P.z + Math.cos(yaw) * 1.6, 8, 0x80b0ff, 4, 0.3); sfx.metal(0.6); this.cb.hint?.('Destroy the tentacles to blind the eye!'); }
    }
    return hits;
  }
  damage(d) {
    this.hp -= d; this.flash = 0.15; this.fx.emit(this.phase === 1 ? this.x : this.eye.position.x, this.phase === 1 ? 1.4 : this.eye.position.y, this.phase === 1 ? this.z : this.eye.position.z, 14, this.phase === 1 ? 0xfff0c0 : 0xff8a5a, 5, 0.4);
    sfx.hit(1); this.cb.onHit?.(this);
    if (this.hp <= 0) { if (this.phase === 1) this.startTransform(); else if (this.phase === 3) this.defeat(); }
  }
  killTent(t) {
    t.state = 'down'; t.t = 0; this.fx.emit(t.x, 1.5, t.z, 24, 0xc040a0, 6, 0.6); sfx.ko(0.7);
    if (this.phase === 3 && !this.vulnerable && ['tentacles', 'idle', 'recover'].includes(this.es)) { this.destroyed++; if (this.destroyed >= 3) this.startStun(); }
  }

  // ----- phase changes -----
  startTransform() {
    this.phase = 2; this.t = 0; this.state = 'transform'; this.waves.length = 0; this.clearTele(); this.setAnim('idle');
    this.cb.say?.('YOU CANNOT BLIND WHAT SEES EVERYTHING.'); this.cb.shake?.(0.7);
    this.cb.clearEnemies?.();
  }
  startEye() {
    this.phase = 3; this.maxHp = this.eyeMax; this.hp = this.eyeMax; this.es = 'rise'; this.t = 0; this.patIdx = 0;
    this.eye.visible = true; this.eye.position.set(0, -6, 0); this.suit.visible = false; this.cb.onPhase?.(2);
  }
  startStun() {
    this.es = 'stunned'; this.t = 0; this.vulnerable = true; this.destroyed = 0;
    for (const t of this.tents) if (t.state !== 'off') { t.state = 'down'; t.t = 0; }
    this.beam.visible = false; this.cb.say?.('NO... YOU CANNOT... LOOK AWAY...'); this.cb.shake?.(0.5); sfx.ko(1);
  }
  defeat() {
    this.phase = 4; this.t = 0; this.vulnerable = false; this.beam.visible = false; this.cb.shake?.(1.2);
    for (const t of this.tents) { t.g.visible = false; t.state = 'off'; }
    this.cb.onDefeated?.();
  }
  clearTele() { for (const w of this.waves) this.group.remove(w.mesh); this.waves.length = 0; if (this.ringTele) { this.group.remove(this.ringTele); this.ringTele = null; } }

  // ----- helpers -----
  face(P, dt, rate = 6) { this.yaw += angDiff(Math.atan2(P.x - this.x, P.z - this.z), this.yaw) * Math.min(1, dt * rate); }
  hurt(P, dmg, x, z) { this.cb.hitPlayer(dmg, x, z); }
  telegraph(radius, color = 0xff2a1a) {
    if (this.ringTele) this.group.remove(this.ringTele);
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(this.x, 0.07, this.z); m.scale.setScalar(radius); this.group.add(m); this.ringTele = m;
  }
  spawnWave() {
    const m = new THREE.Mesh(this.waveGeo, new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(this.x, 0.2, this.z); this.group.add(m); this.waves.push({ mesh: m, r: 1, x: this.x, z: this.z, hit: false });
    this.fx.emit(this.x, 0.3, this.z, 30, 0xffa040, 8, 0.6); this.cb.shake?.(0.5); sfx.ko(1);
  }

  // ----- update -----
  update(dt, P) {
    this.time += dt; this.mixer?.update(dt); this.t += dt; this.cd -= dt; if (this.flash > 0) this.flash -= dt;
    for (const mt of this.suitMats || []) mt.emissive.copy(mt.userData.baseEm).addScalar(Math.max(0, this.flash * 5) * 0.8);
    this.updateWaves(dt, P);
    if (this.phase === 1) this.updateSuit(dt, P);
    else if (this.phase === 2) this.updateTransform(dt);
    else if (this.phase === 3) this.updateEye(dt, P);
    else if (this.phase === 4) this.updateDeath(dt);
    this.updateTents(dt, P);
    if (this.phase < 3 && this.suit.visible) this.setPose();
  }
  updateWaves(dt, P) {
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k]; w.r += 13 * dt; w.mesh.scale.setScalar(w.r); w.mesh.material.opacity = Math.max(0, 0.85 * (1 - w.r / (ARENA_R + 2)));
      if (!w.hit && P.alive) { const d = Math.hypot(P.x - w.x, P.z - w.z); if (Math.abs(d - w.r) < 1.0 && P.y < 0.7) { w.hit = true; this.hurt(P, 22, w.x, w.z); } }
      if (w.r > ARENA_R + 3) { this.group.remove(w.mesh); this.waves.splice(k, 1); }
    }
  }
  updateSuit(dt, P) {
    const dx = P.x - this.x, dz = P.z - this.z, d = Math.hypot(dx, dz);
    if (this.ringTele) this.ringTele.material.opacity = 0.35 + 0.35 * Math.sin(this.time * 18);
    switch (this.state) {
      case 'walk': {
        this.face(P, dt);
        if (d > 2.4) { this.x += dx / d * 3.4 * dt; this.z += dz / d * 3.4 * dt; this.setAnim('walk', 1.3); } else this.setAnim('idle');
        if (!this.s66 && this.hp < this.maxHp * 0.66) { this.s66 = true; this.go('summon'); break; }
        if (!this.s33 && this.hp < this.maxHp * 0.33) { this.s33 = true; this.go('summon'); break; }
        if (this.cd <= 0 && P.alive) {
          const r = Math.random();
          if (d < 3.3 && r < 0.65) this.go('wind_melee'); else if (r < 0.55) this.go('wind_slam'); else this.go('wind_lunge');
        }
        break;
      }
      case 'wind_melee': this.face(P, dt, 10); this.flash = Math.max(this.flash, 0.04 + 0.1 * Math.sin(this.t * 30) ** 2);
        if (this.t > 0.7) { if (d < 3.6 && !P.dashing && P.y < 1.4) this.hurt(P, 18, this.x, this.z); sfx.swing(); this.x += Math.sin(this.yaw) * 0.6; this.z += Math.cos(this.yaw) * 0.6; this.go('recover'); } break;
      case 'wind_slam': this.setAnim('idle'); this.flash = Math.max(this.flash, 0.04 + 0.1 * Math.sin(this.t * 24) ** 2);
        if (this.t > 1.15) { this.spawnWave(); this.go('recover'); } break;
      case 'wind_lunge': this.face(P, dt, 12); this.flash = Math.max(this.flash, 0.04 + 0.1 * Math.sin(this.t * 30) ** 2);
        if (this.t > 0.65) { this.dashDir = { x: dx / (d || 1), z: dz / (d || 1) }; this.go('lunge'); } break;
      case 'lunge': {
        this.setAnim('run', 1.5); this.x += this.dashDir.x * 13 * dt; this.z += this.dashDir.z * 13 * dt;
        if (!this.lungeHit && P.alive && Math.hypot(P.x - this.x, P.z - this.z) < 1.9 && !P.dashing && P.y < 1.4) { this.lungeHit = true; this.hurt(P, 20, this.x, this.z); }
        if (this.t > 0.5) this.go('recover'); break;
      }
      case 'summon': this.setAnim('idle'); if (this.t > 0.4 && !this.summoned) { this.summoned = true; this.cb.spawnDrones?.(3); this.cb.say?.('SECURITY. REMOVE THE PRISONER.'); } if (this.t > 1.4) this.go('recover'); break;
      case 'recover': this.setAnim('idle'); if (this.t > 0.8) { this.cd = rr(1.0, 2.0); this.go('walk'); } break;
      default: break;
    }
    const r = Math.hypot(this.x, this.z); if (r > ARENA_R - 2) { this.x *= (ARENA_R - 2) / r; this.z *= (ARENA_R - 2) / r; }
  }
  go(s) {
    this.state = s; this.t = 0; this.lungeHit = false; this.summoned = false;
    if (s === 'wind_slam') this.telegraph(8.5); else if (s !== 'recover') { if (this.ringTele) { this.group.remove(this.ringTele); this.ringTele = null; } }
    if (s === 'recover' && this.ringTele) { this.group.remove(this.ringTele); this.ringTele = null; }
  }
  updateTransform(dt) {
    this.suit.rotation.x += (-0.5 - this.suit.rotation.x) * Math.min(1, dt * 2); this.suit.position.y = Math.max(-0.6, this.suit.position.y - dt * 0.2);
    if (Math.random() < dt * 14) this.fx.emit(this.x + rr(-0.6, 0.6), rr(0.5, 2.2), this.z + rr(-0.6, 0.6), 4, 0xff5a1a, 4, 0.5);
    if (this.t > 3.2) this.startEye();
  }
  updateDeath(dt) {
    if (Math.random() < dt * 30) this.fx.emit(this.eye.position.x + rr(-3, 3), this.eye.position.y + rr(-3, 3), this.eye.position.z + rr(-3, 3), 6, 0xff7a3a, 7, 0.7);
    this.eye.rotation.z += dt * 2; this.eye.position.y += dt * 0.8; this.eyeLight.intensity = Math.max(0, this.eyeLight.intensity - dt * 30);
    this.eye.scale.multiplyScalar(Math.max(0.2, 1 - dt * 0.25));
    if (this.t > 4) this.eye.visible = false;
  }

  // ----- eye phase -----
  updateEye(dt, P) {
    const e = this.eye;
    this.eyeLight.intensity = 90 + 30 * Math.sin(this.time * 3);
    const lookTarget = new THREE.Vector3(P.x, 1.2, P.z);
    if (this.es !== 'beam') e.lookAt(lookTarget);
    const bob = Math.sin(this.time * 1.6) * 0.35;
    const setY = (y, k = 3) => { e.position.y += (y - e.position.y) * Math.min(1, dt * k); };
    const seq = ['tentacles', 'beam', 'tentacles', 'summon', 'beam'];
    this.eyeObj.irisMat.color.setHex(this.vulnerable ? 0x80c0ff : 0xff3a10);
    if (this.flash > 0) this.eyeObj.irisMat.color.setHex(0xffffff);
    switch (this.es) {
      case 'rise': setY(7, 1.6); if (this.t > 2.6) { this.es = 'idle'; this.t = 0; this.cb.say?.('LOOK AT ME, PRISONER ZERO.'); } break;
      case 'idle': setY(7 + bob, 2); if (this.t > 1.2) { this.es = seq[this.patIdx++ % seq.length]; this.t = 0; this.enterEyeState(P); } break;
      case 'tentacles': setY(6 + bob, 2); if (this.t > 5.5 && !this.anyTent(['tele', 'rise', 'up'])) { this.es = 'idle'; this.t = 0; } break;
      case 'summon': setY(8, 2); if (this.t > 1.6) { this.es = 'idle'; this.t = 0; } break;
      case 'beam': this.updateBeam(dt, P, setY); break;
      case 'stunned': setY(2.3, 2.5); e.rotation.z += (Math.sin(this.time * 7) * 0.05 - e.rotation.z) * 0.2; if (this.t > 9.5) { this.vulnerable = false; this.es = 'recover'; this.t = 0; e.rotation.z = 0; this.cb.say?.('YOU ARE NOTHING.'); } break;
      case 'recover': setY(7, 2); if (this.t > 1.5) { this.es = 'idle'; this.t = 0; } break;
      default: break;
    }
  }
  anyTent(states) { return this.tents.some((t) => states.includes(t.state)); }
  enterEyeState(P) {
    if (this.es === 'tentacles') { this.destroyed = 0; const n = 4; for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = i === 0 ? 0 : rr(2, 8); this.spawnTent(P.x + Math.cos(a) * r, P.z + Math.sin(a) * r); } }
    else if (this.es === 'beam') { this.beamPhase = 'wind'; this.beamAng = Math.atan2(P.z, P.x); this.beamDir = Math.random() < 0.5 ? -1 : 1; this.beam.visible = true; this.beam.material.opacity = 0; this.beamHit = 0; this.cb.say?.('THE IRIS SEES YOU.'); }
    else if (this.es === 'summon') this.cb.spawnDrones?.(3);
  }
  spawnTent(x, z) {
    const t = this.tents.find((q) => q.state === 'off'); if (!t) return;
    const r = Math.hypot(x, z); if (r > ARENA_R - 3) { x *= (ARENA_R - 3) / r; z *= (ARENA_R - 3) / r; }
    Object.assign(t, { state: 'tele', t: 0, x, z, hp: 35, h: 0, struck: false, contactCd: 0 }); t.g.position.set(x, 0, z); t.g.visible = true; t.tele.visible = true;
    for (const s of t.spheres) s.visible = false;
  }
  updateTents(dt, P) {
    for (const t of this.tents) {
      if (t.state === 'off') continue;
      t.t += dt; t.contactCd -= dt;
      if (t.state === 'tele') { t.tele.material.opacity = 0.4 + 0.4 * Math.sin(this.time * 20); if (t.t > 1.1) { t.state = 'rise'; t.t = 0; t.struck = false; for (const s of t.spheres) s.visible = true; } }
      else if (t.state === 'rise') {
        t.h = Math.min(1, t.t / 0.22); t.tele.visible = false;
        if (!t.struck && t.h >= 0.9) { t.struck = true; if (P.alive && Math.hypot(P.x - t.x, P.z - t.z) < 1.9 && P.y < 2) this.hurt(P, 16, t.x, t.z); this.fx.emit(t.x, 0.2, t.z, 14, 0xc080a0, 5, 0.4); }
        if (t.t > 0.22) { t.state = 'up'; t.t = 0; }
      } else if (t.state === 'up') {
        t.h = 1; if (t.contactCd <= 0 && P.alive && Math.hypot(P.x - t.x, P.z - t.z) < 1.3 && P.y < 2) { t.contactCd = 1.2; this.hurt(P, 9, t.x, t.z); }
        if (t.t > 4.2) { t.state = 'down'; t.t = 0; }
      } else if (t.state === 'down') { t.h = Math.max(0, 1 - t.t / 0.35); if (t.t > 0.35) { t.state = 'off'; t.g.visible = false; continue; } }
      // shape the tentacle
      const H = 5.2 * t.h;
      t.spheres.forEach((s, i) => { const u = i / (t.spheres.length - 1); s.position.set(Math.sin(this.time * 3 + t.phase + u * 4) * 0.35 * u * 1.6, u * H, Math.cos(this.time * 2.4 + t.phase + u * 3) * 0.3 * u); s.scale.setScalar(0.62 * (1 - u * 0.72) + 0.03); });
    }
  }
  updateBeam(dt, P, setY) {
    setY(3.2, 3);
    const e = this.eye; e.position.x *= 0.9; e.position.z *= 0.9;
    this.beam.position.set(e.position.x, 0.45, e.position.z);
    if (this.beamPhase === 'wind') {
      this.beam.rotation.y = -this.beamAng; this.beam.material.opacity = 0.25 + 0.2 * Math.sin(this.time * 24); this.beam.scale.y = 0.2;
      e.lookAt(new THREE.Vector3(Math.cos(this.beamAng) * 10, 2, Math.sin(this.beamAng) * 10));
      if (this.t > 1.4) { this.beamPhase = 'fire'; this.t = 0; sfx.zap(1); this.cb.shake?.(0.3); }
    } else if (this.beamPhase === 'fire') {
      this.beamAng += this.beamDir * 0.85 * dt; this.beam.rotation.y = -this.beamAng; this.beam.material.opacity = 0.8; this.beam.scale.y = 1;
      e.lookAt(new THREE.Vector3(Math.cos(this.beamAng) * 10, 2, Math.sin(this.beamAng) * 10));
      this.beamHit -= dt;
      if (P.alive && P.y < 0.85 && !P.dashing && this.beamHit <= 0) {
        const dx = P.x - e.position.x, dz = P.z - e.position.z, d = Math.hypot(dx, dz), da = angDiff(Math.atan2(dz, dx), this.beamAng);
        if (Math.cos(da) > 0 && Math.abs(Math.sin(da) * d) < 0.95 && d < ARENA_R) { this.beamHit = 0.7; this.hurt(P, 14, e.position.x, e.position.z); }
      }
      if (this.t > 5.6) { this.beam.visible = false; this.es = 'idle'; this.t = 0; }
    }
  }
}

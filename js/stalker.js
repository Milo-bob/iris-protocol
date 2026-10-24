import * as THREE from 'three';
import { createMass, Tentacles } from './mass.js';
import { NPC } from './npc.js';
import { sfx } from './audio.js';

// ---------------------------------------------------------------------------
// The Dictator's hunter: a crawling mass of black matter with many eyes. It cannot be killed.
// It does not know where you are, only roughly; it listens, follows your habits (see Director) and searches
// hiding places it has seen you use. Leave the floor to escape it.
// ---------------------------------------------------------------------------
const rr = (a, b) => a + Math.random() * (b - a);
const smooth = (t) => t * t * (3 - 2 * t);
const NL = 7, NA = 3, TAU = Math.PI * 2;
const V = () => new THREE.Vector3();

export class Stalker {
  constructor(scene, fx, dir, cb) {
    this.scene = scene; this.fx = fx; this.dir = dir; this.cb = cb; this.mgr = null;
    this.active = false; this.state = 'dormant'; this.x = 0; this.z = 0; this.yaw = 0; this.sideDir = 1; this.stuckT = 0;
    this.mass = createMass({ R: 0.95, tentacles: 0, eyes: 13, eyeSize: 0.2, bigEye: 0.42, wobble: 0.14 });
    this.mass.group.visible = false; scene.add(this.mass.group);
    const mat = new THREE.MeshStandardMaterial({ color: 0x08040a, roughness: 0.3, metalness: 0.1, emissive: 0x1a0620 });
    this.tent = new Tentacles(NL + NA, 14, mat); this.tent.mesh.visible = false; scene.add(this.tent.mesh);
    this.legs = []; for (let i = 0; i < NL; i++) this.legs.push({ a: (i / NL) * TAU + (i % 2) * 0.12, foot: V(), from: V(), to: V(), t: -1 });
    this.hint = { x: 0, z: 0 }; this.lastSeen = new THREE.Vector2(); this.target = null; this.curNode = null; this.prevNode = null;
    this.t = 0; this.age = 0; this.cd = 0; this.wait = 0; this.searchT = 0; this.lostT = 0; this.huntT = 0; this.windT = 0; this.lookT = 0; this.inspT = 0;
    this.checkSpot = null; this.checked = new Set(); this.knowsHide = null; this.senseT = 0; this.eatT = 0; this.eatTarget = null; this.calmT = 0;
    this.dread = 0; this.speedNow = 0; this.appear = 0; this.menace = 0.4; this.clrT = 0; this.path = null; this.pi = 0; this.pathT = 0;
    this._tgt = V(); this._p = [V(), V(), V(), V()]; this._c = V(); this._id = V();
  }
  moveToward(tx, tz, speed, dt, free) { return NPC.prototype.moveToward.call(this, tx, tz, speed, dt, free); }

  attach(mgr) { this.mgr = mgr; }
  spawn(P) {
    const m = this.mgr; if (!m) return;
    const nodes = m.nodes.filter((n) => n.n.length), far = nodes.filter((n) => Math.hypot(n.x - P.x, n.z - P.z) > 32 && !m.los(n.x, n.z, P.x, P.z, 1.9));
    const list = far.length ? far : nodes.sort((a, b) => Math.hypot(b.x - P.x, b.z - P.z) - Math.hypot(a.x - P.x, a.z - P.z)).slice(0, 3);
    const n = list[Math.floor(Math.random() * list.length)]; if (!n) return;
    this.x = n.x; this.z = n.z; this.yaw = Math.atan2(P.x - n.x, P.z - n.z); this.curNode = n; this.prevNode = null;
    this.hint = { x: P.x, z: P.z }; this.state = 'roam'; this.age = 0; this.appear = 0; this.menace = 0.4; this.calmT = 0; this.wait = 1.5; this.target = null;
    this.checked.clear(); this.checkSpot = null; this.knowsHide = null; this.path = null; this.active = true;
    this.mass.group.visible = true; this.mass.group.scale.setScalar(0.01); this.tent.mesh.visible = false;
    for (const l of this.legs) { const a = this.yaw + l.a; l.foot.set(this.x + Math.sin(a) * 2.3, 0.08, this.z + Math.cos(a) * 2.3); l.t = -1; }
    this.cb.whisper?.('Something is moving beyond the walls.');
    sfx.stalkerRise?.();
  }
  despawn() {
    this.active = false; this.state = 'dormant'; this.mass.group.visible = false; this.tent.mesh.visible = false; this.dread = 0; this.knowsHide = null;
  }

  // ----- senses -----
  look(P, dp) {
    if (P.hidden || !P.alive || P.cutscene) return false;
    const range = 15 * (P.sneaking ? 0.6 : 1) * (P.moving || P.sprinting ? 1 : 0.8) * (0.75 + 0.25 * (P.lit ?? 1));
    if (dp > range) return false;
    const dot = ((P.x - this.x) * Math.sin(this.yaw) + (P.z - this.z) * Math.cos(this.yaw)) / (dp || 1);
    return (dp < 2.4 || dot > 0.26) && this.mgr.los(this.x, this.z, P.x, P.z, 1.9);
  }
  hearNoise(x, z, radius) {   // gunshots, alarms, fights: it comes to look
    if (!this.active || !this.mgr) return;
    const d = Math.hypot(x - this.x, z - this.z); if (d > radius * (1.2 + 0.6 * this.dir.ears)) return;
    if (this.state === 'hunt' || this.state === 'attack') return;
    this.hint = { x: x + rr(-2, 2), z: z + rr(-2, 2) }; this.state = 'investigate'; this.path = null; this.target = null; this.checkSpot = null;
  }
  notifyHide(spot, P) {   // the player just slipped into a hiding place: did it see?
    if (!this.active) return;
    const dp = Math.hypot(P.x - this.x, P.z - this.z);
    if ((this.state === 'hunt' || this.state === 'attack') && this.lostT < 1.2 && dp < 24) this.knowsHide = spot;
  }

  resolveHide(spot, P, sure) {
    this.checked.add(spot.id);
    if (!(P.hidden && P.hideId === spot.id)) return false;
    const p = Math.min(0.97, 0.35 + 0.5 * this.dir.hideWise + 0.2 * Math.min(2, this.dir.spotCount(spot.id)));
    if (sure || this.knowsHide === spot || Math.random() < p) { this.state = 'hunt'; this.knowsHide = null; this.lostT = 0; this.cd = 0.8; this.huntT = 3; this.cb.foundHidden?.(spot, this, true); return true; }
    this.cb.nearMiss?.();
    return false;
  }

  // ----- AI -----
  pickRoamTarget(P) {
    const m = this.mgr, nodes = m.nodes.filter((n) => n.n.length && n !== this.curNode);
    let sum = 0; const ws = nodes.map((n) => {
      const d = Math.hypot(n.x - this.hint.x, n.z - this.hint.z);
      const w = (1 + (m.visits.get(n) || 0) * 0.35) * (1 + 3 * this.menace * Math.exp(-d / 30)); sum += w; return w;   // favors where the player is, and where the player likes to go
    });
    let r = Math.random() * sum; for (let i = 0; i < nodes.length; i++) { r -= ws[i]; if (r <= 0) return nodes[i]; }
    return nodes[0] || null;
  }
  findBody() {
    let best = null, bd = 26;
    for (const b of this.mgr.bodies) { if (b.found) continue; const d = Math.hypot(b.x - this.x, b.z - this.z); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  update(dt, P) {
    if (!this.active || !this.mgr) return;
    const m = this.mgr; this.t += dt; this.age += dt; this.cd -= dt; this.appear = Math.min(1, this.appear + dt / 1.4);
    this.menace = Math.min(1, 0.4 + this.age / 240);
    const dp = Math.hypot(P.x - this.x, P.z - this.z), seen = this.look(P, dp);
    // it senses roughly where the player is now and then
    this.senseT -= dt; if (this.senseT <= 0) { this.senseT = rr(18, 30); if ((this.state === 'roam' || this.state === 'search') && P.alive) this.hint = { x: P.x + rr(-16, 16), z: P.z + rr(-16, 16) }; }
    // it hears footsteps through the walls
    if (P.alive && !P.hidden && P.noise > 0 && dp < P.noise * (1.5 + 0.8 * this.dir.ears) && (this.state === 'roam' || this.state === 'search' || this.state === 'investigate')) { this.hint = { x: P.x + rr(-2, 2), z: P.z + rr(-2, 2) }; if (this.state !== 'investigate') { this.state = 'investigate'; this.path = null; this.checkSpot = null; } }
    if (seen && this.state !== 'hunt' && this.state !== 'attack') { this.state = 'hunt'; this.huntT = 0; this.lostT = 0; this.knowsHide = null; this.path = null; this.cb.spotted?.(); sfx.stalkerRoar?.(); }
    let speed = 0;
    switch (this.state) {
      case 'roam': {
        this.calmT += dt;
        if (this.wait > 0) { this.wait -= dt; this.yaw += Math.sin(this.t * 0.9) * dt * 0.8; this.lookT += dt; }
        else {
          if (!this.target) { this.target = this.pickRoamTarget(P); if (!this.target) { this.wait = 2; break; } }
          speed = 2.3 + 0.9 * this.menace;
          const d = m.navTo(this, this.target.x, this.target.z, speed, dt);
          if (d < 1.4) { this.prevNode = this.curNode; this.curNode = this.target; this.target = null; this.wait = rr(1.0, 3.2); const b = this.findBody(); if (b) { this.eatTarget = b; this.state = 'eat'; this.eatT = 0; } }
        }
        break;
      }
      case 'investigate': {
        this.calmT = 0; speed = 3.7;
        const d = m.navTo(this, this.hint.x, this.hint.z, speed, dt);
        if (d < 1.8) { this.lastSeen.set(this.hint.x, this.hint.z); this.state = 'search'; this.searchT = 11; this.checked.clear(); this.checkSpot = null; this.lookT = 0; }
        break;
      }
      case 'eat': {
        const b = this.eatTarget; if (!b || b.found) { this.state = 'roam'; break; }
        const d = Math.hypot(b.x - this.x, b.z - this.z);
        if (d > 1.7) { speed = 3.4; m.navTo(this, b.x, b.z, speed, dt); }
        else { this.eatT += dt; this.yaw += (Math.atan2(b.x - this.x, b.z - this.z) - this.yaw) * Math.min(1, dt * 5); if (this.eatT > 1.8) { m.removeBody(b); b.holder.visible = false; this.fx.emit(b.x, 0.4, b.z, 24, 0x6a1a5a, 4, 0.8); this.cb.whisper?.('It took the body.'); this.eatTarget = null; this.state = 'roam'; } }
        break;
      }
      case 'hunt': {
        this.calmT = 0; this.huntT += dt;
        const kh = this.knowsHide && P.hidden && P.hideId === this.knowsHide.id ? this.knowsHide : null; if (!kh) this.knowsHide = null;
        if (seen) { this.lastSeen.set(P.x, P.z); this.lostT = 0; } else if (!kh) this.lostT += dt;
        speed = 5.0 + Math.min(1.2, this.huntT * 0.12) + 0.4 * this.menace;
        const tx = kh ? kh.x : this.lastSeen.x, tz = kh ? kh.z : this.lastSeen.y, d = Math.hypot(tx - this.x, tz - this.z);
        if (kh && d < 1.9) { speed = 0; this.inspT += dt; if (this.inspT > 0.6) { this.inspT = 0; this.resolveHide(kh, P, true); } }
        else if (seen && dp < 1.9 && this.cd <= 0) { this.state = 'attack'; this.windT = 0.5; }
        else if (d > 0.8) m.navTo(this, tx, tz, speed, dt);
        else speed = 0;
        if (this.lostT > 1.8 && !kh) { this.state = 'search'; this.searchT = 16; this.checked.clear(); this.checkSpot = null; this.lookT = 0; this.path = null; this.hint = { x: this.lastSeen.x, z: this.lastSeen.y }; }
        break;
      }
      case 'attack': {
        this.windT -= dt; this.yaw += (Math.atan2(P.x - this.x, P.z - this.z) - this.yaw) * Math.min(1, dt * 12);
        if (this.windT <= 0) {
          this.cd = 1.3; this.state = 'hunt';
          const d = Math.hypot(P.x - this.x, P.z - this.z);
          if (d < 2.6 && P.alive && !P.hidden && !P.dashing) this.cb.hitPlayer?.(50, this.x, this.z);
          this.x += Math.sin(this.yaw) * 0.5; this.z += Math.cos(this.yaw) * 0.5; sfx.swing?.(); this.cb.shake?.(0.4);
        }
        break;
      }
      case 'search': {
        this.calmT = 0; this.searchT -= dt;
        if (this.checkSpot) {
          const s = this.checkSpot, d = Math.hypot(s.x - this.x, s.z - this.z);
          if (d > 1.9) { speed = 3.0; m.navTo(this, s.x, s.z, speed, dt); }
          else { this.yaw += (Math.atan2(s.x - this.x, s.z - this.z) - this.yaw) * Math.min(1, dt * 6); this.inspT += dt; if (this.inspT > 1.7) { this.inspT = 0; this.resolveHide(s, P, false); this.checkSpot = null; this.lookT = 0; } }
        } else {
          const d = Math.hypot(this.lastSeen.x - this.x, this.lastSeen.y - this.z);
          if (d > 1.6) { speed = 3.4; m.navTo(this, this.lastSeen.x, this.lastSeen.y, speed, dt); }
          else {
            this.yaw += dt * 1.3; this.lookT += dt;
            if (this.lookT > 2.0) {
              this.lookT = 0;
              if (this.checked.size < 4) {   // it checks hiding places near where it lost you; the more you hid, the more it checks
                let best = null, bd = 22; for (const s of m.hideSpots) { if (this.checked.has(s.id)) continue; const dd = Math.hypot(s.x - this.lastSeen.x, s.z - this.lastSeen.y); if (dd < bd) { bd = dd; best = s; } }
                if (best && (Math.random() < 0.4 + 0.6 * this.dir.hideWise || (P.hidden && P.hideId === best.id && Math.random() < 0.5))) { this.checkSpot = best; this.inspT = 0; } else if (best) this.checked.add(best.id);
              }
            }
          }
        }
        if (this.searchT <= 0) { this.state = 'roam'; this.target = null; this.wait = 1; this.curNode = m.nearestNode(this.x, this.z); this.checkSpot = null; }
        break;
      }
      default: break;
    }
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 5);
    // while roaming it also opens lockers it passes if it has learned that you hide
    if (this.state === 'roam' && this.dir.hideWise > 0.4 && P.hidden && Math.random() < dt * 0.4 * this.dir.hideWise) {
      for (const s of m.hideSpots) if (s.id === P.hideId && Math.hypot(s.x - this.x, s.z - this.z) < 6) { this.state = 'search'; this.lastSeen.set(s.x, s.z); this.searchT = 8; this.checked.clear(); this.checkSpot = s; this.inspT = 0; this.cb.whisper?.('It is checking the lockers.'); break; }
    }
    const k = Math.max(0, 1 - dp / 30);
    this.dread = k * (this.state === 'hunt' || this.state === 'attack' ? 1 : this.state === 'search' || this.state === 'investigate' ? 0.75 : 0.5);
    this.visual(dt, P);
  }

  // ----- body and limbs -----
  visual(dt, P) {
    const g = this.mass.group, crouch = (this.state === 'search' || this.state === 'eat') ? -0.25 : 0;
    const bob = Math.sin(this.t * 2.2) * 0.07 + Math.sin(this.t * 7) * 0.02 * Math.min(1, this.speedNow);
    g.position.set(this.x, 1.3 + bob + crouch - (1 - smooth(this.appear)) * 1.4, this.z);
    g.scale.setScalar(0.4 + 0.6 * smooth(this.appear));
    this.mass.core.rotation.y = this.yaw;
    this.mass.update(dt, this._tgt.set(P.x, P.y + 1.5, P.z));
    this.tent.mesh.visible = this.appear > 0.5;
    const c = this._c.set(this.x, g.position.y, this.z), fwx = Math.sin(this.yaw), fwz = Math.cos(this.yaw), sdx = Math.cos(this.yaw), sdz = -Math.sin(this.yaw);
    const [p0, p1, p2, p3] = this._p, ideal = this._id;
    // legs: plant a foot, lift the neighbours' turn
    for (let i = 0; i < NL; i++) {
      const l = this.legs[i], a = this.yaw + l.a;
      if (l.t < 0) {
        ideal.set(this.x + Math.sin(a) * 2.3 + fwx * this.speedNow * 0.22, 0.08, this.z + Math.cos(a) * 2.3 + fwz * this.speedNow * 0.22);
        if (l.foot.distanceTo(ideal) > 1.5 && this.legs[(i + 1) % NL].t < 0 && this.legs[(i + NL - 1) % NL].t < 0) { l.t = 0; l.from.copy(l.foot); l.to.copy(ideal); }
      } else {
        l.t += dt / 0.2;
        if (l.t >= 1) { l.t = -1; l.foot.copy(l.to); } else { l.foot.lerpVectors(l.from, l.to, smooth(l.t)); l.foot.y = 0.08 + Math.sin(l.t * Math.PI) * 0.7; }
      }
      const ox = Math.sin(a), oz = Math.cos(a);
      p0.set(c.x + ox * 0.7, c.y - 0.2, c.z + oz * 0.7);
      p1.set(p0.x + ox * 1.1, p0.y + 1.1, p0.z + oz * 1.1);
      p2.set(l.foot.x - ox * 0.25, l.foot.y + 1.5, l.foot.z - oz * 0.25);
      this.tent.set(i, p0, p1, p2, l.foot, 0.17, 0.06, 0);
    }
    // arms: writhe in front, rise and slam when it attacks
    const atk = this.state === 'attack' ? 1 - Math.max(0, this.windT) / 0.5 : 0;
    for (let j = 0; j < NA; j++) {
      const sd = (j - 1) * 1.25, w = this.t * (1.4 + j * 0.3) + j * 2;
      p0.set(c.x + fwx * 0.4 + sdx * sd * 0.35, c.y + 0.5, c.z + fwz * 0.4 + sdz * sd * 0.35);
      if (atk > 0) {
        const hit = smooth(Math.max(0, (atk - 0.6) / 0.4)), raise = Math.min(1, atk / 0.6);
        p3.set(c.x + fwx * (0.6 + 1.4 * hit) + sdx * sd * (1 - hit) * 0.6, 0.3 + (1 - hit) * (1.8 + raise * 1.6), c.z + fwz * (0.6 + 1.4 * hit) + sdz * sd * (1 - hit) * 0.6);
      } else p3.set(c.x + fwx * 2.1 + sdx * sd + Math.sin(w) * 0.5, c.y + 0.4 + Math.sin(w * 1.3) * 0.7, c.z + fwz * 2.1 + sdz * sd + Math.cos(w) * 0.5);
      p1.set(p0.x + (p3.x - p0.x) * 0.3, p0.y + 0.9 + Math.sin(w) * 0.2, p0.z + (p3.z - p0.z) * 0.3);
      p2.set(p0.x + (p3.x - p0.x) * 0.7 + Math.cos(w * 1.1) * 0.3, p3.y + 0.5, p0.z + (p3.z - p0.z) * 0.7 + Math.sin(w * 1.1) * 0.3);
      this.tent.set(NL + j, p0, p1, p2, p3, 0.15, 0.05, 0);
    }
    this.tent.commit();
  }
}

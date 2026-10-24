import * as THREE from 'three';
import { announce } from './audio.js';

export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const smooth = (t) => t * t * (3 - 2 * t);

// A shot that flies the camera along a spline while looking along another spline.
export function pathShot(dur, posPts, lookPts, fov0, fov1, onUpdate) {
  let pc, lc;
  return {
    dur,
    enter() { pc = new THREE.CatmullRomCurve3(posPts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'); lc = new THREE.CatmullRomCurve3(lookPts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'); },
    apply(u, camera) {
      const e = ease(u);
      camera.position.copy(pc.getPoint(e)); camera.lookAt(lc.getPoint(e));
      const f = fov0 + (fov1 - fov0) * e; if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
      onUpdate?.(u, camera);
    },
  };
}

export class Cutscene {
  constructor(camera, ui) { this.camera = camera; this.ui = ui; this.active = false; }
  play(def) {
    this.def = def; this.t = 0; this.idx = -1; this.active = true; this.total = def.shots.reduce((a, s) => a + s.dur, 0);
    for (const c of def.captions || []) c.done = false;
    this.ui.bars(true); def.onStart?.();
  }
  skip() { if (this.active) this.finish(); }
  finish() {
    this.active = false; this.ui.bars(false); this.ui.caption(''); this.ui.title(false);
    try { window.speechSynthesis?.cancel(); } catch (e) { /* ignore */ }
    this.def.onEnd?.();
  }
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    let acc = 0, found = false;
    for (let i = 0; i < this.def.shots.length; i++) {
      const s = this.def.shots[i];
      if (this.t < acc + s.dur) {
        if (this.idx !== i) { this.idx = i; s.enter?.(); }
        s.apply((this.t - acc) / s.dur, this.camera, this.t); found = true; break;
      }
      acc += s.dur;
    }
    for (const c of this.def.captions || []) {
      if (!c.done && this.t >= c.t) { c.done = true; this.ui.caption(c.text); if (c.speak !== false) announce(c.text); }
      if (c.done && this.t >= c.t + c.dur && this.ui.currentCaption === c.text) this.ui.caption('');
    }
    this.def.onTick?.(this.t);
    if (!found || this.t >= this.total) this.finish();
  }
}

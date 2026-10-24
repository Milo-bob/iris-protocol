import * as THREE from 'three';

// Cheap particle pool (additive points): sparks, dust, smoke puffs. No blood.
export class FX {
  constructor(scene, max = 400) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.base = new Float32Array(max * 3); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), rg = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = rg; x.fillRect(0, 0, 32, 32);
    this.mesh = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mesh.frustumCulled = false; scene.add(this.mesh);
    for (let k = 0; k < max; k++) this.pos[k * 3 + 1] = -999;
  }
  emit(x, y, z, count, hex, speed = 4, life = 0.5, gravity = 9, up = 1.5) {
    const c = new THREE.Color(hex);
    for (let n = 0; n < count; n++) {
      const k = this.i; this.i = (this.i + 1) % this.max;
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      this.vel[k * 3] = Math.cos(a) * s; this.vel[k * 3 + 1] = Math.random() * s * 0.7 + up; this.vel[k * 3 + 2] = Math.sin(a) * s;
      this.base[k * 3] = c.r; this.base[k * 3 + 1] = c.g; this.base[k * 3 + 2] = c.b;
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.6); this.grav[k] = gravity;
    }
  }
  update(dt) {
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { if (this.pos[k * 3 + 1] > -900) { this.pos[k * 3 + 1] = -999; this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0; } continue; }
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= this.grav[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.03) { this.pos[k * 3 + 1] = 0.03; this.vel[k * 3 + 1] *= -0.3; this.vel[k * 3] *= 0.6; this.vel[k * 3 + 2] *= 0.6; }
      const f = Math.max(0, this.life[k] / this.maxLife[k]);
      this.col[k * 3] = this.base[k * 3] * f; this.col[k * 3 + 1] = this.base[k * 3 + 1] * f; this.col[k * 3 + 2] = this.base[k * 3 + 2] * f;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

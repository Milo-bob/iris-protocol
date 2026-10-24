import * as THREE from 'three';
import { GLTFLoader } from './jsm/loaders/GLTFLoader.js';

export const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);

export function tex(file, { srgb = false, repeat = null } = {}) {
  const t = texLoader.load('assets/textures/' + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

// PBR material from a Poly Haven texture set (CC0): <name>_diff / _nor / _rough .webp
export function pbr(name, o = {}) {
  const rep = o.repeat || null;
  return new THREE.MeshStandardMaterial({
    map: tex(name + '_diff.webp', { srgb: true, repeat: rep }),
    normalMap: tex(name + '_nor.webp', { repeat: rep }),
    roughnessMap: tex(name + '_rough.webp', { repeat: rep }),
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    color: o.color ?? 0xffffff,
    vertexColors: !!o.vertexColors,
    normalScale: new THREE.Vector2(o.ns ?? 1, o.ns ?? 1),
  });
}

export function loadGLB(id) {
  return new Promise((resolve, reject) => gltfLoader.load(`assets/models/${id}.glb`, resolve, undefined, reject));
}

// Bake node transforms into geometry; optionally keep only some meshes and re-center to the origin (base at y=0).
export async function loadProp(id, { names = null, recenter = false } = {}) {
  const g = await loadGLB(id);
  g.scene.updateMatrixWorld(true);
  const parts = [];
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (names) {   // match the mesh or any of its ancestors by name (multi-material meshes become groups)
      let n = o, ok = false;
      while (n && !ok) { ok = names.includes(n.name); n = n.parent; }
      if (!ok) return;
    }
    const geometry = o.geometry.clone();
    geometry.applyMatrix4(o.matrixWorld);
    parts.push({ geometry, material: o.material });
  });
  if (!parts.length) console.warn('prop has no parts:', id, names);
  if (recenter && parts.length) {
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    for (const p of parts) p.geometry.translate(-cx, -box.min.y, -cz);
  }
  return parts;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
// Instances are split into spatial chunks so frustum culling and distance culling skip most of the city.
export function instanced(parts, list, { shadow = true, chunk = 36 } = {}) {
  const group = new THREE.Group();
  if (!list.length) return group;
  const buckets = new Map();
  for (const it of list) { const k = Math.floor(it.x / chunk) + ',' + Math.floor(it.z / chunk); let a = buckets.get(k); if (!a) buckets.set(k, (a = [])); a.push(it); }
  for (const items of buckets.values()) for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geometry, part.material, items.length);
    let cx = 0, cz = 0;
    items.forEach((it, k) => {
      _q.setFromAxisAngle(_up, it.ry || 0); _p.set(it.x, it.y || 0, it.z);
      const sc = it.s || 1; _s.set(sc, sc, sc); _m.compose(_p, _q, _s); im.setMatrixAt(k, _m); cx += it.x; cz += it.z;
    });
    im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = true; im.userData.cx = cx / items.length; im.userData.cz = cz / items.length;
    im.computeBoundingSphere(); group.add(im);
  }
  return group;
}
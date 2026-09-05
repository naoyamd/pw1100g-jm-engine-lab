import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEngineGeometry } from '../lib/engine-geometry.ts';
import { isolatePartMaterials, INSPECTION_VIEWS } from '../lib/inspection.ts';
import { batchRepeatedMeshes } from '../lib/render-batches.ts';

void test('part finishes isolate casing transparency without changing rotor geometry or motion', () => {
  const engine = createEngineGeometry();
  const before = new THREE.Box3().setFromObject(engine.group);
  const meshCount = (root: THREE.Object3D) => {
    let count = 0;
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) count++;
    });
    return count;
  };
  const count = meshCount(engine.group);
  const materials = isolatePartMaterials(engine.group);
  assert.equal(meshCount(engine.group), count);
  const after = new THREE.Box3().setFromObject(engine.group);
  assert.ok(before.equals(after));
  engine.casing.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.opacity = 0.12;
      m.transparent = true;
    }
  });
  let fixedSupports = 0;
  engine.stationary.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    fixedSupports++;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      assert.equal(materials.get(m), o.userData.partId);
      assert.equal(m.opacity, 1, `${o.userData.partId} must stay opaque`);
    }
  });
  assert.ok(fixedSupports > 0);
  batchRepeatedMeshes(engine.group);
  assert.ok(meshCount(engine.group) < count);
  engine.setAngles(1.2, 2.1);
  assert.equal(engine.lp.rotation.x, 1.2);
  assert.equal(engine.hp.rotation.x, 2.1);
  assert.ok(Math.abs(engine.fan.rotation.x + 0.4) < 1e-14);
  for (const [view, families] of [
    ['compressor', ['lpc', 'hpc']],
    ['turbine', ['hpt', 'lpt']],
  ] as const) {
    const range = INSPECTION_VIEWS[view].xRange!;
    for (const stage of engine.stages.filter((s) =>
      (families as readonly string[]).includes(s.family),
    ))
      assert.ok(
        stage.x > range[0] && stage.x < range[1],
        `${stage.id} must be inside inspection window`,
      );
  }
});

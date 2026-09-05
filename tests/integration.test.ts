import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEngine, advanceEngine } from '../lib/physics.ts';
import { FLOW_PATH, createEngineGeometry } from '../lib/engine-geometry.ts';
import { createGearbox } from '../lib/gear.ts';
import { sampleFlow, transportGrid, advect } from '../lib/flow.ts';
import { batchRepeatedMeshes } from '../lib/render-batches.ts';

void test('rendered flow envelope satisfies continuity and the fixed cycle station areas', () => {
  for (const throttle of [0.1, 0.4, 0.7, 1]) {
    const { cycle } = createEngine(throttle);
    for (const stream of ['core', 'bypass'] as const) {
      const path = FLOW_PATH.filter((p) => p.stream === stream);
      const first = path[0].x,
        last = path[path.length - 1].x;
      for (let i = 0; i <= 200; i++) {
        const f = sampleFlow(
          stream,
          first + ((last - first) * i) / 200,
          cycle,
          FLOW_PATH,
        );
        assert.ok(
          f.continuityResidual < 1e-7,
          `${stream}: continuity ${f.continuityResidual}`,
        );
        assert.ok(f.mach <= 1 && f.velocity > 0);
      }
      for (const station of cycle.stations.filter(
        (s) => s.stream === stream && s.x >= first && s.x <= last,
      )) {
        const f = sampleFlow(stream, station.x, cycle, FLOW_PATH);
        assert.ok(
          Math.abs(f.area - station.area) < 1e-7,
          `${station.id}: mesh area ${f.area}, cycle area ${station.area}`,
        );
      }
    }
  }
  for (const [from, to] of [
    [0.1, 1],
    [1, 0.1],
  ]) {
    let state = createEngine(from);
    for (let i = 0; i < 200; i++) {
      state = advanceEngine(state, to, 0.1);
      for (const stream of ['core', 'bypass'] as const) {
        const cells = transportGrid(stream, state.cycle, FLOW_PATH);
        assert.ok(
          cells.every(
            (cell) => cell.continuityResidual < 1e-7 && cell.mach <= 1,
          ),
        );
      }
    }
  }
});

void test('tracer transport respects physical time, wrapping and pause', () => {
  const state = createEngine(0.7);
  for (const stream of ['core', 'bypass'] as const) {
    const grid = transportGrid(stream, state.cycle, FLOW_PATH);
    const start = grid[0].x0 + 0.001;
    assert.equal(advect(start, 0, grid), start);
    const smallDt = Math.min(
      0.000001,
      (grid[0].x1 - start) / grid[0].velocity / 2,
    );
    assert.ok(
      Math.abs(
        advect(start, smallDt, grid) - start - grid[0].velocity * smallDt,
      ) < 1e-12,
    );
    const one = advect(start, 0.075, grid);
    let split = start;
    for (let i = 0; i < 75; i++) split = advect(split, 0.001, grid);
    assert.ok(
      Math.abs(one - split) < 1e-8,
      `${stream}: time partition error ${one - split}`,
    );
  }
});

void test('one dynamic state drives independent spools, actual gearbox meshes and fixed star centres', () => {
  const engine = createEngineGeometry(),
    gearbox = createGearbox();
  gearbox.group.position.x = 0.6;
  let state = createEngine(0.4);
  const nominal = createEngine(0.7);
  assert.ok(
    Math.abs(engine.metadata.designPoint.lpOmega - nominal.lpOmega) < 1e-8,
  );
  assert.ok(
    Math.abs(engine.metadata.designPoint.hpOmega - nominal.hpOmega) < 1e-8,
  );
  const originCentres = gearbox.stars.map((s) =>
    s.getWorldPosition(new THREE.Vector3()),
  );
  for (let i = 0; i < 40; i++) {
    state = advanceEngine(state, 0.9, 0.025);
    engine.setAngles(state.lpAngle, state.hpAngle);
    gearbox.setAngle(state.lpAngle);
    engine.group.updateMatrixWorld(true);
    gearbox.group.updateMatrixWorld(true);
    const angle = (v: number) => Math.abs(Math.atan2(Math.sin(v), Math.cos(v)));
    assert.ok(angle(engine.fan.rotation.x - gearbox.ring.rotation.x) < 1e-10);
    assert.ok(angle(engine.lp.rotation.x - gearbox.sun.rotation.x) < 1e-10);
    assert.ok(angle(engine.hp.rotation.x - state.hpAngle) < 1e-10);
    assert.equal(gearbox.carrier.rotation.x, 0);
    for (let j = 0; j < 5; j++)
      assert.ok(
        gearbox.stars[j]
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(originCentres[j]) < 1e-12,
      );
  }
});

void test('batched display retains every blade geometry and physical parent transform', () => {
  const engine = createEngineGeometry();
  engine.setAngles(0.71, 1.82);
  engine.group.updateMatrixWorld(true);
  const expected = new Map<string, THREE.Matrix4[]>();
  const key = (object: THREE.Mesh) =>
    `${object.userData.partId}/${object.geometry.uuid}`;
  let originalCount = 0;
  engine.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    originalCount++;
    const k = key(object);
    const transforms = expected.get(k) ?? [];
    transforms.push(object.matrixWorld.clone());
    expected.set(k, transforms);
  });
  batchRepeatedMeshes(engine.group);
  engine.group.updateMatrixWorld(true);
  let drawCount = 0;
  const matrix = new THREE.Matrix4();
  engine.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    drawCount++;
    const count = object instanceof THREE.InstancedMesh ? object.count : 1;
    for (let i = 0; i < count; i++) {
      if (object instanceof THREE.InstancedMesh) {
        object.getMatrixAt(i, matrix);
        matrix.premultiply(object.matrixWorld);
      } else matrix.copy(object.matrixWorld);
      const transforms = expected.get(key(object))!;
      // GPU instance matrices use float32; source geometry remains identical.
      const index = transforms.findIndex((candidate) =>
        candidate.elements.every(
          (v, j) => Math.abs(v - matrix.elements[j]) < 1e-6,
        ),
      );
      assert.ok(
        index >= 0,
        `Missing original placement: ${object.userData.partId}`,
      );
      transforms.splice(index, 1);
    }
  });
  assert.ok(
    [...expected.values()].every((transforms) => transforms.length === 0),
  );
  assert.ok(
    drawCount < originalCount / 4,
    `${drawCount} / ${originalCount} draw calls`,
  );
});

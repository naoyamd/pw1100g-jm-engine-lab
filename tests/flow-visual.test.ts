import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createFlowVisual, FLOW_FIELDS } from '../lib/flow-visual.ts';
import { FLOW_PATH } from '../lib/engine-geometry.ts';
import { advect, sampleFlow, transportGrid } from '../lib/flow.ts';
import { advanceEngine, createEngine } from '../lib/physics.ts';

void test('flow field metadata exposes fixed Japanese display scales and legends', () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(FLOW_FIELDS).map(([key, spec]) => [
        key,
        [spec.label, spec.unit, spec.min, spec.max],
      ]),
    ),
    {
      temperature: ['全温 Tt', 'K', 250, 1800],
      pressure: ['全圧 Pt', 'MPa', 0.08, 2.2],
      velocity: ['軸流速度', 'm/s', 0, 650],
    },
  );
  for (const spec of Object.values(FLOW_FIELDS)) {
    assert.equal(spec.legend, spec.colorLegend);
    assert.equal(spec.legend.length, 3);
    assert.ok(
      spec.legend.every(
        (stop) => stop.value >= spec.min && stop.value <= spec.max,
      ),
    );
    assert.ok(spec.legend.every((stop) => /^#[0-9a-f]{6}$/i.test(stop.color)));
  }
});

void test('flow visual uses real ribbon meshes inside the sampled annuli', () => {
  const state = createEngine(0.7);
  const visual = createFlowVisual(FLOW_PATH);
  const residual = visual.update(state, 'temperature').continuityResidual;
  assert.ok(residual < 1e-7, `continuity residual ${residual}`);

  let ribbons = 0;
  visual.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.meanFlow) return;
    ribbons++;
    const position = object.geometry.getAttribute('position');
    assert.ok(object.geometry.index && object.geometry.index.count >= 6);
    const stream = object.userData.stream as 'core' | 'bypass';
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index);
      const radius = Math.hypot(position.getY(index), position.getZ(index));
      const sample = sampleFlow(stream, x, state.cycle, FLOW_PATH);
      assert.ok(radius >= sample.hub - 1e-6, `${stream} ribbon below hub`);
      assert.ok(radius <= sample.tip + 1e-6, `${stream} ribbon above tip`);
    }
  });
  assert.ok(ribbons >= 2);
  assert.ok(
    visual.group.getObjectByName('core-flow-arrowheads') instanceof
      THREE.InstancedMesh,
  );
  assert.ok(
    visual.group.getObjectByName('bypass-flow-trails') instanceof
      THREE.LineSegments,
  );
  visual.dispose();
});

void test('arrows advance by EngineState time, freeze on pause, and reset on rewind', () => {
  const initial = createEngine(0.7);
  const visual = createFlowVisual(FLOW_PATH);
  visual.update(initial, 'velocity');
  const arrowheads = visual.group.getObjectByName(
    'core-flow-arrowheads',
  ) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  assert.ok(arrowheads.material instanceof THREE.MeshBasicMaterial);
  assert.ok(
    !arrowheads.material.vertexColors ||
      arrowheads.geometry.hasAttribute('color'),
    'arrow shader must not read a missing vertex color attribute',
  );
  assert.ok(
    arrowheads.instanceColor,
    'scalar colors must reach the rendered arrow instances',
  );
  arrowheads.getMatrixAt(0, matrix);
  const startX = matrix.elements[12];

  const advanced = advanceEngine(initial, 0.7, 0.001);
  visual.update(advanced, 'velocity');
  arrowheads.getMatrixAt(0, matrix);
  const movedX = matrix.elements[12];
  const expected = advect(
    startX,
    advanced.time - initial.time,
    transportGrid('core', advanced.cycle, FLOW_PATH),
  );
  assert.ok(movedX > startX, `${startX} -> ${movedX}`);
  assert.ok(Math.abs(movedX - expected) < 1e-5);

  visual.update(advanced, 'pressure');
  arrowheads.getMatrixAt(0, matrix);
  assert.equal(matrix.elements[12], movedX);

  visual.update(initial, 'temperature');
  arrowheads.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - startX) < 1e-5);
  visual.dispose();
});

void test('range trims display objects and clipping reaches every material', () => {
  const visual = createFlowVisual(FLOW_PATH);
  const state = createEngine(0.7);
  visual.update(state, 'pressure', [1.4, 2.4]);
  const ribbons = visual.group.children
    .flatMap((child) => child.children)
    .filter((child) => child.userData.meanFlow);
  assert.ok(ribbons.some((ribbon) => ribbon.visible));
  assert.ok(ribbons.some((ribbon) => !ribbon.visible));

  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  visual.setClipping([plane], true);
  visual.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      assert.equal(material.clippingPlanes?.length, 1);
      assert.equal(material.clipIntersection, true);
    }
  });
  visual.dispose();
  visual.dispose();
  assert.equal(visual.group.children.length, 0);
});

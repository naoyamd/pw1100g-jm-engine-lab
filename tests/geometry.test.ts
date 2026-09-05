import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  FLOW_PATH_AREAS,
  FLOW_PATH_STATION_X,
  createEngine,
} from '../lib/physics.ts';
import {
  BYPASS_FLOW_PATH,
  BYPASS_CASE_PROFILE,
  CORE_CASE_PROFILE,
  CORE_FLOW_PATH,
  CORE_FLOW_SHROUD_PROFILE,
  ENGINE_GEOMETRY_CONSTANTS,
  FLOW_PATH,
  GEOMETRY_DESIGN_POINT,
  bypassCaseInnerRadiusAt,
  coreCaseInnerRadiusAt,
  coreCaseOuterRadiusAt,
  coreFlowShroudInnerRadiusAt,
  coreFlowShroudOuterRadiusAt,
  createEngineGeometry,
  type EngineGeometryResult,
} from '../lib/engine-geometry.ts';

function findPart(engine: EngineGeometryResult, id: string): THREE.Object3D {
  let found: THREE.Object3D | undefined;
  engine.group.traverse((object) => {
    if (!found && object.userData.partId === id) found = object;
  });
  assert.ok(found, `missing part ${id}`);
  return found;
}

function radialExtent(object: THREE.Object3D): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  const position = new THREE.Vector3();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const attribute = child.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1) {
      position
        .fromBufferAttribute(attribute, index)
        .applyMatrix4(child.matrixWorld);
      const radius = Math.hypot(position.y, position.z);
      min = Math.min(min, radius);
      max = Math.max(max, radius);
    }
  });
  return { min, max };
}

function radialExtentAtX(
  object: THREE.Object3D,
  x: number,
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  const position = new THREE.Vector3();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const attribute = child.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1) {
      position
        .fromBufferAttribute(attribute, index)
        .applyMatrix4(child.matrixWorld);
      if (Math.abs(position.x - x) > 1e-6) continue;
      const radius = Math.hypot(position.y, position.z);
      min = Math.min(min, radius);
      max = Math.max(max, radius);
    }
  });
  assert.ok(Number.isFinite(min), `mesh has a radial section at x=${x}`);
  return { min, max };
}

function xExtent(object: THREE.Object3D): { min: number; max: number } {
  const bounds = new THREE.Box3().setFromObject(object);
  return { min: bounds.min.x, max: bounds.max.x };
}

function weldKey(x: number, y: number, z: number): string {
  const quantize = (value: number) => Math.round(value * 1e6);
  return `${quantize(x)},${quantize(y)},${quantize(z)}`;
}

function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  assert.ok(index);
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    a.fromBufferAttribute(position, index.getX(triangle));
    b.fromBufferAttribute(position, index.getX(triangle + 1));
    c.fromBufferAttribute(position, index.getX(triangle + 2));
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return volume;
}

function weldedEdgeIncidence(
  geometry: THREE.BufferGeometry,
): Map<string, number[]> {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  assert.ok(index);
  const vertices: string[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    vertices.push(
      weldKey(
        position.getX(vertex),
        position.getY(vertex),
        position.getZ(vertex),
      ),
    );
  }
  const edges = new Map<string, number[]>();
  const addEdge = (left: number, right: number) => {
    const a = vertices[left];
    const b = vertices[right];
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const directions = edges.get(key) ?? [];
    directions.push(a < b ? 1 : -1);
    edges.set(key, directions);
  };
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const a = index.getX(triangle);
    const b = index.getX(triangle + 1);
    const c = index.getX(triangle + 2);
    assert.notEqual(vertices[a], vertices[b], 'degenerate welded edge');
    assert.notEqual(vertices[b], vertices[c], 'degenerate welded edge');
    assert.notEqual(vertices[c], vertices[a], 'degenerate welded edge');
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return edges;
}

function caseInnerLimit(family: string, x: number): number {
  if (family === 'fan') return 1.05;
  return coreFlowShroudInnerRadiusAt(x);
}

function minimumCaseClearance(object: THREE.Object3D, family: string): number {
  let minimum = Number.POSITIVE_INFINITY;
  const position = new THREE.Vector3();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const attribute = child.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1) {
      position
        .fromBufferAttribute(attribute, index)
        .applyMatrix4(child.matrixWorld);
      minimum = Math.min(
        minimum,
        caseInnerLimit(family, position.x) - Math.hypot(position.y, position.z),
      );
    }
  });
  return minimum;
}

function minimumStatorWallClearance(
  object: THREE.Object3D,
  fanCase: boolean,
): number {
  const vaneRoles = new Set([
    'structural-guide-vane',
    'stator-vane',
    'stator-inner-platform',
    'stator-outer-platform',
  ]);
  let minimum = Number.POSITIVE_INFINITY;
  const position = new THREE.Vector3();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !vaneRoles.has(child.userData.role))
      return;
    const attribute = child.geometry.getAttribute('position');
    for (let index = 0; index < attribute.count; index += 1) {
      position
        .fromBufferAttribute(attribute, index)
        .applyMatrix4(child.matrixWorld);
      const boundary = fanCase ? 1.05 : coreFlowShroudInnerRadiusAt(position.x);
      minimum = Math.min(
        boundary - Math.hypot(position.y, position.z),
        minimum,
      );
    }
  });
  return minimum;
}

function flowTipAt(x: number): number {
  if (x <= CORE_FLOW_PATH[0].x) return CORE_FLOW_PATH[0].tip;
  const last = CORE_FLOW_PATH.at(-1)!;
  if (x >= last.x) return last.tip;
  for (let index = 1; index < CORE_FLOW_PATH.length; index += 1) {
    const right = CORE_FLOW_PATH[index];
    if (x <= right.x) {
      const left = CORE_FLOW_PATH[index - 1];
      const fraction = (x - left.x) / (right.x - left.x);
      return left.tip + (right.tip - left.tip) * fraction;
    }
  }
  return last.tip;
}

void test('builds the requested connected stage topology', () => {
  const engine = createEngineGeometry();
  engine.group.updateMatrixWorld(true);

  assert.deepEqual(engine.stageCounts, {
    fan: 1,
    lpc: 3,
    hpc: 8,
    hpt: 2,
    lpt: 3,
  });
  assert.equal(engine.stages.length, 17);
  assert.equal(
    engine.metadata.architecture,
    '1fan-3LPC-8HPC-annular-combustor-2HPT-3LPT',
  );
  assert.equal(
    engine.metadata.fanDiameter,
    ENGINE_GEOMETRY_CONSTANTS.fanDiameter,
  );

  for (const stage of engine.stages) {
    const rotor = findPart(engine, stage.id);
    assert.equal(rotor.userData.role, 'rotor-stage');
    assert.equal(rotor.userData.stageId, stage.id);
    assert.equal(
      rotor.children.filter((child) => child.userData.role === 'rotor-blade')
        .length,
      stage.bladeCount,
      `${stage.id} blade count`,
    );
    assert.ok(
      rotor.children.some((child) => child.userData.role === 'rotor-disk'),
    );
    assert.ok(
      rotor.children.some((child) => child.userData.role === 'rotor-hub'),
    );
  }

  for (const id of [
    'front-center-body',
    'front-bearing-frame',
    'hp-front-bearing-frame',
    'hp-aft-bearing-frame',
    'rear-bearing-frame',
  ]) {
    assert.ok(
      engine.parts.some((part) => part.id === id),
      `metadata for ${id}`,
    );
  }
  const sgv = findPart(engine, 'front-sgv');
  assert.ok(
    sgv.children.filter(
      (child) => child.userData.role === 'structural-guide-vane',
    ).length >= 8,
  );
  assert.ok(
    engine.selectables.every(
      (object) => typeof object.userData.partId === 'string',
    ),
  );

  const carrierSupport = findPart(engine, 'gearbox-carrier-support');
  const carrierSupportSpan = xExtent(carrierSupport);
  assert.ok(carrierSupportSpan.min >= 0.632 && carrierSupportSpan.max <= 0.64);
  assert.equal(carrierSupport.userData.carrierX, 0.6);
});

void test('keeps shafts separated at the reserved gearbox and clears blade tips', () => {
  const engine = createEngineGeometry();
  engine.group.updateMatrixWorld(true);

  const fanShaftObject = findPart(engine, 'fan-output-shaft');
  const lpShaftObject = findPart(engine, 'lp-inner-shaft');
  const fanShaft = xExtent(fanShaftObject);
  const lpShaft = xExtent(lpShaftObject);
  assert.ok(Math.abs(fanShaft.min - 0.2) < 1e-3);
  assert.ok(Math.abs(fanShaft.max - 0.55) < 1e-3);
  assert.ok(Math.abs(lpShaft.min - 0.58) < 1e-3);
  assert.ok(Math.abs(lpShaft.max - 3.25) < 1e-3);
  assert.ok(
    fanShaft.max < lpShaft.min,
    'fan/ring and LP/sun shafts leave the reducer interface open',
  );
  assert.equal(
    engine.parts.some((part) => part.id === 'lp-drive-coupling'),
    false,
  );

  const hpShaftObject = findPart(engine, 'hp-hollow-shaft');
  const hpShaft = xExtent(hpShaftObject);
  const hpRadii = radialExtent(hpShaftObject);
  assert.ok(Math.abs(hpRadii.min - 0.06) < 1e-3, `HP bore ${hpRadii.min}`);
  assert.ok(Math.abs(hpRadii.max - 0.095) < 1e-3, `HP wall ${hpRadii.max}`);

  for (const stage of engine.stages.filter(
    (item) => item.family === 'hpc' || item.family === 'hpt',
  )) {
    const hub = findPart(engine, stage.id).children.find(
      (child) => child.userData.role === 'rotor-hub',
    );
    assert.ok(hub, `${stage.id} hollow hub`);
    assert.ok(
      radialExtent(hub).min >= 0.095 - 1e-3,
      `${stage.id} hub preserves HP bore`,
    );
    assert.equal(hub.userData.boreRadius, 0.095);
  }

  for (const stage of engine.stages) {
    const stageObject = findPart(engine, stage.id);
    const clearance = minimumCaseClearance(stageObject, stage.family);
    assert.ok(
      clearance > 0.003,
      `${stage.id} actual case clearance ${clearance}`,
    );
    const radius = radialExtent(stageObject);
    assert.ok(radius.min >= 0);

    const shaftSpan =
      stage.family === 'fan'
        ? fanShaft
        : stage.family === 'hpc' || stage.family === 'hpt'
          ? hpShaft
          : lpShaft;
    const disk = stageObject.children.find(
      (child) => child.userData.role === 'rotor-disk',
    );
    assert.ok(disk, `${stage.id} disk`);
    const diskSpan = xExtent(disk);
    assert.ok(
      diskSpan.min < shaftSpan.max && diskSpan.max > shaftSpan.min,
      `${stage.id} disk/shaft overlap`,
    );
    const diskRadius = radialExtent(disk);
    assert.ok(
      diskRadius.min <
        (stage.family === 'fan'
          ? 0.055
          : stage.family === 'hpc' || stage.family === 'hpt'
            ? 0.095
            : 0.035),
    );
    if (stage.family === 'hpc' || stage.family === 'hpt') {
      assert.ok(
        diskRadius.min >= 0.06 - 1e-3,
        `${stage.id} disk preserves HP bore`,
      );
    }

    const path = CORE_FLOW_PATH.find((point) => point.stageId === stage.id);
    if (path) {
      assert.ok(
        Math.abs(path.hub - stage.hubRadius) < 1e-9,
        `${stage.id} hub/flow mapping`,
      );
      assert.ok(
        Math.abs(path.tip - stage.tipRadius) < 1e-9,
        `${stage.id} tip/flow mapping`,
      );
    }
  }

  const lpcTips = engine.stages
    .filter((stage) => stage.family === 'lpc')
    .map((stage) => stage.tipRadius);
  const lptTips = engine.stages
    .filter((stage) => stage.family === 'lpt')
    .map((stage) => stage.tipRadius);
  assert.ok(lpcTips[0] > lpcTips[2], 'compressor annulus contracts');
  assert.ok(lptTips[0] < lptTips[2], 'turbine annulus opens');

  for (const point of CORE_FLOW_PATH) {
    if (point.x >= CORE_CASE_PROFILE[0].x) {
      assert.ok(
        point.tip < coreCaseInnerRadiusAt(point.x),
        `${point.stageId ?? 'core'} stays inside the structural case`,
      );
      assert.ok(
        Math.abs(
          coreFlowShroudInnerRadiusAt(point.x) -
            point.tip -
            ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudClearance,
        ) < 1e-12,
        `${point.stageId ?? 'core'} maps to the physical flow shroud`,
      );
    }
  }
  const coreFlowShroud = findPart(engine, 'core-flow-shroud');
  assert.equal(coreFlowShroud.userData.role, 'core-flow-shroud');
  assert.deepEqual(engine.flowShroudProfile, CORE_FLOW_SHROUD_PROFILE);
  const shroudSpan = xExtent(coreFlowShroud);
  assert.ok(shroudSpan.min <= CORE_FLOW_SHROUD_PROFILE[0].x + 1e-6);
  assert.ok(shroudSpan.max >= CORE_FLOW_SHROUD_PROFILE.at(-1)!.x - 1e-6);
  for (const point of CORE_FLOW_SHROUD_PROFILE) {
    const flowPoint = CORE_FLOW_PATH.find(
      (candidate) => candidate.x === point.x,
    );
    const flowTip = flowPoint?.tip ?? flowTipAt(point.x);
    assert.ok(
      point.inner >=
        flowTip + ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudClearance - 1e-12,
    );
    if (flowPoint) {
      assert.ok(
        Math.abs(
          point.inner -
            flowPoint.tip -
            ENGINE_GEOMETRY_CONSTANTS.coreFlowShroudClearance,
        ) < 1e-12,
      );
    }
    assert.ok(point.outer > point.inner);
    assert.ok(
      point.outer < coreCaseInnerRadiusAt(point.x),
      `core shroud clears structural case at x=${point.x}`,
    );
    const meshBoundary = radialExtentAtX(coreFlowShroud, point.x);
    assert.ok(
      Math.abs(meshBoundary.min - point.inner) < 2e-5,
      `core shroud inner mesh boundary at x=${point.x}`,
    );
    assert.ok(
      Math.abs(meshBoundary.max - point.outer) < 2e-5,
      `core shroud outer mesh boundary at x=${point.x}`,
    );
  }
  for (let sample = 0; sample <= 128; sample += 1) {
    const x =
      CORE_FLOW_SHROUD_PROFILE[0].x +
      ((CORE_FLOW_SHROUD_PROFILE.at(-1)!.x - CORE_FLOW_SHROUD_PROFILE[0].x) *
        sample) /
        128;
    assert.ok(
      coreFlowShroudOuterRadiusAt(x) < coreCaseInnerRadiusAt(x),
      `continuous core shroud/case separation at x=${x.toFixed(3)}`,
    );
  }
  for (const point of BYPASS_FLOW_PATH) {
    if (point.x >= BYPASS_CASE_PROFILE[0].x) {
      assert.ok(
        point.tip <= bypassCaseInnerRadiusAt(point.x) + 1e-12,
        `${point.stageId ?? 'bypass'} meets the bypass flow wall boundary`,
      );
    }
  }
  const bypassCase = findPart(engine, 'bypass-envelope');
  for (const point of BYPASS_CASE_PROFILE) {
    assert.ok(
      point.outer - point.inner >=
        ENGINE_GEOMETRY_CONSTANTS.bypassCaseWall - 1e-12,
    );
    assert.ok(
      Math.abs(
        point.outer - point.inner - ENGINE_GEOMETRY_CONSTANTS.bypassCaseWall,
      ) < 1e-12,
    );
    const meshBoundary = radialExtentAtX(bypassCase, point.x);
    assert.ok(
      Math.abs(meshBoundary.min - point.inner) < 2e-5,
      `bypass inner mesh boundary at x=${point.x}`,
    );
    assert.ok(
      Math.abs(meshBoundary.max - point.outer) < 2e-5,
      `bypass outer mesh boundary at x=${point.x}`,
    );
  }
  for (const point of BYPASS_FLOW_PATH.slice(1)) {
    assert.ok(
      point.hub >
        coreCaseOuterRadiusAt(Math.max(point.x, CORE_CASE_PROFILE[0].x)),
      `${point.stageId ?? 'bypass'} clears the core-case outside wall`,
    );
  }

  for (const row of engine.stationary.children) {
    if (
      row.userData.role !== 'stator-row' &&
      row.userData.role !== 'structural-guide-vane-row'
    )
      continue;
    assert.ok(
      minimumStatorWallClearance(
        row,
        row.userData.stageId === 'fan' || row.userData.partId === 'front-sgv',
      ) > 0.003,
      `${row.userData.partId ?? 'stator'} actual vane/case clearance`,
    );
  }
});

void test('uses triangle-derived work and maintains the 3:1 fan phase', () => {
  const engine = createEngineGeometry();
  assert.equal(engine.metadata.fanRpm, GEOMETRY_DESIGN_POINT.fanRpm);
  assert.equal(engine.metadata.lpRpm, GEOMETRY_DESIGN_POINT.lpRpm);
  assert.equal(engine.metadata.hpRpm, GEOMETRY_DESIGN_POINT.hpRpm);
  const nominal = createEngine(GEOMETRY_DESIGN_POINT.throttle);
  assert.equal(engine.metadata.designPoint.lpOmega, nominal.lpOmega);
  assert.equal(engine.metadata.designPoint.hpOmega, nominal.hpOmega);
  const expectedWork = GEOMETRY_DESIGN_POINT.specificWork;
  const expectedSpeed = GEOMETRY_DESIGN_POINT.axialSpeed;
  for (const stage of engine.stages) {
    assert.ok(
      Math.abs(stage.specificWork - expectedWork[stage.family]) < 1e-9,
      `${stage.id} cycle work`,
    );
    assert.ok(
      Math.abs(stage.axialSpeed - expectedSpeed[stage.family]) < 1e-9,
      `${stage.id} cycle speed`,
    );
  }
  for (const triangle of engine.velocityTriangles) {
    assert.ok(
      Math.abs(triangle.bladeSpeed - triangle.omega * triangle.radius) < 1e-9,
    );
    assert.ok(Math.abs(triangle.eulerWork - triangle.expectedWork) < 1e-9);
    assert.ok(Math.abs(triangle.workResidual) < 1e-9);
    assert.ok(triangle.pitch > 0);
    assert.ok(Number.isFinite(triangle.rotorStagger));
    assert.ok(Number.isFinite(triangle.statorStagger));
  }
  const nominalStations = new Map(
    nominal.cycle.stations.map((station) => [station.id, station]),
  );
  const combustorExit = nominalStations.get('combustor-exit')!;
  const hptExit = nominalStations.get('hpt-exit')!;
  const lptExit = nominalStations.get('lpt-exit')!;
  assert.ok(
    Math.abs(
      expectedWork.hpt * 2 -
        GEOMETRY_DESIGN_POINT.gasSpecificHeat * (combustorExit.Tt - hptExit.Tt),
    ) < 1e-8,
    'HPT Euler work follows gas enthalpy drop',
  );
  assert.ok(
    Math.abs(
      expectedWork.lpt * 3 -
        GEOMETRY_DESIGN_POINT.gasSpecificHeat * (hptExit.Tt - lptExit.Tt),
    ) < 1e-8,
    'LPT Euler work follows gas enthalpy drop',
  );
  assert.ok(
    engine.stages.some(
      (stage) =>
        Math.abs(
          stage.velocityTriangles[0].rotorStagger -
            stage.velocityTriangles[2].rotorStagger,
        ) > 0.05,
    ),
    'at least one rotor row has triangle-derived radial twist',
  );
  assert.ok(Math.abs(engine.workConsistency.residual) < 1e-9);
  assert.ok(engine.workConsistency.maxResidual < 1e-9);

  engine.setAngles(1.2, -0.7);
  assert.equal(engine.lp.rotation.x, 1.2);
  assert.equal(engine.hp.rotation.x, -0.7);
  assert.ok(Math.abs(engine.fan.rotation.x + 0.4) < 1e-12);
  assert.ok(Math.abs(engine.group.userData.angles.fan + 0.4) < 1e-12);

  const core = FLOW_PATH.filter((point) => point.stream === 'core');
  const bypass = FLOW_PATH.filter((point) => point.stream === 'bypass');
  assert.ok(
    core.every((point, index) => index === 0 || point.x > core[index - 1].x),
  );
  assert.ok(
    bypass.every(
      (point, index) => index === 0 || point.x > bypass[index - 1].x,
    ),
  );
  assert.ok(
    [...FLOW_PATH, ...BYPASS_FLOW_PATH].every((point) => point.area > 0),
  );

  const stationMapping = {
    'fan-exit': [FLOW_PATH_STATION_X.fanExit, FLOW_PATH_AREAS.fanExit],
    'core-split': [FLOW_PATH_STATION_X.coreSplit, FLOW_PATH_AREAS.coreSplit],
    'lpc-exit': [FLOW_PATH_STATION_X.lpcExit, FLOW_PATH_AREAS.lpcExit],
    'hpc-exit': [FLOW_PATH_STATION_X.hpcExit, FLOW_PATH_AREAS.hpcExit],
    'combustor-exit': [
      FLOW_PATH_STATION_X.combustorExit,
      FLOW_PATH_AREAS.combustor,
    ],
    'hpt-exit': [FLOW_PATH_STATION_X.hptExit, FLOW_PATH_AREAS.hptExit],
    'lpt-exit': [FLOW_PATH_STATION_X.lptExit, FLOW_PATH_AREAS.lptExit],
    'core-nozzle': [FLOW_PATH_STATION_X.coreNozzle, FLOW_PATH_AREAS.coreNozzle],
    'bypass-nozzle': [
      FLOW_PATH_STATION_X.bypassNozzle,
      FLOW_PATH_AREAS.bypassNozzle,
    ],
  } as const;
  for (const point of FLOW_PATH.filter((candidate) => candidate.stationId)) {
    const expected =
      stationMapping[point.stationId as keyof typeof stationMapping];
    assert.ok(expected, `known physics station ${point.stationId}`);
    assert.equal(point.x, expected[0]);
    assert.ok(Math.abs(point.area - expected[1]) < 1e-12);
    assert.equal(point.physicsArea, expected[1]);
  }
});

void test('emits closed indexed meshes with normals for cutaway caps', () => {
  const engine = createEngineGeometry();
  let meshCount = 0;
  const geometries = new Set<THREE.BufferGeometry>();
  engine.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount += 1;
    const meshPosition = object.geometry.getAttribute('position');
    const normal = object.geometry.getAttribute('normal');
    const index = object.geometry.getIndex();
    assert.ok(meshPosition && meshPosition.count > 0);
    assert.ok(normal && normal.count === meshPosition.count);
    assert.ok(index && index.count > 0 && index.count % 3 === 0);
    assert.equal(typeof object.userData.partId, 'string');
    if (geometries.has(object.geometry)) return;
    geometries.add(object.geometry);
    const edges = weldedEdgeIncidence(object.geometry);
    assert.ok(
      [...edges.values()].every(
        (directions) =>
          directions.length === 2 && directions[0] === -directions[1],
      ),
      `${object.userData.partId ?? 'mesh'} is a directed welded two-manifold`,
    );
    assert.ok(
      signedVolume(object.geometry) > 1e-10,
      `${object.userData.partId ?? 'mesh'} has outward winding`,
    );
    const normals = object.geometry.getAttribute('normal');
    for (let vertex = 0; vertex < normals.count; vertex += 1) {
      const x = normals.getX(vertex);
      const y = normals.getY(vertex);
      const z = normals.getZ(vertex);
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
      assert.ok(
        x * x + y * y + z * z > 0,
        `${object.userData.partId} has usable outward normals`,
      );
    }
  });
  assert.ok(meshCount > 250, `detailed mesh count ${meshCount}`);
  assert.ok(
    geometries.size > 100,
    `unique closed geometries ${geometries.size}`,
  );
});

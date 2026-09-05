import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getComponentDiagnostics,
  getStageDiagnostics,
} from '../lib/component-diagnostics.ts';
import { advanceEngine, createEngine } from '../lib/physics.ts';
import {
  GEOMETRY_DESIGN_POINT,
  createEngineGeometry,
} from '../lib/engine-geometry.ts';

const components = ['compressor', 'combustor', 'turbine'] as const;

function assertComponentClosure(state: ReturnType<typeof createEngine>) {
  for (const component of components) {
    const diagnostic = getComponentDiagnostics(state, component);
    assert.ok(diagnostic.inlet.Tt > 0);
    assert.ok(diagnostic.inlet.Pt > 0);
    assert.ok(diagnostic.outlet.Tt > 0);
    assert.ok(diagnostic.outlet.Pt > 0);
    assert.ok(diagnostic.massFlow > 0);
    assert.ok(diagnostic.inletMassFlow > 0);
    assert.ok(diagnostic.outletMassFlow > 0);
    assert.ok(Number.isFinite(diagnostic.thermalEnthalpyPower));
    assert.ok(Math.abs(diagnostic.componentResidual) < 1e-5);
  }
}

void test('live component enthalpy diagnostics close at 10%, 70%, and 100%', () => {
  for (const throttle of [0.1, 0.7, 1]) {
    const state = createEngine(throttle);
    assertComponentClosure(state);

    const compressor = getComponentDiagnostics(state, 'compressor');
    assert.equal(compressor.inlet.id, 'inlet');
    assert.equal(compressor.outlet.id, 'hpc-exit');
    assert.equal(compressor.inletMassFlow, state.cycle.inletFlow);
    assert.equal(compressor.coreMassFlow, state.cycle.coreFlow);
    assert.equal(compressor.bypassMassFlow, state.cycle.bypassFlow);
    assert.equal(compressor.shaftMechanicalEfficiency, 1);
    assert.ok(compressor.shaftDemand > 0);

    const combustor = getComponentDiagnostics(state, 'combustor');
    assert.equal(combustor.inlet.id, 'hpc-exit');
    assert.equal(combustor.outlet.id, 'combustor-exit');
    assert.equal(combustor.fuelFlow, state.cycle.fuelFlow);
    assert.equal(
      combustor.gasMassFlow,
      state.cycle.coreFlow + state.cycle.fuelFlow,
    );
    assert.ok(combustor.fuelAirRatio >= 0);
    assert.ok(combustor.fuelEnergyPower > 0);

    const turbine = getComponentDiagnostics(state, 'turbine');
    assert.equal(turbine.inlet.id, 'combustor-exit');
    assert.equal(turbine.outlet.id, 'lpt-exit');
    assert.ok(turbine.thermalEnthalpyPower < 0);
    assert.ok(turbine.gasPower > turbine.shaftOutput);
    assert.ok(turbine.shaftLossPower > 0);
    assert.equal(turbine.shaftMechanicalEfficiency, 0.98);
  }
});

void test('live component diagnostics remain closed during meaningful transients', () => {
  for (const [start, target] of [
    [0.1, 1],
    [1, 0.1],
  ] as const) {
    let state = createEngine(start);
    for (let step = 0; step < 20; step += 1) {
      state = advanceEngine(state, target, 0.02);
      assertComponentClosure(state);
    }
  }
});

void test('stage diagnostics expose design-point C = U + W and signed Euler work', () => {
  const geometry = createEngineGeometry();
  assert.equal(geometry.stages.length, 17);
  for (const stage of geometry.stages) {
    const diagnostic = getStageDiagnostics(stage);
    const turbine = stage.family === 'hpt' || stage.family === 'lpt';
    const expected = turbine ? -stage.specificWork : stage.specificWork;
    assert.equal(diagnostic.stageId, stage.id);
    assert.equal(diagnostic.fixedDesignPoint, true);
    assert.equal(diagnostic.designPointThrottle, 0.7);
    assert.equal(diagnostic.samples.length, 3);
    assert.equal(diagnostic.specificWork, stage.specificWork);
    assert.equal(diagnostic.loading, stage.stageLoading);
    assert.equal(diagnostic.expectedDeltaH, expected);
    assert.ok(Math.abs(diagnostic.workResidual) < 1e-9);
    assert.equal(
      diagnostic.worldRotationSign,
      stage.family === 'fan'
        ? 'fan-world-negative-relative-to-LP'
        : 'model-positive-rpm',
    );

    for (const sample of diagnostic.samples) {
      assert.equal(sample.expectedDeltaH, expected);
      assert.ok(Math.abs(sample.workResidual) < 1e-9);
      assert.equal(sample.loading, stage.stageLoading);
      assert.ok(turbine ? sample.deltaH < 0 : sample.deltaH > 0);
      for (const side of ['inlet', 'outlet'] as const) {
        const vectors = sample[side];
        assert.ok(
          Math.abs(vectors.C.axial - vectors.U.axial - vectors.W.axial) < 1e-12,
        );
        assert.ok(
          Math.abs(
            vectors.C.tangential - vectors.U.tangential - vectors.W.tangential,
          ) < 1e-12,
        );
        assert.ok(Math.abs(vectors.vectorResidual.axial) < 1e-12);
        assert.ok(Math.abs(vectors.vectorResidual.tangential) < 1e-12);
      }
    }
  }
});

void test('stage work sum matches the shared nominal cycle and geometry metadata', () => {
  const geometry = createEngineGeometry();
  const nominal = createEngine(0.7).cycle;
  const stageWorkByFamily = new Map<string, number>();
  for (const stage of geometry.stages) {
    const diagnostic = getStageDiagnostics(stage);
    stageWorkByFamily.set(
      stage.family,
      (stageWorkByFamily.get(stage.family) ?? 0) + diagnostic.expectedDeltaH,
    );
  }
  assert.ok(
    Math.abs(
      stageWorkByFamily.get('fan')! - nominal.fanPower / nominal.inletFlow,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      stageWorkByFamily.get('lpc')! - nominal.lpcPower / nominal.coreFlow,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      stageWorkByFamily.get('hpc')! - nominal.hpcPower / nominal.coreFlow,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      stageWorkByFamily.get('hpt')! +
        GEOMETRY_DESIGN_POINT.turbineEnthalpyDrop.hpt,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      stageWorkByFamily.get('lpt')! +
        GEOMETRY_DESIGN_POINT.turbineEnthalpyDrop.lpt,
    ) < 1e-8,
  );
});

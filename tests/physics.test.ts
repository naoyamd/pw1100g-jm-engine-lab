import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceEngine,
  createEngine,
  ENGINEERING_PARAMETERS,
  evaluateCycle,
  FLOW_PATH_AREAS,
  FLOW_PATH_STATION_X,
  getDiagnostics,
  PHYSICS_LIMITS,
} from "../lib/physics.ts";

const HOT_STATION_IDS = new Set(["combustor-exit", "hpt-exit", "lpt-exit", "core-nozzle"]);

function independentClosure(cycle: ReturnType<typeof evaluateCycle>) {
  let massResidual = 0;
  let nozzleEnergyResidual = 0;
  for (const station of cycle.stations) {
    massResidual = Math.max(
      massResidual,
      Math.abs(station.massFlow - station.density * station.velocity * station.area) /
        Math.max(cycle.inletFlow, 1),
    );
    if (station.id === "core-nozzle" || station.id === "bypass-nozzle") {
      const gamma = HOT_STATION_IDS.has(station.id) ? 1.33 : 1.4;
      const cp = (gamma * 287.05) / (gamma - 1);
      nozzleEnergyResidual = Math.max(
        nozzleEnergyResidual,
        Math.abs(
          cp * station.Tt -
            (cp * station.staticTemperature + 0.5 * station.velocity ** 2),
        ) / Math.max(cp * station.Tt, 1),
      );
    }
  }
  const gasFlow = cycle.coreFlow + cycle.fuelFlow;
  const explicitFlowResidual =
    Math.abs(cycle.inletFlow - cycle.coreFlow - cycle.bypassFlow) /
      Math.max(cycle.inletFlow, 1) +
    Math.abs(gasFlow - cycle.coreNozzle.massFlow) / Math.max(gasFlow, 1);
  return { massResidual, nozzleEnergyResidual, explicitFlowResidual };
}

void test("default running point closes flow, mass, shaft, and energy balances", () => {
  const state = createEngine();
  const { cycle } = state;

  assert.equal(state.time, 0);
  assert.equal(state.throttle, 0.7);
  assert.ok(state.lpOmega > PHYSICS_LIMITS.minLpOmega);
  assert.ok(state.hpOmega > PHYSICS_LIMITS.minHpOmega);
  assert.ok(cycle.coreFlow > 0);
  assert.ok(cycle.bypassFlow > cycle.coreFlow);
  assert.ok(cycle.fuelFlow >= 0);
  assert.ok(cycle.massResidual < 1e-9);
  assert.ok(cycle.powerResidual < 1e-8);
  assert.ok(cycle.energyResidual < 1e-9);
  assert.equal(cycle.stations.length, 10);
  assert.deepEqual(
    cycle.stations.map((station) => station.x),
    [
      FLOW_PATH_STATION_X.inlet,
      FLOW_PATH_STATION_X.fanExit,
      FLOW_PATH_STATION_X.coreSplit,
      FLOW_PATH_STATION_X.lpcExit,
      FLOW_PATH_STATION_X.hpcExit,
      FLOW_PATH_STATION_X.combustorExit,
      FLOW_PATH_STATION_X.hptExit,
      FLOW_PATH_STATION_X.lptExit,
      FLOW_PATH_STATION_X.coreNozzle,
      FLOW_PATH_STATION_X.bypassNozzle,
    ],
  );

  for (const station of cycle.stations) {
    assert.ok(["core", "bypass", "common"].includes(station.stream));
    assert.ok(Number.isFinite(station.velocity));
    assert.ok(station.area > 0);
    assert.ok(station.staticTemperature > 0);
    assert.ok(station.staticPressure > 0);
    assert.ok(station.density > 0);
    const independentlyRecomputedFlow =
      station.density * station.velocity * station.area;
    assert.ok(
      Math.abs(independentlyRecomputedFlow - station.massFlow) /
        Math.max(cycle.inletFlow, 1) <
        1e-9,
    );
  }

  assert.equal(cycle.coreNozzle.throatArea, FLOW_PATH_AREAS.coreNozzle);
  assert.equal(cycle.bypassNozzle.throatArea, FLOW_PATH_AREAS.bypassNozzle);
  assert.ok(cycle.coreNozzle.totalEnergyResidual < 1e-12);
  assert.ok(cycle.bypassNozzle.totalEnergyResidual < 1e-12);
  assert.ok(
    Math.abs(
      cycle.gearLoss -
        cycle.fanPower * (1 / ENGINEERING_PARAMETERS.gearEfficiency - 1),
    ) < 1e-6,
  );
});

void test("object and positional cycle evaluation expose static flow and choking", () => {
  const objectCycle = evaluateCycle({
    throttle: 0.6,
    lpOmega: 850,
    hpOmega: 1400,
  });
  const positionalCycle = evaluateCycle(850, 1400, 0.6);
  assert.equal(objectCycle.coreFlow, positionalCycle.coreFlow);
  assert.equal(objectCycle.hpcPressureRatio, positionalCycle.hpcPressureRatio);

  const chokedCycle = evaluateCycle({
    throttle: 0.7,
    lpOmega: 850,
    hpOmega: 1400,
  });
  assert.equal(chokedCycle.coreNozzle.choked, true);
  assert.equal(chokedCycle.coreNozzle.exitMach, 1);
  assert.ok(chokedCycle.coreNozzle.pressureThrust > 0);
  assert.ok(chokedCycle.coreNozzle.totalEnergyResidual < 1e-12);
  assert.ok(chokedCycle.coreNozzle.exitPressure < chokedCycle.stations[7].Pt);
  assert.equal(chokedCycle.stations[0].stream, "common");
  assert.equal(chokedCycle.stations[2].stream, "core");
  assert.equal(chokedCycle.stations.at(-1)?.stream, "bypass");

  const diagnostics = getDiagnostics(createEngine());
  assert.equal(typeof diagnostics.coreNozzle.choked, "boolean");
  assert.ok(Number.isFinite(diagnostics.lpTorque));
  assert.ok(Number.isFinite(diagnostics.energyResidual));
});

void test("the LP and HP rotors integrate independently and converge with smaller dt", () => {
  const state = createEngine();
  const targetThrottle = 0.9;
  const targetAtStart = evaluateCycle({
    lpOmega: state.lpOmega,
    hpOmega: state.hpOmega,
    throttle: targetThrottle,
  });
  const next = advanceEngine(state, targetThrottle, 0.05);
  assert.ok(Math.abs(next.time - 0.05) < 1e-12);
  assert.notEqual(next.lpAngle, state.lpAngle);
  assert.notEqual(next.hpAngle, state.hpAngle);
  assert.notEqual(next.lpOmega / next.hpOmega, state.lpOmega / state.hpOmega);
  assert.equal(next.throttle, targetThrottle);
  assert.ok(next.lpOmega > state.lpOmega);
  assert.ok(next.hpOmega > state.hpOmega);
  assert.ok(next.cycle.thrust > state.cycle.thrust);

  const coarse = advanceEngine(state, targetThrottle, 0.1);
  let fine = state;
  for (let i = 0; i < 10; i += 1) {
    fine = advanceEngine(fine, targetThrottle, 0.01);
  }
  assert.ok(Math.abs(coarse.time - fine.time) < 1e-12);
  assert.ok(Math.abs(coarse.lpOmega - fine.lpOmega) / fine.lpOmega < 0.002);
  assert.ok(Math.abs(coarse.hpOmega - fine.hpOmega) / fine.hpOmega < 0.002);

  const deltaKineticPower =
    (next.cycle.shaftKineticEnergy - state.cycle.shaftKineticEnergy) / 0.05;
  const averageAppliedPower =
    (targetAtStart.shaftKineticPower + next.cycle.shaftKineticPower) / 2;
  assert.ok(deltaKineticPower > 0);
  assert.ok(
    Math.abs(deltaKineticPower - averageAppliedPower) / averageAppliedPower <
      0.03,
  );
});

void test("the full running envelope and long transients retain independent closure", () => {
  const steadyRows: Array<{
    throttle: number;
    powerResidual: number;
    energyResidual: number;
    independent: ReturnType<typeof independentClosure>;
  }> = [];
  for (let index = 1; index <= 10; index += 1) {
    const throttle = index / 10;
    const state = createEngine(throttle);
    steadyRows.push({
      throttle,
      powerResidual: state.cycle.powerResidual,
      energyResidual: state.cycle.energyResidual,
      independent: independentClosure(state.cycle),
    });
  }
  assert.equal(steadyRows.length, 10);
  assert.ok(Math.max(...steadyRows.map((row) => row.powerResidual)) < 1e-7);
  assert.ok(Math.max(...steadyRows.map((row) => row.energyResidual)) < 1e-9);
  assert.ok(
    Math.max(...steadyRows.map((row) => row.independent.massResidual)) < 1e-9,
  );
  assert.ok(
    Math.max(...steadyRows.map((row) => row.independent.nozzleEnergyResidual)) <
      1e-9,
  );
  assert.ok(
    Math.max(...steadyRows.map((row) => row.independent.explicitFlowResidual)) <
      1e-9,
  );

  const transientRows: Array<{
    start: number;
    target: number;
    dt: number;
    powerResidual: number;
    maxMassResidual: number;
    maxEnergyResidual: number;
    maxIndependentNozzleEnergyResidual: number;
    maxExplicitFlowResidual: number;
    workResidual: number;
    workResidualFraction: number;
    state: ReturnType<typeof createEngine>;
  }> = [];
  for (const [start, target] of [
    [0.1, 1],
    [1, 0.1],
    [0.4, 0.9],
  ] as const) {
    for (const dt of [0.02, 0.01, 0.005]) {
      let state = createEngine(start);
      let maxMassResidual = 0;
      let maxEnergyResidual = 0;
      let maxIndependentNozzleEnergyResidual = 0;
      let maxExplicitFlowResidual = 0;
      let workResidual = 0;
      let workScale = 0;
      const stepCount = Math.round(20 / dt);
      for (let step = 0; step < stepCount; step += 1) {
        const next = advanceEngine(state, target, dt);
        const independent = independentClosure(next.cycle);
        maxMassResidual = Math.max(
          maxMassResidual,
          next.cycle.massResidual,
          independent.massResidual,
        );
        maxEnergyResidual = Math.max(
          maxEnergyResidual,
          next.cycle.energyResidual,
        );
        maxIndependentNozzleEnergyResidual = Math.max(
          maxIndependentNozzleEnergyResidual,
          independent.nozzleEnergyResidual,
        );
        maxExplicitFlowResidual = Math.max(
          maxExplicitFlowResidual,
          independent.explicitFlowResidual,
        );
        // Independently sample the cycle at the arithmetic midpoint speed;
        // this is a midpoint quadrature check rather than reusing the
        // integrator's internal derivative.
        const midpointCycle = evaluateCycle({
          lpOmega: (state.lpOmega + next.lpOmega) / 2,
          hpOmega: (state.hpOmega + next.hpOmega) / 2,
          throttle: target,
        });
        const appliedWork = midpointCycle.shaftKineticPower * dt;
        workResidual +=
          next.cycle.shaftKineticEnergy - state.cycle.shaftKineticEnergy - appliedWork;
        workScale += Math.abs(appliedWork);
        state = next;
      }
      const row = {
        start,
        target,
        dt,
        powerResidual: state.cycle.powerResidual,
        maxMassResidual,
        maxEnergyResidual,
        maxIndependentNozzleEnergyResidual,
        maxExplicitFlowResidual,
        workResidual,
        workResidualFraction: Math.abs(workResidual) / Math.max(workScale, 1),
        state,
      };
      transientRows.push(row);
      assert.ok(Math.abs(state.time - 20) < 1e-9);
      assert.ok(maxMassResidual < 1e-9);
      assert.ok(maxEnergyResidual < 1e-9);
      assert.ok(maxIndependentNozzleEnergyResidual < 1e-9);
      assert.ok(maxExplicitFlowResidual < 1e-9);
      assert.ok(row.powerResidual < 1e-3);
      assert.ok(row.workResidualFraction < 1e-3);
    }
  }

  for (const [start, target] of [
    [0.1, 1],
    [1, 0.1],
    [0.4, 0.9],
  ] as const) {
    const coarse = transientRows.find(
      (row) => row.start === start && row.target === target && row.dt === 0.02,
    );
    const fine = transientRows.find(
      (row) => row.start === start && row.target === target && row.dt === 0.005,
    );
    assert.ok(coarse);
    assert.ok(fine);
    assert.ok(Math.abs(coarse.state.lpOmega - fine.state.lpOmega) / fine.state.lpOmega < 1e-3);
    assert.ok(Math.abs(coarse.state.hpOmega - fine.state.hpOmega) / fine.state.hpOmega < 1e-3);
    assert.ok(fine.workResidualFraction < coarse.workResidualFraction);
  }
});

void test("inputs are finite and the running envelope rejects invalid steady points", () => {
  assert.equal(createEngine(2).throttle, 1);
  assert.throws(
    () => createEngine(PHYSICS_LIMITS.minRunningThrottle - 0.01),
    /steady running point/,
  );
  assert.throws(() => createEngine(Number.NaN), /finite/);
  assert.throws(
    () => evaluateCycle({ lpOmega: 0, hpOmega: 1500, throttle: 0.7 }),
    /between/,
  );
  assert.throws(() => advanceEngine(createEngine(), 0.5, -0.1), /between/);
  assert.throws(
    () => advanceEngine(createEngine(), Number.POSITIVE_INFINITY, 0.1),
    /finite/,
  );
});

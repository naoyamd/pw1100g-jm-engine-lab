import type { CycleResult } from './physics.ts';
import type { FlowPathPoint, FlowStream } from './engine-geometry.ts';

export function sampleFlow(
  stream: FlowStream,
  x: number,
  cycle: CycleResult,
  path: readonly FlowPathPoint[],
) {
  const envelope = path.filter((p) => p.stream === stream);
  let a = envelope[0],
    b = envelope[envelope.length - 1];
  for (let i = 1; i < envelope.length; i++)
    if (x <= envelope[i].x) {
      a = envelope[i - 1];
      b = envelope[i];
      break;
    }
  const mix = (v: number, w: number, t: number) =>
    v + (w - v) * Math.max(0, Math.min(1, t));
  const fraction = (x - a.x) / (b.x - a.x);
  const hub = mix(a.hub, b.hub, fraction),
    tip = mix(a.tip, b.tip, fraction);
  const area = Math.PI * (tip * tip - hub * hub);
  const stations = cycle.stations
    .filter((s) => s.stream === stream || s.stream === 'common')
    .sort((s, t) => s.x - t.x);
  let before = stations[0],
    after = stations[stations.length - 1];
  for (let i = 1; i < stations.length; i++)
    if (x <= stations[i].x) {
      before = stations[i - 1];
      after = stations[i];
      break;
    }
  const t = (x - before.x) / (after.x - before.x || 1);
  const Tt = mix(before.Tt, after.Tt, t),
    Pt = mix(before.Pt, after.Pt, t);
  // Fuel joins the core over the combustor. Tracers are mean transport paths,
  // not individual molecules resolving moving blade boundary layers.
  const hotFraction =
    stream === 'core' ? Math.max(0, Math.min(1, (x - 2.1) / 0.32)) : 0;
  const massFlow =
    stream === 'bypass'
      ? cycle.bypassFlow
      : cycle.coreFlow + cycle.fuelFlow * hotFraction;
  const gamma = mix(1.4, 1.33, hotFraction),
    R = 287.05;
  const flux = (M: number) =>
    (Pt / Math.sqrt(R * Tt)) *
    Math.sqrt(gamma) *
    M *
    (1 + ((gamma - 1) * M * M) / 2) ** (-(gamma + 1) / (2 * (gamma - 1)));
  if (massFlow > area * flux(1) * (1 + 1e-9))
    throw new RangeError(
      `Flow exceeds choked capacity: ${stream} x=${x.toFixed(3)} m`,
    );
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (area * flux(mid) < massFlow) lo = mid;
    else hi = mid;
  }
  const mach = (lo + hi) / 2;
  const temperature = Tt / (1 + ((gamma - 1) * mach * mach) / 2);
  const pressure =
    Pt / (1 + ((gamma - 1) * mach * mach) / 2) ** (gamma / (gamma - 1));
  const density = pressure / (R * temperature);
  const velocity = mach * Math.sqrt(gamma * R * temperature);
  return {
    x,
    hub,
    tip,
    area,
    Tt,
    Pt,
    temperature,
    pressure,
    density,
    velocity,
    mach,
    massFlow,
    continuityResidual:
      Math.abs(density * velocity * area - massFlow) / Math.max(massFlow, 1),
  };
}

export function transportGrid(
  stream: FlowStream,
  cycle: CycleResult,
  path: readonly FlowPathPoint[],
) {
  const envelope = path.filter((p) => p.stream === stream);
  const grid = [];
  for (let i = 1; i < envelope.length; i++) {
    const start = envelope[i - 1].x,
      end = envelope[i].x;
    for (let j = 0; j < 3; j++) {
      const x0 = start + ((end - start) * j) / 3,
        x1 = start + ((end - start) * (j + 1)) / 3;
      grid.push({ x0, x1, ...sampleFlow(stream, (x0 + x1) / 2, cycle, path) });
    }
  }
  return grid;
}

export function advect(
  x: number,
  dt: number,
  grid: ReturnType<typeof transportGrid>,
) {
  if (dt < 0 || !Number.isFinite(dt) || !Number.isFinite(x))
    throw new RangeError('Invalid transport state');
  const first = grid[0],
    last = grid[grid.length - 1];
  if (!first || !last) return x;
  const transitTime = grid.reduce(
    (sum, cell) => sum + (cell.x1 - cell.x0) / cell.velocity,
    0,
  );
  let remaining = dt % transitTime;
  let index = Math.max(
    0,
    grid.findIndex((cell) => x < cell.x1 - 1e-10),
  );
  if (x >= last.x1 || x < first.x0) x = first.x0;
  while (remaining > 1e-12) {
    const cell = grid[index];
    const crossing = (cell.x1 - x) / Math.max(cell.velocity, 1e-9);
    if (remaining < crossing) {
      x += remaining * cell.velocity;
      break;
    }
    remaining -= Math.max(0, crossing);
    index = (index + 1) % grid.length;
    x = grid[index].x0;
  }
  return x;
}

import { FLOW_FIELDS, type FlowField } from '@/lib/flow-visual';
import { sampleFlow } from '@/lib/flow';
import { FLOW_PATH } from '@/lib/engine-geometry';
import type { EngineState } from '@/lib/physics';
import { INSPECTION_VIEWS, type InspectionView } from '@/lib/inspection';

export function FlowProfile({
  state,
  field,
  view,
  onView,
}: {
  state: EngineState;
  field: FlowField;
  view: InspectionView;
  onView: (view: InspectionView) => void;
}) {
  const spec = FLOW_FIELDS[field];
  const sections = [
    { view: 'engine', x: 0.2, label: 'Fan' },
    { view: 'compressor', x: 1.16, label: 'LPC' },
    { view: 'compressor', x: 1.85, label: 'HPC' },
    { view: 'combustor', x: 2.25, label: '燃焼器' },
    { view: 'turbine', x: 2.61, label: 'HPT' },
    { view: 'turbine', x: 3.05, label: 'LPT' },
  ] as const;
  const range = INSPECTION_VIEWS[view].xRange;
  const xPlot = (x: number) => 18 + (x / 3.4) * 664;
  const curves = (['core', 'bypass'] as const).map((stream) => {
    const end = stream === 'core' ? 3.32 : 3.25;
    return Array.from({ length: 61 }, (_, i) => {
      const x = (end * i) / 60;
      const f = sampleFlow(stream, x, state.cycle, FLOW_PATH);
      const value =
        field === 'temperature'
          ? f.Tt
          : field === 'pressure'
            ? f.Pt / 1e6
            : f.velocity;
      const y =
        52 -
        Math.min(1, Math.max(0, (value - spec.min) / (spec.max - spec.min))) *
          43;
      return `${i ? 'L' : 'M'}${xPlot(x).toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  });
  return (
    <section className="flow-profile" aria-label="流れの凡例と軸方向分布">
      <div className="flow-legend">
        <strong>
          {spec.label} <small>{spec.unit}</small>
        </strong>
        <div
          className="flow-color-scale"
          style={{
            background: `linear-gradient(90deg in srgb-linear, ${spec.legend.map((stop) => stop.color).join(', ')})`,
          }}
        />
        <div className="flow-scale-labels">
          <span>{spec.min}</span>
          <span>{spec.max}</span>
        </div>
        <span className="flow-line-key">
          <i /> コア <i /> バイパス
        </span>
      </div>
      <div className="flow-plot">
        <svg
          viewBox="0 0 700 75"
          preserveAspectRatio="none"
          aria-label={`${spec.label}の軸方向分布。コアは実線、バイパスは破線。横軸はエンジン入口からの位置。`}
        >
          {range && (
            <rect
              x={xPlot(range[0])}
              y="3"
              width={xPlot(range[1]) - xPlot(range[0])}
              height="52"
              fill="#e9eef1"
            />
          )}
          {[9, 30.5, 52].map((y) => (
            <line key={y} x1="18" x2="682" y1={y} y2={y} stroke="#e0e6ea" />
          ))}
          {sections.map((s) => (
            <line
              key={s.label}
              x1={xPlot(s.x)}
              x2={xPlot(s.x)}
              y1="4"
              y2="55"
              stroke="#d9e1e6"
              strokeDasharray="2 3"
            />
          ))}
          <path
            d={curves[0]}
            fill="none"
            stroke="#885c37"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={curves[1]}
            fill="none"
            stroke="#286a8c"
            strokeWidth="2"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="flow-region-links" aria-label="流路から拡大表示">
          {sections.map((s) => (
            <button
              key={s.label}
              style={{ left: `${xPlot(s.x) / 7}%` }}
              aria-label={`${s.label}の拡大表示`}
              onClick={() => onView(s.view)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="flow-explanation">
        断面平均の1D流れ · 矢印は方向と移流速度を表示 · 本数は流量比を表しません
      </p>
    </section>
  );
}

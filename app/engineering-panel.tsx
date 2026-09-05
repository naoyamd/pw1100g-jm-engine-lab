import {
  getComponentDiagnostics,
  getStageDiagnostics,
  type StageTriangleDiagnostics,
} from '@/lib/component-diagnostics';
import type { EngineState } from '@/lib/physics';
import type { StageInfo } from '@/lib/engine-geometry';
import type { InspectionView } from '@/lib/inspection';

const n = (value: number, digits = 1) =>
  value.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const mw = (value: number) => `${n(value / 1e6, 2)} MW`;

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function VelocityTriangles({ sample }: { sample: StageTriangleDiagnostics }) {
  const vectors = [sample.inlet, sample.outlet];
  const top = Math.max(
    0,
    sample.bladeSpeed,
    ...vectors.map((v) => v.C.tangential),
  );
  const bottom = Math.min(0, ...vectors.map((v) => v.C.tangential));
  const scale = Math.min(
    94 / sample.axialSpeed,
    100 / Math.max(top - bottom, 1),
  );
  const y0 = 32 + top * scale;
  return (
    <svg
      className="velocity-diagram"
      viewBox="0 0 300 176"
      aria-label="動翼入口と出口の速度三角形。絶対速度 C は翼速度 U と相対速度 W の和。"
    >
      <defs>
        {['#286a8c', '#81613c', '#be6346'].map((color, i) => (
          <marker
            key={color}
            id={`velocity-arrow-${i}`}
            markerWidth="5"
            markerHeight="5"
            refX="4"
            refY="2.5"
            orient="auto"
          >
            <path d="M0 0 L5 2.5 L0 5 Z" fill={color} />
          </marker>
        ))}
      </defs>
      {vectors.map((v, i) => {
        const x0 = 22 + i * 150,
          x = x0 + v.C.axial * scale;
        const cy = y0 - v.C.tangential * scale,
          uy = y0 - v.U.tangential * scale;
        return (
          <g key={i}>
            <text x={x0} y="16" className="diagram-label">
              {i === 0 ? '動翼入口 1' : '動翼出口 2'}
            </text>
            <path
              d={`M${x0} ${y0} H${x0 + 108} M${x0} ${y0} V28`}
              stroke="#d4dde2"
              fill="none"
            />
            <path
              d={`M${x0} ${y0} L${x} ${cy}`}
              stroke="#286a8c"
              strokeWidth="2"
              markerEnd="url(#velocity-arrow-0)"
            />
            <path
              d={`M${x0} ${y0} L${x0} ${uy}`}
              stroke="#81613c"
              strokeWidth="2"
              markerEnd="url(#velocity-arrow-1)"
            />
            <path
              d={`M${x0} ${uy} L${x} ${cy}`}
              stroke="#be6346"
              strokeWidth="2"
              markerEnd="url(#velocity-arrow-2)"
            />
            <text x={x0 - 15} y={(y0 + uy) / 2} fill="#81613c">
              U
            </text>
            <text x={(x0 + x) / 2 + 3} y={(y0 + cy) / 2 + 13} fill="#286a8c">
              C
            </text>
            <text x={(x0 + x) / 2} y={(uy + cy) / 2 - 6} fill="#be6346">
              W
            </text>
            <text x={x0} y="158" className="diagram-label">
              Cθ{i + 1} = {n(v.C.tangential, 0)} m/s
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function EngineeringPanel({
  state,
  view,
  stages,
  selected,
  onSelect,
}: {
  state: EngineState;
  view: InspectionView;
  stages: StageInfo[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const c = state.cycle;
  const component =
    view === 'combustor'
      ? 'combustor'
      : view === 'turbine'
        ? 'turbine'
        : 'compressor';
  const d = getComponentDiagnostics(state, component);
  const rows = stages.filter((s) =>
    view === 'compressor'
      ? s.family === 'lpc' || s.family === 'hpc'
      : view === 'turbine'
        ? s.family === 'hpt' || s.family === 'lpt'
        : true,
  );
  const stage =
    rows.find((s) => selected === s.id || selected.startsWith(`${s.id}-`)) ??
    rows[0];
  const design = stage && getStageDiagnostics(stage);
  const sample = design?.samples[1];
  return (
    <div className="engineering-panel">
      {(view === 'engine' || view === 'gear') && (
        <section className="engineering-section">
          <span className="field-label">LIVE SHAFT BALANCE</span>
          <h2>2軸の出力収支</h2>
          <p className="quiet">
            タービンの出力から負荷と損失を引いた余剰が、それぞれの軸を加速・減速します。
          </p>
          <dl className="readouts">
            <Reading label="HPT → HP軸" value={mw(c.hptPower)} />
            <Reading label="HPC の要求" value={mw(c.hpcPower)} />
            <Reading label="HP軸受損失" value={mw(c.hpBearingLoss)} />
            <Reading label="HP 余剰出力" value={mw(c.hpNetPower)} />
            <Reading label="LPT → LP軸" value={mw(c.lptPower)} />
            <Reading
              label="Fan + LPC の要求"
              value={mw(c.fanPower + c.lpcPower)}
            />
            <Reading
              label="減速機・LP軸受損失"
              value={mw(c.gearLoss + c.lpBearingLoss)}
            />
            <Reading label="LP 余剰出力" value={mw(c.lpNetPower)} />
          </dl>
          <p className="formula">P余剰 = I ω dω/dt</p>
        </section>
      )}
      {view !== 'combustor' && view !== 'gear' && design && sample && (
        <section className="engineering-section">
          <span className="field-label">BLADE ROW / DESIGN POINT</span>
          <label className="stage-label" htmlFor="stage-select">
            動翼列を選択 · 3D形状を強調
          </label>
          <select
            id="stage-select"
            value={stage.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="stage-context">
            固定70%設計点 · 平均半径 · +x 軸方向 / +θ 翼進行方向
          </p>
          <VelocityTriangles sample={sample} />
          <p className="vector-key">
            <span>C 絶対速度</span>
            <span>U 翼速度</span>
            <span>W 相対速度</span>
          </p>
          <p className="formula">
            Δh = U (Cθ₂ − Cθ₁) ={' '}
            <b data-testid="stage-work">{n(sample.deltaH / 1000, 2)} kJ/kg</b>
          </p>
          <details className="design-details">
            <summary>設計入力と仕事の残差</summary>
            <dl className="readouts compact">
              <Reading
                label="翼速度 U / 軸流速度 Cx"
                value={`${n(sample.bladeSpeed, 0)} / ${n(sample.axialSpeed, 0)} m/s`}
              />
              <Reading
                label="平均半径 / 動翼枚数"
                value={`${n(sample.radius * 1000, 0)} mm / ${design.geometry.bladeCount}`}
              />
              <Reading label="段負荷 |Δh| / U²" value={n(design.loading, 3)} />
              <Reading
                label="Euler 仕事残差"
                value={`${sample.workResidual.toExponential(1)} J/kg`}
              />
            </dl>
            <p className="quiet">
              速度三角形は翼の取付角を定める設計入力です。翼面まわりの流れや損失を解いた結果ではありません。
              形状と設計三角形は運転指令を変えても固定です。
            </p>
          </details>
        </section>
      )}
      <section className="engineering-section">
        <span className="field-label">LIVE COMPONENT BALANCE</span>
        <h3>{d.label}</h3>
        <table className="component-stations">
          <thead>
            <tr>
              <th>境界</th>
              <th>Tt / K</th>
              <th>Pt / MPa</th>
            </tr>
          </thead>
          <tbody>
            {[d.inlet, d.outlet].map((s, i) => (
              <tr key={s.id}>
                <th title={s.name}>{i ? '出口' : '入口'}</th>
                <td>{n(s.Tt, 0)}</td>
                <td>{n(s.Pt / 1e6, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="readouts compact">
          <Reading
            label={
              component === 'turbine'
                ? '膨張比（入口 / 出口）'
                : component === 'combustor'
                  ? '全圧回復率'
                  : '全圧比（出口 / 入口）'
            }
            value={n(d.pressureRatio, 3)}
          />
          <Reading
            label={component === 'turbine' ? '燃焼ガス流量' : 'コア空気流量'}
            value={`${n(d.massFlow, 2)} kg/s`}
          />
          {d.component === 'compressor' && (
            <>
              <Reading
                label="Fan / LPC / HPC の要求"
                value={`${n(c.fanPower / 1e6, 2)} / ${n(c.lpcPower / 1e6, 2)} / ${n(c.hpcPower / 1e6, 2)} MW`}
              />
              <Reading label="軸仕事の合計" value={mw(d.shaftDemand)} />
              <Reading
                label="空気のエンタルピー増加"
                value={mw(d.thermalEnthalpyPower)}
              />
            </>
          )}
          {d.component === 'combustor' && (
            <>
              <Reading label="燃料流量" value={`${n(d.fuelFlow, 3)} kg/s`} />
              <Reading label="燃料 / 空気 比" value={n(d.fuelAirRatio, 4)} />
              <Reading label="燃料の発熱量" value={mw(d.fuelEnergyPower)} />
              <Reading
                label="ガスへの入熱（効率99%）"
                value={mw(d.thermalEnthalpyPower)}
              />
              <Reading
                label="出口ガス = 空気 + 燃料"
                value={`${n(d.gasMassFlow, 3)} kg/s`}
              />
            </>
          )}
          {d.component === 'turbine' && (
            <>
              <Reading label="ガスからの仕事抽出" value={mw(d.gasPower)} />
              <Reading
                label="軸出力（機械効率98%）"
                value={mw(d.shaftOutput)}
              />
              <Reading
                label="HPT / LPT の軸出力"
                value={`${n(c.hptPower / 1e6, 2)} / ${n(c.lptPower / 1e6, 2)} MW`}
              />
              <Reading label="機械損失" value={mw(d.shaftLossPower)} />
            </>
          )}
          <Reading
            label="境界状態からの収支残差"
            value={`${d.componentResidual.toExponential(2)} W`}
          />
        </dl>
        {d.component === 'compressor' && (
          <p className="quiet">
            境界と収支はファンを含む圧縮系全体。ファン仕事にはバイパス空気への仕事も含めています。
          </p>
        )}
        {d.component === 'combustor' && (
          <>
            <p className="formula">ṁg h₄ − ṁa h₃ = ηb ṁf LHV</p>
            <div className="anatomy-buttons" aria-label="燃焼器の部品">
              {[
                ['fuel-injectors', '噴射器'],
                ['combustor-dome', 'ドーム'],
                ['combustor-outer-liner', '外側ライナ'],
                ['combustor-inner-liner', '内側ライナ'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={selected === id}
                  onClick={() => onSelect(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="quiet">
              燃焼器は静止部品です。表示は環状流路の平均加熱を扱い、火炎の反応・保炎・冷却孔の流れは解いていません。
            </p>
          </>
        )}
        <p className="quiet">
          温度・圧力・流量は現在の運転状態から計算。内部寸法と特性は再構成値です。
        </p>
      </section>
    </div>
  );
}

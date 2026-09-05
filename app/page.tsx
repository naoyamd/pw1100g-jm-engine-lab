'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Box,
  ChevronRight,
  CircleHelp,
  Layers3,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  SkipForward,
  Wind,
  X,
} from 'lucide-react';
import {
  advanceEngine,
  createEngine,
  getDiagnostics,
  PHYSICS_LIMITS,
  type EngineState,
} from '@/lib/physics';
import type { createViewer, ViewOptions } from '@/lib/viewer';
import type { PartInfo, StageInfo } from '@/lib/engine-geometry';
import { INSPECTION_VIEWS } from '@/lib/inspection';
import { FLOW_FIELDS, type FlowField } from '@/lib/flow-visual';
import { EngineeringPanel } from './engineering-panel';
import { FlowProfile } from './flow-profile';
import benchmark from '@/data/benchmark.json';

type Viewer = ReturnType<typeof createViewer>;
type Rendered = ReturnType<Viewer['renderedDiagnostics']>;
const INITIAL_OPTIONS: ViewOptions = {
  view: 'engine',
  cut: 'quarter',
  transparent: true,
  flow: true,
  flowField: 'temperature',
  selected: 'fan',
};
const rpm = (omega: number) => (Math.abs(omega) * 60) / (2 * Math.PI);
const num = (n: number | undefined, digits = 0) =>
  n === undefined
    ? '—'
    : n.toLocaleString('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const sci = (n: number | undefined) =>
  n === undefined ? '—' : n.toExponential(2);
const REPO = 'https://github.com/naoyamd/pw1100g-jm-engine-lab';
const SOURCES = [
  [
    'P&W · Product card',
    '81 in / 1–G–3–8–2–3 / 公称バイパス比 約12',
    'https://prd-sc102-cdn.rtx.com/prattwhitney/-/media/pw/newsroom/collateral/documents/commercial-engines/pw_gtf_pc_pw1100g-jm.pdf',
  ],
  [
    'IHI · 技報 Vol.53 No.4',
    'ファンケース・支持構造・低圧圧縮機・軸系',
    'https://www.ihi.co.jp/technology/techinfo/contents_no/__icsFiles/afieldfile/2023/06/16/dfa646fceb7705a3c159683b20eb8b2b.pdf',
  ],
  [
    'ASME · Global Gas Turbine News',
    '固定キャリア、5スター、ダブルヘリカル、約3:1',
    'https://www.asme.org/getmedia/1838965b-aa81-41ff-ad77-c06c31984cbd/1221mem-web.pdf',
  ],
  [
    'EASA · TCDS E.093',
    '型式・段構成・外形寸法の参照',
    'https://www.easa.europa.eu/en/document-library/type-certificates/engine-cs-e/easaime093-pw1100g-jm-series-engines',
  ],
  [
    'NASA Glenn · Thermodynamics',
    '圧縮機・タービンとエネルギー保存',
    'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/conservation-of-energy/',
  ],
];
const GEAR_PARTS: PartInfo[] = [
  {
    id: 'gear',
    name: 'Fan drive gear system',
    x: 0.6,
    description:
      'LP軸 → サン → 5個のスター → 内歯リング → ファン。スター中心は固定され、自転だけを行います。',
    approximation:
      '30 / 30 / 90 歯、モジュール 4.5 mm、ねじれ角 20° は成立性を検証するためのモデル値。実機歯数は未確認。',
  },
  {
    id: 'carrier',
    name: 'Fixed star carrier',
    x: 0.6,
    description:
      '5本のジャーナル軸を保持する固定キャリア。歯車の反力を静止ケースへ伝えます。',
    approximation: '支持板・軸受の寸法は説明用です。',
  },
  {
    id: 'shaft',
    name: 'Gear shaft interface',
    x: 0.6,
    description: 'サン側のLP入力と、リング側のファン出力は別々の軸です。',
    approximation: '結合部の寸法は説明用です。',
  },
  {
    id: 'ring',
    name: 'Ring / fan output',
    x: 0.6,
    description:
      '内歯リングはサンの逆向きに1/3の角速度で回転し、ファンを駆動します。',
  },
];

export default function Home() {
  const sourceDialog = useRef<HTMLDialogElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const engine = useRef<EngineState | null>(null);
  const controls = useRef({ running: true, rate: 1 / 60, throttle: 0.7 });
  const [options, setOptions] = useState<ViewOptions>(INITIAL_OPTIONS);
  const [running, setRunning] = useState(true);
  const [rate, setRate] = useState(1 / 600);
  const [throttle, setThrottle] = useState(0.7);
  const [snapshot, setSnapshot] = useState<EngineState | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [tab, setTab] = useState<
    'structure' | 'engineering' | 'cycle' | 'checks'
  >('structure');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [error, setError] = useState('');
  const [fps, setFps] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let localViewer: Viewer | null = null;
    let previous = performance.now(),
      sampled = previous,
      frames = 0;
    void (async () => {
      try {
        const { createViewer } = await import('@/lib/viewer');
        if (cancelled || !mount.current) return;
        localViewer = createViewer(mount.current, (selected) =>
          setOptions((current) => ({ ...current, selected })),
        );
        viewer.current = localViewer;
        setParts([...localViewer.engine.parts, ...GEAR_PARTS]);
        setStages(localViewer.engine.stages);
        engine.current = createEngine(controls.current.throttle);
        localViewer.setOptions(INITIAL_OPTIONS);
        localViewer.update(engine.current);
        setSnapshot(engine.current);
        const animate = (now: number) => {
          if (cancelled || !engine.current || !localViewer) return;
          try {
            const elapsed = Math.max(
              0,
              Math.min((now - previous) / 1000, 0.05),
            );
            previous = now;
            if (controls.current.running)
              engine.current = advanceEngine(
                engine.current,
                controls.current.throttle,
                elapsed * controls.current.rate,
              );
            localViewer.update(engine.current);
            frames++;
            if (now - sampled >= 250) {
              setSnapshot(engine.current);
              setRendered(localViewer.renderedDiagnostics(engine.current));
              setFps(Math.round((frames * 1000) / (now - sampled)));
              frames = 0;
              sampled = now;
            }
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            controls.current.running = false;
            setRunning(false);
          }
          frame = requestAnimationFrame(animate);
        };
        previous = performance.now();
        frame = requestAnimationFrame(animate);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      localViewer?.dispose();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    controls.current = { running, rate, throttle };
  }, [running, rate, throttle]);
  useEffect(() => {
    viewer.current?.setOptions(options);
  }, [options]);
  useEffect(() => {
    if (sourcesOpen) sourceDialog.current?.showModal();
    else sourceDialog.current?.close();
  }, [sourcesOpen]);
  const patchOptions = (patch: Partial<ViewOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));
  const changeView = (view: ViewOptions['view']) => {
    patchOptions({
      view,
      cut: view === 'gear' ? 'whole' : 'quarter',
      selected: INSPECTION_VIEWS[view].selected,
    });
    setTab(view === 'engine' || view === 'gear' ? 'structure' : 'engineering');
  };
  const step = () => {
    setRunning(false);
    controls.current.running = false;
    if (!engine.current || !viewer.current) return;
    // One sixteenth of a sun tooth. Every rotor uses this same physical dt.
    engine.current = advanceEngine(
      engine.current,
      throttle,
      (2 * Math.PI) / (30 * 16 * engine.current.lpOmega),
    );
    viewer.current.update(engine.current);
    setSnapshot(engine.current);
    setRendered(viewer.current.renderedDiagnostics(engine.current));
  };
  const reset = () => {
    try {
      engine.current = createEngine(throttle);
      setSnapshot(engine.current);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  };
  const c = snapshot?.cycle;
  const d = snapshot ? getDiagnostics(snapshot) : null;
  const selected =
    parts.find((p) => p.id === options.selected) ?? GEAR_PARTS[0];
  const transformError = rendered
    ? Math.max(
        rendered.fanConstraint,
        rendered.lpConstraint,
        rendered.hpConstraint,
        rendered.sunConstraint,
        rendered.ringConstraint,
        rendered.starConstraint,
        rendered.carrierConstraint,
      )
    : undefined;
  const steady = !!c && c.normalizedPowerResidual < 0.001;
  const currentView = INSPECTION_VIEWS[options.view];

  return (
    <main className="lab">
      <header className="topbar">
        <a
          className="brand"
          href="./"
          aria-label="PW1100G-JM Engineering Lab ホーム"
        >
          <span className="brand-mark">
            <Settings2 size={22} />
          </span>
          <span>
            <strong>PW1100G–JM</strong>
            <small>STRUCTURE & OPERATION</small>
          </span>
        </a>
        <div className="header-note">
          <span className="status-dot" /> 公開資料に基づく再構成
        </div>
        <button className="source-button" onClick={() => setSourcesOpen(true)}>
          <CircleHelp size={15} /> モデルと出典
        </button>
      </header>
      <section className="workspace" aria-label="エンジン解析ワークスペース">
        <div className="stage-area">
          <div className="view-toolbar">
            <div className="segmented" aria-label="表示対象">
              {(Object.keys(INSPECTION_VIEWS) as ViewOptions['view'][]).map(
                (view) => (
                  <button
                    key={view}
                    aria-pressed={options.view === view}
                    onClick={() => changeView(view)}
                  >
                    {view === 'engine' && <Box size={15} />}
                    {INSPECTION_VIEWS[view].label}
                  </button>
                ),
              )}
            </div>
            <div className="display-controls">
              <label className="cut-control">
                <Layers3 size={15} />
                <select
                  aria-label="カット表示"
                  value={options.cut}
                  onChange={(e) =>
                    patchOptions({ cut: e.target.value as ViewOptions['cut'] })
                  }
                >
                  <option value="quarter">1/4 カット</option>
                  <option value="half">1/2 カット</option>
                  <option value="whole">外観</option>
                </select>
              </label>
              <button
                className="icon-label"
                aria-pressed={options.transparent}
                onClick={() =>
                  patchOptions({ transparent: !options.transparent })
                }
              >
                透過
              </button>
              <button
                className="icon-label"
                aria-pressed={options.flow}
                disabled={options.view === 'gear'}
                onClick={() => patchOptions({ flow: !options.flow })}
              >
                <Wind size={15} /> 流れ
              </button>
              {options.flow && options.view !== 'gear' && (
                <select
                  aria-label="流れの表示量"
                  className="flow-field-select"
                  value={options.flowField}
                  onChange={(e) =>
                    patchOptions({ flowField: e.target.value as FlowField })
                  }
                >
                  {(Object.keys(FLOW_FIELDS) as FlowField[]).map((field) => (
                    <option key={field} value={field}>
                      {FLOW_FIELDS[field].label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="viewport" ref={mount}>
            <div className="scene-caption">
              <span className="eyebrow">{currentView.eyebrow}</span>
              <h1>{currentView.title}</h1>
              <p>{currentView.summary}</p>
              {currentView.xRange && (
                <p className="inspection-range">
                  観察範囲 x = {currentView.xRange[0].toFixed(2)}–
                  {currentView.xRange[1].toFixed(2)} m · 同じエンジンを拡大
                </p>
              )}
            </div>
            <div className="camera-controls" aria-label="カメラ方向">
              {(['iso', 'side', 'front'] as const).map((preset, i) => (
                <button
                  key={preset}
                  onClick={() => viewer.current?.setCamera(preset)}
                >
                  {['斜視', '側面', '正面'][i]}
                </button>
              ))}
              <button
                aria-label="カメラを初期位置へ"
                onClick={() => viewer.current?.setCamera('iso')}
              >
                <Maximize2 size={14} />
              </button>
            </div>
            {error && (
              <div className="error-panel" role="alert">
                <strong>計算・表示を停止しました</strong>
                <p>{error}</p>
              </div>
            )}
            {!snapshot && !error && (
              <div className="loading">形状と定常運転点を構築中…</div>
            )}
            <div className="scene-footer">
              <span>
                DRAG 回転 <b>·</b> SCROLL 拡大 <b>·</b> CLICK 部品選択
              </span>
              <span className="mono">
                {fps} FPS <b>·</b> +X → EXHAUST
              </span>
            </div>
          </div>
          {options.flow && options.view !== 'gear' && snapshot && (
            <FlowProfile
              state={snapshot}
              field={options.flowField}
              view={options.view}
              onView={changeView}
            />
          )}
          <div className="telemetry" aria-label="回転とサイクル計器">
            <Metric
              label="FAN / RING"
              value={snapshot ? num(rpm(snapshot.lpOmega) / 3) : '—'}
              unit="rpm"
              tone="cyan"
              note="LP と逆回転"
              id="fan-rpm"
            />
            <Metric
              label="LP / SUN"
              value={snapshot ? num(rpm(snapshot.lpOmega)) : '—'}
              unit="rpm"
              tone="gold"
              note="LPC 3段 ↔ LPT 3段"
              id="lp-rpm"
            />
            <Metric
              label="HP SPOOL"
              value={snapshot ? num(rpm(snapshot.hpOmega)) : '—'}
              unit="rpm"
              tone="red"
              note="HPC 8段 ↔ HPT 2段"
              id="hp-rpm"
            />
            <Metric
              label="TURBINE INLET"
              value={num(c?.turbineInletTemp)}
              unit="K"
              tone="muted"
              note="簡略サイクルの計算値"
              id="turbine-temperature"
            />
          </div>
          <div className="transport">
            <button
              className="play-button"
              aria-label={running ? '一時停止' : '再生'}
              onClick={() => setRunning(!running)}
            >
              {running ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              className="step-button"
              aria-label="1/16歯ずつ進める"
              onClick={step}
            >
              <SkipForward size={17} />
            </button>
            <label className="speed-label">
              TIME
              <select
                aria-label="時間倍率"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              >
                <option value={1 / 1200}>1/1200×</option>
                <option value={1 / 600}>1/600×</option>
                <option value={1 / 120}>1/120×</option>
                <option value={1 / 60}>1/60×</option>
                <option value={1 / 20}>1/20×</option>
                <option value={1}>1× 実時間</option>
              </select>
            </label>
            <output className="clock" data-testid="sim-time">
              t = {num(snapshot?.time, 5)} s
            </output>
            <span className="transport-note">全回転・流れに同じ時間倍率</span>
          </div>
        </div>
        <aside className="inspector">
          <div className="inspector-heading">
            <span className="eyebrow">構造・運転データ</span>
            <span
              className={`run-badge ${steady ? 'balanced' : ''}`}
              data-testid="balance-status"
            >
              {steady ? '定常' : '過渡'}
            </span>
          </div>
          <nav className="inspector-tabs" aria-label="解析パネル">
            {(['structure', 'engineering', 'cycle', 'checks'] as const).map(
              (t, i) => (
                <button
                  key={t}
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                >
                  {['構造', '作動', 'サイクル', '検証'][i]}
                </button>
              ),
            )}
          </nav>
          <div className="inspector-content">
            {tab === 'engineering' && snapshot && (
              <EngineeringPanel
                state={snapshot}
                view={options.view}
                stages={stages}
                selected={options.selected}
                onSelect={(selected) => patchOptions({ selected })}
              />
            )}
            {tab === 'structure' && (
              <>
                <label className="field-label" htmlFor="part-select">
                  選択部品
                </label>
                <select
                  id="part-select"
                  value={options.selected}
                  onChange={(e) => patchOptions({ selected: e.target.value })}
                >
                  {parts
                    .filter(
                      (p, i) => parts.findIndex((q) => q.id === p.id) === i,
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <h2>{selected.name}</h2>
                <p className="part-description">{selected.description}</p>
                {selected.approximation && (
                  <p className="approximation">
                    <span>モデルの近似</span>
                    {selected.approximation}
                  </p>
                )}
                <div className="power-path">
                  <span className="field-label">動力伝達経路</span>
                  <div>
                    <span className="red">HPT</span>
                    <b>━━</b>
                    <span className="red">HPC</span>
                    <small>HP SHAFT</small>
                  </div>
                  <div>
                    <span className="gold">LPT</span>
                    <b>━━</b>
                    <span className="gold">LPC</span>
                    <small>LP SHAFT</small>
                  </div>
                  <div>
                    <span className="gold">SUN</span>
                    <ChevronRight size={12} />
                    <span>5 STARS</span>
                    <ChevronRight size={12} />
                    <span className="cyan">RING</span>
                  </div>
                  <div className="fan-output">
                    <span className="cyan">RING ━━ FAN</span>
                    <small>ωfan = −ωLP / 3</small>
                  </div>
                </div>
                <div className="spec-grid">
                  <div>
                    <span>ファン直径</span>
                    <strong>
                      81 <small>in</small>
                    </strong>
                  </div>
                  <div>
                    <span>段構成</span>
                    <strong>1–G–3–8–2–3</strong>
                  </div>
                </div>
                <p className="quiet">
                  図面未公開の内部寸法、翼形状、翼枚数、歯数は再構成値です。構成の出典と数式・検証範囲を公開しています。
                </p>
              </>
            )}
            {tab === 'cycle' && (
              <>
                <div className="cycle-title">
                  <span className="field-label">1D SEPARATE-FLOW CYCLE</span>
                  <Activity size={16} />
                </div>
                <div className="large-value">
                  {num(c ? c.thrust / 1000 : undefined, 1)} <small>kN</small>
                  <span>モデル推力 · 海面上静止</span>
                </div>
                <p className="quiet">
                  合成特性による概念モデルの出力。実機の性能予測値ではありません。
                </p>
                <CycleChart state={snapshot} />
                <div className="table-scroll">
                  <table className="station-table">
                    <thead>
                      <tr>
                        <th>STATION</th>
                        <th>Tt / K</th>
                        <th>Pt / kPa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c?.stations.map((s) => (
                        <tr key={s.id}>
                          <th title={s.name}>{s.id}</th>
                          <td>{num(s.Tt)}</td>
                          <td>{num(s.Pt / 1000, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="readouts">
                  <Row
                    label="コア空気流量"
                    value={`${num(c?.coreFlow, 2)} kg/s`}
                  />
                  <Row
                    label="バイパス流量"
                    value={`${num(c?.bypassFlow, 2)} kg/s`}
                  />
                  <Row label="燃料流量" value={`${num(c?.fuelFlow, 3)} kg/s`} />
                  <Row
                    label="バイパス比（モデル）"
                    value={c ? num(c.bypassFlow / c.coreFlow, 2) : '—'}
                  />
                  <Row
                    label="コア出口 Mach"
                    value={num(c?.coreNozzle.exitMach, 3)}
                  />
                  <Row
                    label="バイパス出口 Mach"
                    value={num(c?.bypassNozzle.exitMach, 3)}
                  />
                </dl>
              </>
            )}
            {tab === 'checks' && (
              <>
                <span className="field-label">LIVE CONSTRAINTS</span>
                <h2>数値と描画の照合</h2>
                <p className="quiet">
                  画面上の実メッシュ角度を計算状態と比較。軸の余剰出力は過渡時の加速・減速に使われます。
                </p>
                <dl className="readouts checks">
                  <Row
                    label="描画角度の最大残差"
                    value={`${sci(transformError)} rad`}
                    id="transform-error"
                  />
                  <Row
                    label="質量収支（相対残差）"
                    value={sci(c?.normalizedMassResidual)}
                    id="mass-error"
                  />
                  <Row
                    label="エネルギー収支（相対残差）"
                    value={sci(c?.energyResidual)}
                    id="energy-error"
                  />
                  <Row
                    label="流れの連続式（表示時）"
                    value={sci(rendered?.flowResidual)}
                    id="flow-error"
                  />
                  <Row
                    label="軸出力の不均衡率"
                    value={sci(c?.normalizedPowerResidual)}
                    id="power-imbalance"
                  />
                  <Row
                    label="LP 余剰出力"
                    value={`${num(c ? c.lpNetPower / 1000 : undefined, 2)} kW`}
                  />
                  <Row
                    label="HP 余剰出力"
                    value={`${num(c ? c.hpNetPower / 1000 : undefined, 2)} kW`}
                  />
                  <Row
                    label="LP 合成慣性"
                    value={`${num(d?.lpInertia, 3)} kg·m²`}
                  />
                  <Row
                    label="HP 慣性"
                    value={`${num(d?.hpInertia, 3)} kg·m²`}
                  />
                  <Row
                    label="スター数 / 公転"
                    value={`${rendered?.starCount ?? '—'} / 0`}
                  />
                  <Row
                    label="Fan / Sun 回転角"
                    value={
                      rendered
                        ? `${num(rendered.fanAngle, 4)} / ${num(rendered.sunAngle, 4)}`
                        : '—'
                    }
                    id="rendered-angles"
                  />
                  <Row
                    label="描画時刻"
                    value={`${num(rendered?.lastRenderedTime, 5)} s`}
                    id="rendered-time"
                  />
                  <Row
                    label="Triangles / frame"
                    value={num(rendered?.triangles)}
                  />
                  <Row
                    label="Draw calls / frame"
                    value={num(rendered?.drawCalls)}
                  />
                </dl>
                <a
                  className="text-link"
                  href={`${REPO}/blob/main/docs/VERIFICATION.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  検証方法・結果を読む <ArrowUpRight size={14} />
                </a>
              </>
            )}
          </div>
          <div className="operating-control">
            <div className="control-label">
              <label htmlFor="throttle">運転点指令</label>
              <output>{num(throttle * 100)}%</output>
            </div>
            <input
              id="throttle"
              aria-label="運転点指令"
              type="range"
              min={PHYSICS_LIMITS.minRunningThrottle * 100}
              max="100"
              step="1"
              value={throttle * 100}
              onChange={(e) => {
                setThrottle(Number(e.target.value) / 100);
                setRate(1);
                setRunning(true);
              }}
            />
            <div className="range-labels">
              <span>10% · RUNNING IDLE</span>
              <span>100%</span>
            </div>
            <p>操作すると実時間に切り替わり、軸トルクで加減速します。</p>
            <button className="reset-button" onClick={reset}>
              <RotateCcw size={13} /> この指令の定常点に再初期化
            </button>
          </div>
        </aside>
      </section>
      <footer className="page-footer">
        <div className="benchmark-record">
          <span>
            工学モデリング・ベンチマーク <b>·</b> GPT-6 Astra + Luna
          </span>
          <details>
            <summary>
              実施 {benchmark.executionDate} · 総トークン{' '}
              {num(benchmark.tokens.total_tokens / 1e6, 2)}M（キャッシュ込み）
            </summary>
            <p>
              集計時点：
              {new Date(benchmark.snapshotAt).toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}{' '}
              JST。初期制作から改良まで、このタスクと調査・実装サブエージェントのローカル利用記録を合算した観測値です。
            </p>
            <dl>
              <Row
                label="総トークン（入力＋出力）"
                value={num(benchmark.tokens.total_tokens)}
              />
              <Row label="入力" value={num(benchmark.tokens.input_tokens)} />
              <Row
                label="入力のうちキャッシュ"
                value={num(benchmark.tokens.cached_input_tokens)}
              />
              <Row
                label="出力（推論を含む）"
                value={num(benchmark.tokens.output_tokens)}
              />
              {benchmark.models.map((m) => (
                <Row
                  key={m.model}
                  label={m.model}
                  value={num(m.tokens.total_tokens)}
                />
              ))}
            </dl>
            <p>
              同じ文脈を再読込した分も含みます。承認の自動レビューと集計後の作業は含めません。課金額や使用率への換算値ではありません。
            </p>
            <a
              href={`${REPO}/blob/main/docs/BENCHMARK.md`}
              target="_blank"
              rel="noreferrer"
            >
              集計方法と記録 <ArrowUpRight size={12} />
            </a>
          </details>
        </div>
        <a href={REPO} target="_blank" rel="noreferrer">
          SOURCE & VERIFICATION <ArrowUpRight size={12} />
        </a>
      </footer>
      <dialog
        ref={sourceDialog}
        className="source-dialog"
        aria-labelledby="source-title"
        onClose={() => setSourcesOpen(false)}
      >
        <button
          className="close-button"
          aria-label="出典を閉じる"
          autoFocus
          onClick={() => setSourcesOpen(false)}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">MODEL SCOPE & EVIDENCE</span>
        <h2 id="source-title">モデルの対象範囲と出典</h2>
        <p>
          PW1100G-JMの公開された構成をもとに、歯車のかみ合い・軸の結合・圧縮性流れ・トルクによる回転を計算するインタラクティブモデルです。
        </p>
        <p>
          歯数、内部寸法、翼形、材料、慣性と圧縮機特性は説明用の再構成値です。非公開の製造図面、実測性能マップ、CFD、FEM、始動過程やFADECは含みません。数値収支が閉じることと、実機を同定できることは別の検証項目です。
        </p>
        <div className="sources">
          {SOURCES.map(([label, description, href]) => (
            <a key={label} href={href} target="_blank" rel="noreferrer">
              <strong>
                {label}
                <ArrowUpRight size={14} />
              </strong>
              <span>{description}</span>
            </a>
          ))}
        </div>
        <a className="text-link" href={REPO} target="_blank" rel="noreferrer">
          モデルの数式・近似・再現可能なテスト <ArrowUpRight size={14} />
        </a>
      </dialog>
    </main>
  );
}

function Metric({
  label,
  value,
  unit,
  tone,
  note,
  id,
}: {
  label: string;
  value: string;
  unit: string;
  tone: string;
  note: string;
  id: string;
}) {
  return (
    <div className={`metric ${tone}`}>
      <span className="metric-label">{label}</span>
      <div>
        <output data-testid={id}>{value}</output>
        <small>{unit}</small>
      </div>
      <p>{note}</p>
    </div>
  );
}
function Row({
  label,
  value,
  id,
}: {
  label: string;
  value: string;
  id?: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-testid={id}>{value}</dd>
    </div>
  );
}
function CycleChart({ state }: { state: EngineState | null }) {
  const stations =
    state?.cycle.stations.filter((s) => s.stream !== 'bypass') ?? [];
  if (!stations.length) return null;
  const points = stations
    .map(
      (s, i) =>
        `${12 + (i * 246) / (stations.length - 1)},${104 - (s.Tt / 2000) * 88}`,
    )
    .join(' ');
  return (
    <figure className="cycle-chart">
      <figcaption>
        全温 Tt <span>0–2,000 K</span>
      </figcaption>
      <svg viewBox="0 0 270 118" aria-label="各ステーションの全温">
        <path
          d="M12 16H258 M12 60H258 M12 104H258"
          stroke="#dce3e8"
          strokeWidth="1"
        />
        <polyline
          points={points}
          stroke="#956b43"
          fill="none"
          strokeWidth="2"
        />
        {stations.map((s, i) => (
          <circle
            key={s.id}
            cx={12 + (i * 246) / (stations.length - 1)}
            cy={104 - (s.Tt / 2000) * 88}
            r="2.5"
            fill="#956b43"
          />
        ))}
      </svg>
    </figure>
  );
}

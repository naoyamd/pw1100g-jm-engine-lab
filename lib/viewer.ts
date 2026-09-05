import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createEngineGeometry } from './engine-geometry';
import { createGearbox, deriveGearAngles } from './gear';
import { createFlowVisual, type FlowField } from './flow-visual';
import {
  INSPECTION_VIEWS,
  isolatePartMaterials,
  type InspectionView,
} from './inspection';
import { batchRepeatedMeshes } from './render-batches';
import type { EngineState } from './physics';

export type ViewOptions = {
  view: InspectionView;
  cut: 'quarter' | 'half' | 'whole';
  transparent: boolean;
  flow: boolean;
  flowField: FlowField;
  selected: string;
};
export type ViewState = EngineState;
const angleError = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function createViewer(
  container: HTMLElement,
  onSelect: (id: string) => void,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    stencil: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.domElement.setAttribute(
    'aria-label',
    'PW1100G-JM 3Dモデル。ドラッグで回転、ホイールで拡大。部品をクリックして詳細表示。',
  );
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 40);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 0.24;
  controls.maxDistance = 14;
  controls.target.set(1.6, 0, 0);
  camera.position.set(-1.5, 1.8, 5.0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xf6f8ff, 0x4b4e53, 0.65));
  const key = new THREE.DirectionalLight(0xfff7ed, 2.6);
  key.position.set(-1, 6, 4);
  key.target.position.set(1.5, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 14;
  key.shadow.normalBias = 0.004;
  key.shadow.bias = -0.00015;
  scene.add(key.target);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xecf2ff, 2.0);
  rim.position.set(4, 1, -3);
  scene.add(rim);
  const engine = createEngineGeometry();
  const gearbox = createGearbox();
  gearbox.group.position.x = 0.6;
  gearbox.group.traverse((o) => {
    if (
      o instanceof THREE.Mesh &&
      o.material instanceof THREE.MeshStandardMaterial
    ) {
      o.material.flatShading = true;
    }
  });
  const model = new THREE.Group();
  model.add(engine.group, gearbox.group);
  const partMaterials = isolatePartMaterials(model);
  const casingParts = new Set<string>();
  engine.casing.traverse((o) => {
    if (o.userData.partId) casingParts.add(o.userData.partId);
  });
  scene.add(model);

  const backdrop = new THREE.Scene();
  backdrop.background = new THREE.Color('#e9edf0');
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ color: 0x495963, opacity: 0.19 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(1.5, -1.13, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  const halfPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const quarterPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const originalMaterials = new Map<
    THREE.Material,
    { opacity: number; transparent: boolean }
  >();
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m instanceof THREE.MeshStandardMaterial) {
          const color = m.color.getHex();
          // Material families remain distinct without painting the rotors as a diagram.
          const finish: Record<number, [number, number]> = {
            0x39c5d5: [0x9ca7af, 0.26],
            0xd6a24a: [0xa9a9a4, 0.3],
            0xd64f3f: [0x82796d, 0.38],
            0x27313b: [0x87939c, 0.34],
            0x687782: [0x727e87, 0.4],
            0x9da8b2: [0xc2c8ce, 0.23],
            0xb98238: [0xad9982, 0.27],
            0xd6dce2: [0xb7c0c7, 0.24],
            0x159ca7: [0x778792, 0.32],
          };
          if (finish[color]) {
            m.color.setHex(finish[color][0]);
            m.roughness = finish[color][1];
          }
          m.metalness = 0.88;
          m.envMapIntensity = 0.85;
          m.clipShadows = true;
        }
        originalMaterials.set(m, {
          opacity: m.opacity,
          transparent: m.transparent,
        });
      }
    }
  });
  batchRepeatedMeshes(model);
  // Rotation about x preserves these axial bounds, including every blade instance.
  const axialBounds = new Map<THREE.Mesh, THREE.Box3>();
  model.updateMatrixWorld(true);
  engine.group.traverse((o) => {
    if (o instanceof THREE.Mesh)
      axialBounds.set(o, new THREE.Box3().setFromObject(o));
  });
  const backStencil = new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    colorWrite: false,
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: THREE.IncrementWrapStencilOp,
    stencilZFail: THREE.IncrementWrapStencilOp,
    stencilZPass: THREE.IncrementWrapStencilOp,
  });
  const frontStencil = backStencil.clone();
  frontStencil.side = THREE.FrontSide;
  frontStencil.stencilFail = THREE.DecrementWrapStencilOp;
  frontStencil.stencilZFail = THREE.DecrementWrapStencilOp;
  frontStencil.stencilZPass = THREE.DecrementWrapStencilOp;
  const capMaterial = new THREE.MeshStandardMaterial({
    color: 0x69757e,
    metalness: 0.55,
    roughness: 0.6,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilRef: 0,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  const cap = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), capMaterial);
  const capScene = new THREE.Scene();
  capScene.environment = environment.texture;
  capScene.add(new THREE.HemisphereLight(0xf6f8ff, 0x797978, 1.25));
  capScene.add(cap);
  const frontNormal = new THREE.Vector3(0, 0, 1);

  const overlay = new THREE.Scene();
  const flow = createFlowVisual(engine.flowPath);
  overlay.add(flow.group);
  let flowResidual = 0;
  let options: ViewOptions = {
    view: 'engine',
    cut: 'quarter',
    transparent: true,
    flow: true,
    flowField: 'temperature',
    selected: 'fan',
  };
  let disposed = false;
  let lastTime = 0;
  let cameraPreset: 'iso' | 'side' | 'front' = 'iso';
  const resize = () => {
    const width = container.clientWidth,
      height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    setCamera(cameraPreset);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  function setCamera(preset: 'iso' | 'side' | 'front') {
    cameraPreset = preset;
    const gearView = options.view === 'gear';
    const range = INSPECTION_VIEWS[options.view].xRange;
    const box = range
      ? new THREE.Box3(
          new THREE.Vector3(range[0], -0.62, -0.62),
          new THREE.Vector3(range[1], 0.62, 0.62),
        )
      : new THREE.Box3().setFromObject(gearView ? gearbox.group : model);
    const center = box.getCenter(new THREE.Vector3());
    const direction =
      preset === 'front'
        ? new THREE.Vector3(gearView ? 1 : -1, 0.001, 0.001)
        : preset === 'side'
          ? new THREE.Vector3(0, 0.04, 1)
          : new THREE.Vector3(
              gearView
                ? 1.6
                : options.view === 'combustor'
                  ? -1.25
                  : range
                    ? -0.45
                    : -0.75,
              0.43,
              1,
            );
    direction.normalize();
    controls.target.copy(center);
    camera.position.copy(center).add(direction);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    const inverse = camera.quaternion.clone().invert();
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanX = tanY * camera.aspect;
    let distance = 0;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, y, z)
            .sub(center)
            .applyQuaternion(inverse);
          distance = Math.max(
            distance,
            Math.abs(p.x) / (tanX * 0.86) + p.z,
            Math.abs(p.y) / (tanY * (range ? 0.9 : 0.74)) + p.z,
          );
        }
    camera.position.copy(center).addScaledVector(direction, distance);
    if (range) {
      camera.position.y += 0.12;
      controls.target.y += 0.12;
    }
    controls.update();
  }
  const dragStart = new THREE.Vector2();
  const down = (e: PointerEvent) => {
    dragStart.set(e.clientX, e.clientY);
  };
  const up = (e: PointerEvent) => {
    if (dragStart.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 5)
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster
      .intersectObject(options.view === 'gear' ? gearbox.group : model, true)
      .find((h) => {
        for (
          let parent: THREE.Object3D | null = h.object;
          parent;
          parent = parent.parent
        )
          if (!parent.visible) return false;
        const range = INSPECTION_VIEWS[options.view].xRange;
        if (range && (h.point.x < range[0] || h.point.x > range[1]))
          return false;
        if (options.transparent && casingParts.has(h.object.userData.partId))
          return false;
        if (options.cut === 'half' && h.point.z > 0) return false;
        if (options.cut === 'quarter' && h.point.z > 0 && h.point.y > 0)
          return false;
        return !!h.object.userData.partId;
      });
    if (hit) onSelect(hit.object.userData.partId);
  };
  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointerup', up);

  function setOptions(next: ViewOptions) {
    const viewChanged = next.view !== options.view;
    options = next;
    const range = INSPECTION_VIEWS[next.view].xRange;
    engine.group.visible = next.view !== 'gear';
    gearbox.group.visible = next.view === 'engine' || next.view === 'gear';
    floor.visible = next.view === 'engine';
    for (const [o, bounds] of axialBounds) {
      o.visible =
        !range || (bounds.max.x >= range[0] && bounds.min.x <= range[1]);
      if (
        range &&
        (o.userData.partId === 'bypass-envelope' ||
          o.userData.partId === 'fan-case')
      )
        o.visible = false;
    }
    renderer.clippingPlanes = range
      ? [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -range[0]),
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), range[1]),
        ]
      : [];
    const planes =
      next.cut === 'whole'
        ? []
        : next.cut === 'half'
          ? [halfPlane]
          : [halfPlane, quarterPlane];
    for (const m of originalMaterials.keys()) {
      m.clippingPlanes = planes;
      m.clipIntersection = next.cut === 'quarter';
      if (m instanceof THREE.MeshStandardMaterial) {
        m.emissive.setHex(
          partMaterials.get(m) === next.selected ? 0x996029 : 0x000000,
        );
        m.emissiveIntensity = 0.22;
      }
      m.needsUpdate = true;
    }
    engine.casing.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.transparent = next.transparent;
        m.opacity = next.transparent ? 0.12 : 1;
        m.depthWrite = !next.transparent;
      }
    });
    flow.group.visible = next.flow && next.view !== 'gear';
    const bypassFlow = flow.group.getObjectByName('bypass-flow');
    if (bypassFlow) bypassFlow.visible = !range;
    flow.setClipping(planes, next.cut === 'quarter');
    if (viewChanged) setCamera('iso');
  }

  function update(state: ViewState) {
    if (disposed) return;
    engine.setAngles(state.lpAngle, state.hpAngle);
    gearbox.setAngle(state.lpAngle);
    controls.update();
    model.updateMatrixWorld(true);
    if (flow.group.visible)
      flowResidual = flow.update(
        state,
        options.flowField,
        INSPECTION_VIEWS[options.view].xRange,
      ).continuityResidual;
    renderer.info.reset();
    renderer.clear(true, true, true);
    renderer.render(backdrop, camera);
    if (options.cut !== 'whole') {
      floor.visible = false;
      renderer.shadowMap.autoUpdate = false;
      const planes =
        options.cut === 'half' ? [halfPlane] : [halfPlane, quarterPlane];
      for (let i = 0; i < planes.length; i++) {
        renderer.clearStencil();
        backStencil.clippingPlanes = [planes[i]];
        frontStencil.clippingPlanes = [planes[i]];
        scene.overrideMaterial = backStencil;
        renderer.render(scene, camera);
        scene.overrideMaterial = frontStencil;
        renderer.render(scene, camera);
        scene.overrideMaterial = null;
        cap.position.set(1.5, 0, 0);
        cap.quaternion.setFromUnitVectors(frontNormal, planes[i].normal);
        capMaterial.clippingPlanes =
          planes.length === 2 ? [planes[1 - i].clone().negate()] : [];
        renderer.render(capScene, camera);
      }
      floor.visible = options.view === 'engine';
      renderer.shadowMap.autoUpdate = true;
    }
    renderer.clearStencil();
    renderer.render(scene, camera);
    renderer.render(overlay, camera);
    lastTime = state.time;
  }

  function renderedDiagnostics(state: ViewState) {
    const angles = deriveGearAngles(state.lpAngle);
    return {
      fanAngle: engine.fan.rotation.x,
      lpAngle: engine.lp.rotation.x,
      hpAngle: engine.hp.rotation.x,
      ringAngle: gearbox.ring.rotation.x,
      sunAngle: gearbox.sun.rotation.x,
      fanConstraint: angleError(engine.fan.rotation.x, -state.lpAngle / 3),
      lpConstraint: angleError(engine.lp.rotation.x, state.lpAngle),
      hpConstraint: angleError(engine.hp.rotation.x, state.hpAngle),
      sunConstraint: angleError(gearbox.sun.rotation.x, state.lpAngle),
      ringConstraint: angleError(gearbox.ring.rotation.x, angles.ring),
      starConstraint: Math.max(
        ...gearbox.stars.map((s, i) =>
          angleError(s.rotation.x, angles.stars[i]),
        ),
      ),
      carrierConstraint: Math.abs(gearbox.carrier.rotation.x),
      lastRenderedTime: lastTime,
      triangles: renderer.info.render.triangles,
      drawCalls: renderer.info.render.calls,
      starCount: gearbox.stars.length,
      flowResidual: flow.group.visible ? flowResidual : undefined,
    };
  }
  setOptions(options);
  return {
    update,
    setOptions,
    setCamera,
    renderedDiagnostics,
    engine,
    gearbox,
    dispose() {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointerup', up);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      flow.dispose();
      for (const s of [scene, backdrop, capScene])
        s.traverse((o) => {
          if (
            o instanceof THREE.Mesh ||
            o instanceof THREE.Points ||
            o instanceof THREE.Line
          ) {
            geometries.add(o.geometry);
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material])
              materials.add(m);
          }
        });
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      backStencil.dispose();
      frontStencil.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

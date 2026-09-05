import * as THREE from 'three';

export type InspectionView =
  | 'engine'
  | 'gear'
  | 'compressor'
  | 'combustor'
  | 'turbine';

export const INSPECTION_VIEWS: Record<
  InspectionView,
  {
    label: string;
    eyebrow: string;
    title: string;
    summary: string;
    selected: string;
    xRange?: readonly [number, number];
  }
> = {
  engine: {
    label: '全体',
    eyebrow: 'GEARED TURBOFAN',
    title: 'エンジン構造・作動モデル',
    summary: '2スプール / 3:1 減速 / 同軸シャフト',
    selected: 'fan',
  },
  gear: {
    label: '減速機',
    eyebrow: 'FAN DRIVE GEAR SYSTEM',
    title: 'ファン駆動減速機',
    summary: '固定キャリア / ダブルヘリカル / 内歯リング出力',
    selected: 'gear',
  },
  compressor: {
    label: '圧縮機',
    eyebrow: 'AXIAL COMPRESSION',
    title: '低圧・高圧圧縮機',
    summary: 'LPC 3段 + HPC 8段 / 動翼・静翼 / 独立した2軸',
    selected: 'hpc-4',
    xRange: [0.84, 2.04],
  },
  combustor: {
    label: '燃焼器',
    eyebrow: 'ANNULAR COMBUSTION',
    title: '環状燃焼器',
    summary: '噴射器 → ライナ → HPT入口 / 燃料・熱量の収支',
    selected: 'combustor-outer-liner',
    xRange: [2.03, 2.44],
  },
  turbine: {
    label: 'タービン',
    eyebrow: 'TURBINE WORK EXTRACTION',
    title: '高圧・低圧タービン',
    summary: 'HPT 2段 + LPT 3段 / 膨張から軸動力へ',
    selected: 'hpt-1',
    xRange: [2.43, 3.26],
  },
};

/** A part owns its finish; shared palette materials must not spread casing opacity or selection. */
export function isolatePartMaterials(root: THREE.Object3D) {
  const materials = new Map<THREE.Material, string>();
  const copies = new Map<THREE.Material, Map<string, THREE.Material>>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const part = String(object.userData.partId ?? '');
    const own = (source: THREE.Material) => {
      let byPart = copies.get(source);
      if (!byPart) copies.set(source, (byPart = new Map()));
      let material = byPart.get(part);
      if (!material) {
        material = source.clone();
        byPart.set(part, material);
        materials.set(material, part);
      }
      return material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(own)
      : own(object.material);
  });
  for (const source of copies.keys()) source.dispose();
  return materials;
}

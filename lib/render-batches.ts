import * as THREE from 'three';

/** Instance identical sibling parts; their parent remains the physical rotor. */
export function batchRepeatedMeshes(root: THREE.Object3D) {
  const parents: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.children.length > 1) parents.push(object);
  });
  for (const parent of parents) {
    const batches = new Map<string, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (
        !(child instanceof THREE.Mesh) ||
        child instanceof THREE.InstancedMesh ||
        Array.isArray(child.material)
      )
        continue;
      const key = `${child.geometry.uuid}/${child.material.uuid}/${child.userData.partId}`;
      const batch = batches.get(key) ?? [];
      batch.push(child);
      batches.set(key, batch);
    }
    for (const meshes of batches.values()) {
      if (meshes.length < 2) continue;
      const first = meshes[0];
      const instances = new THREE.InstancedMesh(
        first.geometry,
        first.material,
        meshes.length,
      );
      instances.name = `${first.name || first.userData.partId}-instances`;
      instances.userData = { ...first.userData };
      instances.castShadow = first.castShadow;
      instances.receiveShadow = first.receiveShadow;
      for (let i = 0; i < meshes.length; i++) {
        meshes[i].updateMatrix();
        instances.setMatrixAt(i, meshes[i].matrix);
        parent.remove(meshes[i]);
      }
      instances.instanceMatrix.needsUpdate = true;
      instances.computeBoundingSphere();
      parent.add(instances);
    }
  }
}

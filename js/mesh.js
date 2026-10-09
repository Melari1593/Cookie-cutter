import * as THREE from 'three';

function toShapes(polygons) {
  return polygons.map(({ outer, holes }) => {
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    return shape;
  });
}

/** Construye un grupo de mallas (eje Z hacia arriba) a partir de las capas. */
export function buildModel(layers, material) {
  const group = new THREE.Group();
  for (const layer of layers) {
    if (!layer.polygons.length) continue;
    const geometry = new THREE.ExtrudeGeometry(toShapes(layer.polygons), {
      depth: layer.z1 - layer.z0,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.translate(0, 0, layer.z0);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = layer.name;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return group;
}

export function triangleCount(group) {
  let n = 0;
  group.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      n += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return n;
}

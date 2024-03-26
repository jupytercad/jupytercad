import * as THREE from 'three';
import { getCSSVariableColor } from '../tools';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree
} from 'three-mesh-bvh';
import { IDict, IParsedShape } from '@jupytercad/schema';

// Apply the BVH extension

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const DEFAULT_MESH_COLOR_CSS = '--jp-inverse-layout-color4';
export const DEFAULT_EDGE_COLOR_CSS = '--jp-inverse-layout-color2';
export const SELECTED_MESH_COLOR_CSS = '--jp-brand-color0';

export const DEFAULT_MESH_COLOR = new THREE.Color(
  getCSSVariableColor(DEFAULT_MESH_COLOR_CSS)
);
export const DEFAULT_EDGE_COLOR = new THREE.Color(
  getCSSVariableColor(DEFAULT_EDGE_COLOR_CSS)
);
export const SELECTED_MESH_COLOR = new THREE.Color(
  getCSSVariableColor(SELECTED_MESH_COLOR_CSS)
);

export type BasicMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial
>;

/**
 * The interface for a 3D pointer
 */
export interface IPointer {
  parent: BasicMesh;
  readonly mesh: BasicMesh;
}

/**
 * The result of mesh picking, contains the picked mesh and the 3D position of the pointer.
 */
export interface IPickedResult {
  mesh: BasicMesh;
  position: THREE.Vector3;
}

export function projectVector(options: {
  vector: THREE.Vector3;
  camera: THREE.Camera;
  width: number;
  height: number;
}): THREE.Vector2 {
  const { vector, camera, width, height } = options;
  const copy = new THREE.Vector3().copy(vector);

  copy.project(camera);

  return new THREE.Vector2(
    (0.5 + copy.x / 2) * width,
    (0.5 - copy.y / 2) * height
  );
}

export function computeExplodedState(options: {
  mesh: BasicMesh;
  boundingGroup: THREE.Box3;
  factor: number;
}) {
  const { mesh, boundingGroup, factor } = options;
  const center = new THREE.Vector3();
  boundingGroup.getCenter(center);

  const oldGeometryCenter = new THREE.Vector3();
  mesh.geometry.boundingBox?.getCenter(oldGeometryCenter);

  const centerToMesh = new THREE.Vector3(
    oldGeometryCenter.x - center.x,
    oldGeometryCenter.y - center.y,
    oldGeometryCenter.z - center.z
  );
  const distance = centerToMesh.length() * factor;

  centerToMesh.normalize();

  const newGeometryCenter = new THREE.Vector3(
    oldGeometryCenter.x + distance * centerToMesh.x,
    oldGeometryCenter.y + distance * centerToMesh.y,
    oldGeometryCenter.z + distance * centerToMesh.z
  );

  return {
    oldGeometryCenter,
    newGeometryCenter,
    vector: centerToMesh,
    distance
  };
}

export function buildShape(options: {
  objName: string;
  data: IParsedShape;
  clippingPlanes: THREE.Plane[];
  selected: boolean;
  guidata?: IDict;
}): {
  meshGroup: THREE.Group;
  mainMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
} | null {
  const { objName, data, guidata, clippingPlanes, selected } = options;
  const { faceList, edgeList, jcObject } = data;

  const vertices: Array<number> = [];
  const normals: Array<number> = [];
  const triangles: Array<number> = [];

  let vInd = 0;
  if (faceList.length === 0 && edgeList.length === 0) {
    return null;
  }
  faceList.forEach(face => {
    // Copy Vertices into three.js Vector3 List
    vertices.push(...face.vertexCoord);
    normals.push(...face.normalCoord);

    // Sort Triangles into a three.js Face List
    for (let i = 0; i < face.triIndexes.length; i += 3) {
      triangles.push(
        face.triIndexes[i + 0] + vInd,
        face.triIndexes[i + 1] + vInd,
        face.triIndexes[i + 2] + vInd
      );
    }

    vInd += face.vertexCoord.length / 3;
  });

  let color = DEFAULT_MESH_COLOR;
  let visible = jcObject.visible;
  if (guidata && guidata[objName]) {
    const objdata = guidata[objName];

    if (Object.prototype.hasOwnProperty.call(objdata, 'color')) {
      const rgba = objdata['color'] as number[];
      color = new THREE.Color(rgba[0], rgba[1], rgba[2]);
    }

    if (Object.prototype.hasOwnProperty.call(objdata, 'visibility')) {
      visible = guidata[objName]['visibility'];
    }
  }

  // Compile the connected vertices and faces into a model
  // And add to the scene
  // We need one material per-mesh because we will set the uniform color independently later
  // it's too bad Three.js does not easily allow setting uniforms independently per-mesh
  const material = new THREE.MeshPhongMaterial({
    color,
    side: THREE.DoubleSide,
    wireframe: false,
    flatShading: false,
    clippingPlanes,
    shininess: 0
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(triangles);
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  if (vertices.length > 0) {
    geometry.computeBoundsTree();
  }

  const meshGroup = new THREE.Group();
  meshGroup.name = objName;
  meshGroup.visible = visible;

  const baseMat = new THREE.MeshBasicMaterial();
  baseMat.depthWrite = false;
  baseMat.depthTest = false;
  baseMat.colorWrite = false;
  baseMat.stencilWrite = true;
  baseMat.stencilFunc = THREE.AlwaysStencilFunc;

  // back faces
  const mat0 = baseMat.clone();
  mat0.side = THREE.BackSide;
  mat0.clippingPlanes = clippingPlanes;
  mat0.stencilFail = THREE.IncrementWrapStencilOp;
  mat0.stencilZFail = THREE.IncrementWrapStencilOp;
  mat0.stencilZPass = THREE.IncrementWrapStencilOp;
  const backFaces = new THREE.Mesh(geometry, mat0);
  meshGroup.add(backFaces);

  // front faces
  const mat1 = baseMat.clone();
  mat1.side = THREE.FrontSide;
  mat1.clippingPlanes = clippingPlanes;
  mat1.stencilFail = THREE.DecrementWrapStencilOp;
  mat1.stencilZFail = THREE.DecrementWrapStencilOp;
  mat1.stencilZPass = THREE.DecrementWrapStencilOp;
  const frontFaces = new THREE.Mesh(geometry, mat1);
  meshGroup.add(frontFaces);

  const mainMesh = new THREE.Mesh(geometry, material);
  mainMesh.name = 'main';

  if (visible) {
    // this._boundingGroup.expandByObject(mainMesh);
  }

  if (selected) {
    //selectedNames.includes(objName)
    // this._selectedMeshes.push(mainMesh);
    mainMesh.material.color = SELECTED_MESH_COLOR;
  }

  const edgeMaterial = new THREE.LineBasicMaterial({
    linewidth: 5,
    color: DEFAULT_EDGE_COLOR,
    clippingPlanes
  });
  edgeList.forEach(edge => {
    const edgeVertices = new THREE.Float32BufferAttribute(edge.vertexCoord, 3);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', edgeVertices);
    const edgesMesh = new THREE.Line(edgeGeometry, edgeMaterial);
    edgesMesh.name = 'edge';

    mainMesh.add(edgesMesh);
  });
  meshGroup.add(mainMesh);

  return { meshGroup, mainMesh };
}

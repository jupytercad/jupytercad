import { MapChange } from '@jupyter/ydoc';
import { IWorkerMessage } from '@jupytercad/occ-worker';
import {
  IAnnotation,
  IDict,
  IDisplayShape,
  IJcadObjectDocChange,
  IJCadWorker,
  IJCadWorkerRegistry,
  IJupyterCadClientState,
  IJupyterCadDoc,
  IJupyterCadModel,
  IMainMessage,
  IPostResult,
  ISelection,
  MainAction,
  WorkerAction
} from '@jupytercad/schema';
import { IObservableMap, ObservableMap } from '@jupyterlab/observables';
import { User } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { JSONValue } from '@lumino/coreutils';
import { ContextMenu } from '@lumino/widgets';
import * as Color from 'd3-color';
import * as React from 'react';
import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree
} from 'three-mesh-bvh';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { v4 as uuid } from 'uuid';

import { FloatingAnnotation } from './annotation/view';
import { getCSSVariableColor, throttle } from './tools';
import { AxeHelper, CameraSettings, ExplodedView, ClipSettings } from './types';

// Apply the BVH extension
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DEFAULT_MESH_COLOR_CSS = '--jp-inverse-layout-color4';
const DEFAULT_EDGE_COLOR_CSS = '--jp-inverse-layout-color2';
const SELECTED_MESH_COLOR_CSS = '--jp-brand-color0';

const DEFAULT_MESH_COLOR = new THREE.Color(
  getCSSVariableColor(DEFAULT_MESH_COLOR_CSS)
);
const DEFAULT_EDGE_COLOR = new THREE.Color(
  getCSSVariableColor(DEFAULT_EDGE_COLOR_CSS)
);
const SELECTED_MESH_COLOR = new THREE.Color(
  getCSSVariableColor(SELECTED_MESH_COLOR_CSS)
);

const DEFAULT_LINEWIDTH = 6;
const SELECTED_LINEWIDTH = 15;

export type BasicMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial
>;

interface IProps {
  view: ObservableMap<JSONValue>;
  jcadModel: IJupyterCadModel;
  workerRegistry: IJCadWorkerRegistry;
}

interface IStates {
  id: string; // ID of the component, it is used to identify which component
  //is the source of awareness updates.
  loading: boolean;
  lightTheme: boolean;
  remoteUser?: User.IIdentity | null;
  annotations: IDict<IAnnotation>;
  firstLoad: boolean;
}

/**
 * The interface for a 3D pointer
 */
interface IPointer {
  parent: BasicMesh;
  readonly mesh: BasicMesh;
}

/**
 * The result of mesh picking, contains the picked mesh and the 3D position of the pointer.
 */
interface IPickedResult {
  mesh: BasicMesh;
  position: THREE.Vector3;
}

export class MainView extends React.Component<IProps, IStates> {
  constructor(props: IProps) {
    super(props);

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setDrawRange(0, 3 * 10000);

    this.props.view.changed.connect(this._onViewChanged, this);

    this._model = this.props.jcadModel;

    this._pointer = new THREE.Vector2();
    this._collaboratorPointers = {};
    this._model.themeChanged.connect(this._handleThemeChange, this);

    this._model.sharedObjectsChanged.connect(
      this._onSharedObjectsChanged,
      this
    );
    this._model.sharedOptionsChanged.connect(
      this._onSharedOptionsChanged,
      this
    );
    this._model.clientStateChanged.connect(
      this._onClientSharedStateChanged,
      this
    );
    this._model.sharedMetadataChanged.connect(
      this._onSharedMetadataChanged,
      this
    );

    // @ts-ignore Missing ThreeJS typing
    this._raycaster.params.Line2 = {};
    // Is this threshold in pixels? It looks like it
    // @ts-ignore Missing ThreeJS typing
    this._raycaster.params.Line2.threshold = 50;

    this._worker = props.workerRegistry.getDefaultWorker();
    const id = this._worker.register({
      messageHandler: this.messageHandler.bind(this)
    });
    props.workerRegistry.getAllWorkers().forEach(wk => {
      const id = wk.register({
        messageHandler: this.postProcessWorkerHandler.bind(this)
      });
      this._postWorkerId.set(id, wk);
    });
    const lightTheme =
      document.body.getAttribute('data-jp-theme-light') === 'true';
    this.state = {
      id,
      lightTheme,
      loading: true,
      annotations: {},
      firstLoad: true
    };
  }

  componentDidMount(): void {
    window.addEventListener('resize', this._handleWindowResize);
    this.generateScene();
    this.addContextMenu();
  }

  componentDidUpdate(oldProps: IProps, oldState: IStates): void {
    this.resizeCanvasToDisplaySize();
  }

  componentWillUnmount(): void {
    window.cancelAnimationFrame(this._requestID);
    window.removeEventListener('resize', this._handleWindowResize);
    this.props.view.changed.disconnect(this._onViewChanged, this);
    this._controls.dispose();

    this._model.themeChanged.disconnect(this._handleThemeChange, this);
    this._model.sharedOptionsChanged.disconnect(
      this._onSharedOptionsChanged,
      this
    );
    this._model.sharedObjectsChanged.disconnect(
      this._onSharedObjectsChanged,
      this
    );
    this._model.clientStateChanged.disconnect(
      this._onClientSharedStateChanged,
      this
    );
    this._model.sharedMetadataChanged.disconnect(
      this._onSharedMetadataChanged,
      this
    );
  }

  addContextMenu = (): void => {
    const commands = new CommandRegistry();
    commands.addCommand('add-annotation', {
      execute: () => {
        if (!this._pointer3D) {
          return;
        }

        const position = new THREE.Vector3().copy(
          this._pointer3D.mesh.position
        );

        // If in exploded view, we scale down to the initial position (to before exploding the view)
        if (this._explodedView.enabled) {
          const explodedState = this._computeExplodedState(
            this._pointer3D.mesh
          );

          position.add(
            explodedState.vector.multiplyScalar(-explodedState.distance)
          );
        }

        this._model.annotationModel?.addAnnotation(uuid(), {
          position: [position.x, position.y, position.z],
          label: 'New annotation',
          contents: [],
          parent: this._pointer3D.parent.name
        });
      },
      label: 'Add annotation',
      isEnabled: () => {
        return !!this._pointer3D;
      }
    });
    this._contextMenu = new ContextMenu({ commands });
    this._contextMenu.addItem({
      command: 'add-annotation',
      selector: 'canvas',
      rank: 1
    });
  };

  sceneSetup = (): void => {
    if (this.divRef.current !== null) {
      DEFAULT_MESH_COLOR.set(getCSSVariableColor(DEFAULT_MESH_COLOR_CSS));
      DEFAULT_EDGE_COLOR.set(getCSSVariableColor(DEFAULT_EDGE_COLOR_CSS));
      SELECTED_MESH_COLOR.set(getCSSVariableColor(SELECTED_MESH_COLOR_CSS));

      this._camera = new THREE.PerspectiveCamera(90, 2, 0.1, 1000);
      this._camera.position.set(8, 8, 8);
      this._camera.up.set(0, 0, 1);

      this._scene = new THREE.Scene();

      this._scene.add(new THREE.AmbientLight(0xffffff, 0.5)); // soft white light

      this._cameraLight = new THREE.PointLight(0xffffff, 1);

      this._camera.add(this._cameraLight);

      this._scene.add(this._camera);

      this._renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true
      });
      // this._renderer.setPixelRatio(window.devicePixelRatio);
      this._renderer.setClearColor(0x000000, 0);
      this._renderer.setSize(500, 500, false);
      this.divRef.current.appendChild(this._renderer.domElement); // mount using React ref

      this._syncPointer = throttle(
        (position: THREE.Vector3 | undefined, parent: string | undefined) => {
          if (position && parent) {
            this._model.syncPointer({
              parent,
              x: position.x,
              y: position.y,
              z: position.z
            });
          } else {
            this._model.syncPointer(undefined);
          }
        },
        100
      );
      this._renderer.domElement.addEventListener(
        'pointermove',
        this._onPointerMove.bind(this)
      );
      this._renderer.domElement.addEventListener('mouseup', e => {
        this._onClick.bind(this)(e);
      });

      this._renderer.domElement.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        this._contextMenu.open(e);
      });

      document.addEventListener('keydown', e => {
        this._onKeyDown.bind(this)(e);
      });

      const controls = new OrbitControls(
        this._camera,
        this._renderer.domElement
      );
      // controls.rotateSpeed = 1.0;
      // controls.zoomSpeed = 1.2;
      // controls.panSpeed = 0.8;
      controls.target.set(
        this._scene.position.x,
        this._scene.position.y,
        this._scene.position.z
      );
      this._controls = controls;

      this._controls.addEventListener('change', () => {
        this._updateAnnotation();
      });
      this._controls.addEventListener(
        'change',
        throttle(() => {
          // Not syncing camera state if following someone else
          if (this._model.localState?.remoteUser) {
            return;
          }

          this._model.syncCamera(
            {
              position: this._camera.position.toArray([]),
              rotation: this._camera.rotation.toArray([]),
              up: this._camera.up.toArray([])
            },
            this.state.id
          );
        }, 100)
      );

      // Setting up the transform controls
      this._transformControls = new TransformControls(
        this._camera,
        this._renderer.domElement
      );

      // Create half transparent plane mesh for controls
      this._clippingPlaneMeshControl = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 'black',
          opacity: 0.2,
          transparent: true,
          side: THREE.DoubleSide
        })
      );
      this._clippingPlaneMeshControl.visible = false;

      // Setting the fake plane position
      const target = new THREE.Vector3(0, 0, 1);
      this._clippingPlane.coplanarPoint(target);
      this._clippingPlaneMeshControl.geometry.translate(
        target.x,
        target.y,
        target.z
      );
      this._clippingPlaneMeshControl.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        this._clippingPlane.normal
      );

      this._scene.add(this._clippingPlaneMeshControl);

      // Disable the orbit control whenever we do transformation
      this._transformControls.addEventListener('dragging-changed', event => {
        this._controls.enabled = !event.value;
      });

      // Update the clipping plane whenever the transform UI move
      this._transformControls.addEventListener('change', () => {
        const normal = new THREE.Vector3(0, 0, 1);

        this._clippingPlane.setFromNormalAndCoplanarPoint(
          normal.applyEuler(this._clippingPlaneMeshControl.rotation),
          this._clippingPlaneMeshControl.position
        );
      });
      this._transformControls.attach(this._clippingPlaneMeshControl);
      this._scene.add(this._transformControls);

      this._transformControls.enabled = false;
      this._transformControls.visible = false;
    }
  };

  _pick(): IPickedResult | null {
    if (this._meshGroup === null || !this._meshGroup.children) {
      return null;
    }

    this._raycaster.setFromCamera(this._pointer, this._camera);

    const intersects = this._raycaster.intersectObjects(
      this._meshGroup.children
    );

    if (intersects.length > 0) {
      // Find the first intersection with a visible object
      for (const intersect of intersects) {
        // Object is hidden
        if (!intersect.object.visible || !intersect.object.parent?.visible) {
          continue;
        }

        // Object is clipped
        const planePoint = new THREE.Vector3();
        this._clippingPlane.coplanarPoint(planePoint);
        planePoint.sub(intersect.point);

        if (
          this._clipSettings.enabled &&
          planePoint.dot(this._clippingPlane.normal) > 0
        ) {
          continue;
        }

        const intersectMesh = intersect.object.name.includes('-front')
          ? intersect.object.parent.getObjectByName(
              intersect.object.name.replace('-front', '')
            )
          : intersect.object;

        return {
          mesh: intersectMesh as BasicMesh,
          // @ts-ignore Missing threejs typing
          position: intersect.pointOnLine
            ? // @ts-ignore Missing threejs typing
              intersect.pointOnLine
            : intersect.point
        };
      }
    }

    return null;
  }

  animate = (): void => {
    this._requestID = window.requestAnimationFrame(this.animate);

    for (const material of this._edgeMaterials) {
      material.resolution.set(
        this._renderer.domElement.width,
        this._renderer.domElement.height
      );
    }

    if (this._clippingPlaneMesh !== null) {
      this._clippingPlane.coplanarPoint(this._clippingPlaneMesh.position);
      this._clippingPlaneMesh.lookAt(
        this._clippingPlaneMesh.position.x - this._clippingPlane.normal.x,
        this._clippingPlaneMesh.position.y - this._clippingPlane.normal.y,
        this._clippingPlaneMesh.position.z - this._clippingPlane.normal.z
      );
    }

    this._controls.update();

    this._renderer.setRenderTarget(null);

    this._renderer.clearDepth();

    this._renderer.render(this._scene, this._camera);
  };

  resizeCanvasToDisplaySize = (): void => {
    if (this.divRef.current !== null) {
      this._renderer.setSize(
        this.divRef.current.clientWidth,
        this.divRef.current.clientHeight,
        false
      );
      if (this._camera.type === 'PerspectiveCamera') {
        this._camera.aspect =
          this.divRef.current.clientWidth / this.divRef.current.clientHeight;
      } else {
        this._camera.left = this.divRef.current.clientWidth / -2;
        this._camera.right = this.divRef.current.clientWidth / 2;
        this._camera.top = this.divRef.current.clientHeight / 2;
        this._camera.bottom = this.divRef.current.clientHeight / -2;
      }
      this._camera.updateProjectionMatrix();
    }
  };

  generateScene = (): void => {
    this.sceneSetup();
    this.animate();
    this.resizeCanvasToDisplaySize();
  };

  messageHandler = (msg: IMainMessage): void => {
    switch (msg.action) {
      case MainAction.DISPLAY_SHAPE: {
        const { result, postResult } = msg.payload;
        this._saveMeta(result);
        this._shapeToMesh(result);
        if (Object.keys(result).length > 0) {
          if (this._firstRender) {
            const outputs = this._model.sharedModel.outputs;
            Object.entries(outputs).forEach(([objName, postResult]) => {
              this._objToMesh(objName, postResult as any);
            });
            this._firstRender = false;
          } else {
            this._postWorkerId.forEach((wk, id) => {
              wk.postMessage({
                id,
                action: WorkerAction.POSTPROCESS,
                payload: postResult
              });
            });
          }
        }

        break;
      }
      case MainAction.INITIALIZED: {
        if (!this._model) {
          return;
        }
        const content = this._model.getContent();

        this._postMessage({
          action: WorkerAction.LOAD_FILE,
          payload: {
            content
          }
        });
      }
    }
  };

  postProcessWorkerHandler = (msg: IMainMessage): void => {
    switch (msg.action) {
      case MainAction.DISPLAY_POST: {
        msg.payload.forEach(element => {
          const { jcObject, postResult } = element;
          this._model.sharedModel.setOutput(jcObject.name, postResult);
          this._objToMesh(jcObject.name, postResult);
        });

        break;
      }
    }
  };

  private _projectVector = (vector: THREE.Vector3): THREE.Vector2 => {
    const copy = new THREE.Vector3().copy(vector);
    const canvas = this._renderer.domElement;

    copy.project(this._camera);

    return new THREE.Vector2(
      (0.5 + copy.x / 2) * canvas.width,
      (0.5 - copy.y / 2) * canvas.height
    );
  };

  private _updateAnnotation() {
    Object.keys(this.state.annotations).forEach(key => {
      const el = document.getElementById(key);
      if (el) {
        const annotation = this._model.annotationModel?.getAnnotation(key);
        let screenPosition = new THREE.Vector2();

        if (annotation) {
          const parent = this._meshGroup?.getObjectByName(
            annotation.parent
          ) as BasicMesh;
          const position = new THREE.Vector3(
            annotation.position[0],
            annotation.position[1],
            annotation.position[2]
          );

          // If in exploded view, we explode the annotation position as well
          if (this._explodedView.enabled && parent) {
            const explodedState = this._computeExplodedState(parent);
            const explodeVector = explodedState.vector.multiplyScalar(
              explodedState.distance
            );

            position.add(explodeVector);
          }

          screenPosition = this._projectVector(position);
        }

        el.style.left = `${Math.round(screenPosition.x)}px`;
        el.style.top = `${Math.round(screenPosition.y)}px`;
      }
    });
  }

  private _onPointerMove(e: MouseEvent) {
    const rect = this._renderer.domElement.getBoundingClientRect();

    this._pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const picked = this._pick();

    // Update our 3D pointer locally so there is no visual latency in the local pointer movement
    if (!this._pointer3D && this._model.localState && picked) {
      this._pointer3D = {
        parent: picked.mesh,
        mesh: this._createPointer(this._model.localState.user)
      };
      this._scene.add(this._pointer3D.mesh);
    }

    if (picked) {
      if (!this._pointer3D) {
        this._syncPointer(undefined, undefined);
        return;
      }

      this._pointer3D.mesh.visible = true;
      this._pointer3D.mesh.position.copy(picked.position);
      this._pointer3D.parent = picked.mesh;

      // If in exploded view, we scale down to the initial position (to before exploding the view)
      if (this._explodedView.enabled) {
        const explodedState = this._computeExplodedState(
          this._pointer3D.parent
        );

        picked.position.add(
          explodedState.vector.multiplyScalar(-explodedState.distance)
        );
      }

      // If clipping is enabled and picked position is hidden
      this._syncPointer(picked.position, picked.mesh.name);
    } else {
      if (this._pointer3D) {
        this._pointer3D.mesh.visible = false;
      }
      this._syncPointer(undefined, undefined);
    }
  }

  private _onClick(e: MouseEvent) {
    const selection = this._pick();
    const selectedMeshesNames = new Set(
      this._selectedMeshes.map(sel => sel.name)
    );

    if (selection) {
      const selectionName = selection.mesh.name;
      if (e.ctrlKey) {
        if (selectedMeshesNames.has(selectionName)) {
          selectedMeshesNames.delete(selectionName);
        } else {
          selectedMeshesNames.add(selectionName);
        }
      } else {
        const alreadySelected = selectedMeshesNames.has(selectionName);
        selectedMeshesNames.clear();

        if (!alreadySelected) {
          selectedMeshesNames.add(selectionName);
        }
      }

      const names = Array.from(selectedMeshesNames);

      const newSelection: { [key: string]: ISelection } = {};
      for (const name of names) {
        newSelection[name] = this._meshGroup?.getObjectByName(name)
          ?.userData as ISelection;
      }

      this._updateSelected(newSelection);
      this._model.syncSelected(newSelection, this.state.id);
    }
  }

  private _onKeyDown(event: KeyboardEvent) {
    // TODO Make these Lumino commands? Or not?
    if (this._clipSettings.enabled) {
      switch (event.key) {
        case 'r':
          event.preventDefault();
          event.stopPropagation();

          if (this._transformControls.mode === 'rotate') {
            this._transformControls.setMode('translate');
          } else {
            this._transformControls.setMode('rotate');
          }
          break;
      }
    }
  }

  private _saveMeta = (payload: IDisplayShape['payload']['result']) => {
    if (!this._model) {
      return;
    }
    Object.entries(payload).forEach(([objName, data]) => {
      this._model.sharedModel.setShapeMeta(objName, data.meta);
    });
  };

  private _shapeToMesh = (payload: IDisplayShape['payload']['result']) => {
    if (this._meshGroup !== null) {
      this._scene.remove(this._meshGroup);
    }
    if (this._explodedViewLinesHelperGroup !== null) {
      this._scene.remove(this._explodedViewLinesHelperGroup);
    }

    const guidata = this._model.sharedModel.getOption('guidata');
    const selectedNames = this._selectedMeshes.map(sel => sel.name);
    this._selectedMeshes = [];

    this._boundingGroup = new THREE.Box3();

    this._edgeMaterials = [];

    this._meshGroup = new THREE.Group();
    Object.entries(payload).forEach(([objName, data]) => {
      const { faceList, edgeList, jcObject } = data;

      const vertices: Array<any> = [];
      const normals: Array<any> = [];
      const triangles: Array<any> = [];

      let vInd = 0;
      if (faceList.length === 0 && edgeList.length === 0) {
        return;
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
        clippingPlanes: this._clippingPlanes,
        shininess: 0
      });

      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(triangles);
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3)
      );
      geometry.setAttribute(
        'normal',
        new THREE.Float32BufferAttribute(normals, 3)
      );
      geometry.computeBoundingBox();
      if (vertices.length > 0) {
        geometry.computeBoundsTree();
      }

      const meshGroup = new THREE.Group();
      meshGroup.name = `${objName}-group`;
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
      mat0.clippingPlanes = this._clippingPlanes;
      mat0.stencilFail = THREE.IncrementWrapStencilOp;
      mat0.stencilZFail = THREE.IncrementWrapStencilOp;
      mat0.stencilZPass = THREE.IncrementWrapStencilOp;
      const backFaces = new THREE.Mesh(geometry, mat0);
      backFaces.name = `${objName}-back`;
      meshGroup.add(backFaces);

      // front faces
      const mat1 = baseMat.clone();
      mat1.side = THREE.FrontSide;
      mat1.clippingPlanes = this._clippingPlanes;
      mat1.stencilFail = THREE.DecrementWrapStencilOp;
      mat1.stencilZFail = THREE.DecrementWrapStencilOp;
      mat1.stencilZPass = THREE.DecrementWrapStencilOp;
      const frontFaces = new THREE.Mesh(geometry, mat1);
      frontFaces.name = `${objName}-front`;
      meshGroup.add(frontFaces);

      const mainMesh = new THREE.Mesh(geometry, material);
      mainMesh.name = objName;
      mainMesh.userData = {
        type: 'shape'
      };

      if (visible) {
        this._boundingGroup.expandByObject(mainMesh);
      }

      if (selectedNames.includes(objName)) {
        this._selectedMeshes.push(mainMesh);
        mainMesh.material.color = SELECTED_MESH_COLOR;
      }

      let edgeIdx = 0;
      edgeList.forEach(edge => {
        const edgeMaterial = new LineMaterial({
          linewidth: DEFAULT_LINEWIDTH,
          // @ts-ignore Missing typing in ThreeJS
          color: DEFAULT_EDGE_COLOR,
          clippingPlanes: this._clippingPlanes,
          // Depth offset so that lines are most always on top of faces
          polygonOffset: true,
          polygonOffsetFactor: -5,
          polygonOffsetUnits: -5
        });
        this._edgeMaterials.push(edgeMaterial);
        const edgeGeometry = new LineGeometry();
        edgeGeometry.setPositions(edge.vertexCoord);
        const edgesMesh = new LineSegments2(edgeGeometry, edgeMaterial);
        edgesMesh.name = `edge-${objName}-${edgeIdx}`;
        edgesMesh.userData = {
          type: 'edge',
          edgeIndex: edgeIdx,
          parent: objName
        };

        if (selectedNames.includes(edgesMesh.name)) {
          this._selectedMeshes.push(edgesMesh as unknown as BasicMesh);
          edgesMesh.material.color = SELECTED_MESH_COLOR;
          edgesMesh.material.linewidth = SELECTED_LINEWIDTH;
        }

        meshGroup.add(edgesMesh);
        edgeIdx++;
      });
      meshGroup.add(mainMesh);

      this._meshGroup?.add(meshGroup);
    });

    if (guidata) {
      this._model.sharedModel?.setOption('guidata', guidata);
    }
    // Update the reflength
    this._updateRefLength();
    // Set the expoded view if it's enabled
    this._setupExplodedView();

    // Clip plane rendering
    const planeGeom = new THREE.PlaneGeometry(
      this._refLength! * 10, // *10 is a bit arbitrary and extreme but that does not impact performance or anything
      this._refLength! * 10
    );
    const planeMat = new THREE.MeshPhongMaterial({
      color: DEFAULT_EDGE_COLOR,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
      side: THREE.DoubleSide
    });
    this._clippingPlaneMesh = new THREE.Mesh(planeGeom, planeMat);
    this._clippingPlaneMesh.onAfterRender = function (renderer) {
      renderer.clearStencil();
    };

    this._scene.add(this._clippingPlaneMesh);
    this._scene.add(this._meshGroup);

    this.setState(old => ({ ...old, loading: false }));
  };

  private _updateRefLength(force = false): void {
    if (this._meshGroup) {
      if (
        force ||
        (this._refLength === null && this._meshGroup.children.length)
      ) {
        const boxSizeVec = new THREE.Vector3();
        this._boundingGroup.getSize(boxSizeVec);

        this._refLength =
          Math.max(boxSizeVec.x, boxSizeVec.y, boxSizeVec.z) / 5 || 1;
        this._updatePointers(this._refLength);
        this._camera.lookAt(this._scene.position);

        this._camera.position.set(
          10 * this._refLength,
          10 * this._refLength,
          10 * this._refLength
        );
        this._camera.far = 200 * this._refLength;

        // Update clip plane size
        this._clippingPlaneMeshControl.geometry = new THREE.PlaneGeometry(
          this._refLength * 10,
          this._refLength * 10
        );
      }
      if (!this._meshGroup.children.length) {
        this._refLength = null;
      }
    }
  }

  private async _objToMesh(
    name: string,
    postResult: IPostResult
  ): Promise<void> {
    const { binary, format, value } = postResult;
    let obj: THREE.BufferGeometry | undefined = undefined;
    if (format === 'STL') {
      let buff: string | ArrayBuffer;
      if (binary) {
        const str = `data:application/octet-stream;base64,${value}`;
        const b = await fetch(str);
        buff = await b.arrayBuffer();
      } else {
        buff = value;
      }
      const loader = new STLLoader();
      obj = loader.parse(buff);
    }

    if (!obj) {
      return;
    }

    const material = new THREE.MeshPhongMaterial({
      color: DEFAULT_MESH_COLOR
    });
    const mesh = new THREE.Mesh(obj, material);

    const lineGeo = new THREE.WireframeGeometry(mesh.geometry);
    const mat = new THREE.LineBasicMaterial({ color: 'black' });
    const wireframe = new THREE.LineSegments(lineGeo, mat);
    mesh.add(wireframe);
    mesh.name = name;
    mesh.visible = true;
    if (this._meshGroup) {
      this._meshGroup.add(mesh);
      this._boundingGroup?.expandByObject(mesh);
    }
    this._updateRefLength(true);
  }

  private _postMessage = (msg: Omit<IWorkerMessage, 'id'>) => {
    if (this._worker) {
      const newMsg = { ...msg, id: this.state.id };
      this._worker.postMessage(newMsg);
    }
  };

  private _updatePointers(refLength): void {
    this._pointerGeometry = new THREE.SphereGeometry(refLength / 10, 32, 32);

    for (const clientId in this._collaboratorPointers) {
      this._collaboratorPointers[clientId].mesh.geometry =
        this._pointerGeometry;
    }
  }

  private _createPointer(user?: User.IIdentity): BasicMesh {
    let clientColor: Color.RGBColor | null = null;

    if (user?.color?.startsWith('var')) {
      clientColor = Color.color(
        getComputedStyle(document.documentElement).getPropertyValue(
          user.color.slice(4, -1)
        )
      ) as Color.RGBColor;
    } else {
      clientColor = Color.color(user?.color ?? 'steelblue') as Color.RGBColor;
    }

    const material = new THREE.MeshBasicMaterial({
      color: clientColor
        ? new THREE.Color(
            clientColor.r / 255,
            clientColor.g / 255,
            clientColor.b / 255
          )
        : 'black'
    });

    return new THREE.Mesh(this._pointerGeometry, material);
  }

  private _updateSelected(selection: { [key: string]: ISelection }) {
    // Reset original color for old selection
    for (const selectedMesh of this._selectedMeshes) {
      let originalColor = DEFAULT_MESH_COLOR;
      const guidata = this._model.sharedModel.getOption('guidata');
      if (
        guidata &&
        guidata[selectedMesh.name] &&
        guidata[selectedMesh.name]['color']
      ) {
        const rgba = guidata[selectedMesh.name]['color'] as number[];
        originalColor = new THREE.Color(rgba[0], rgba[1], rgba[2]);
      }
      if (selectedMesh.material?.color) {
        selectedMesh.material.color = originalColor;
      }
      // @ts-ignore
      if (selectedMesh.material?.linewidth) {
        // @ts-ignore
        selectedMesh.material.linewidth = DEFAULT_LINEWIDTH;
      }
    }

    // Set new selection
    this._selectedMeshes = [];

    for (const selectionName in selection) {
      const selectedMesh = this._meshGroup?.getObjectByName(
        selectionName
      ) as BasicMesh;

      if (!selectedMesh) {
        continue;
      }

      this._selectedMeshes.push(selectedMesh);
      if (selectedMesh?.material?.color) {
        selectedMesh.material.color = SELECTED_MESH_COLOR;
      }
      // @ts-ignore
      if (selectedMesh?.material?.linewidth) {
        // @ts-ignore
        selectedMesh.material.linewidth = SELECTED_LINEWIDTH;
      }
    }
  }

  private _onSharedMetadataChanged = (
    _: IJupyterCadDoc,
    changes: MapChange
  ) => {
    const newState = { ...this.state.annotations };
    changes.forEach((val, key) => {
      if (!key.startsWith('annotation')) {
        return;
      }
      const data = this._model.sharedModel.getMetadata(key);
      let open = true;
      if (this.state.firstLoad) {
        open = false;
      }

      if (data && (val.action === 'add' || val.action === 'update')) {
        const jsonData = JSON.parse(data);
        jsonData['open'] = open;
        newState[key] = jsonData;
      } else if (val.action === 'delete') {
        delete newState[key];
      }
    });

    this.setState(old => ({ ...old, annotations: newState, firstLoad: false }));
  };

  private _onClientSharedStateChanged = (
    sender: IJupyterCadModel,
    clients: Map<number, IJupyterCadClientState>
  ): void => {
    const remoteUser = this._model.localState?.remoteUser;

    // If we are in following mode, we update our camera and selection
    if (remoteUser) {
      const remoteState = clients.get(remoteUser);
      if (!remoteState) {
        return;
      }

      if (remoteState.user?.username !== this.state.remoteUser?.username) {
        this.setState(old => ({ ...old, remoteUser: remoteState.user }));
      }

      // Sync selected
      if (remoteState.selected?.value) {
        this._updateSelected(remoteState.selected.value);
      }

      // Sync camera
      const remoteCamera = remoteState.camera;
      if (remoteCamera?.value) {
        const { position, rotation, up } = remoteCamera.value;
        this._camera.position.set(position[0], position[1], position[2]);
        this._camera.rotation.set(rotation[0], rotation[1], rotation[2]);
        this._camera.up.set(up[0], up[1], up[2]);
      }
    } else {
      // If we are unfollowing a remote user, we reset our camera to its old position
      if (this.state.remoteUser !== null) {
        this.setState(old => ({ ...old, remoteUser: null }));
        const camera = this._model.localState?.camera?.value;

        if (camera) {
          const position = camera.position;
          const rotation = camera.rotation;
          const up = camera.up;

          this._camera.position.set(position[0], position[1], position[2]);
          this._camera.rotation.set(rotation[0], rotation[1], rotation[2]);
          this._camera.up.set(up[0], up[1], up[2]);
        }
      }

      // Sync local selection if needed
      const localState = this._model.localState;

      if (localState?.selected?.value) {
        this._updateSelected(localState.selected.value);
      }
    }

    // Displaying collaborators pointers
    clients.forEach((clientState, clientId) => {
      const pointer = clientState.pointer?.value;

      // We already display our own cursor on mouse move
      if (this._model.getClientId() === clientId) {
        return;
      }

      let collaboratorPointer = this._collaboratorPointers[clientId];

      if (pointer) {
        const parent = this._meshGroup?.getObjectByName(
          pointer.parent
        ) as BasicMesh;

        if (!collaboratorPointer) {
          const mesh = this._createPointer(clientState.user);

          collaboratorPointer = this._collaboratorPointers[clientId] = {
            mesh,
            parent
          };
          this._scene.add(mesh);
        }

        collaboratorPointer.mesh.visible = true;

        // If we are in exploded view, we display the collaborator cursor at the exploded position
        if (this._explodedView.enabled) {
          const explodedState = this._computeExplodedState(parent);
          const explodeVector = explodedState.vector.multiplyScalar(
            explodedState.distance
          );

          collaboratorPointer.mesh.position.copy(
            new THREE.Vector3(
              pointer.x + explodeVector.x,
              pointer.y + explodeVector.y,
              pointer.z + explodeVector.z
            )
          );
        } else {
          collaboratorPointer.mesh.position.copy(
            new THREE.Vector3(pointer.x, pointer.y, pointer.z)
          );
        }

        collaboratorPointer.parent = parent;
      } else {
        if (this._collaboratorPointers[clientId]) {
          this._collaboratorPointers[clientId].mesh.visible = false;
        }
      }
    });
  };

  private async _onSharedObjectsChanged(
    _: IJupyterCadDoc,
    change: IJcadObjectDocChange
  ): Promise<void> {
    if (change.objectChange) {
      await this._worker.ready;
      this._postMessage({
        action: WorkerAction.LOAD_FILE,
        payload: {
          content: this._model.getContent()
        }
      });
    }
  }

  private _onSharedOptionsChanged(
    sender: IJupyterCadDoc,
    change: MapChange
  ): void {
    const guidata = sender.getOption('guidata');

    if (guidata) {
      for (const objName in guidata) {
        const obj = this._meshGroup?.getObjectByName(objName) as
          | BasicMesh
          | undefined;
        if (!obj) {
          continue;
        }
        if (
          Object.prototype.hasOwnProperty.call(guidata[objName], 'visibility')
        ) {
          const explodedLineHelper =
            this._explodedViewLinesHelperGroup?.getObjectByName(objName);
          const objGuiData = guidata[objName];

          if (objGuiData) {
            obj.parent!.visible = objGuiData['visibility'];

            if (explodedLineHelper) {
              explodedLineHelper.visible = objGuiData['visibility'];
            }
          }
        }
        if (obj.material.color) {
          if ('color' in guidata[objName]) {
            const rgba = guidata[objName]['color'] as number[];
            const color = new THREE.Color(rgba[0], rgba[1], rgba[2]);
            obj.material.color = color;
          } else {
            obj.material.color = DEFAULT_MESH_COLOR;
          }
        }
      }
    }
  }

  private _onViewChanged(
    sender: ObservableMap<JSONValue>,
    change: IObservableMap.IChangedArgs<JSONValue>
  ): void {
    if (change.key === 'axes') {
      this._sceneAxe?.removeFromParent();
      const axe = change.newValue as AxeHelper | undefined;

      if (change.type !== 'remove' && axe && axe.visible) {
        this._sceneAxe = new THREE.AxesHelper(axe.size);
        this._scene.add(this._sceneAxe);
      }
    }

    if (change.key === 'explodedView') {
      const explodedView = change.newValue as ExplodedView | undefined;

      if (change.type !== 'remove' && explodedView) {
        this._explodedView = explodedView;

        this._setupExplodedView();
      }
    }

    if (change.key === 'cameraSettings') {
      const cameraSettings = change.newValue as CameraSettings | undefined;

      if (change.type !== 'remove' && cameraSettings) {
        this._cameraSettings = cameraSettings;

        this._updateCamera();
      }
    }

    if (change.key === 'clipView') {
      const clipSettings = change.newValue as ClipSettings | undefined;

      if (change.type !== 'remove' && clipSettings) {
        this._clipSettings = clipSettings;

        this._updateClipping();
      }
    }
  }

  private _setupExplodedView() {
    if (this._explodedView.enabled) {
      const center = new THREE.Vector3();
      this._boundingGroup.getCenter(center);

      this._explodedViewLinesHelperGroup?.removeFromParent();
      this._explodedViewLinesHelperGroup = new THREE.Group();

      for (const group of this._meshGroup?.children as THREE.Group[]) {
        const explodedState = this._computeExplodedState(
          group.getObjectByName(group.name.replace('-group', '')) as BasicMesh
        );

        group.position.set(0, 0, 0);
        group.translateOnAxis(explodedState.vector, explodedState.distance);

        // Draw lines
        const material = new THREE.LineBasicMaterial({
          color: DEFAULT_EDGE_COLOR,
          linewidth: DEFAULT_LINEWIDTH
        });
        const geometry = new THREE.BufferGeometry().setFromPoints([
          explodedState.oldGeometryCenter,
          explodedState.newGeometryCenter
        ]);
        const line = new THREE.Line(geometry, material);
        line.name = group.name;
        line.visible = group.visible;

        this._explodedViewLinesHelperGroup.add(line);
      }

      this._scene.add(this._explodedViewLinesHelperGroup);
    } else {
      // Exploded view is disabled, we reset the initial positions
      for (const mesh of this._meshGroup?.children as BasicMesh[]) {
        mesh.position.set(0, 0, 0);
      }
      this._explodedViewLinesHelperGroup?.removeFromParent();
    }
  }

  private _updateCamera() {
    const position = new THREE.Vector3().copy(this._camera.position);
    const up = new THREE.Vector3().copy(this._camera.up);

    this._camera.remove(this._cameraLight);
    this._scene.remove(this._camera);

    if (this._cameraSettings.type === 'Perspective') {
      this._camera = new THREE.PerspectiveCamera(90, 2, 0.1, 1000);
    } else {
      const width = this.divRef.current?.clientWidth || 0;
      const height = this.divRef.current?.clientHeight || 0;

      this._camera = new THREE.OrthographicCamera(
        width / -2,
        width / 2,
        height / 2,
        height / -2
      );
    }

    this._camera.add(this._cameraLight);

    this._scene.add(this._camera);
    this._controls.object = this._camera;

    this._camera.position.copy(position);
    this._camera.up.copy(up);
  }

  private _updateClipping() {
    if (this._clipSettings.enabled) {
      this._renderer.localClippingEnabled = true;
      this._transformControls.enabled = true;
      this._transformControls.visible = true;
      this._clippingPlaneMeshControl.visible = this._clipSettings.showClipPlane;
    } else {
      this._renderer.localClippingEnabled = false;
      this._transformControls.enabled = false;
      this._transformControls.visible = false;
      this._clippingPlaneMeshControl.visible = false;
    }
  }

  private _computeExplodedState(mesh: BasicMesh) {
    const center = new THREE.Vector3();
    this._boundingGroup.getCenter(center);

    const oldGeometryCenter = new THREE.Vector3();
    mesh.geometry.boundingBox?.getCenter(oldGeometryCenter);

    const centerToMesh = new THREE.Vector3(
      oldGeometryCenter.x - center.x,
      oldGeometryCenter.y - center.y,
      oldGeometryCenter.z - center.z
    );
    const distance = centerToMesh.length() * this._explodedView.factor;

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

  private _handleThemeChange = (): void => {
    const lightTheme =
      document.body.getAttribute('data-jp-theme-light') === 'true';

    DEFAULT_MESH_COLOR.set(getCSSVariableColor(DEFAULT_MESH_COLOR_CSS));
    DEFAULT_EDGE_COLOR.set(getCSSVariableColor(DEFAULT_EDGE_COLOR_CSS));
    SELECTED_MESH_COLOR.set(getCSSVariableColor(SELECTED_MESH_COLOR_CSS));

    this.setState(old => ({ ...old, lightTheme }));
  };

  private _handleWindowResize = (): void => {
    this.resizeCanvasToDisplaySize();
    this._updateAnnotation();
  };

  render(): JSX.Element {
    return (
      <div
        className="jcad-Mainview"
        style={{
          border: this.state.remoteUser
            ? `solid 3px ${this.state.remoteUser.color}`
            : 'unset'
        }}
      >
        <div
          className={'jpcad-Spinner'}
          style={{ display: this.state.loading ? 'flex' : 'none' }}
        >
          {' '}
          <div className={'jpcad-SpinnerContent'}></div>{' '}
        </div>
        {this.state.remoteUser?.display_name ? (
          <div
            style={{
              position: 'absolute',
              top: 1,
              right: 3,
              background: this.state.remoteUser.color
            }}
          >
            {`Following ${this.state.remoteUser.display_name}`}
          </div>
        ) : null}
        {Object.entries(this.state.annotations).map(([key, annotation]) => {
          if (!this._model.annotationModel) {
            return null;
          }
          const parent = this._meshGroup?.getObjectByName(
            annotation.parent
          ) as BasicMesh;
          const position = new THREE.Vector3(
            annotation.position[0],
            annotation.position[1],
            annotation.position[2]
          );

          // If in exploded view, we explode the annotation position as well
          if (this._explodedView.enabled && parent) {
            const explodedState = this._computeExplodedState(parent);
            const explodeVector = explodedState.vector.multiplyScalar(
              explodedState.distance
            );

            position.add(explodeVector);
          }

          const screenPosition = this._projectVector(position);

          return (
            <div
              key={key}
              id={key}
              style={{
                left: screenPosition.x,
                top: screenPosition.y
              }}
              className={'jcad-Annotation-Wrapper'}
            >
              <FloatingAnnotation
                itemId={key}
                model={this._model.annotationModel}
                open={false}
                // open={annotation.open} // TODO: "open" missing from the IAnnotation interface?
              />
            </div>
          );
        })}

        <div
          ref={this.divRef}
          style={{
            width: '100%',
            height: 'calc(100%)'
          }}
        />
      </div>
    );
  }

  private divRef = React.createRef<HTMLDivElement>(); // Reference of render div

  private _model: IJupyterCadModel;
  private _worker: IJCadWorker;

  private _pointer: THREE.Vector2;
  private _syncPointer: (
    position: THREE.Vector3 | undefined,
    parent: string | undefined
  ) => void;
  private _selectedMeshes: BasicMesh[] = [];

  private _meshGroup: THREE.Group | null = null; // The list of ThreeJS meshes

  private _boundingGroup = new THREE.Box3();

  // TODO Make this a shared property
  private _explodedView: ExplodedView = { enabled: false, factor: 0 };
  private _explodedViewLinesHelperGroup: THREE.Group | null = null; // The list of line helpers for the exploded view
  private _cameraSettings: CameraSettings = { type: 'Perspective' };
  private _clipSettings: ClipSettings = { enabled: false, showClipPlane: true };
  private _clippingPlaneMeshControl: THREE.Mesh; // Plane mesh using for controlling the clip plane in the UI
  private _clippingPlaneMesh: THREE.Mesh | null = null; // Plane mesh used for "filling the gaps"
  private _clippingPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0); // Mathematical object for clipping computation
  private _clippingPlanes = [this._clippingPlane];
  private _edgeMaterials: any[] = [];

  private _scene: THREE.Scene; // Threejs scene
  private _camera: THREE.PerspectiveCamera | THREE.OrthographicCamera; // Threejs camera
  private _cameraLight: THREE.PointLight;
  private _raycaster = new THREE.Raycaster();
  private _renderer: THREE.WebGLRenderer; // Threejs render
  private _requestID: any = null; // ID of window.requestAnimationFrame
  private _geometry: THREE.BufferGeometry; // Threejs BufferGeometry
  private _refLength: number | null = null; // Length of bounding box of current object
  private _sceneAxe: THREE.Object3D | null; // Array of  X, Y and Z axe
  private _controls: OrbitControls; // Mouse controls
  private _transformControls: TransformControls; // Mesh position/rotation controls
  private _pointer3D: IPointer | null = null;
  private _collaboratorPointers: IDict<IPointer>;
  private _pointerGeometry: THREE.SphereGeometry;
  private _contextMenu: ContextMenu;
  private _postWorkerId: Map<string, IJCadWorker> = new Map();
  private _firstRender = true;
}

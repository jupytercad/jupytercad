import { MapChange } from '@jupyter/ydoc';
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
import { v4 as uuid } from 'uuid';

import {
  AxeHelper,
  CameraSettings,
  ExplodedView,
  IAnnotation,
  IDict,
  IDisplayShape,
  IJcadObjectDocChange,
  IJupyterCadClientState,
  IJupyterCadDoc,
  IJupyterCadModel,
  IMainMessage,
  IWorkerMessage,
  MainAction,
  WorkerAction
} from './types';
import { FloatingAnnotation } from './annotation/view';
import { getCSSVariableColor, throttle } from './tools';

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

export type BasicMesh = THREE.Mesh<
  THREE.BufferGeometry,
  THREE.MeshBasicMaterial
>;

interface IProps {
  view: ObservableMap<JSONValue>;
  jcadModel: IJupyterCadModel;
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

    const lightTheme =
      document.body.getAttribute('data-jp-theme-light') === 'true';

    this.state = {
      id: uuid(),
      lightTheme,
      loading: true,
      annotations: {},
      firstLoad: true
    };

    this._model = this.props.jcadModel;
    this._worker = this._model.getWorker();

    this._pointer = new THREE.Vector2();
    this._collaboratorPointers = {};
    this._messageChannel = new MessageChannel();
    this._messageChannel.port1.onmessage = msgEvent => {
      this.messageHandler(msgEvent.data);
    };
    this._postMessage(
      { action: WorkerAction.REGISTER, payload: { id: this.state.id } },
      this._messageChannel.port2
    );
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

    if (this._raycaster.params.Line) {
      this._raycaster.params.Line.threshold = 0.1;
    }
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

      this._camera = new THREE.PerspectiveCamera(45, 2, 0.1, 1000);
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

      this._transformControls = new TransformControls(
        this._camera,
        this._renderer.domElement
      );
      this._transformControls.addEventListener('dragging-changed', event => {
        this._transforming = event.value;
        this._controls.enabled = !event.value;

        if (this._transforming && this._pointer3D) {
          this._pointer3D.mesh.visible = false;
        }
      });
      this._scene.add(this._transformControls);
      this._transformControls.addEventListener('objectChange', function () {
        console.log('object changed!');
      });
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
        if (!intersect.object.visible || !intersect.object.parent?.visible) {
          continue;
        }

        return {
          mesh: intersect.object as BasicMesh,
          position: intersect.point
        };
      }
    }

    return null;
  }

  startAnimationLoop = (): void => {
    this._requestID = window.requestAnimationFrame(this.startAnimationLoop);

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
    this.startAnimationLoop();
    this.resizeCanvasToDisplaySize();
  };

  messageHandler = (msg: IMainMessage): void => {
    switch (msg.action) {
      case MainAction.DISPLAY_SHAPE: {
        this._saveMeta(msg.payload);
        this._shapeToMesh(msg.payload);
        break;
      }
      case MainAction.INITIALIZED: {
        if (!this._model) {
          return;
        }
        this._postMessage({
          action: WorkerAction.LOAD_FILE,
          payload: {
            content: this._model.getContent()
          }
        });
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
    if (this._transforming) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

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

      this._syncPointer(picked.position, picked.mesh.name);
    } else {
      if (this._pointer3D) {
        this._pointer3D.mesh.visible = false;
      }
      this._syncPointer(undefined, undefined);
    }
  }

  private _onClick(e: MouseEvent) {
    if (this._transforming) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const selection = this._pick();
    const selectedMeshesNames = new Set(
      this._selectedMeshes.map(sel => sel.name)
    );

    if (selection) {
      // TODO Support selecting edges?
      let selectionName = '';
      if (selection.mesh.name.startsWith('edge')) {
        selectionName = (selection.mesh.parent as BasicMesh).name;
      } else {
        selectionName = selection.mesh.name;
      }

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
      this._updateSelected(names);
      this._model.syncSelectedObject(names, this.state.id);
    }
  }
  private _saveMeta = (payload: IDisplayShape['payload']) => {
    if (!this._model) {
      return;
    }
    Object.entries(payload).forEach(([objName, data]) => {
      this._model.sharedModel.setShapeMeta(objName, data.meta);
    });
  };
  private _shapeToMesh = (payload: IDisplayShape['payload']) => {
    console.log('shapetomesh!');
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

      // Get the old center of the object and center its vertices to the scene
      const center = new THREE.Vector3();
      geometry.boundingBox?.getCenter(center);
      geometry.center();

      if (vertices.length > 0) {
        geometry.computeBoundsTree();
      }

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = objName;
      mesh.visible = visible;
      mesh.position.copy(center);

      if (visible) {
        this._boundingGroup.expandByObject(mesh);
      }

      if (selectedNames.includes(objName)) {
        this._selectedMeshes.push(mesh);
        mesh.material.color = SELECTED_MESH_COLOR;
      }

      const edgeMaterial = new THREE.LineBasicMaterial({
        linewidth: 5,
        color: DEFAULT_EDGE_COLOR
      });
      edgeList.forEach(edge => {
        const edgeVertices = new THREE.Float32BufferAttribute(
          edge.vertexCoord,
          3
        );
        const edgeGeometry = new THREE.BufferGeometry();
        edgeGeometry.setAttribute('position', edgeVertices);
        const edgeCenter = new THREE.Vector3();
        edgeGeometry.computeBoundingBox();
        edgeGeometry.boundingBox?.getCenter(edgeCenter);
        edgeGeometry.center();

        const edgePosition = new THREE.Vector3();
        edgePosition.copy(center);
        edgePosition.multiplyScalar(-1);
        edgePosition.add(edgeCenter);

        const edgesMesh = new THREE.Line(edgeGeometry, edgeMaterial);
        edgesMesh.name = 'edge';
        edgesMesh.position.copy(edgePosition);

        mesh.add(edgesMesh);
      });
      if (this._meshGroup) {
        this._meshGroup.add(mesh);
      }
    });
    if (guidata) {
      this._model.sharedModel?.setOption('guidata', guidata);
    }
    // Update the reflength
    if (this._refLength === null && this._meshGroup.children.length) {
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
    }

    // Reset reflength if there are no objects
    if (!this._meshGroup.children.length) {
      this._refLength = null;
    }

    // Set the expoded view if it's enabled
    this._setupExplodedView();

    this._scene.add(this._meshGroup);
    this.setState(old => ({ ...old, loading: false }));
  };

  private _postMessage = (
    msg: Omit<IWorkerMessage, 'id'>,
    port?: MessagePort
  ) => {
    if (this._worker) {
      const newMsg = { ...msg, id: this.state.id };
      if (port) {
        this._worker.postMessage(newMsg, [port]);
      } else {
        this._worker.postMessage(newMsg);
      }
    }
  };

  private _updatePointers(refLength): void {
    this._pointerGeometry = new THREE.SphereGeometry(refLength / 10, 32, 32);

    for (const clientId in this._collaboratorPointers) {
      this._collaboratorPointers[clientId].mesh.geometry =
        this._pointerGeometry;
    }
  }

  private _createPointer(user: User.IIdentity): BasicMesh {
    let clientColor: Color.RGBColor | null = null;

    if (user.color?.startsWith('var')) {
      clientColor = Color.color(
        getComputedStyle(document.documentElement).getPropertyValue(
          user.color.slice(4, -1)
        )
      ) as Color.RGBColor;
    } else {
      clientColor = Color.color(user.color) as Color.RGBColor;
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

  private _updateSelected(names: string[]) {
    this._transformControls.detach();

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

      selectedMesh.material.color = originalColor;
    }

    // Set new selection
    this._selectedMeshes = [];
    for (const name of names) {
      const selected = this._meshGroup?.getObjectByName(name) as
        | BasicMesh
        | undefined;
      if (!selected) {
        continue;
      }

      this._selectedMeshes.push(selected);
      selected.material.color = SELECTED_MESH_COLOR;
    }

    if (this._selectedMeshes.length === 1) {
      this._transformControls.attach(this._selectedMeshes[0]);
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
      if (Array.isArray(remoteState.selected.value)) {
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

      if (localState?.selected && Array.isArray(localState.selected.value)) {
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

  private _onSharedObjectsChanged(
    _: IJupyterCadDoc,
    change: IJcadObjectDocChange
  ): void {
    if (change.objectChange) {
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
            obj.visible = objGuiData['visibility'];

            if (explodedLineHelper) {
              explodedLineHelper.visible = objGuiData['visibility'];
            }
          }
        }
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
  }

  private _setupExplodedView() {
    // if (this._explodedView.enabled) {
    //   const center = new THREE.Vector3();
    //   this._boundingGroup.getCenter(center);
    //   this._explodedViewLinesHelperGroup?.removeFromParent();
    //   this._explodedViewLinesHelperGroup = new THREE.Group();
    //   for (const mesh of this._meshGroup?.children as BasicMesh[]) {
    //     const explodedState = this._computeExplodedState(mesh);
    //     mesh.position.set(0, 0, 0);
    //     mesh.translateOnAxis(explodedState.vector, explodedState.distance);
    // // Draw lines
    // const material = new THREE.LineBasicMaterial({
    //   color: DEFAULT_EDGE_COLOR,
    //   linewidth: 2
    // });
    // const geometry = new THREE.BufferGeometry().setFromPoints([
    //   explodedState.oldGeometryCenter,
    //   explodedState.newGeometryCenter
    // ]);
    // const line = new THREE.Line(geometry, material);
    // line.name = mesh.name;
    // line.visible = mesh.visible;
    //     this._explodedViewLinesHelperGroup.add(line);
    //   }
    //   this._scene.add(this._explodedViewLinesHelperGroup);
    // } else {
    //   // Exploded view is disabled, we reset the initial positions
    //   for (const mesh of this._meshGroup?.children as BasicMesh[]) {
    //     mesh.position.set(0, 0, 0);
    //   }
    //   this._explodedViewLinesHelperGroup?.removeFromParent();
    // }
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
  private _worker?: Worker = undefined;
  private _messageChannel?: MessageChannel;

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

  private _scene: THREE.Scene; // Threejs scene
  private _camera: THREE.PerspectiveCamera | THREE.OrthographicCamera; // Threejs camera
  private _cameraLight: THREE.PointLight;
  private _raycaster = new THREE.Raycaster();
  private _renderer: THREE.WebGLRenderer; // Threejs render
  private _requestID: any = null; // ID of window.requestAnimationFrame
  private _geometry: THREE.BufferGeometry; // Threejs BufferGeometry
  private _refLength: number | null = null; // Length of bounding box of current object
  private _sceneAxe: THREE.Object3D | null; // Array of  X, Y and Z axe
  private _controls: OrbitControls; // Threejs orbit control
  private _transformControls: TransformControls; // Threejs transform control
  private _transforming = false;
  private _pointer3D: IPointer | null = null;
  private _collaboratorPointers: IDict<IPointer>;
  private _pointerGeometry: THREE.SphereGeometry;
  private _contextMenu: ContextMenu;
}

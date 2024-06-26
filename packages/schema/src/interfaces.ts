import {
  DocumentChange,
  MapChange,
  StateChange,
  YDocument
} from '@jupyter/ydoc';
import { IWidgetTracker } from '@jupyterlab/apputils';
import { IChangedArgs } from '@jupyterlab/coreutils';
import { DocumentRegistry, IDocumentWidget } from '@jupyterlab/docregistry';
import { User } from '@jupyterlab/services';
import { ReactWidget } from '@jupyterlab/ui-components';
import { JSONObject } from '@lumino/coreutils';
import { ISignal, Signal } from '@lumino/signaling';

import {
  IJCadContent,
  IJCadModel,
  IJCadObject,
  IJCadOptions
} from './_interface/jcad';

export interface IDict<T = any> {
  [key: string]: T;
}

/**
 * Position and orientation of the user Camera
 */
export type Camera = {
  position: number[];
  rotation: number[];
  up: number[];
};

export interface IAnnotationModel {
  updateSignal: ISignal<this, null>;
  user: User.IIdentity | undefined;

  context: DocumentRegistry.IContext<IJupyterCadModel> | undefined;
  contextChanged: ISignal<this, void>;

  update(): void;

  getAnnotation(id: string): IAnnotation | undefined;

  getAnnotationIds(): string[];

  addAnnotation(key: string, value: IAnnotation): void;

  removeAnnotation(key): void;

  addContent(id: string, value: string): void;
}

export interface IJcadObjectDocChange {
  objectChange?: Array<{
    name: string;
    key: keyof IJCadObject;
    newValue: IJCadObject | undefined;
  }>;
}

export interface ISelection {
  type: 'shape' | 'edge';
  edgeIndex?: number;
  parent?: string;
}

export interface IJupyterCadClientState {
  pointer: { value?: Pointer; emitter?: string | null };
  camera: { value?: Camera; emitter?: string | null };
  selected: { value?: { [key: string]: ISelection }; emitter?: string | null };
  selectedPropField?: {
    id: string | null;
    value: any;
    parentType: 'panel' | 'dialog';
  };
  user: User.IIdentity;
  remoteUser?: number;
  toolbarForm?: IDict;
}

export interface IJupyterCadDoc extends YDocument<IJupyterCadDocChange> {
  objects: Array<IJCadObject>;
  options: JSONObject;
  metadata: JSONObject;
  outputs: JSONObject;

  readonly editable: boolean;
  readonly toJcadEndpoint?: string;

  objectExists(name: string): boolean;
  getObjectByName(name: string): IJCadObject | undefined;
  removeObjects(names: string[]): void;
  removeObjectByName(name: string): void;
  addObject(value: IJCadObject): void;
  addObjects(value: Array<IJCadObject>): void;
  updateObjectByName(name: string, key: string, value: any): void;
  getDependants(name: string): string[];

  getOption(key: keyof IJCadOptions): IDict | undefined;
  setOption(key: keyof IJCadOptions, value: IDict): void;
  setOptions(options: IJCadOptions): void;

  getOutput(key: string): IPostResult | undefined;
  setOutput(key: string, value: IPostResult): void;
  removeOutput(key: string): void;

  getMetadata(key: string): string | undefined;
  setMetadata(key: string, value: string): void;
  removeMetadata(key: string): void;

  setShapeMeta(key: string, meta?: IDict): void;

  metadataChanged: ISignal<IJupyterCadDoc, MapChange>;
  optionsChanged: ISignal<IJupyterCadDoc, MapChange>;
  objectsChanged: ISignal<IJupyterCadDoc, IJcadObjectDocChange>;
}

export interface IJupyterCadDocChange extends DocumentChange {
  contextChange?: MapChange;
  contentChange?: MapChange;
  objectChange?: Array<{
    name: string;
    key: string;
    newValue: IJCadObject | undefined;
  }>;
  optionChange?: MapChange;
  stateChange?: StateChange<any>[];
}

export interface IJupyterCadModel extends DocumentRegistry.IModel {
  isDisposed: boolean;
  sharedModel: IJupyterCadDoc;
  annotationModel?: IAnnotationModel;
  localState: IJupyterCadClientState | null;

  themeChanged: Signal<
    IJupyterCadModel,
    IChangedArgs<string, string | null, string>
  >;
  clientStateChanged: ISignal<
    IJupyterCadModel,
    Map<number, IJupyterCadClientState>
  >;
  sharedMetadataChanged: ISignal<IJupyterCadDoc, MapChange>;
  sharedOptionsChanged: ISignal<IJupyterCadDoc, MapChange>;
  sharedObjectsChanged: ISignal<IJupyterCadDoc, IJcadObjectDocChange>;

  getWorker(): Worker;
  getContent(): IJCadContent;
  getAllObject(): IJCadModel;

  syncPointer(position: Pointer | undefined, emitter?: string): void;
  syncCamera(camera: Camera | undefined, emitter?: string): void;
  syncSelected(value: { [key: string]: ISelection }, emitter?: string): void;
  syncSelectedPropField(data: {
    id: string | null;
    value: any;
    parentType: 'panel' | 'dialog';
  });
  setUserToFollow(userId?: number): void;
  syncFormData(form: any): void;

  getClientId(): number;

  addMetadata(key: string, value: string): void;
  removeMetadata(key: string): void;

  disposed: ISignal<any, void>;
}

export interface IUserData {
  userId: number;
  userData: User.IIdentity;
}

/**
 * User pointer in the 3D environment
 */
export type Pointer = {
  parent: string;
  x: number;
  y: number;
  z: number;
};

export interface IAnnotationContent {
  user?: User.IIdentity;
  value: string;
}

export interface IAnnotation {
  label: string;
  position: [number, number, number];
  contents: IAnnotationContent[];
  parent: string;
}

export interface IFace {
  vertexCoord: Array<number>;
  triIndexes: Array<number>;
  numberOfTriangles: number;
}

export interface IEdge {
  vertexCoord: number[];
  numberOfCoords: number;
}
export interface IParsedShape {
  jcObject: IJCadObject;
  faceList: Array<IFace>;
  edgeList: Array<IEdge>;
  isSolid: boolean;
  meta?: IDict;
  guiData?: IDict;
}

export interface IPostOperatorInput {
  jcObject: IJCadObject;
  postShape?: string | ArrayBuffer;
}

/**
 * Action definitions for worker
 */
export enum WorkerAction {
  DRY_RUN = 'DRY_RUN',
  LOAD_FILE = 'LOAD_FILE',
  SAVE_FILE = 'SAVE_FILE',
  REGISTER = 'REGISTER',
  POSTPROCESS = 'POSTPROCESS'
}

/**
 * Action definitions for main thread
 */
export enum MainAction {
  DISPLAY_SHAPE = 'DISPLAY_SHAPE',
  INITIALIZED = 'INITIALIZED',
  DISPLAY_POST = 'DISPLAY_POST',
  DRY_RUN_RESPONSE = 'DRY_RUN_RESPONSE'
}

export interface IMainMessageBase {
  action: MainAction;
  payload: any;
}

export interface IDisplayShape extends IMainMessageBase {
  action: MainAction.DISPLAY_SHAPE;
  payload: {
    result: IDict<IParsedShape>;
    postResult: IDict<IPostOperatorInput>;
  };
}

export interface IDryRunResponsePayload {
  id: string;
  status: 'ok' | 'error';
  message?: string;
}

export interface IDryRunResponse extends IMainMessageBase {
  action: MainAction.DRY_RUN_RESPONSE;
  payload: IDryRunResponsePayload;
}

export interface IWorkerInitialized extends IMainMessageBase {
  action: MainAction.INITIALIZED;
  payload: boolean;
}

export interface IPostResult {
  format: 'STL'; // Supported format, for now only STL is supported.
  value: any;
  binary: boolean;
}
export interface IDisplayPost extends IMainMessageBase {
  action: MainAction.DISPLAY_POST;
  payload: {
    jcObject: IJCadObject;
    postResult: IPostResult;
  }[];
}

export type IMainMessage =
  | IDisplayShape
  | IWorkerInitialized
  | IDisplayPost
  | IDryRunResponse;

export interface IWorkerMessageBase {
  id: string;
  action: WorkerAction;
  payload: any;
}
export type IMessageHandler =
  | ((msg: IMainMessageBase) => void)
  | ((msg: IMainMessageBase) => Promise<void>);

export enum JCadWorkerSupportedFormat {
  BREP = 'BREP',
  GLTF = 'GLTF'
}
export interface IJCadWorker {
  ready: Promise<void>;
  shapeFormat?: JCadWorkerSupportedFormat;
  postMessage(msg: IWorkerMessageBase): void;
  register(options: { messageHandler: IMessageHandler; thisArg?: any }): string;
  unregister(id: string): void;
}

export interface IJCadWorkerRegistry {
  /**
   *
   *
   * @param {string} workerId
   * @param {IJCadWorker} worker
   */
  registerWorker(workerId: string, worker: IJCadWorker): void;

  /**
   *
   *
   * @param {string} workerId
   */
  unregisterWorker(workerId: string): void;

  /**
   *
   *
   * @param {string} workerId
   * @return {*}  {(IJCadWorker | undefined)}
   */
  getWorker(workerId: string): IJCadWorker | undefined;
  /**
   *
   *
   * @param {string} workerId
   * @return {*}  {(IJCadWorker | undefined)}
   */
  getDefaultWorker(): IJCadWorker;

  /**
   *
   *
   * @return {*}  {IJCadWorker[]}
   */
  getAllWorkers(): IJCadWorker[];
}

export type IJupyterCadWidget = IDocumentWidget<ReactWidget, IJupyterCadModel>;

export type IJupyterCadTracker = IWidgetTracker<IJupyterCadWidget>;

export interface IJCadFormSchemaRegistry {
  /**
   *
   *
   * @return {*}  {IDict}
   * @memberof IJCadFormSchemaRegistry
   */
  getSchemas(): Map<string, IDict>;

  /**
   *
   *
   * @param {string} name
   * @param {IDict} schema
   * @memberof IJCadFormSchemaRegistry
   */
  registerSchema(name: string, schema: IDict): void;

  /**
   *
   *
   * @param {string} name
   * @return {*}  {boolean}
   * @memberof IJCadFormSchemaRegistry
   */
  has(name: string): boolean;
}

export interface IJCadExternalCommand {
  name: string;
  id: string;
  label?: string;
}

export interface IJCadExternalCommandRegistry {
  getCommands(): IJCadExternalCommand[];
  registerCommand(command: IJCadExternalCommand): void;
}

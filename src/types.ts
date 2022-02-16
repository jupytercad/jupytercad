import * as Y from 'yjs';

import { IChangedArgs } from '@jupyterlab/coreutils';
import { DocumentRegistry, IDocumentWidget } from '@jupyterlab/docregistry';
import { IObservableMap, ObservableMap } from '@jupyterlab/observables';
import { MapChange, YDocument } from '@jupyterlab/shared-models';
import { ReactWidget } from '@jupyterlab/ui-components';
import { ISignal, Signal } from '@lumino/signaling';

import { IJupyterCadTracker } from './token';

export interface IDict<T = any> {
  [key: string]: T;
}

export type ValueOf<T> = T[keyof T];

/**
 * Action definitions for worker
 */
export enum WorkerAction {
  LOAD_FILE = 'LOAD_FILE',
  SAVE_FILE = 'SAVE_FILE',
  CLOSE_FILE = 'CLOSE_FILE',
  REGISTER = 'REGISTER'
}

interface IMainId {
  id: string;
}

export interface IRegister extends IMainId {
  action: WorkerAction.REGISTER;
  payload: {
    id: string;
  };
}

export interface ILoadFile extends IMainId {
  action: WorkerAction.LOAD_FILE;
  payload: {
    fileName: string;
    content: IJCadContent;
  };
}

export interface ICloseFile extends IMainId {
  action: WorkerAction.CLOSE_FILE;
  payload: {
    fileName: string;
  };
}

export type IWorkerMessage = ILoadFile | IRegister | ICloseFile;

/**
 * Action definitions for main thread
 */
export enum MainAction {
  DISPLAY_SHAPE = 'DISPLAY_SHAPE',
  INITIALIZED = 'INITIALIZED'
}

export interface IDisplayShape {
  action: MainAction.DISPLAY_SHAPE;
  payload: {
    edgeList: any;
    faceList: any;
  };
}
export interface IWorkerInitialized {
  action: MainAction.INITIALIZED;
  payload: boolean;
}

export type IMainMessage = IDisplayShape | IWorkerInitialized;

export type Position = {
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  z: number;
};

export enum PrimitiveShapes {
  BOX = 'Box',
  SPHERE = 'Sphere'
}

export interface IJcadObjectDocChange {
  contextChange?: MapChange;
  objectChange?: MapChange;
}

// export interface IJcadObjectDoc extends Y.Map<any> {
//   getObject(): IJcadObject;
//   getProperty(key: keyof IJcadObject): ValueOf<IJcadObject> | undefined;
//   setProperty(key: keyof IJcadObject, value: ValueOf<IJcadObject>): void;
//   changed: ISignal<IJcadObjectDoc, IJcadObjectDocChange>;
// }

export interface IJupyterCadDocChange {
  contextChange?: MapChange;
  contentChange?: MapChange;
  objectChange?: Array<{
    name: string;
    oldValue: any;
    newValue: any;
  }>;
  optionChange?: MapChange;
}
export type IJcadObjectDoc = Y.Map<any>;
export interface IJupyterCadDoc extends YDocument<IJupyterCadDocChange> {
  objects: Y.Map<IJcadObjectDoc>;
  options: Y.Map<any>;
  getObjectById(key: string): IJcadObjectDoc | undefined;
  setObject(key: string, value: IJcadObjectDoc): void;
  getOption(key: string): any;
  setOption(key: string, value: any): void;
}

export interface IJupyterCadModel extends DocumentRegistry.IModel {
  isDisposed: boolean;
  sharedModelChanged: ISignal<IJupyterCadModel, IJupyterCadDocChange>;
  themeChanged: Signal<
    IJupyterCadModel,
    IChangedArgs<string, string | null, string>
  >;
  cameraChanged: ISignal<IJupyterCadModel, Map<number, any>>;
  sharedModel: IJupyterCadDoc;
  getWorker(): Worker;
  getContent(): IJCadContent;
  getAllObject(): IJcadModel;
  syncCamera(pos: Position | undefined): void;
  getClientId(): number;
}

export interface IJcadObject {
  id: string;
  shape: PrimitiveShapes;
  parameters: IDict;
  visible: boolean;
  operator?: Array<IDict>;
  dependencies?: Array<string>;
}

export interface IJcadModel {
  [key: string]: IJcadObject;
}

export interface IJCadContent {
  id?: number;
  objects: IJcadModel;
  options?: IDict;
}

export interface IControlPanelState {
  activatedObject: string;
}

export type IStateValue = string | number;
export type ISateChangedSignal = ISignal<
  ObservableMap<IStateValue>,
  IObservableMap.IChangedArgs<IStateValue>
>;

export type IJupyterCadWidget = IDocumentWidget<ReactWidget, IJupyterCadModel>;
export interface IControlPanelModel {
  state: ObservableMap<IStateValue>;
  stateChanged: ISateChangedSignal;
  set(key: keyof IControlPanelState, value: IStateValue): void;
  get(key: keyof IControlPanelState): IStateValue | undefined;
  has(key: keyof IControlPanelState): boolean;
  disconnect(f: any): void;
  documentChanged: ISignal<IJupyterCadTracker, IJupyterCadWidget | null>;
  filePath: string | undefined;
  jcadModel: IJupyterCadModel | undefined;
  sharedModel: IJupyterCadDoc | undefined;
}

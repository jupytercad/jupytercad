import { IWorkerMessage } from '@jupytercad/occ-worker';
import {
  IAnnotation,
  IDisplayShape,
  IJcadObjectDocChange,
  IJCadWorker,
  IJCadWorkerRegistry,
  IJupyterCadDoc,
  IJupyterCadModel,
  IMainMessage,
  MainAction,
  WorkerAction
} from '@jupytercad/schema';
import { ObservableMap } from '@jupyterlab/observables';
import { JSONValue } from '@lumino/coreutils';
import { IDisposable } from '@lumino/disposable';
import { ISignal, Signal } from '@lumino/signaling';
import { v4 as uuid } from 'uuid';

export class MainViewModel implements IDisposable {
  constructor(options: MainViewModel.IOptions) {
    this._jcadModel = options.jcadModel;
    this._viewSetting = options.viewSetting;
    this._workerRegistry = options.workerRegistry;
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  get id(): string {
    return this._id;
  }
  get renderSignal(): ISignal<this, { shapes: any; postShapes: any }> {
    return this._renderSignal;
  }
  get jcadModel() {
    return this._jcadModel;
  }

  get viewSettingChanged() {
    return this._viewSetting.changed;
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._jcadModel.sharedObjectsChanged.disconnect(
      this._onSharedObjectsChanged,
      this
    );
    this._isDisposed = true;
  }

  initSignal(): void {
    this._jcadModel.sharedObjectsChanged.connect(
      this._onSharedObjectsChanged,
      this
    );
  }
  initWorker(): void {
    this._worker = this._workerRegistry.getDefaultWorker();
    this._id = this._worker.register({
      messageHandler: this.messageHandler.bind(this)
    });
    this._workerRegistry.getAllWorkers().forEach(wk => {
      const id = wk.register({
        messageHandler: this.postProcessWorkerHandler.bind(this)
      });
      this._postWorkerId.set(id, wk);
    });
  }

  messageHandler = (msg: IMainMessage): void => {
    switch (msg.action) {
      case MainAction.DISPLAY_SHAPE: {
        const { result, postResult } = msg.payload;
        this._saveMeta(result);

        if (this._firstRender) {
          const postShapes = this._jcadModel.sharedModel.outputs;
          this._renderSignal.emit({ shapes: result, postShapes });
          this._firstRender = false;
        } else {
          this._renderSignal.emit({ shapes: result, postShapes: null });
          this._postWorkerId.forEach((wk, id) => {
            wk.postMessage({
              id,
              action: WorkerAction.POSTPROCESS,
              payload: postResult
            });
          });
        }

        break;
      }
      case MainAction.INITIALIZED: {
        if (!this._jcadModel) {
          return;
        }
        const content = this._jcadModel.getContent();

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
        const postShapes: any = {};
        msg.payload.forEach(element => {
          const { jcObject, postResult } = element;
          this._jcadModel.sharedModel.setOutput(jcObject.name, postResult);
          postShapes[jcObject.name] = postResult;
        });
        this._renderSignal.emit({ shapes: null, postShapes });
        break;
      }
    }
  };

  addAnnotation(value: IAnnotation): void {
    this._jcadModel.annotationModel?.addAnnotation(uuid(), value);
  }

  private _postMessage = (msg: Omit<IWorkerMessage, 'id'>) => {
    if (this._worker) {
      const newMsg = { ...msg, id: this._id };
      this._worker.postMessage(newMsg);
    }
  };

  private _saveMeta = (payload: IDisplayShape['payload']['result']) => {
    if (!this._jcadModel) {
      return;
    }
    Object.entries(payload).forEach(([objName, data]) => {
      this._jcadModel.sharedModel.setShapeMeta(objName, data.meta);
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
          content: this._jcadModel.getContent()
        }
      });
    }
  }

  private _jcadModel: IJupyterCadModel;
  private _viewSetting: ObservableMap<JSONValue>;
  private _workerRegistry: IJCadWorkerRegistry;
  private _worker: IJCadWorker;
  private _postWorkerId: Map<string, IJCadWorker> = new Map();
  private _firstRender = true;
  private _id: string;
  private _renderSignal = new Signal<this, { shapes: any; postShapes: any }>(
    this
  );
  private _isDisposed = false;
}

export namespace MainViewModel {
  export interface IOptions {
    jcadModel: IJupyterCadModel;
    viewSetting: ObservableMap<JSONValue>;
    workerRegistry: IJCadWorkerRegistry;
  }
}

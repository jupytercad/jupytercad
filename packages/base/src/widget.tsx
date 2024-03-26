import { IJupyterCadModel } from '@jupytercad/schema';
import { ReactWidget } from '@jupyterlab/apputils';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { IObservableMap, ObservableMap } from '@jupyterlab/observables';
import { JSONValue } from '@lumino/coreutils';
import { ISignal, Signal } from '@lumino/signaling';
import * as React from 'react';

import { MainView } from './mainview';
import {
  AxeHelper,
  CameraSettings,
  ExplodedView,
  ClipSettings,
  SplitScreenSettings
} from './types';
import { IJCadWorkerRegistry, IJupyterCadWidget } from '@jupytercad/schema';

export class JupyterCadWidget
  extends DocumentWidget<JupyterCadPanel, IJupyterCadModel>
  implements IJupyterCadWidget
{
  constructor(
    options: DocumentWidget.IOptions<JupyterCadPanel, IJupyterCadModel>
  ) {
    super(options);
  }

  /**
   * Dispose of the resources held by the widget.
   */
  dispose(): void {
    this.content.dispose();
    super.dispose();
  }

  onResize = (msg: any): void => {
    window.dispatchEvent(new Event('resize'));
  };
}

export class JupyterCadPanel extends ReactWidget {
  /**
   * Construct a `ExamplePanel`.
   *
   * @param context - The documents context.
   */
  constructor(options: {
    model: IJupyterCadModel;
    workerRegistry: IJCadWorkerRegistry;
  }) {
    super();
    this.addClass('jp-jupytercad-panel');
    this._jcadModel = options.model;
    this._workerRegistry = options.workerRegistry;
    this._view = new ObservableMap<JSONValue>();
  }

  get viewChanged(): ISignal<
    ObservableMap<JSONValue>,
    IObservableMap.IChangedArgs<JSONValue>
  > {
    return this._view.changed;
  }

  /**
   * Dispose of the resources held by the widget.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    Signal.clearData(this);
    super.dispose();
  }

  get axes(): AxeHelper | undefined {
    return this._view.get('axes') as AxeHelper | undefined;
  }

  set axes(value: AxeHelper | undefined) {
    this._view.set('axes', value || null);
  }

  get explodedView(): ExplodedView | undefined {
    return this._view.get('explodedView') as ExplodedView | undefined;
  }

  set explodedView(value: ExplodedView | undefined) {
    this._view.set('explodedView', value || null);
  }

  get cameraSettings(): CameraSettings | undefined {
    return this._view.get('cameraSettings') as CameraSettings | undefined;
  }

  set cameraSettings(value: CameraSettings | undefined) {
    this._view.set('cameraSettings', value || null);
  }

  get clipView(): ClipSettings | undefined {
    return this._view.get('clipView') as ClipSettings | undefined;
  }

  set clipView(value: ClipSettings | undefined) {
    this._view.set('clipView', value || null);
  }

  get splitScreen(): SplitScreenSettings | undefined {
    return (this._view.get('splitScreen') ?? {
      enabled: false
    }) as SplitScreenSettings;
  }

  set splitScreen(value: SplitScreenSettings | undefined) {
    this._view.set('splitScreen', value || null);
  }

  deleteAxes(): void {
    this._view.delete('axes');
  }

  render(): JSX.Element {
    return (
      <MainView
        view={this._view}
        jcadModel={this._jcadModel}
        workerRegistry={this._workerRegistry}
      />
    );
  }

  private _view: ObservableMap<JSONValue>;
  private _workerRegistry: IJCadWorkerRegistry;
  private _jcadModel: IJupyterCadModel;
}

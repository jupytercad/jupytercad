import { IJupyterCadModel } from '@jupytercad/schema';
import { ReactWidget } from '@jupyterlab/apputils';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { IObservableMap, ObservableMap } from '@jupyterlab/observables';
import { JSONValue } from '@lumino/coreutils';
import { ISignal, Signal } from '@lumino/signaling';
import * as React from 'react';

import { MainView } from './3dview';
import { AxeHelper, CameraSettings, ExplodedView, ClipSettings } from './types';
import { IJCadWorkerRegistry, IJupyterCadWidget } from '@jupytercad/schema';
import { MainViewModel } from './3dview/mainviewmodel';

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
    this._view = new ObservableMap<JSONValue>();
    this._mainViewModel = new MainViewModel({
      jcadModel: options.model,
      workerRegistry: options.workerRegistry,
      viewSetting: this._view
    });
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
    this._mainViewModel.dispose();
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

  deleteAxes(): void {
    this._view.delete('axes');
  }

  render(): JSX.Element {
    return <MainView viewModel={this._mainViewModel} />;
  }
  private _mainViewModel: MainViewModel;
  private _view: ObservableMap<JSONValue>;
}

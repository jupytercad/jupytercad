import { ReactWidget } from '@jupyterlab/apputils';
import {
  PanelWithToolbar,
  ToolbarButton,
  addIcon,
  homeIcon
} from '@jupyterlab/ui-components';
import { Panel } from '@lumino/widgets';
import * as React from 'react';
import { SuggestionModel } from './model';
import { Suggestion } from './view';

export class SuggestionPanel extends PanelWithToolbar {
  constructor(params: SuggestionPanel.IOptions) {
    super();
    this.title.label = 'Suggestions';
    const { model } = params;
    this._model = model;
    const body = ReactWidget.create(<Suggestion model={model} />);
    this.addWidget(body);
    this.addClass('jpcad-sidebar-propertiespanel');
    this.toolbar.addItem(
      'backToRoot',
      new ToolbarButton({
        icon: homeIcon,
        onClick: async () => {
          await this._model.backToRoot();
        },
        tooltip: 'Return to root document'
      })
    );
    this.toolbar.addItem(
      'newFork',
      new ToolbarButton({
        icon: addIcon,
        onClick: this.createFork.bind(this),
        tooltip: 'Create new fork'
      })
    );
  }

  async createFork() {
    await this._model.createFork();
  }
  private _model: SuggestionModel;
}

export namespace SuggestionPanel {
  /**
   * Instantiation options for `ObjectProperties`.
   */
  export interface IOptions extends Panel.IOptions {
    model: SuggestionModel;
  }
}

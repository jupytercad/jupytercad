import {
  JupyterCadDoc,
  IJupyterCadTracker,
  IJCadFormSchemaRegistry
} from '@jupytercad/schema';
import { SidePanel } from '@jupyterlab/ui-components';

import { IControlPanelModel } from '../types';

import { ControlPanelHeader } from './header';
import { ObjectTree } from './objecttree';
import { ObjectProperties } from './objectproperties';

export class LeftPanelWidget extends SidePanel {
  constructor(options: LeftPanelWidget.IOptions) {
    super();
    this.addClass('jpcad-sidepanel-widget');
    this._model = options.model;

    const header = new ControlPanelHeader();
    this.header.addWidget(header);

    const tree = new ObjectTree({ controlPanelModel: this._model });
    this.addWidget(tree);

    const properties = new ObjectProperties({
      controlPanelModel: this._model,
      formSchemaRegistry: options.formSchemaRegistry
    });
    this.addWidget(properties);

    this._model.documentChanged.connect((_, changed) => {
      if (changed) {
        if (changed.context.model.sharedModel.editable) {
          header.title.label = changed.context.localPath;
          properties.show();
        } else {
          header.title.label = `${changed.context.localPath} - Read Only`;
          properties.hide();
        }
      } else {
        header.title.label = '-';
      }
    });
  }

  dispose(): void {
    super.dispose();
  }

  private _model: IControlPanelModel;
}

export namespace LeftPanelWidget {
  export interface IOptions {
    model: IControlPanelModel;
    formSchemaRegistry: IJCadFormSchemaRegistry;
    tracker: IJupyterCadTracker;
  }

  export interface IProps {
    filePath?: string;
    sharedModel?: JupyterCadDoc;
  }
}

import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { WidgetTracker } from '@jupyterlab/apputils';
import { ITranslator } from '@jupyterlab/translation';
import { IMainMenu } from '@jupyterlab/mainmenu';

import fcplugin from './fcplugin/plugins';
import jcadPlugin from './jcadplugin/plugins';
import { JupyterCadModel } from './model';
import { ControlPanelModel } from './panelview/model';
import { LeftPanelWidget } from './panelview/leftpanel';
import { RightPanelWidget } from './panelview/rightpanel';
import {
  IJupyterCadDocTracker,
  IJupyterCadTracker,
  IAnnotation
} from './token';
import { jcLightIcon } from './tools';
import { IAnnotationModel } from './types';
import { JupyterCadWidget } from './widget';
import { ToolbarWidget } from './toolbar/widget';
import { AnnotationModel } from './annotation/model';
import { notebookRendererPlugin, ypyWidgetManager } from './notebookrenderer';

const NAME_SPACE = 'jupytercad';

const plugin: JupyterFrontEndPlugin<IJupyterCadTracker> = {
  id: 'jupytercad:plugin',
  autoStart: true,
  requires: [IMainMenu, ITranslator],
  provides: IJupyterCadDocTracker,
  activate: (
    app: JupyterFrontEnd,
    mainMenu: IMainMenu,
    translator: ITranslator
  ): IJupyterCadTracker => {
    const tracker = new WidgetTracker<JupyterCadWidget>({
      namespace: NAME_SPACE
    });
    JupyterCadModel.worker = new Worker(
      new URL('./worker', (import.meta as any).url)
    );

    console.log('JupyterLab extension jupytercad is activated!');

    /**
     * Whether there is an active notebook.
     */
    const isEnabled = (): boolean => {
      return (
        tracker.currentWidget !== null &&
        tracker.currentWidget === app.shell.currentWidget
      );
    };

    addCommands(app, tracker, translator);
    populateMenus(mainMenu, isEnabled);

    return tracker;
  }
};

const annotationPlugin: JupyterFrontEndPlugin<IAnnotationModel> = {
  id: 'jupytercad:annotation',
  autoStart: true,
  requires: [IJupyterCadDocTracker],
  provides: IAnnotation,
  activate: (app: JupyterFrontEnd, tracker: IJupyterCadTracker) => {
    const annotationModel = new AnnotationModel({
      context: tracker.currentWidget?.context
    });

    tracker.currentChanged.connect((_, changed) => {
      annotationModel.context = changed?.context || undefined;
    });
    return annotationModel;
  }
};

const controlPanel: JupyterFrontEndPlugin<void> = {
  id: 'jupytercad:controlpanel',
  autoStart: true,
  requires: [IJupyterCadDocTracker, IAnnotation],
  optional: [ILayoutRestorer],
  activate: (
    app: JupyterFrontEnd,
    tracker: IJupyterCadTracker,
    annotationModel: IAnnotationModel,
    restorer: ILayoutRestorer | null,
  ) => {
    const controlModel = new ControlPanelModel({ tracker });

    const leftControlPanel = new LeftPanelWidget({
      model: controlModel,
      annotationModel,
      tracker
    });
    leftControlPanel.id = 'jupytercad::leftControlPanel';
    leftControlPanel.title.caption = 'JupyterCad Control Panel';
    leftControlPanel.title.icon = jcLightIcon;

    const rightControlPanel = new RightPanelWidget({ model: controlModel });
    rightControlPanel.id = 'jupytercad::rightControlPanel';
    rightControlPanel.title.caption = 'JupyterCad Control Panel';
    rightControlPanel.title.icon = jcLightIcon;

    if (restorer) {
      restorer.add(leftControlPanel, NAME_SPACE);
      restorer.add(rightControlPanel, NAME_SPACE);
    }
    app.shell.add(leftControlPanel, 'left', { rank: 2000 });
    app.shell.add(rightControlPanel, 'right', { rank: 2000 });
  }
};

/**
 * Add the FreeCAD commands to the application's command registry.
 */
function addCommands(
  app: JupyterFrontEnd,
  tracker: WidgetTracker<JupyterCadWidget>,
  translator: ITranslator
): void {
  const trans = translator.load('jupyterlab');
  const { commands } = app;

  commands.addCommand(ToolbarWidget.CommandIDs.redo, {
    label: trans.__('Redo'),
    execute: args => {
      const current = tracker.currentWidget;

      if (current) {
        return current.context.model.sharedModel.redo();
      }
    }
  });

  commands.addCommand(ToolbarWidget.CommandIDs.undo, {
    label: trans.__('Undo'),
    execute: args => {
      const current = tracker.currentWidget;

      if (current) {
        return current.context.model.sharedModel.undo();
      }
    }
  });
}

/**
 * Populates the application menus for the notebook.
 */
function populateMenus(mainMenu: IMainMenu, isEnabled: () => boolean): void {
  // Add undo/redo hooks to the edit menu.
  mainMenu.editMenu.undoers.redo.add({
    id: ToolbarWidget.CommandIDs.redo,
    isEnabled
  });
  mainMenu.editMenu.undoers.undo.add({
    id: ToolbarWidget.CommandIDs.undo,
    isEnabled
  });
}

export default [
  plugin,
  controlPanel,
  fcplugin,
  jcadPlugin,
  annotationPlugin,
  notebookRendererPlugin,
  ypyWidgetManager
];

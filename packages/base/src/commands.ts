import {
  IDict,
  IJCadFormSchemaRegistry,
  IJCadObject,
  IJupyterCadDoc,
  IJupyterCadModel,
  ISelection,
  Parts
} from '@jupytercad/schema';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { showErrorMessage, WidgetTracker } from '@jupyterlab/apputils';
import { ITranslator } from '@jupyterlab/translation';
import { redoIcon, undoIcon } from '@jupyterlab/ui-components';

import { FormDialog } from './formdialog';
import { SketcherDialog } from './sketcher/sketcherdialog';
import {
  axesIcon,
  boxIcon,
  coneIcon,
  cutIcon,
  cylinderIcon,
  explodedViewIcon,
  extrusionIcon,
  intersectionIcon,
  requestAPI,
  sphereIcon,
  torusIcon,
  unionIcon,
  clippingIcon
} from './tools';
import { JupyterCadPanel, JupyterCadWidget } from './widget';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { PathExt } from '@jupyterlab/coreutils';

export function newName(type: string, model: IJupyterCadModel): string {
  const sharedModel = model.sharedModel;

  let n = 1;
  let name = `${type} 1`;
  while (sharedModel.objectExists(name)) {
    name = `${type} ${++n}`;
  }

  return name;
}

export function setVisible(
  sharedModel: IJupyterCadDoc,
  name: string,
  value: boolean
) {
  const guidata = sharedModel.getOption('guidata') || {};

  if (guidata && guidata[name]) {
    guidata[name]['visibility'] = false;
  } else {
    guidata[name] = { visibility: false };
  }

  sharedModel.setOption('guidata', guidata);
}

const PARTS = {
  box: {
    title: 'Box parameters',
    shape: 'Part::Box',
    default: (model: IJupyterCadModel) => {
      return {
        Name: newName('Box', model),
        Length: 1,
        Width: 1,
        Height: 1,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    }
  },
  cylinder: {
    title: 'Cylinder parameters',
    shape: 'Part::Cylinder',
    default: (model: IJupyterCadModel) => {
      return {
        Name: newName('Cylinder', model),
        Radius: 1,
        Height: 1,
        Angle: 360,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    }
  },
  sphere: {
    title: 'Sphere parameters',
    shape: 'Part::Sphere',
    default: (model: IJupyterCadModel) => {
      return {
        Name: newName('Sphere', model),
        Radius: 5,
        Angle1: -90,
        Angle2: 90,
        Angle3: 360,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    }
  },
  cone: {
    title: 'Cone parameters',
    shape: 'Part::Cone',
    default: (model: IJupyterCadModel) => {
      return {
        Name: newName('Cone', model),
        Radius1: 1,
        Radius2: 0.5,
        Height: 1,
        Angle: 360,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    }
  },
  torus: {
    title: 'Torus parameters',
    shape: 'Part::Torus',
    default: (model: IJupyterCadModel) => {
      return {
        Name: newName('Torus', model),
        Radius1: 10,
        Radius2: 2,
        Angle1: -180,
        Angle2: 180,
        Angle3: 360,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    }
  }
};

function getSelectedMeshName(
  selection: { [key: string]: ISelection } | undefined,
  index: number
): string {
  if (selection === undefined) {
    return '';
  }

  const selectedNames = Object.keys(selection);

  if (selectedNames[index]) {
    const selected = selection[selectedNames[index]];

    if (selected.type === 'shape') {
      return selectedNames[index];
    } else {
      return selected.parent as string;
    }
  }

  return '';
}

function getSelectedEdge(
  selection: { [key: string]: ISelection } | undefined
): { shape: string; edgeIndex: number } | undefined {
  if (selection === undefined) {
    return;
  }

  const selectedNames = Object.keys(selection);
  for (const name of selectedNames) {
    if (selection[name].type === 'edge') {
      return {
        shape: selection[name].parent!,
        edgeIndex: selection[name].edgeIndex!
      };
    }
  }
}

const OPERATORS = {
  cut: {
    title: 'Cut parameters',
    shape: 'Part::Cut',
    default: (model: IJupyterCadModel) => {
      const objects = model.getAllObject();
      const selected = model.localState?.selected.value || {};
      const sel0 = getSelectedMeshName(selected, 0);
      const sel1 = getSelectedMeshName(selected, 1);
      return {
        Name: newName('Cut', model),
        Base: sel0 || objects[0].name || '',
        Tool: sel1 || objects[1].name || '',
        Refine: false,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    },
    syncData: (model: IJupyterCadModel) => {
      return (props: IDict) => {
        const { Name, ...parameters } = props;
        const objectModel: IJCadObject = {
          shape: 'Part::Cut',
          parameters,
          visible: true,
          name: Name
        };
        const sharedModel = model.sharedModel;
        if (sharedModel) {
          sharedModel.transact(() => {
            setVisible(sharedModel, parameters['Base'], false);
            setVisible(sharedModel, parameters['Tool'], false);

            if (!sharedModel.objectExists(objectModel.name)) {
              sharedModel.addObject(objectModel);
            } else {
              showErrorMessage(
                'The object already exists',
                'There is an existing object with the same name.'
              );
            }
          });
        }
      };
    }
  },
  extrusion: {
    title: 'Extrusion parameters',
    shape: 'Part::Extrusion',
    default: (model: IJupyterCadModel) => {
      const objects = model.getAllObject();
      const selected = model.localState?.selected.value || {};
      const sel0 = getSelectedMeshName(selected, 0);
      return {
        Name: newName('Extrusion', model),
        Base: [sel0 || objects[0].name || ''],
        Dir: [0, 0, 1],
        LengthFwd: 10,
        LengthRev: 0,
        Solid: false,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    },
    syncData: (model: IJupyterCadModel) => {
      return (props: IDict) => {
        const { Name, ...parameters } = props;
        const objectModel: IJCadObject = {
          shape: 'Part::Extrusion',
          parameters,
          visible: true,
          name: Name
        };
        const sharedModel = model.sharedModel;
        if (sharedModel) {
          setVisible(sharedModel, parameters['Base'], false);

          sharedModel.transact(() => {
            if (!sharedModel.objectExists(objectModel.name)) {
              sharedModel.addObject(objectModel);
            } else {
              showErrorMessage(
                'The object already exists',
                'There is an existing object with the same name.'
              );
            }
          });
        }
      };
    }
  },
  union: {
    title: 'Fuse parameters',
    shape: 'Part::MultiFuse',
    default: (model: IJupyterCadModel) => {
      const objects = model.getAllObject();
      const selected = model.localState?.selected.value || {};
      const sel0 = getSelectedMeshName(selected, 0);
      const sel1 = getSelectedMeshName(selected, 1);
      return {
        Name: newName('Union', model),
        Shapes: [sel0 || objects[0].name || '', sel1 || objects[1].name || ''],
        Refine: false,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    },
    syncData: (model: IJupyterCadModel) => {
      return (props: IDict) => {
        const { Name, ...parameters } = props;
        const objectModel: IJCadObject = {
          shape: 'Part::MultiFuse',
          parameters,
          visible: true,
          name: Name
        };
        const sharedModel = model.sharedModel;
        if (sharedModel) {
          sharedModel.transact(() => {
            parameters['Shapes'].map((shape: string) => {
              setVisible(sharedModel, shape, false);
            });

            if (!sharedModel.objectExists(objectModel.name)) {
              sharedModel.addObject(objectModel);
            } else {
              showErrorMessage(
                'The object already exists',
                'There is an existing object with the same name.'
              );
            }
          });
        }
      };
    }
  },
  intersection: {
    title: 'Intersection parameters',
    shape: 'Part::MultiCommon',
    default: (model: IJupyterCadModel) => {
      const objects = model.getAllObject();
      const selected = model.localState?.selected.value || {};
      const sel0 = getSelectedMeshName(selected, 0);
      const sel1 = getSelectedMeshName(selected, 1);
      return {
        Name: newName('Intersection', model),
        Shapes: [sel0 || objects[0].name || '', sel1 || objects[1].name || ''],
        Refine: false,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    },
    syncData: (model: IJupyterCadModel) => {
      return (props: IDict) => {
        const { Name, ...parameters } = props;
        const objectModel: IJCadObject = {
          shape: 'Part::MultiCommon',
          parameters,
          visible: true,
          name: Name
        };
        const sharedModel = model.sharedModel;
        if (sharedModel) {
          sharedModel.transact(() => {
            parameters['Shapes'].map((shape: string) => {
              setVisible(sharedModel, shape, false);
            });

            if (!sharedModel.objectExists(objectModel.name)) {
              sharedModel.addObject(objectModel);
            } else {
              showErrorMessage(
                'The object already exists',
                'There is an existing object with the same name.'
              );
            }
          });
        }
      };
    }
  },
  chamfer: {
    title: 'Chamfer parameters',
    shape: 'Edge::Chamfer',
    default: (model: IJupyterCadModel) => {
      const objects = model.getAllObject();
      const selectedEdge = getSelectedEdge(model.localState?.selected.value);
      return {
        Name: newName('Chamfer', model),
        Base: selectedEdge?.shape || objects[0].name || '',
        Edge: selectedEdge?.edgeIndex || 0,
        Dist: 0.2,
        Placement: { Position: [0, 0, 0], Axis: [0, 0, 1], Angle: 0 }
      };
    },
    syncData: (model: IJupyterCadModel) => {
      return (props: IDict) => {
        const { Name, ...parameters } = props;
        const objectModel: IJCadObject = {
          shape: 'Edge::Chamfer',
          parameters,
          visible: true,
          name: Name
        };
        const sharedModel = model.sharedModel;
        if (sharedModel) {
          sharedModel.transact(() => {
            setVisible(sharedModel, parameters['Base'], false);

            if (!sharedModel.objectExists(objectModel.name)) {
              sharedModel.addObject(objectModel);
            } else {
              showErrorMessage(
                'The object already exists',
                'There is an existing object with the same name.'
              );
            }
          });
        }
      };
    }
  }
};

const AXES_FORM = {
  title: 'Axes Helper',
  schema: {
    type: 'object',
    required: ['Size', 'Visible'],
    additionalProperties: false,
    properties: {
      Size: {
        type: 'number',
        description: 'Size of the axes'
      },
      Visible: {
        type: 'boolean',
        description: 'Whether the axes are visible or not'
      }
    }
  },
  default: (panel: JupyterCadPanel) => {
    return {
      Size: panel.axes?.size ?? 5,
      Visible: panel.axes?.visible ?? true
    };
  },
  syncData: (panel: JupyterCadPanel) => {
    return (props: IDict) => {
      const { Size, Visible } = props;
      panel.axes = {
        size: Size,
        visible: Visible
      };
    };
  }
};

const EXPLODED_VIEW_FORM = {
  title: 'Exploded View Settings',
  schema: {
    type: 'object',
    required: ['Enabled', 'Factor'],
    additionalProperties: false,
    properties: {
      Enabled: {
        type: 'boolean',
        description: 'Whether the exploded view is enabled or not'
      },
      Factor: {
        type: 'number',
        description: 'The exploded view factor'
      }
    }
  },
  default: (panel: JupyterCadPanel) => {
    return {
      Enabled: panel.explodedView?.enabled ?? false,
      Factor: panel.explodedView?.factor ?? 0.5
    };
  },
  syncData: (panel: JupyterCadPanel) => {
    return (props: IDict) => {
      const { Enabled, Factor } = props;
      panel.explodedView = {
        enabled: Enabled,
        factor: Factor
      };
    };
  }
};

const CAMERA_FORM = {
  title: 'Camera Settings',
  schema: {
    type: 'object',
    required: ['Type'],
    additionalProperties: false,
    properties: {
      Type: {
        title: 'Projection',
        description: 'The projection type',
        type: 'string',
        enum: ['Perspective', 'Orthographic']
      }
    }
  },
  default: (panel: JupyterCadPanel) => {
    return {
      Type: panel.cameraSettings?.type ?? 'Perspective'
    };
  },
  syncData: (panel: JupyterCadPanel) => {
    return (props: IDict) => {
      const { Type } = props;
      panel.cameraSettings = {
        type: Type
      };
    };
  }
};

const CLIP_VIEW_FORM = {
  title: 'Clip View Settings',
  schema: {
    type: 'object',
    required: ['Enabled'],
    additionalProperties: false,
    properties: {
      Enabled: {
        type: 'boolean',
        description: 'Whether the clip view is enabled or not'
      },
      ShowClipPlane: {
        type: 'boolean',
        description: 'Whether the clip plane should be rendered or not'
      }
    }
  },
  default: (panel: JupyterCadPanel) => {
    return {
      Enabled: panel.clipView?.enabled ?? false,
      ShowClipPlane: panel.clipView?.showClipPlane ?? true
    };
  },
  syncData: (panel: JupyterCadPanel) => {
    return (props: IDict) => {
      const { Enabled, ShowClipPlane } = props;
      panel.clipView = {
        enabled: Enabled,
        showClipPlane: ShowClipPlane
      };
    };
  }
};

const EXPORT_FORM = {
  title: 'Export to .jcad',
  schema: {
    type: 'object',
    required: ['Name'],
    additionalProperties: false,
    properties: {
      Name: {
        title: 'File name',
        description: 'The exported file name',
        type: 'string'
      }
    }
  },
  default: (context: DocumentRegistry.IContext<IJupyterCadModel>) => {
    return {
      Name: PathExt.basename(context.path).replace(
        PathExt.extname(context.path),
        '.jcad'
      )
    };
  },
  syncData: (context: DocumentRegistry.IContext<IJupyterCadModel>) => {
    return (props: IDict) => {
      const { Name } = props;
      console.log(`export to ${Name}`);
      requestAPI<{ done: boolean }>('jupytercad/export', {
        method: 'POST',
        body: JSON.stringify({
          path: context.path,
          newName: Name
        })
      });
    };
  }
};

/**
 * Add the FreeCAD commands to the application's command registry.
 */
export function addCommands(
  app: JupyterFrontEnd,
  tracker: WidgetTracker<JupyterCadWidget>,
  translator: ITranslator,
  formSchemaRegistry: IJCadFormSchemaRegistry
): void {
  const trans = translator.load('jupyterlab');
  const { commands } = app;
  Private.updateFormSchema(formSchemaRegistry);
  commands.addCommand(CommandIDs.redo, {
    label: trans.__('Redo'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    execute: args => {
      const current = tracker.currentWidget;

      if (current) {
        return current.context.model.sharedModel.redo();
      }
    },
    icon: redoIcon
  });

  commands.addCommand(CommandIDs.undo, {
    label: trans.__('Undo'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    execute: args => {
      const current = tracker.currentWidget;

      if (current) {
        return current.context.model.sharedModel.undo();
      }
    },
    icon: undoIcon
  });
  commands.addCommand(CommandIDs.newSketch, {
    label: trans.__('New Sketch'),
    iconClass: 'fa fa-pencil',
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    execute: async args => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const props = {
        sharedModel: current.context.model.sharedModel,
        closeCallback: {
          handler: () => {
            /* Awful hack to allow the body can close the dialog*/
          }
        }
      };
      const dialog = new SketcherDialog(props);
      props.closeCallback.handler = () => dialog.close();
      await dialog.launch();
    }
  });

  commands.addCommand(CommandIDs.newBox, {
    label: trans.__('New Box'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: boxIcon,
    execute: Private.createPart('box', tracker)
  });

  commands.addCommand(CommandIDs.newCylinder, {
    label: trans.__('New Cylinder'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: cylinderIcon,
    execute: Private.createPart('cylinder', tracker)
  });

  commands.addCommand(CommandIDs.newSphere, {
    label: trans.__('New Sphere'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: sphereIcon,
    execute: Private.createPart('sphere', tracker)
  });

  commands.addCommand(CommandIDs.newCone, {
    label: trans.__('New Cone'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: coneIcon,
    execute: Private.createPart('cone', tracker)
  });

  commands.addCommand(CommandIDs.newTorus, {
    label: trans.__('New Torus'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: torusIcon,
    execute: Private.createPart('torus', tracker)
  });

  commands.addCommand(CommandIDs.extrusion, {
    label: trans.__('Extrusion'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: extrusionIcon,
    execute: Private.executeOperator('extrusion', tracker)
  });

  commands.addCommand(CommandIDs.cut, {
    label: trans.__('Cut'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: cutIcon,
    execute: Private.executeOperator('cut', tracker)
  });

  commands.addCommand(CommandIDs.union, {
    label: trans.__('Union'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: unionIcon,
    execute: Private.executeOperator('union', tracker)
  });

  commands.addCommand(CommandIDs.intersection, {
    label: trans.__('Intersection'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    icon: intersectionIcon,
    execute: Private.executeOperator('intersection', tracker)
  });

  commands.addCommand(CommandIDs.chamfer, {
    label: trans.__('Make chamfer'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.editable
        : false;
    },
    iconClass: 'fa fa-grip-lines',
    execute: Private.executeOperator('chamfer', tracker)
  });

  commands.addCommand(CommandIDs.updateAxes, {
    label: trans.__('Axes Helper'),
    isEnabled: () => Boolean(tracker.currentWidget),
    icon: axesIcon,
    execute: async () => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const dialog = new FormDialog({
        context: current.context,
        title: AXES_FORM.title,
        schema: AXES_FORM.schema,
        sourceData: AXES_FORM.default(current.content),
        syncData: AXES_FORM.syncData(current.content),
        cancelButton: true
      });
      await dialog.launch();
    }
  });

  commands.addCommand(CommandIDs.updateExplodedView, {
    label: trans.__('Exploded View'),
    isEnabled: () => Boolean(tracker.currentWidget),
    icon: explodedViewIcon,
    execute: async () => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const dialog = new FormDialog({
        context: current.context,
        title: EXPLODED_VIEW_FORM.title,
        schema: EXPLODED_VIEW_FORM.schema,
        sourceData: EXPLODED_VIEW_FORM.default(current.content),
        syncData: EXPLODED_VIEW_FORM.syncData(current.content),
        cancelButton: true
      });
      await dialog.launch();
    }
  });

  commands.addCommand(CommandIDs.updateCameraSettings, {
    label: trans.__('Camera Settings'),
    isEnabled: () => Boolean(tracker.currentWidget),
    iconClass: 'fa fa-camera',
    execute: async () => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const dialog = new FormDialog({
        context: current.context,
        title: CAMERA_FORM.title,
        schema: CAMERA_FORM.schema,
        sourceData: CAMERA_FORM.default(current.content),
        syncData: CAMERA_FORM.syncData(current.content),
        cancelButton: true
      });
      await dialog.launch();
    }
  });

  commands.addCommand(CommandIDs.updateClipView, {
    label: trans.__('Clipping'),
    isEnabled: () => Boolean(tracker.currentWidget),
    icon: clippingIcon,
    execute: async () => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const dialog = new FormDialog({
        context: current.context,
        title: CLIP_VIEW_FORM.title,
        schema: CLIP_VIEW_FORM.schema,
        sourceData: CLIP_VIEW_FORM.default(current.content),
        syncData: CLIP_VIEW_FORM.syncData(current.content),
        cancelButton: true
      });
      await dialog.launch();
    }
  });

  commands.addCommand(CommandIDs.exportJcad, {
    label: trans.__('Export to .jcad'),
    isEnabled: () => {
      return tracker.currentWidget
        ? tracker.currentWidget.context.model.sharedModel.exportable
        : false;
    },
    iconClass: 'fa fa-file-export',
    execute: async () => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const dialog = new FormDialog({
        context: current.context,
        title: EXPORT_FORM.title,
        schema: EXPORT_FORM.schema,
        sourceData: EXPORT_FORM.default(tracker.currentWidget?.context),
        syncData: EXPORT_FORM.syncData(tracker.currentWidget?.context),
        cancelButton: true
      });
      await dialog.launch();
    }
  });
}

/**
 * The command IDs used by the FreeCAD plugin.
 */
export namespace CommandIDs {
  export const redo = 'jupytercad:redo';
  export const undo = 'jupytercad:undo';

  export const newSketch = 'jupytercad:sketch';

  export const newBox = 'jupytercad:newBox';
  export const newCylinder = 'jupytercad:newCylinder';
  export const newSphere = 'jupytercad:newSphere';
  export const newCone = 'jupytercad:newCone';
  export const newTorus = 'jupytercad:newTorus';

  export const cut = 'jupytercad:cut';
  export const extrusion = 'jupytercad:extrusion';
  export const union = 'jupytercad:union';
  export const intersection = 'jupytercad:intersection';

  export const chamfer = 'jupytercad:chamfer';

  export const updateAxes = 'jupytercad:updateAxes';
  export const updateExplodedView = 'jupytercad:updateExplodedView';
  export const updateCameraSettings = 'jupytercad:updateCameraSettings';
  export const updateClipView = 'jupytercad:updateClipView';

  export const exportJcad = 'jupytercad:exportJcad';
}

namespace Private {
  export const FORM_SCHEMA = {};

  export function updateFormSchema(
    formSchemaRegistry: IJCadFormSchemaRegistry
  ) {
    if (Object.keys(FORM_SCHEMA).length > 0) {
      return;
    }
    const formSchema = formSchemaRegistry.getSchemas();
    formSchema.forEach((val, key) => {
      if (key === 'Placement of the box') {
        return;
      }
      const value = (FORM_SCHEMA[key] = JSON.parse(JSON.stringify(val)));
      value['required'] = ['Name', ...value['required']];
      value['properties'] = {
        Name: { type: 'string', description: 'The Name of the Object' },
        ...value['properties']
      };
    });
  }

  export function createPart(
    part: keyof typeof PARTS,
    tracker: WidgetTracker<JupyterCadWidget>
  ) {
    return async (args: any) => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const value = PARTS[part];

      current.context.model.syncFormData(value);

      const syncSelectedField = (
        id: string | null,
        value: any,
        parentType: 'panel' | 'dialog'
      ): void => {
        let property: string | null = null;
        if (id) {
          const prefix = id.split('_')[0];
          property = id.substring(prefix.length);
        }
        current.context.model.syncSelectedPropField({
          id: property,
          value,
          parentType
        });
      };

      const dialog = new FormDialog({
        context: current.context,
        title: value.title,
        sourceData: value.default(current.context.model),
        schema: FORM_SCHEMA[value.shape],
        syncData: (props: IDict) => {
          const { Name, ...parameters } = props;
          const objectModel: IJCadObject = {
            shape: value.shape as Parts,
            parameters,
            visible: true,
            name: Name
          };

          const sharedModel = current.context.model.sharedModel;
          if (sharedModel) {
            if (!sharedModel.objectExists(objectModel.name)) {
              sharedModel.addObject(objectModel);
            } else {
              showErrorMessage(
                'The object already exists',
                'There is an existing object with the same name.'
              );
            }
          }
        },
        cancelButton: () => {
          current.context.model.syncFormData(undefined);
        },
        syncSelectedPropField: syncSelectedField
      });
      await dialog.launch();
    };
  }

  export function executeOperator(
    operator: keyof typeof OPERATORS,
    tracker: WidgetTracker<JupyterCadWidget>
  ) {
    return async (args: any) => {
      const current = tracker.currentWidget;

      if (!current) {
        return;
      }

      const op = OPERATORS[operator];

      // Fill form schema with available objects
      const form_schema = JSON.parse(JSON.stringify(FORM_SCHEMA[op.shape]));
      const allObjects = current.context.model.getAllObject().map(o => o.name);
      for (const prop in form_schema['properties']) {
        const fcType = form_schema['properties'][prop]['fcType'];
        if (fcType) {
          const propDef = form_schema['properties'][prop];
          switch (fcType) {
            case 'App::PropertyLink':
              propDef['enum'] = allObjects;
              break;
            case 'App::PropertyLinkList':
              propDef['items']['enum'] = allObjects;
              break;
            default:
          }
        }
      }

      const dialog = new FormDialog({
        context: current.context,
        title: op.title,
        sourceData: op.default(current.context.model),
        schema: form_schema,
        syncData: op.syncData(current.context.model),
        cancelButton: true
      });
      await dialog.launch();
    };
  }
}

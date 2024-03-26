import { ISignal } from '@lumino/signaling';
import { IJupyterCadModel, IJupyterCadDoc, IDict } from '@jupytercad/schema';
import { IJupyterCadTracker, IJupyterCadWidget } from '@jupytercad/schema';

export { IDict };
export type ValueOf<T> = T[keyof T];

/**
 * Axe's dimensions
 */
export type AxeHelper = {
  size: number;
  visible: boolean;
};

/**
 * The state of the exploded view
 */
export type ExplodedView = {
  enabled: boolean;
  factor: number;
};

/**
 * The state of the camera
 */
export type CameraSettings = {
  type: 'Perspective' | 'Orthographic';
};

/**
 * The state of the clip view
 */
export type ClipSettings = {
  enabled: boolean;
  showClipPlane: boolean;
};

/**
 * The state of the split screen
 */
export type SplitScreenSettings = {
  enabled: boolean;
};

export interface IControlPanelModel {
  disconnect(f: any): void;
  documentChanged: ISignal<IJupyterCadTracker, IJupyterCadWidget | null>;
  filePath: string | undefined;
  jcadModel: IJupyterCadModel | undefined;
  sharedModel: IJupyterCadDoc | undefined;
}

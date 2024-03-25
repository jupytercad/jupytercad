import { OCC } from '@jupytercad/opencascade';
import {
  IAny,
  IBox,
  ICone,
  ICut,
  ICylinder,
  IExtrusion,
  IFuse,
  IIntersection,
  IJCadContent,
  IShapeMetadata,
  ISketchObject,
  ISphere,
  ITorus,
  IPostOperator,
  WorkerAction,
  IWorkerMessageBase,
  IChamfer
} from '@jupytercad/schema';

export interface IDict<T = any> {
  [key: string]: T;
}

export type ValueOf<T> = T[keyof T];

export interface IRegister extends IWorkerMessageBase {
  action: WorkerAction.REGISTER;
  payload: {
    id: string;
  };
}

export interface ILoadFile extends IWorkerMessageBase {
  action: WorkerAction.LOAD_FILE;
  payload: {
    content: IJCadContent;
  };
}

export type IWorkerMessage = ILoadFile | IRegister;

export interface IOperatorFuncOutput {
  occShape?: OCC.TopoDS_Shape;
  metadata?: IShapeMetadata | undefined;
  occBrep?: string;
}

type IOperatorFunc<T> = (
  args: T,
  jcadContent: IJCadContent
) => IOperatorFuncOutput | undefined;

export type IAllOperatorFunc =
  | IOperatorFunc<IAny>
  | IOperatorFunc<IBox>
  | IOperatorFunc<ICylinder>
  | IOperatorFunc<ISphere>
  | IOperatorFunc<ICone>
  | IOperatorFunc<ITorus>
  | IOperatorFunc<ICut>
  | IOperatorFunc<IFuse>
  | IOperatorFunc<IIntersection>
  | IOperatorFunc<IExtrusion>
  | IOperatorFunc<IChamfer>
  | IOperatorFunc<ISketchObject>
  | IOperatorFunc<IPostOperator>;

export type IOperatorArg = IAny &
  IBox &
  ICylinder &
  ISphere &
  ICone &
  ITorus &
  ICut &
  IFuse &
  IExtrusion &
  IChamfer &
  ISketchObject &
  IPostOperator;

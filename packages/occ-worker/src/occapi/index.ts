import {
  IAny,
  IBox,
  IChamfer,
  ICone,
  ICut,
  ICylinder,
  IExtrusion,
  IFuse,
  IIntersection,
  ISketchObject,
  ISphere,
  ITorus
} from '@jupytercad/schema';

import { _Any } from './any';
import { _Box } from './box';
import { setShapesFactory } from './common';
import { _Cone } from './cone';
import { _Cut } from './cut';
import { _Cylinder } from './cylinder';
import { _Extrude } from './extrude';
import { _Fuse } from './fuse';
import { _Chamfer } from './chamfer';
import { _Intersection } from './intersection';
import { _loadObjectFile } from './loadObjectFile';
import { operatorCache } from './operatorCache';
import { _PostOperator } from './postOperator';
import { _SketchObject } from './sketchObject';
import { _Sphere } from './sphere';
import { _Torus } from './torus';

export const Any = operatorCache<IAny>('Part::Any', _Any);
export const Box = operatorCache<IBox>('Part::Box', _Box);

export const Cylinder = operatorCache<ICylinder>('Part::Cylinder', _Cylinder);

export const Sphere = operatorCache<ISphere>('Part::Sphere', _Sphere);

export const Cone = operatorCache<ICone>('Part::Cone', _Cone);

export const Torus = operatorCache<ITorus>('Part::Torus', _Torus);

export const SketchObject = operatorCache<ISketchObject>(
  'Sketcher::SketchObject',
  _SketchObject
);

export const Cut = operatorCache<ICut>('Part::Cut', _Cut);

export const Fuse = operatorCache<IFuse>('Part::MultiFuse', _Fuse);

export const Intersection = operatorCache<IIntersection>(
  'Part::MultiCommon',
  _Intersection
);

export const Extrude = operatorCache<IExtrusion>('Part::Extrusion', _Extrude);

export const Chamfer = operatorCache<IChamfer>('Edge::Chamfer', _Chamfer);

export const ObjectFile = operatorCache<{
  content: string;
  type: IAny['Type'];
}>('ObjectFile', _loadObjectFile);

export function initShapesFactory() {
  setShapesFactory('Part::Any', Any);
  setShapesFactory('Part::Box', Box);
  setShapesFactory('Part::Cylinder', Cylinder);
  setShapesFactory('Part::Sphere', Sphere);
  setShapesFactory('Part::Cone', Cone);
  setShapesFactory('Part::Torus', Torus);
  setShapesFactory('Part::Cut', Cut);
  setShapesFactory('Part::MultiFuse', Fuse);
  setShapesFactory('Part::Extrusion', Extrude);
  setShapesFactory('Part::MultiCommon', Intersection);
  setShapesFactory('Edge::Chamfer', Chamfer);
  setShapesFactory('Sketcher::SketchObject', SketchObject);
  setShapesFactory('Post::Operator', _PostOperator);
}

export { getShapesFactory } from './common';

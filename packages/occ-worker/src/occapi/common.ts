import { OCC } from '@jupytercad/opencascade';
import { Parts } from '@jupytercad/schema';
import { IAllOperatorFunc } from '../types';

let occ: OCC.OpenCascadeInstance;

export function getOcc(): OCC.OpenCascadeInstance {
  if (!occ) {
    occ = (self as any).occ as OCC.OpenCascadeInstance;
  }
  return occ;
}

export function toRad(deg: number): number {
  return (Math.PI * deg) / 180;
}
export function toDeg(rad: number): number {
  return (180 * rad) / Math.PI;
}

export function setShapePlacement(
  shape: OCC.TopoDS_Shape,
  placement?: {
    Position: number[];
    Axis: number[];
    Angle: number;
  }
): OCC.TopoDS_Shape {
  if (!placement) {
    return shape;
  }
  const oc = getOcc();
  const trsf = new oc.gp_Trsf_1();

  const ax = new oc.gp_Ax1_2(
    new oc.gp_Pnt_3(0, 0, 0),
    new oc.gp_Dir_4(placement.Axis[0], placement.Axis[1], placement.Axis[2])
  );
  const angle = toRad(placement.Angle);
  trsf.SetRotation_1(ax, angle);
  trsf.SetTranslationPart(
    new oc.gp_Vec_4(
      placement.Position[0],
      placement.Position[1],
      placement.Position[2]
    )
  );
  const loc = new oc.TopLoc_Location_2(trsf);
  shape.Location_2(loc, true);
  return shape;
}
const _ShapesFactory: {
  [key in Parts]: IAllOperatorFunc | undefined;
} = {
  'Part::Any': undefined,
  'Part::Box': undefined,
  'Part::Cylinder': undefined,
  'Part::Sphere': undefined,
  'Part::Cone': undefined,
  'Part::Torus': undefined,
  'Part::Cut': undefined,
  'Part::MultiFuse': undefined,
  'Part::Extrusion': undefined,
  'Part::MultiCommon': undefined,
  'Edge::Chamfer': undefined,
  'Edge::Fillet': undefined,
  'Sketcher::SketchObject': undefined,
  'Post::Operator': undefined
};

export function getShapesFactory() {
  return _ShapesFactory;
}
export function setShapesFactory(key: Parts, value: IAllOperatorFunc) {
  _ShapesFactory[key] = value;
}

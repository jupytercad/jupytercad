import { OCC } from '@jupytercad/opencascade';
import { IChamfer, IJCadContent } from '@jupytercad/schema';

import { getOcc } from './common';
import { IOperatorArg } from '../types';
import { setShapePlacement, getShapesFactory } from './common';

export function _Chamfer(
  arg: IChamfer,
  content: IJCadContent
): OCC.TopoDS_Shape | undefined {
  const { Base, Edge, Dist, Placement } = arg;
  const oc = getOcc();
  const baseObject = content.objects.filter(obj => obj.name === Base);

  if (baseObject.length === 0) {
    return;
  }
  const baseShape = baseObject[0].shape;
  const shapesFactory = getShapesFactory();
  if (baseShape && shapesFactory[baseShape]) {
    const base = shapesFactory[baseShape]?.(
      baseObject[0].parameters as IOperatorArg,
      content
    );
    if (!base || !base.occShape) {
      return;
    }

    const mapOfShape = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(
      base.occShape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
      mapOfShape
    );

    const edge = oc.TopoDS.Edge_1(mapOfShape.FindKey(Edge + 1));

    const chamferBuilder = new oc.BRepFilletAPI_MakeChamfer(base.occShape);
    chamferBuilder.Add_2(Dist, edge);

    chamferBuilder.Build(new oc.Message_ProgressRange_1());

    if (chamferBuilder.IsDone()) {
      return setShapePlacement(chamferBuilder.Shape(), Placement);
    } else {
      console.error('Failed to create chamfer');
    }
  }
}

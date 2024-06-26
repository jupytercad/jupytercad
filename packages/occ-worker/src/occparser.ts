import { OCC } from '@jupytercad/opencascade';
import { IEdge, IFace, IJCadObject, IParsedShape } from '@jupytercad/schema';

import { IDict, IOperatorFuncOutput } from './types';

interface IShapeList {
  shapeData: IOperatorFuncOutput;
  jcObject: IJCadObject;
}

export class OccParser {
  private _shapeList: IShapeList[];
  private _occ: OCC.OpenCascadeInstance = (self as any).occ;

  constructor(shapeList: IShapeList[]) {
    this._shapeList = shapeList;
  }

  execute(raiseOnFailure = false): IDict<IParsedShape> {
    const maxDeviation = 0.1;
    const threejsData: IDict<IParsedShape> = {};
    this._shapeList.forEach(data => {
      const { shapeData, jcObject } = data;
      const { occShape, metadata } = shapeData;
      if (!occShape) {
        if (raiseOnFailure) {
          throw Error('Unknown failure');
        } else {
          return;
        }
      }
      new this._occ.BRepMesh_IncrementalMesh_2(
        occShape,
        maxDeviation,
        false,
        maxDeviation * 5,
        true
      );
      const faceList = this._build_face_mesh(occShape);
      let edgeList: IEdge[] = [];
      if (this._shouldComputeEdge(jcObject)) {
        edgeList = this._build_edge_mesh(occShape);
      }
      let wireList: IEdge[] = [];
      if (this._shouldComputeWire(jcObject)) {
        //Only compute the wire mesh for 2d geometries
        wireList = this._build_wire_mesh(occShape, maxDeviation);
      }

      threejsData[jcObject.name] = {
        jcObject,
        faceList,
        edgeList: [...edgeList, ...wireList],
        isSolid: this._isSolid(occShape),
        meta: metadata
      };
    });

    return threejsData;
  }

  private _isSolid(shape: OCC.TopoDS_Shape) {
    console.log('try checking is solid');
    if (
      shape.ShapeType() == this._occ.TopAbs_ShapeEnum.TopAbs_SOLID ||
      shape.ShapeType() == this._occ.TopAbs_ShapeEnum.TopAbs_SHELL
    ) {
      console.log('1');
      try {
        const classifier = new this._occ.BRepClass3d_SolidClassifier();
        console.log('2');
        classifier.Load(shape);

        console.log('3');
        // Define a point (doesn't need to be specific, as we only care if it's closed)
        const point = new this._occ.gp_Pnt();
        console.log('4');
        classifier.Perform(point, 0);

        console.log('5');
        // Check if the point is inside, on the boundary, or outside the solid
        if (
          classifier.State() == this._occ.TopAbs_State.TopAbs_IN ||
          classifier.State() == this._occ.TopAbs_State.TopAbs_ON
        ) {
          console.log('6');
          return true; // The solid is closed
        }
      } catch (e) {
        if (typeof e === 'number') {
          const exceptionData = this._occ.OCJS.getStandard_FailureData(e);
          console.log(
            `That didn't work because: ${exceptionData.GetMessageString()}`
          );
        } else {
          console.log('Unkown error');
        }
      }
    }
    console.log('61');
    return false;
  }

  private _shouldComputeEdge(obj: IJCadObject): boolean {
    if (obj.shape === 'Part::Any' && obj.parameters?.Type === 'STL') {
      return false;
    }
    return true;
  }

  private _shouldComputeWire(obj: IJCadObject): boolean {
    if (obj.shape === 'Sketcher::SketchObject') {
      return true;
    }
    return false;
  }
  private _build_wire_mesh(
    shape: OCC.TopoDS_Shape,
    maxDeviation: number
  ): Array<IEdge> {
    const edgeList: Array<IEdge> = [];
    const oc = this._occ;
    const expl = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );
    expl.Init(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );

    while (expl.More()) {
      const edge = oc.TopoDS.Edge_1(expl.Current());

      const aLocation = new oc.TopLoc_Location_1();
      const adaptorCurve = new oc.BRepAdaptor_Curve_2(edge);
      const tangDef = new oc.GCPnts_TangentialDeflection_2(
        adaptorCurve,
        maxDeviation,
        0.1,
        2,
        1.0e-9,
        1.0e-7
      );
      const vertexCoord = new Array(tangDef.NbPoints() * 3);
      for (let j = 0; j < tangDef.NbPoints(); j++) {
        const vertex = tangDef
          .Value(j + 1)
          .Transformed(aLocation.Transformation());
        vertexCoord[j * 3 + 0] = vertex.X();
        vertexCoord[j * 3 + 1] = vertex.Y();
        vertexCoord[j * 3 + 2] = vertex.Z();
      }
      edgeList.push({ vertexCoord, numberOfCoords: tangDef.NbPoints() * 3 });
      expl.Next();
    }
    return edgeList;
  }

  private _build_face_mesh(shape: OCC.TopoDS_Shape): Array<IFace> {
    const faceList: Array<IFace> = [];
    const triangulations: Array<OCC.Handle_Poly_Triangulation> = [];
    const oc = this._occ;
    const expl = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as any,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );

    expl.Init(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as any,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );
    while (expl.More()) {
      const face = oc.TopoDS.Face_1(expl.Current());
      const aLocation = new oc.TopLoc_Location_1();
      const myT = oc.BRep_Tool.Triangulation(face, aLocation, 0);
      if (myT.IsNull()) {
        console.error('Encountered Null Face!');
        expl.Next();
        continue;
      }
      const thisFace: IFace = {
        vertexCoord: [],
        triIndexes: [],
        numberOfTriangles: 0
      };
      const triangulation = myT.get();
      const nbNodes = triangulation.NbNodes();

      thisFace.vertexCoord = new Array(nbNodes * 3);
      for (let i = 0; i < nbNodes; i++) {
        const p = triangulation
          .Node(i + 1)
          .Transformed(aLocation.Transformation());
        thisFace.vertexCoord[i * 3 + 0] = p.X();
        thisFace.vertexCoord[i * 3 + 1] = p.Y();
        thisFace.vertexCoord[i * 3 + 2] = p.Z();
      }

      const orient = face.Orientation_1();

      const nbTriangles = triangulation.NbTriangles();

      // Write triangle buffer
      thisFace.triIndexes = new Array(nbTriangles * 3);
      let validFaceTriCount = 0;
      for (let nt = 1; nt <= myT.get().NbTriangles(); nt++) {
        const t = triangulation.Triangle(nt);
        let n1 = t.Value(1);
        let n2 = t.Value(2);
        const n3 = t.Value(3);
        if (orient !== oc.TopAbs_Orientation.TopAbs_FORWARD) {
          const tmp = n1;
          n1 = n2;
          n2 = tmp;
        }

        thisFace.triIndexes[validFaceTriCount * 3 + 0] = n1 - 1;
        thisFace.triIndexes[validFaceTriCount * 3 + 1] = n2 - 1;
        thisFace.triIndexes[validFaceTriCount * 3 + 2] = n3 - 1;
        validFaceTriCount++;
      }
      thisFace.numberOfTriangles = validFaceTriCount;
      faceList.push(thisFace);
      triangulations.push(myT);
      expl.Next();
    }
    return faceList;
  }

  private _build_edge_mesh(shape: OCC.TopoDS_Shape): IEdge[] {
    const oc = this._occ;
    const edgeList: IEdge[] = [];
    const mapOfShape = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
      mapOfShape
    );

    const edgeMap = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
    oc.TopExp.MapShapesAndAncestors(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE as any,
      oc.TopAbs_ShapeEnum.TopAbs_FACE as any,
      edgeMap
    );

    for (let iEdge = 1; iEdge <= edgeMap.Extent(); iEdge++) {
      const faceList = edgeMap.FindFromIndex(iEdge);
      if (faceList.Extent() === 0) {
        continue;
      }
      const anEdge = oc.TopoDS.Edge_1(mapOfShape.FindKey(iEdge));
      let myTransf = new oc.gp_Trsf_1();
      const aLoc = new oc.TopLoc_Location_1();
      const aPoly = oc.BRep_Tool.Polygon3D(anEdge, aLoc);

      const theEdge: IEdge = {
        vertexCoord: [],
        numberOfCoords: 0
      };
      let nbNodesInFace: number;
      if (!aPoly.IsNull()) {
        if (!aLoc.IsIdentity()) {
          myTransf = aLoc.Transformation();
        }
        const poly = aPoly.get();

        nbNodesInFace = poly.NbNodes();

        theEdge.numberOfCoords = nbNodesInFace;
        theEdge.vertexCoord = new Array(nbNodesInFace * 3);
        const nodeListOfEdge = aPoly.get().Nodes();
        for (let ii = 0; ii < nbNodesInFace; ii++) {
          const V = nodeListOfEdge.Value(ii + 1);
          V.Transform(myTransf);
          theEdge.vertexCoord[ii * 3 + 0] = V.X();
          theEdge.vertexCoord[ii * 3 + 1] = V.Y();
          theEdge.vertexCoord[ii * 3 + 2] = V.Z();
        }
      } else {
        const aFace = oc.TopoDS.Face_1(edgeMap.FindFromIndex(iEdge).First_1());
        const aPolyTria = oc.BRep_Tool.Triangulation(aFace, aLoc, 0);
        if (!aLoc.IsIdentity()) {
          myTransf = aLoc.Transformation();
        }
        const aPoly = oc.BRep_Tool.PolygonOnTriangulation_1(
          anEdge,
          aPolyTria,
          aLoc
        );
        if (aPoly.IsNull()) {
          continue;
        }
        nbNodesInFace = aPoly.get().NbNodes();
        theEdge.numberOfCoords = nbNodesInFace;
        theEdge.vertexCoord = new Array(nbNodesInFace * 3);

        const indices = aPoly.get().Nodes();
        const nodeListOfFace = aPolyTria.get();

        for (let jj = indices.Lower(); jj <= indices.Upper(); jj++) {
          const v = nodeListOfFace.Node(indices.Value(jj));
          v.Transform(myTransf);
          const locIndex = jj - 1;

          theEdge.vertexCoord[locIndex * 3 + 0] = v.X();
          theEdge.vertexCoord[locIndex * 3 + 1] = v.Y();
          theEdge.vertexCoord[locIndex * 3 + 2] = v.Z();
        }
      }
      edgeList.push(theEdge);
    }
    return edgeList;
  }
}

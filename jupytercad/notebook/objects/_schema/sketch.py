# generated by datamodel-codegen:
#   filename:  sketch.json
#   timestamp: 2023-02-17T16:06:05+00:00

from __future__ import annotations

from typing import List, Optional, Union

from pydantic import BaseModel, Extra, Field

from . import geomCircle, geomLineSegment, placement


class ISketchObject(BaseModel):
    class Config:
        extra = Extra.forbid

    AttachmentOffset: placement.Model = Field(..., description='The attachment offset')
    Geometry: List[
        Union[geomCircle.IGeomCircle, geomLineSegment.IGeomLineSegment]
    ] = Field(..., description='The geometry list')
    Placement: Optional[placement.Model] = None

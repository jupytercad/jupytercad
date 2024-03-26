import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { LabIcon } from '@jupyterlab/ui-components';
import * as d3Color from 'd3-color';

import axesIconStr from '../style/icon/axes.svg';
import boxIconStr from '../style/icon/box.svg';
import coneIconStr from '../style/icon/cone.svg';
import cutIconStr from '../style/icon/cut.svg';
import cylinderIconStr from '../style/icon/cylinder.svg';
import extrusionIconStr from '../style/icon/extrusion.svg';
import intersectionIconStr from '../style/icon/intersection.svg';
import jvControlLight from '../style/icon/jvcontrol.svg';
import minimizeIconStr from '../style/icon/minimize.svg';
import sphereIconStr from '../style/icon/sphere.svg';
import torusIconStr from '../style/icon/torus.svg';
import unionIconStr from '../style/icon/union.svg';
import clippingIconStr from '../style/icon/clipping.svg';
import visibilitySvg from '../style/icon/visibility.svg';
import visibilityOffSvg from '../style/icon/visibilityOff.svg';

export const jcLightIcon = new LabIcon({
  name: 'jupytercad:control-light',
  svgstr: jvControlLight
});

export const minimizeIcon = new LabIcon({
  name: 'jupytercad:minimize-icon',
  svgstr: minimizeIconStr
});

export const boxIcon = new LabIcon({
  name: 'jupytercad:box-icon',
  svgstr: boxIconStr
});

export const coneIcon = new LabIcon({
  name: 'jupytercad:cone-icon',
  svgstr: coneIconStr
});

export const sphereIcon = new LabIcon({
  name: 'jupytercad:sphere-icon',
  svgstr: sphereIconStr
});

export const cylinderIcon = new LabIcon({
  name: 'jupytercad:cylinder-icon',
  svgstr: cylinderIconStr
});

export const torusIcon = new LabIcon({
  name: 'jupytercad:torus-icon',
  svgstr: torusIconStr
});

export const cutIcon = new LabIcon({
  name: 'jupytercad:cut-icon',
  svgstr: cutIconStr
});

export const unionIcon = new LabIcon({
  name: 'jupytercad:union-icon',
  svgstr: unionIconStr
});

export const intersectionIcon = new LabIcon({
  name: 'jupytercad:intersection-icon',
  svgstr: intersectionIconStr
});

export const extrusionIcon = new LabIcon({
  name: 'jupytercad:extrusion-icon',
  svgstr: extrusionIconStr
});

export const axesIcon = new LabIcon({
  name: 'jupytercad:axes-icon',
  svgstr: axesIconStr
});

export const explodedViewIcon = new LabIcon({
  name: 'jupytercad:explodedView-icon',
  svgstr: jvControlLight
});

export const clippingIcon = new LabIcon({
  name: 'jupytercad:clipping-icon',
  svgstr: clippingIconStr
});

export const visibilityIcon = new LabIcon({
  name: 'jupytercad:visibilityIcon',
  svgstr: visibilitySvg
});
export const visibilityOffIcon = new LabIcon({
  name: 'jupytercad:visibilityOffIcon',
  svgstr: visibilityOffSvg
});

export const debounce = (
  func: CallableFunction,
  timeout = 100
): CallableFunction => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, timeout);
  };
};

export function throttle<T extends (...args: any[]) => void>(
  callback: T,
  delay = 100
): T {
  let last: number;
  let timer: any;
  return function (...args: any[]) {
    const now = +new Date();
    if (last && now < last + delay) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = now;
        callback(...args);
      }, delay);
    } else {
      last = now;
      callback(...args);
    }
  } as T;
}

export function itemFromName<T extends { name: string }>(
  name: string,
  arr: T[]
): T | undefined {
  for (const it of arr) {
    if (it.name === name) {
      return it;
    }
  }
  return undefined;
}

export function focusInputField(
  filePath?: string,
  fieldId?: string | null,
  value?: any,
  color?: string,
  lastSelectedPropFieldId?: string
): string | undefined {
  const propsToRemove = ['border-color', 'box-shadow'];
  let newSelected: string | undefined;
  if (!fieldId) {
    if (lastSelectedPropFieldId) {
      removeStyleFromProperty(filePath, lastSelectedPropFieldId, propsToRemove);
      if (value) {
        const el = getElementFromProperty(filePath, lastSelectedPropFieldId);
        if (el?.tagName?.toLowerCase() === 'input') {
          (el as HTMLInputElement).value = value;
        }
      }
      newSelected = undefined;
    }
  } else {
    if (fieldId !== lastSelectedPropFieldId) {
      removeStyleFromProperty(filePath, lastSelectedPropFieldId, propsToRemove);

      const el = getElementFromProperty(filePath, fieldId);
      if (el) {
        el.style.borderColor = color ?? 'red';
        el.style.boxShadow = `inset 0 0 4px ${color ?? 'red'}`;
      }
      newSelected = fieldId;
    }
  }
  return newSelected;
}

export function getElementFromProperty(
  filePath?: string | null,
  prop?: string | null
): HTMLElement | undefined | null {
  if (!filePath || !prop) {
    return;
  }
  const parent = document.querySelector(`[data-path="${filePath}"]`);

  if (parent) {
    const el = parent.querySelector(`[id$=${prop}]`);
    return el as HTMLElement;
  }
}

export function removeStyleFromProperty(
  filePath: string | null | undefined,
  prop: string | null | undefined,
  properties: string[]
): void {
  if (!filePath || !prop || properties.length === 0) {
    return;
  }
  const el = getElementFromProperty(filePath, prop);
  if (el) {
    properties.forEach(prop => el.style.removeProperty(prop));
  }
}

export function nearest(n: number, tol: number): number {
  const round = Math.round(n);
  if (Math.abs(round - n) < tol) {
    return round;
  } else {
    return n;
  }
}

export function getCSSVariableColor(name: string): string {
  const color =
    window.getComputedStyle(document.body).getPropertyValue(name) || '#ffffff';

  return d3Color.rgb(color).formatHex();
}

/**
 * Call the API extension
 *
 * @param endPoint API REST end point for the extension
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON
 */
export async function requestAPI<T>(
  endPoint = '',
  init: RequestInit = {}
): Promise<T> {
  // Make request to Jupyter API
  const settings = ServerConnection.makeSettings();
  const requestUrl = URLExt.join(settings.baseUrl, endPoint);

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as any);
  }

  let data: any = await response.text();

  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      console.log('Not a JSON response body.', response);
    }
  }

  if (!response.ok) {
    throw new ServerConnection.ResponseError(response, data.message || data);
  }

  return data;
}

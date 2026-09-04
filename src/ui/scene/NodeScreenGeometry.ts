export interface ScreenViewport {
  width: number;
  height: number;
}

export interface ProjectedScreenPoint {
  x: number;
  y: number;
}

export interface NodeScreenGeometry {
  centerX: number;
  centerY: number;
  radiusPx: number;
  topX: number;
  topY: number;
}

function ndcToScreen(point: ProjectedScreenPoint, viewport: ScreenViewport) {
  const width = Math.max(viewport.width, 1);
  const height = Math.max(viewport.height, 1);
  return {
    x: (point.x * .5 + .5) * width,
    y: (-point.y * .5 + .5) * height,
  };
}

/**
 * Converts a rendered sphere center and one radius sample into the only geometry
 * the DOM label layer is allowed to consume. The sample measures radius only;
 * label direction is a screen-space invariant: straight up from the visible center.
 */
export function nodeScreenGeometryFromNdc(
  centerNdc: ProjectedScreenPoint,
  radiusSampleNdc: ProjectedScreenPoint,
  viewport: ScreenViewport,
): NodeScreenGeometry {
  const center = ndcToScreen(centerNdc, viewport);
  const sample = ndcToScreen(radiusSampleNdc, viewport);
  const radiusPx = Math.hypot(sample.x - center.x, sample.y - center.y);
  return {
    centerX: center.x,
    centerY: center.y,
    radiusPx,
    topX: center.x,
    topY: center.y - radiusPx,
  };
}

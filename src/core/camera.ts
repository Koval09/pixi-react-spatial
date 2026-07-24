export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export function createCameraState(x = 0, y = 0, zoom = 1): CameraState {
  return { x, y, zoom };
}

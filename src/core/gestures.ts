import type { CameraState, Point, Rect, Size } from './camera';
import { zoomAtPoint, clampCamera } from './camera';

export type GestureEventType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'pointercancel'
  | 'wheel';

export interface GestureEvent {
  type: GestureEventType;
  x: number;
  y: number;
  pointerId?: number;
  deltaY?: number;
}

export interface PointerInfo {
  id: number;
  current: Point;
  start: Point;
  prev: Point;
}

export type GestureMode = 'idle' | 'drag_pending' | 'panning' | 'pinching';

export interface PinchState {
  initialDistance: number;
  initialMidpoint: Point;
  initialCamera: CameraState;
}

export interface GestureState {
  mode: GestureMode;
  pointers: PointerInfo[];
  pinch?: PinchState;
}

export interface GestureConfig {
  viewport: Size;
  worldBounds?: Rect;
  minZoom?: number;
  maxZoom?: number;
  panThreshold?: number; // default 3px
  wheelSensitivity?: number; // default 0.001
}

export function createGestureState(): GestureState {
  return {
    mode: 'idle',
    pointers: [],
  };
}

export function handleGesture(
  state: GestureState,
  camera: CameraState,
  event: GestureEvent,
  config: GestureConfig
): { state: GestureState; camera: CameraState } {
  const panThreshold = config.panThreshold ?? 3;
  const wheelSensitivity = config.wheelSensitivity ?? 0.001;

  if (event.type === 'wheel') {
    const deltaY = event.deltaY ?? 0;
    if (deltaY === 0) {
      return { state, camera };
    }
    const factor = Math.exp(-deltaY * wheelSensitivity);
    const targetZoom = camera.zoom * factor;
    let nextCam = zoomAtPoint(
      camera,
      { x: event.x, y: event.y },
      targetZoom,
      config.viewport,
      config.minZoom,
      config.maxZoom
    );
    if (config.worldBounds) {
      nextCam = clampCamera(nextCam, config.worldBounds, config.viewport);
    }
    return { state, camera: nextCam };
  }

  const pointerId = event.pointerId ?? 0;
  let pointers = [...state.pointers];

  if (event.type === 'pointerdown') {
    const existingIdx = pointers.findIndex((p) => p.id === pointerId);
    const newPointer: PointerInfo = {
      id: pointerId,
      current: { x: event.x, y: event.y },
      start: { x: event.x, y: event.y },
      prev: { x: event.x, y: event.y },
    };

    if (existingIdx !== -1) {
      pointers[existingIdx] = newPointer;
    } else {
      pointers.push(newPointer);
    }

    if (pointers.length === 1) {
      return {
        state: {
          mode: 'drag_pending',
          pointers,
        },
        camera,
      };
    } else if (pointers.length >= 2) {
      const p1 = pointers[0].current;
      const p2 = pointers[1].current;
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      return {
        state: {
          mode: 'pinching',
          pointers,
          pinch: {
            initialDistance: dist,
            initialMidpoint: mid,
            initialCamera: camera,
          },
        },
        camera,
      };
    }
  }

  if (event.type === 'pointermove') {
    const idx = pointers.findIndex((p) => p.id === pointerId);
    if (idx === -1) {
      return { state, camera };
    }

    const prevPointer = pointers[idx];
    const updatedPointer: PointerInfo = {
      ...prevPointer,
      current: { x: event.x, y: event.y },
    };
    pointers[idx] = updatedPointer;

    if (state.mode === 'drag_pending' && pointers.length === 1) {
      const dist = Math.hypot(
        updatedPointer.current.x - updatedPointer.start.x,
        updatedPointer.current.y - updatedPointer.start.y
      );

      if (dist >= panThreshold) {
        pointers[idx] = {
          ...updatedPointer,
          prev: { x: event.x, y: event.y },
        };
        return {
          state: {
            mode: 'panning',
            pointers,
          },
          camera,
        };
      } else {
        return {
          state: {
            ...state,
            pointers,
          },
          camera,
        };
      }
    }

    if (state.mode === 'panning' && pointers.length === 1) {
      const dx = updatedPointer.current.x - prevPointer.prev.x;
      const dy = updatedPointer.current.y - prevPointer.prev.y;

      pointers[idx] = {
        ...updatedPointer,
        prev: { x: event.x, y: event.y },
      };

      let newCam = {
        ...camera,
        x: camera.x - dx / camera.zoom,
        y: camera.y - dy / camera.zoom,
      };

      if (config.worldBounds) {
        newCam = clampCamera(newCam, config.worldBounds, config.viewport);
      }

      return {
        state: {
          mode: 'panning',
          pointers,
        },
        camera: newCam,
      };
    }

    if (state.mode === 'pinching' && pointers.length >= 2 && state.pinch) {
      const p1 = pointers[0].current;
      const p2 = pointers[1].current;
      const currentDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const currentMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      const { initialDistance, initialMidpoint, initialCamera } = state.pinch;

      if (initialDistance > 0) {
        const scale = currentDist / initialDistance;
        const targetZoom = initialCamera.zoom * scale;

        let newCam = zoomAtPoint(
          initialCamera,
          initialMidpoint,
          targetZoom,
          config.viewport,
          config.minZoom,
          config.maxZoom
        );

        const midDx = currentMid.x - initialMidpoint.x;
        const midDy = currentMid.y - initialMidpoint.y;

        newCam = {
          ...newCam,
          x: newCam.x - midDx / newCam.zoom,
          y: newCam.y - midDy / newCam.zoom,
        };

        if (config.worldBounds) {
          newCam = clampCamera(newCam, config.worldBounds, config.viewport);
        }

        return {
          state: {
            ...state,
            pointers,
          },
          camera: newCam,
        };
      }
    }
  }

  if (event.type === 'pointerup' || event.type === 'pointercancel') {
    pointers = pointers.filter((p) => p.id !== pointerId);

    if (pointers.length === 0) {
      return {
        state: createGestureState(),
        camera,
      };
    }

    if (pointers.length === 1) {
      const rem = pointers[0];
      pointers[0] = {
        ...rem,
        start: { ...rem.current },
        prev: { ...rem.current },
      };

      return {
        state: {
          mode: 'panning',
          pointers,
        },
        camera,
      };
    }
  }

  return { state: { ...state, pointers }, camera };
}

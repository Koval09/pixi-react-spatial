import React, {
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type ReactNode,
  type RefObject,
} from 'react';
import type { CameraState, Deadzone, Rect, Size } from '../core/camera';
import { clampCamera, createCameraState, followTarget } from '../core/camera';
import { createGestureState, handleGesture, type GestureState } from '../core/gestures';
import { ViewportContext, type CameraListener, type ViewportContextValue } from './context';

export interface SpatialContainerHandle {
  position: { x: number; y: number };
  scale: { x: number; y: number };
}

export interface SpatialViewportProps {
  children?: ReactNode;
  worldWidth?: number;
  worldHeight?: number;
  worldBounds?: Rect;
  viewportWidth?: number;
  viewportHeight?: number;
  minZoom?: number;
  maxZoom?: number;
  clamp?: boolean;
  follow?: RefObject<{ x: number; y: number } | null> | { x: number; y: number } | null;
  followLerp?: number;
  followDeadzone?: Deadzone;
  onViewportChange?: (camera: CameraState) => void;
  initialCamera?: CameraState;
  /** Custom ticker override for testing or manual frame updates */
  ticker?: { add: (fn: (delta: number) => void) => () => void };
}

interface EventPayload {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  deltaY?: number;
  wheelDeltaY?: number;
  detail?: number;
  x?: number;
  y?: number;
  global?: { x?: number; y?: number };
  nativeEvent?: {
    clientX?: number;
    clientY?: number;
    pointerId?: number;
    deltaY?: number;
    wheelDeltaY?: number;
  };
}

function extractEventData(e: unknown): { x: number; y: number; pointerId: number; deltaY: number } {
  const ev = e as EventPayload | undefined;
  const native = ev?.nativeEvent;
  const x =
    (ev?.clientX !== undefined && ev.clientX !== 0 ? ev.clientX : undefined) ??
    (native?.clientX !== undefined && native.clientX !== 0 ? native.clientX : undefined) ??
    ev?.global?.x ??
    ev?.clientX ??
    native?.clientX ??
    0;
  const y =
    (ev?.clientY !== undefined && ev.clientY !== 0 ? ev.clientY : undefined) ??
    (native?.clientY !== undefined && native.clientY !== 0 ? native.clientY : undefined) ??
    ev?.global?.y ??
    ev?.clientY ??
    native?.clientY ??
    0;
  const pointerId = ev?.pointerId ?? native?.pointerId ?? 0;
  const deltaY = ev?.deltaY ?? native?.deltaY ?? ev?.wheelDeltaY ?? (ev?.detail ? ev.detail * 40 : 0);
  return { x, y, pointerId, deltaY };
}

export const SpatialViewport = forwardRef<SpatialContainerHandle, SpatialViewportProps>(
  function SpatialViewport(props, ref) {
    const {
      children,
      worldWidth,
      worldHeight,
      worldBounds: customWorldBounds,
      viewportWidth = 800,
      viewportHeight = 600,
      minZoom = 0.1,
      maxZoom = 10,
      clamp = false,
      follow,
      followLerp = 0.1,
      followDeadzone,
      onViewportChange,
      initialCamera,
      ticker,
    } = props;

    const cameraRef = useRef<CameraState>(
      initialCamera ?? createCameraState(0, 0, 1)
    );
    const gestureStateRef = useRef<GestureState>(createGestureState());
    const listenersRef = useRef<Set<CameraListener>>(new Set());
    const internalContainerRef = useRef<SpatialContainerHandle>({
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
    });

    useImperativeHandle(ref, () => internalContainerRef.current, []);

    const viewportSize: Size = {
      width: viewportWidth,
      height: viewportHeight,
    };

    const effectiveWorldBounds: Rect | undefined = customWorldBounds ?? (
      worldWidth !== undefined && worldHeight !== undefined
        ? { x: 0, y: 0, width: worldWidth, height: worldHeight }
        : undefined
    );

    const onViewportChangeRef = useRef(onViewportChange);
    useEffect(() => {
      onViewportChangeRef.current = onViewportChange;
    }, [onViewportChange]);

    const lastNotifyTimeRef = useRef(-Infinity);
    const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const notifyViewportChange = useCallback((camera: CameraState) => {
      // 1. Notify immediate subscribers
      for (const listener of listenersRef.current) {
        listener(camera);
      }

      // 2. Throttled callback for onViewportChange (max once per 100ms)
      if (!onViewportChangeRef.current) return;

      const now = Date.now();
      const elapsed = now - lastNotifyTimeRef.current;

      if (elapsed >= 100) {
        lastNotifyTimeRef.current = now;
        onViewportChangeRef.current(camera);
      } else if (!notifyTimeoutRef.current) {
        notifyTimeoutRef.current = setTimeout(() => {
          notifyTimeoutRef.current = null;
          lastNotifyTimeRef.current = Date.now();
          if (onViewportChangeRef.current) {
            onViewportChangeRef.current(cameraRef.current);
          }
        }, 100 - elapsed);
      }
    }, []);

    useEffect(() => {
      return () => {
        if (notifyTimeoutRef.current) {
          clearTimeout(notifyTimeoutRef.current);
        }
      };
    }, []);

    const getCamera = useCallback(() => cameraRef.current, []);
    const getViewport = useCallback(() => viewportSize, [viewportWidth, viewportHeight]);
    const subscribe = useCallback((listener: CameraListener) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    }, []);

    const contextValue: ViewportContextValue = {
      getCamera,
      getViewport,
      subscribe,
    };

    // Apply gesture events to camera
    const dispatchGesture = useCallback(
      (type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'wheel', e: unknown) => {
        const data = extractEventData(e);
        const config = {
          viewport: viewportSize,
          worldBounds: clamp ? effectiveWorldBounds : undefined,
          minZoom,
          maxZoom,
        };

        const res = handleGesture(
          gestureStateRef.current,
          cameraRef.current,
          {
            type,
            x: data.x,
            y: data.y,
            pointerId: data.pointerId,
            deltaY: data.deltaY,
          },
          config
        );

        gestureStateRef.current = res.state;
        const prevCam = cameraRef.current;
        cameraRef.current = res.camera;

        if (
          prevCam.x !== res.camera.x ||
          prevCam.y !== res.camera.y ||
          prevCam.zoom !== res.camera.zoom
        ) {
          notifyViewportChange(res.camera);
        }
      },
      [clamp, effectiveWorldBounds, maxZoom, minZoom, notifyViewportChange, viewportSize]
    );

    // Frame update loop
    const updateFrame = useCallback(() => {
      let camera = cameraRef.current;
      let changed = false;

      // Handle target follow
      let followTargetObj: { x: number; y: number } | null = null;
      if (follow) {
        if ('current' in follow) {
          followTargetObj = follow.current;
        } else {
          followTargetObj = follow;
        }
      }

      if (followTargetObj) {
        const nextCam = followTarget(camera, followTargetObj, followLerp, followDeadzone);
        if (nextCam.x !== camera.x || nextCam.y !== camera.y) {
          camera = nextCam;
          changed = true;
        }
      }

      // Clamp if enabled
      if (clamp && effectiveWorldBounds) {
        const clampedCam = clampCamera(camera, effectiveWorldBounds, viewportSize);
        if (clampedCam.x !== camera.x || clampedCam.y !== camera.y) {
          camera = clampedCam;
          changed = true;
        }
      }

      if (changed) {
        cameraRef.current = camera;
        notifyViewportChange(camera);
      }

      // Directly mutate container transform per frame
      const container = internalContainerRef.current;
      if (container) {
        container.position.x = viewportWidth / 2 - camera.x * camera.zoom;
        container.position.y = viewportHeight / 2 - camera.y * camera.zoom;
        container.scale.x = camera.zoom;
        container.scale.y = camera.zoom;
      }
    }, [
      clamp,
      effectiveWorldBounds,
      follow,
      followDeadzone,
      followLerp,
      notifyViewportChange,
      viewportHeight,
      viewportSize,
      viewportWidth,
    ]);

    // Attach custom ticker if supplied
    useEffect(() => {
      if (ticker) {
        const remove = ticker.add(updateFrame);
        return () => {
          if (remove) remove();
        };
      }
    }, [ticker, updateFrame]);

    // Event handlers for Pixi / DOM
    const handlePointerDown = (e: React.SyntheticEvent) => dispatchGesture('pointerdown', e);
    const handlePointerMove = (e: React.SyntheticEvent) => dispatchGesture('pointermove', e);
    const handlePointerUp = (e: React.SyntheticEvent) => dispatchGesture('pointerup', e);
    const handlePointerCancel = (e: React.SyntheticEvent) => dispatchGesture('pointercancel', e);
    const handleWheel = (e: React.SyntheticEvent) => dispatchGesture('wheel', e);

    return (
      <ViewportContext.Provider value={contextValue}>
        <div
          data-testid="spatial-viewport"
          style={{
            position: 'relative',
            width: viewportWidth,
            height: viewportHeight,
            overflow: 'hidden',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
        >
          {children}
        </div>
      </ViewportContext.Provider>
    );
  }
);

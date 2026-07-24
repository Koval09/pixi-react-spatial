import React, {
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useImperativeHandle,
  forwardRef,
  type ReactNode,
  type RefObject,
} from 'react';
import type { CameraState, Deadzone, Rect, Size } from '../core/camera';
import { clampCamera, createCameraState, followTarget } from '../core/camera';
import { createGestureState, handleGesture, type GestureState } from '../core/gestures';
import { ViewportContext, type CameraListener, type ViewportContextValue, type ViewportHandle } from './context';

export interface SpatialViewportProps {
  children?: ReactNode;
  container?: unknown;
  targetElement?: HTMLElement | null;
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

function applyContainerTransform(container: unknown, posX: number, posY: number, zoom: number): void {
  if (!container) return;

  const target = container as {
    position?: { set?: (x: number, y: number) => void };
    scale?: { set?: (x: number, y: number) => void };
    style?: { transform?: string; transformOrigin?: string };
  };

  if (typeof target.position?.set === 'function' && typeof target.scale?.set === 'function') {
    target.position.set(posX, posY);
    target.scale.set(zoom, zoom);
    return;
  }

  if (target.style && 'transform' in target.style) {
    target.style.transformOrigin = '0 0';
    target.style.transform = `translate3d(${posX}px, ${posY}px, 0px) scale(${zoom})`;
    return;
  }

  throw new Error(
    'SpatialViewport: target container must be a valid PixiJS Container instance with position.set and scale.set methods or a DOM Element.'
  );
}

function isValidContainer(node: unknown): boolean {
  if (!node) return false;
  const target = node as {
    position?: { set?: (x: number, y: number) => void };
    scale?: { set?: (x: number, y: number) => void };
    style?: { transform?: string };
  };
  return (
    (typeof target.position?.set === 'function' && typeof target.scale?.set === 'function') ||
    Boolean(target.style && 'transform' in target.style)
  );
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export const SpatialViewport = forwardRef<ViewportHandle, SpatialViewportProps>(
  function SpatialViewport(props, ref) {
    const {
      children,
      container: containerProp,
      targetElement,
      worldWidth = 8000,
      worldHeight = 8000,
      worldBounds: propWorldBounds,
      viewportWidth: propViewportWidth,
      viewportHeight: propViewportHeight,
      minZoom = 0.1,
      maxZoom = 4.0,
      clamp = false,
      follow,
      followLerp = 0.1,
      followDeadzone,
      onViewportChange,
      initialCamera,
      ticker,
    } = props;

    const [observedSize, setObservedSize] = useState<Size | null>(null);
    const viewportRootRef = useRef<HTMLDivElement | null>(null);
    const overlayRef = useRef<HTMLElement | null>(null);

    // Imperative DOM overlay creation for Pixi canvas target mode
    useEffect(() => {
      if (typeof document === 'undefined') return;
      if (!targetElement) return;

      let overlay = document.querySelector<HTMLElement>('[data-testid="spatial-viewport"]');
      let created = false;
      let prevPos: string | undefined;

      if (!overlay) {
        overlay = document.createElement('div');
        overlay.setAttribute('data-testid', 'spatial-viewport');
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.pointerEvents = 'none';
        overlay.style.overflow = 'hidden';

        const parent = targetElement.parentElement ?? document.body;
        prevPos = parent.style.position;
        if (parent.style.position !== 'relative' && parent.style.position !== 'absolute') {
          parent.style.position = 'relative';
        }
        parent.appendChild(overlay);
        created = true;
      }

      overlayRef.current = overlay;

      return () => {
        if (created && overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
          const parent = targetElement.parentElement ?? document.body;
          if (prevPos !== undefined) {
            parent.style.position = prevPos;
          }
        }
        if (overlayRef.current === overlay) {
          overlayRef.current = null;
        }
      };
    }, [targetElement]);

    // Dynamic ResizeObserver on root element (active ONLY when explicit viewportWidth/Height props are omitted)
    useEffect(() => {
      if (typeof propViewportWidth === 'number' && typeof propViewportHeight === 'number') return;
      const root = viewportRootRef.current ?? targetElement;
      if (!root || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setObservedSize((prev) => {
              if (prev && prev.width === width && prev.height === height) return prev;
              return { width, height };
            });
          }
        }
      });

      observer.observe(root);
      return () => observer.disconnect();
    }, [propViewportWidth, propViewportHeight, targetElement]);

    const effectiveWorldBounds: Rect = propWorldBounds ?? {
      x: 0,
      y: 0,
      width: worldWidth,
      height: worldHeight,
    };

    const viewportSize: Size = useMemo(
      () => ({
        width: propViewportWidth ?? observedSize?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 800),
        height: propViewportHeight ?? observedSize?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 600),
      }),
      [propViewportWidth, propViewportHeight, observedSize]
    );

    const cameraRef = useRef<CameraState>(
      initialCamera ?? createCameraState(0, 0, 1.0)
    );

    const gestureStateRef = useRef<GestureState>(createGestureState());
    const containerInstanceRef = useRef<unknown | null>(null);
    const listenersRef = useRef<Set<CameraListener>>(new Set());

    const setContainerRef = useCallback((node: unknown) => {
      containerInstanceRef.current = node;
    }, []);

    const getActiveContainer = useCallback(() => {
      const active = containerProp ?? containerInstanceRef.current;
      return active;
    }, [containerProp]);

    const activeContainer = getActiveContainer();
    if (activeContainer && !isValidContainer(activeContainer)) {
      throw new Error(
        'SpatialViewport: target container must be a valid PixiJS Container instance with position.set and scale.set methods.'
      );
    }

    const notifyListeners = useCallback(() => {
      const cam = cameraRef.current;
      for (const listener of listenersRef.current) {
        listener(cam);
      }
    }, []);

    const lastReportedCamRef = useRef<CameraState | null>(null);
    const lastReportedTime = useRef<number>(0);

    const checkReportChange = useCallback(() => {
      if (!onViewportChange) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastReportedTime.current >= 100) {
        const cam = cameraRef.current;
        const last = lastReportedCamRef.current;
        const EPS = 0.001;
        if (
          !last ||
          Math.abs(cam.x - last.x) > EPS ||
          Math.abs(cam.y - last.y) > EPS ||
          Math.abs(cam.zoom - last.zoom) > EPS
        ) {
          lastReportedCamRef.current = { ...cam };
          lastReportedTime.current = now;
          onViewportChange(cam);
        }
      }
    }, [onViewportChange]);

    const getCamera = useCallback(() => cameraRef.current, []);
    const getViewport = useCallback(() => viewportSize, [viewportSize.height, viewportSize.width]);

    const subscribe = useCallback((listener: CameraListener) => {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    }, []);

    const getOverlayElement = useCallback(() => {
      return (
        overlayRef.current ??
        viewportRootRef.current ??
        (typeof document !== 'undefined'
          ? document.querySelector<HTMLElement>('[data-testid="spatial-viewport"]')
          : null)
      );
    }, []);

    const contextValue: ViewportContextValue = useMemo(
      () => ({
        getCamera,
        getViewport,
        subscribe,
        getOverlayElement,
      }),
      [getCamera, getViewport, subscribe, getOverlayElement]
    );

    useImperativeHandle(ref, () => contextValue, [contextValue]);

    const updateFrame = useCallback(() => {
      let currentCam = cameraRef.current;

      let targetPos: { x: number; y: number } | null = null;
      if (follow) {
        if ('current' in follow) {
          targetPos = follow.current;
        } else {
          targetPos = follow;
        }
      }

      if (targetPos) {
        currentCam = followTarget(currentCam, targetPos, followLerp, followDeadzone);
      }

      if (clamp) {
        currentCam = clampCamera(currentCam, effectiveWorldBounds, viewportSize);
      }

      const prevCam = cameraRef.current;
      const changed =
        prevCam.x !== currentCam.x || prevCam.y !== currentCam.y || prevCam.zoom !== currentCam.zoom;

      cameraRef.current = currentCam;

      const halfW = viewportSize.width / 2;
      const halfH = viewportSize.height / 2;
      const posX = halfW - currentCam.x * currentCam.zoom;
      const posY = halfH - currentCam.y * currentCam.zoom;

      const targetContainer = getActiveContainer();
      applyContainerTransform(targetContainer, posX, posY, currentCam.zoom);

      if (changed) {
        notifyListeners();
        checkReportChange();
      }
    }, [
      follow,
      followLerp,
      followDeadzone,
      clamp,
      effectiveWorldBounds,
      viewportSize,
      getActiveContainer,
      notifyListeners,
      checkReportChange,
    ]);

    useIsomorphicLayoutEffect(() => {
      updateFrame();
    }, [updateFrame]);

    const dispatchGesture = useCallback(
      (
        type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'wheel',
        e: unknown
      ) => {
        const { x, y, pointerId, deltaY } = extractEventData(e);
        const { camera: nextCam, state: nextGesture } = handleGesture(
          gestureStateRef.current,
          cameraRef.current,
          {
            type,
            x,
            y,
            pointerId,
            deltaY,
          },
          {
            viewport: viewportSize,
            minZoom,
            maxZoom,
            worldBounds: clamp ? effectiveWorldBounds : undefined,
          }
        );

        const prevCam = cameraRef.current;
        const changed =
          prevCam.x !== nextCam.x || prevCam.y !== nextCam.y || prevCam.zoom !== nextCam.zoom;

        cameraRef.current = nextCam;
        gestureStateRef.current = nextGesture;

        updateFrame();

        if (changed) {
          notifyListeners();
          checkReportChange();
        }
      },
      [viewportSize, minZoom, maxZoom, clamp, effectiveWorldBounds, updateFrame, notifyListeners, checkReportChange]
    );

    // Event listeners attached to targetElement (e.g. app.canvas) or viewportRootRef
    useEffect(() => {
      const target = targetElement ?? viewportRootRef.current;
      if (!target) return;

      const onPointerDown = (e: PointerEvent) => dispatchGesture('pointerdown', e);
      const onPointerMove = (e: PointerEvent) => dispatchGesture('pointermove', e);
      const onPointerUp = (e: PointerEvent) => dispatchGesture('pointerup', e);
      const onPointerCancel = (e: PointerEvent) => dispatchGesture('pointercancel', e);
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        dispatchGesture('wheel', e);
      };

      target.addEventListener('pointerdown', onPointerDown as EventListener);
      target.addEventListener('pointermove', onPointerMove as EventListener);
      target.addEventListener('pointerup', onPointerUp as EventListener);
      target.addEventListener('pointercancel', onPointerCancel as EventListener);
      target.addEventListener('wheel', onWheel as EventListener, { passive: false });

      return () => {
        target.removeEventListener('pointerdown', onPointerDown as EventListener);
        target.removeEventListener('pointermove', onPointerMove as EventListener);
        target.removeEventListener('pointerup', onPointerUp as EventListener);
        target.removeEventListener('pointercancel', onPointerCancel as EventListener);
        target.removeEventListener('wheel', onWheel as EventListener);
      };
    }, [targetElement, dispatchGesture]);

    useEffect(() => {
      if (typeof window === 'undefined' || ticker) return;

      let animId: number;
      const loop = () => {
        updateFrame();
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);

      return () => {
        cancelAnimationFrame(animId);
      };
    }, [ticker, updateFrame]);

    useEffect(() => {
      if (ticker) {
        const remove = ticker.add(updateFrame);
        return () => {
          if (remove) remove();
        };
      }
    }, [ticker, updateFrame]);

    const isPixiTree = Boolean(targetElement);

    if (isPixiTree) {
      // In PixiJS tree mode, NEVER render HTML JSX <div> elements (render ONLY pixiContainer)
      return (
        <ViewportContext.Provider value={contextValue}>
          {React.createElement('pixiContainer', { ref: setContainerRef }, children)}
        </ViewportContext.Provider>
      );
    }

    // Standard DOM mode
    return (
      <ViewportContext.Provider value={contextValue}>
        <div
          ref={viewportRootRef}
          data-testid="spatial-viewport"
          style={{
            position: 'relative',
            width: typeof viewportSize.width === 'number' ? `${viewportSize.width}px` : viewportSize.width,
            height: typeof viewportSize.height === 'number' ? `${viewportSize.height}px` : viewportSize.height,
            overflow: 'hidden',
          }}
        >
          <div
            ref={setContainerRef as (node: HTMLDivElement | null) => void}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            {children}
          </div>
        </div>
      </ViewportContext.Provider>
    );
  }
);

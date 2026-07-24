import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { worldToScreen, type Point } from '../core/camera';
import { useOptionalViewportContext, type ViewportHandle } from './context';

export interface WorldPortalAnchor {
  x: number;
  y: number;
}

export interface WorldPortalProps {
  children?: ReactNode;
  at: Point | (() => Point);
  anchor?: number | WorldPortalAnchor;
  hideWhenOffscreen?: boolean; // default true
  interactive?: boolean; // default false
  clampToScreen?: boolean; // default false
  className?: string;
  style?: CSSProperties;
  /**
   * Viewport handle providing camera, viewport size, and frame subscriptions.
   * Required when rendering WorldPortal in the DOM tree outside SpatialViewport.
   */
  viewport?: ViewportHandle;
  /** Custom ticker override for testing or manual frame updates */
  ticker?: { add: (fn: (delta: number) => void) => () => void };
}

/**
 * WorldPortal projects 2D world coordinates to CSS translate3d screen positions in real-time.
 * MUST be rendered in the react-dom tree (e.g. next to <Application>), NOT inside <Application>.
 */
export function WorldPortal(props: WorldPortalProps): React.ReactPortal | null {
  const {
    children,
    at,
    anchor = 0,
    hideWhenOffscreen = true,
    interactive = false,
    clampToScreen = false,
    className,
    style,
    viewport: viewportProp,
    ticker,
  } = props;

  // Resolution order: viewport prop first, then SpatialViewport context
  const contextViewport = useOptionalViewportContext();
  const activeViewport = viewportProp ?? contextViewport;

  if (!activeViewport) {
    throw new Error(
      'WorldPortal must receive a viewport prop or be rendered inside SpatialViewport.'
    );
  }

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerMounted, setContainerMounted] = useState(false);

  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  }, [at]);

  const anchorRef = useRef(anchor);
  useEffect(() => {
    anchorRef.current = anchor;
  }, [anchor]);

  // Update position via direct DOM mutation on frame tick (ZERO setState per frame)
  const updatePosition = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const camera = activeViewport.getCamera();
    const viewport = activeViewport.getViewport();
    const currentAt = atRef.current;
    const targetAt = typeof currentAt === 'function' ? currentAt() : currentAt;
    const currentAnchor = anchorRef.current;

    const screen = worldToScreen(targetAt, camera, viewport);

    let screenX = screen.x;
    let screenY = screen.y;

    if (clampToScreen) {
      screenX = Math.max(0, Math.min(viewport.width, screenX));
      screenY = Math.max(0, Math.min(viewport.height, screenY));
    }

    const ax = typeof currentAnchor === 'number' ? currentAnchor : currentAnchor.x;
    const ay = typeof currentAnchor === 'number' ? currentAnchor : currentAnchor.y;

    const transformStr =
      ax === 0 && ay === 0
        ? `translate3d(${screenX}px, ${screenY}px, 0)`
        : `translate3d(${screenX}px, ${screenY}px, 0) translate(${-ax * 100}%, ${-ay * 100}%)`;

    el.style.transform = transformStr;

    const isOffscreen =
      screen.x < 0 || screen.x > viewport.width || screen.y < 0 || screen.y > viewport.height;

    if (hideWhenOffscreen && isOffscreen && !clampToScreen) {
      el.style.visibility = 'hidden';
    } else {
      el.style.visibility = 'visible';
    }
  }, [activeViewport, clampToScreen, hideWhenOffscreen]);

  // Attach wrapper element to viewport container via activeViewport.getOverlayElement()
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.willChange = 'transform';
    el.style.pointerEvents = interactive ? 'auto' : 'none';
    if (className) el.className = className;
    if (style) {
      Object.assign(el.style, style);
    }

    wrapperRef.current = el;

    let attached = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryAttach = () => {
      if (attached) return;
      const targetOverlay = activeViewport.getOverlayElement() ?? document.body;
      targetOverlay.appendChild(el);
      attached = true;
      updatePosition();
      setContainerMounted(true);
    };

    tryAttach();

    if (!attached) {
      retryTimer = setTimeout(tryAttach, 0);
    }

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      setContainerMounted(false);
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
      wrapperRef.current = null;
    };
  }, [activeViewport, updatePosition]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    el.style.pointerEvents = interactive ? 'auto' : 'none';
    if (className) el.className = className;
    if (style) Object.assign(el.style, style);
  }, [className, interactive, style]);

  const isGetter = typeof at === 'function';

  // Single position update subscription:
  // - If ticker is provided: use ticker.
  // - Else if at is a getter function: ONLY use rAF loop.
  // - Else (at is static point): ONLY subscribe to activeViewport.subscribe.
  useEffect(() => {
    if (!containerMounted) return;

    if (ticker) {
      const remove = ticker.add(updatePosition);
      return () => {
        if (remove) remove();
      };
    } else if (isGetter) {
      let animId: number;
      const loop = () => {
        updatePosition();
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);
      return () => {
        cancelAnimationFrame(animId);
      };
    } else {
      const unsubscribe = activeViewport.subscribe(updatePosition);
      return () => {
        unsubscribe();
      };
    }
  }, [activeViewport, containerMounted, isGetter, ticker, updatePosition]);

  // Return null until DOM wrapper is attached to overlay to prevent leaking text nodes to Pixi React reconciler
  if (!containerMounted || !wrapperRef.current) {
    return null;
  }

  return createPortal(children, wrapperRef.current);
}

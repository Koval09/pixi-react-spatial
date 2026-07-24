import React, {
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { worldToScreen, type Point } from '../core/camera';
import { useViewportContext } from './context';

export interface WorldPortalAnchor {
  x: number;
  y: number;
}

export interface WorldPortalProps {
  children?: ReactNode;
  at: Point;
  anchor?: number | WorldPortalAnchor;
  hideWhenOffscreen?: boolean; // default true
  interactive?: boolean; // default false
  clampToScreen?: boolean; // default false
  className?: string;
  style?: CSSProperties;
  /** Custom ticker override for testing or manual frame updates */
  ticker?: { add: (fn: (delta: number) => void) => () => void };
}

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
    ticker,
  } = props;

  const viewportCtx = useViewportContext();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Lazy creation of DOM node in effect (SSR-safe)
  if (wrapperRef.current === null && typeof document !== 'undefined') {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.willChange = 'transform';
    el.style.pointerEvents = interactive ? 'auto' : 'none';
    wrapperRef.current = el;
  }

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

    const camera = viewportCtx.getCamera();
    const viewport = viewportCtx.getViewport();
    const targetAt = atRef.current;
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
  }, [clampToScreen, hideWhenOffscreen, viewportCtx]);

  // Attach wrapper element to viewport container or body
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    el.style.pointerEvents = interactive ? 'auto' : 'none';
    if (className) el.className = className;
    if (style) {
      Object.assign(el.style, style);
    }

    // Locate viewport DOM container
    let container = document.querySelector<HTMLElement>('[data-testid="spatial-viewport"]');
    if (!container) {
      container = document.body;
    }

    container.appendChild(el);
    // Initial position sync
    updatePosition();

    return () => {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    };
  }, [className, interactive, style, updatePosition]);

  // Subscribe to ticker or viewportContext
  useEffect(() => {
    if (ticker) {
      const remove = ticker.add(updatePosition);
      return () => {
        if (remove) remove();
      };
    } else {
      const unsubscribe = viewportCtx.subscribe(updatePosition);
      return () => {
        unsubscribe();
      };
    }
  }, [ticker, updatePosition, viewportCtx]);

  if (!wrapperRef.current) return null;
  return createPortal(children, wrapperRef.current);
}

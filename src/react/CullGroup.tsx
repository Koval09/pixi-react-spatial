import React, {
  createContext,
  useContext,
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  type ReactNode,
} from 'react';
import type { Rect } from '../core/quadtree';
import { Quadtree } from '../core/quadtree';
import { useViewportContext } from './context';

export interface CullableHandle {
  renderable: boolean;
}

export interface CullItemEntry {
  id: symbol | object;
  target: CullableHandle;
  getRect: () => Rect;
}

export interface CullContextValue {
  register: (entry: CullItemEntry) => () => void;
  markDirty: (entry: CullItemEntry) => void;
}

export const CullContext = createContext<CullContextValue | null>(null);

export interface CullStats {
  total: number;
  visible: number;
}

export interface CullGroupHandle {
  getStats: () => CullStats;
}

export interface CullGroupProps {
  children?: ReactNode;
  bounds?: Rect;
  overscan?: number; // default 0.2 (20%)
  enabled?: boolean; // default true
  /** Custom ticker override for testing or manual frame updates */
  ticker?: { add: (fn: (delta: number) => void) => () => void };
}

const DEFAULT_BOUNDS: Rect = {
  x: -10000,
  y: -10000,
  width: 20000,
  height: 20000,
};

export const CullGroup = forwardRef<CullGroupHandle, CullGroupProps>(
  function CullGroup(props, ref) {
    const {
      children,
      bounds = DEFAULT_BOUNDS,
      overscan = 0.2,
      enabled = true,
      ticker,
    } = props;

    const viewportCtx = useViewportContext();
    const quadtreeRef = useRef<Quadtree<CullItemEntry>>(
      new Quadtree<CullItemEntry>(bounds)
    );
    const registeredSetRef = useRef<Set<CullItemEntry>>(new Set());
    const statsRef = useRef<CullStats>({ total: 0, visible: 0 });

    useImperativeHandle(
      ref,
      () => ({
        getStats: () => ({ ...statsRef.current }),
      }),
      []
    );

    // Recreate Quadtree if bounds prop changes meaningfully
    const prevBoundsRef = useRef(bounds);
    if (
      prevBoundsRef.current.x !== bounds.x ||
      prevBoundsRef.current.y !== bounds.y ||
      prevBoundsRef.current.width !== bounds.width ||
      prevBoundsRef.current.height !== bounds.height
    ) {
      prevBoundsRef.current = bounds;
      const newQt = new Quadtree<CullItemEntry>(bounds);
      for (const entry of registeredSetRef.current) {
        newQt.insert(entry, entry.getRect());
      }
      quadtreeRef.current = newQt;
    }

    const register = useCallback((entry: CullItemEntry) => {
      registeredSetRef.current.add(entry);
      quadtreeRef.current.insert(entry, entry.getRect());

      return () => {
        registeredSetRef.current.delete(entry);
        quadtreeRef.current.remove(entry);
      };
    }, []);

    const markDirty = useCallback((entry: CullItemEntry) => {
      if (registeredSetRef.current.has(entry)) {
        quadtreeRef.current.update(entry, entry.getRect());
      }
    }, []);

    const updateCulling = useCallback(() => {
      const registered = registeredSetRef.current;
      const totalCount = registered.size;

      if (!enabled) {
        for (const entry of registered) {
          entry.target.renderable = true;
        }
        statsRef.current = { total: totalCount, visible: totalCount };
        return;
      }

      const camera = viewportCtx.getCamera();
      const viewport = viewportCtx.getViewport();

      const visW = viewport.width / camera.zoom;
      const visH = viewport.height / camera.zoom;
      const visX = camera.x - visW / 2;
      const visY = camera.y - visH / 2;

      const marginW = visW * overscan;
      const marginH = visH * overscan;

      const queryRect: Rect = {
        x: visX - marginW,
        y: visY - marginH,
        width: visW + 2 * marginW,
        height: visH + 2 * marginH,
      };

      const visibleEntries = quadtreeRef.current.query(queryRect);
      const visibleSet = new Set(visibleEntries);

      for (const entry of registered) {
        entry.target.renderable = visibleSet.has(entry);
      }

      statsRef.current = {
        total: totalCount,
        visible: visibleSet.size,
      };
    }, [enabled, overscan, viewportCtx]);

    // Attach custom ticker or register subscriber on ViewportContext
    useEffect(() => {
      if (ticker) {
        const remove = ticker.add(updateCulling);
        return () => {
          if (remove) remove();
        };
      } else {
        const unsubscribe = viewportCtx.subscribe(updateCulling);
        return () => {
          unsubscribe();
        };
      }
    }, [ticker, updateCulling, viewportCtx]);

    const contextValue: CullContextValue = {
      register,
      markDirty,
    };

    return (
      <CullContext.Provider value={contextValue}>
        {children}
      </CullContext.Provider>
    );
  }
);

export function useCullable<T extends CullableHandle>(
  targetRef: React.RefObject<T | null> | T | null,
  getRect: () => Rect
): { markDirty: () => void } {
  const ctx = useContext(CullContext);
  const entryRef = useRef<CullItemEntry | null>(null);

  const getRectRef = useRef(getRect);
  useEffect(() => {
    getRectRef.current = getRect;
  }, [getRect]);

  useEffect(() => {
    if (!ctx) return;
    const target = targetRef && 'current' in targetRef ? targetRef.current : targetRef;
    if (!target) return;

    const entry: CullItemEntry = {
      id: Symbol(),
      target,
      getRect: () => getRectRef.current(),
    };
    entryRef.current = entry;

    const unregister = ctx.register(entry);
    return () => {
      unregister();
      entryRef.current = null;
    };
  }, [ctx, targetRef]);

  const markDirty = useCallback(() => {
    if (ctx && entryRef.current) {
      ctx.markDirty(entryRef.current);
    }
  }, [ctx]);

  return { markDirty };
}

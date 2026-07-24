import { jsx as _jsx } from "react/jsx-runtime";
import React, { createContext, useContext, useRef, useCallback, useEffect, useImperativeHandle, forwardRef, } from 'react';
import { Quadtree } from '../core/quadtree';
import { useViewportContext } from './context';
const CullGroupContext = createContext(null);
function applyRenderable(target, visible) {
    if (!target)
        return;
    const obj = target;
    if ('renderable' in obj) {
        if (obj.renderable !== visible) {
            obj.renderable = visible;
        }
    }
    if (obj.style && 'display' in obj.style) {
        const nextDisplay = visible ? '' : 'none';
        if (obj.style.display !== nextDisplay) {
            obj.style.display = nextDisplay;
        }
    }
}
function isRectContained(outer, inner) {
    return (inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height);
}
export function useCullable(targetRef, getRect) {
    const context = useContext(CullGroupContext);
    const handleRef = useRef(null);
    useEffect(() => {
        if (!context || !targetRef.current)
            return;
        const handle = {
            getRect,
            target: targetRef.current,
            cachedRect: getRect(),
            frameStamp: 0,
            lastVisibleState: undefined,
        };
        handleRef.current = handle;
        const unregister = context.register(handle);
        return () => {
            unregister();
            handleRef.current = null;
        };
    }, [context, getRect, targetRef]);
    const markDirty = useCallback(() => {
        if (context && handleRef.current) {
            handleRef.current.cachedRect = handleRef.current.getRect();
            context.markDirty(handleRef.current);
        }
    }, [context]);
    return { markDirty };
}
export const CullGroup = forwardRef(function CullGroup(props, ref) {
    const { children, bounds = { x: 0, y: 0, width: 8000, height: 8000 }, overscan = 0.2, enabled = true, } = props;
    const viewportCtx = useViewportContext();
    const quadtreeRef = useRef(new Quadtree(bounds));
    const registeredSetRef = useRef(new Set());
    const statsRef = useRef({ total: 0, visible: 0, culled: 0, rebuildCount: 0 });
    const currentFrameStampRef = useRef(1);
    const queryResultsRef = useRef([]);
    const lastQueryRectRef = useRef(null);
    useImperativeHandle(ref, () => ({
        getStats: () => ({ ...statsRef.current }),
    }), []);
    // Recreate Quadtree if bounds prop changes
    const prevBoundsRef = useRef(bounds);
    if (prevBoundsRef.current.x !== bounds.x ||
        prevBoundsRef.current.y !== bounds.y ||
        prevBoundsRef.current.width !== bounds.width ||
        prevBoundsRef.current.height !== bounds.height) {
        prevBoundsRef.current = bounds;
        const newQt = new Quadtree(bounds);
        for (const entry of registeredSetRef.current) {
            const r = entry.cachedRect ?? entry.getRect();
            entry.cachedRect = r;
            newQt.insert(entry, r);
        }
        quadtreeRef.current = newQt;
        lastQueryRectRef.current = null;
    }
    const register = useCallback((entry) => {
        registeredSetRef.current.add(entry);
        const r = entry.cachedRect ?? entry.getRect();
        entry.cachedRect = r;
        quadtreeRef.current.insert(entry, r);
        return () => {
            registeredSetRef.current.delete(entry);
            quadtreeRef.current.remove(entry, r);
        };
    }, []);
    const markDirty = useCallback((entry) => {
        if (registeredSetRef.current.has(entry)) {
            const r = entry.getRect();
            entry.cachedRect = r;
            quadtreeRef.current.update(entry, r);
        }
    }, []);
    const updateCulling = useCallback(() => {
        const registered = registeredSetRef.current;
        const totalCount = registered.size;
        const qtRebuildCount = quadtreeRef.current.rebuildCount;
        if (!enabled) {
            for (const entry of registered) {
                if (entry.lastVisibleState !== true) {
                    applyRenderable(entry.target, true);
                    entry.lastVisibleState = true;
                }
            }
            statsRef.current = { total: totalCount, visible: totalCount, culled: 0, rebuildCount: qtRebuildCount };
            lastQueryRectRef.current = null;
            return;
        }
        const camera = viewportCtx.getCamera();
        const viewport = viewportCtx.getViewport();
        const visW = viewport.width / camera.zoom;
        const visH = viewport.height / camera.zoom;
        // FAST PATH 1: Max Zoom-Out / Full World Visible
        if (visW >= bounds.width && visH >= bounds.height) {
            for (const entry of registered) {
                if (entry.lastVisibleState !== true) {
                    applyRenderable(entry.target, true);
                    entry.lastVisibleState = true;
                }
            }
            statsRef.current = {
                total: totalCount,
                visible: totalCount,
                culled: 0,
                rebuildCount: qtRebuildCount,
            };
            lastQueryRectRef.current = null;
            return;
        }
        const visibleCameraRect = {
            x: camera.x - visW / 2,
            y: camera.y - visH / 2,
            width: visW,
            height: visH,
        };
        const marginX = visW * overscan;
        const marginY = visH * overscan;
        const targetQueryRect = {
            x: camera.x - visW / 2 - marginX,
            y: camera.y - visH / 2 - marginY,
            width: visW + 2 * marginX,
            height: visH + 2 * marginY,
        };
        if (lastQueryRectRef.current &&
            isRectContained(lastQueryRectRef.current, visibleCameraRect) &&
            lastQueryRectRef.current.width <= targetQueryRect.width * 1.5 &&
            lastQueryRectRef.current.height <= targetQueryRect.height * 1.5) {
            statsRef.current = {
                total: totalCount,
                visible: statsRef.current.visible,
                culled: statsRef.current.culled,
                rebuildCount: qtRebuildCount,
            };
            return;
        }
        lastQueryRectRef.current = targetQueryRect;
        const frameStamp = ++currentFrameStampRef.current;
        const queryResults = quadtreeRef.current.query(targetQueryRect, undefined, queryResultsRef.current);
        let visibleCount = 0;
        for (let i = 0; i < queryResults.length; i++) {
            const entry = queryResults[i];
            if (entry.frameStamp !== frameStamp) {
                entry.frameStamp = frameStamp;
                visibleCount++;
            }
        }
        if (visibleCount === totalCount) {
            for (const entry of registered) {
                if (entry.lastVisibleState !== true) {
                    applyRenderable(entry.target, true);
                    entry.lastVisibleState = true;
                }
            }
            statsRef.current = {
                total: totalCount,
                visible: totalCount,
                culled: 0,
                rebuildCount: qtRebuildCount,
            };
            return;
        }
        for (const entry of registered) {
            const isVisible = entry.frameStamp === frameStamp;
            if (entry.lastVisibleState !== isVisible) {
                applyRenderable(entry.target, isVisible);
                entry.lastVisibleState = isVisible;
            }
        }
        const finalVisibleCount = Math.min(totalCount, visibleCount);
        const culledCount = Math.max(0, totalCount - finalVisibleCount);
        statsRef.current = {
            total: totalCount,
            visible: finalVisibleCount,
            culled: culledCount,
            rebuildCount: qtRebuildCount,
        };
    }, [bounds.height, bounds.width, enabled, overscan, viewportCtx]);
    useEffect(() => {
        updateCulling();
        const unsubscribe = viewportCtx.subscribe(() => {
            updateCulling();
        });
        return () => {
            unsubscribe();
        };
    }, [updateCulling, viewportCtx]);
    const contextValue = {
        register,
        markDirty,
    };
    // Render purely pixiContainer element in PixiJS scene graph tree
    return (_jsx(CullGroupContext.Provider, { value: contextValue, children: React.createElement('pixiContainer', null, children) }));
});

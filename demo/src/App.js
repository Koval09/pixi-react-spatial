import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Application, extend, useApplication, useTick } from '@pixi/react';
import { Container, Sprite, Graphics } from 'pixi.js';
import { SpatialViewport, CullGroup, WorldPortal, useCullable, } from 'pixi-react-spatial';
// Register PixiJS display objects for @pixi/react v8 JSX elements (<pixiContainer>, <pixiSprite>)
extend({ Container, Sprite, Graphics });
// Memoized Static Sprite Item (9,980 items rendered inside WebGL canvas)
const StaticSpriteItem = React.memo(function StaticSpriteItem({ creature, texture, }) {
    const spriteRef = useRef(null);
    const getRect = useCallback(() => ({
        x: creature.x - creature.size / 2,
        y: creature.y - creature.size / 2,
        width: creature.size,
        height: creature.size,
    }), [creature.x, creature.y, creature.size]);
    useCullable(spriteRef, getRect);
    return (_jsx("pixiSprite", { ref: spriteRef, texture: texture, x: creature.x, y: creature.y, width: creature.size, height: creature.size, anchor: 0.5, tint: creature.color }));
});
// Individual Moving Sprite Item (20 items rendered inside WebGL canvas)
function MovingSpriteItem({ creature, texture, onRegisterUpdater, }) {
    const spriteRef = useRef(null);
    const posRef = useRef({ x: creature.x, y: creature.y });
    const getRect = useCallback(() => ({
        x: posRef.current.x - creature.size / 2,
        y: posRef.current.y - creature.size / 2,
        width: creature.size,
        height: creature.size,
    }), [creature.size]);
    const { markDirty } = useCullable(spriteRef, getRect);
    useEffect(() => {
        onRegisterUpdater(creature.id, (newX, newY) => {
            posRef.current = { x: newX, y: newY };
            if (spriteRef.current) {
                spriteRef.current.position.set(newX, newY);
            }
            markDirty();
        });
    }, [creature.id, markDirty, onRegisterUpdater]);
    return (_jsx("pixiSprite", { ref: spriteRef, texture: texture, x: creature.x, y: creature.y, width: creature.size, height: creature.size, anchor: 0.5, tint: creature.color, zIndex: 10 }));
}
/**
 * WorldPortal Healthbar Overlay
 * RENDERED IN THE REACT-DOM TREE (siblings of Application), NOT INSIDE <Application>.
 */
function CreaturePortal({ creature, viewport, getPosition, }) {
    const portalAtGetter = useCallback(() => {
        const p = getPosition();
        return { x: p.x, y: p.y - creature.size / 2 - 14 };
    }, [creature.size, getPosition]);
    return (_jsx(WorldPortal, { viewport: viewport, at: portalAtGetter, anchor: 0.5, hideWhenOffscreen: true, children: _jsxs("div", { style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '3px',
                pointerEvents: 'none',
            }, children: [_jsx("div", { style: {
                        fontSize: '11px',
                        fontWeight: 700,
                        color: '#f8fafc',
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        border: '1px solid rgba(255, 255, 255, 0.25)',
                        whiteSpace: 'nowrap',
                        backdropFilter: 'blur(4px)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
                    }, children: creature.name }), _jsx("div", { style: {
                        width: '46px',
                        height: '5px',
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        borderRadius: '3px',
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                    }, children: _jsx("div", { style: {
                            width: `${creature.hp}%`,
                            height: '100%',
                            backgroundColor: creature.hp > 50 ? '#22c55e' : '#ef4444',
                            borderRadius: '3px',
                        } }) })] }) }));
}
// Inner Scene component running inside @pixi/react <Application> context (PixiJS tree only!)
function SceneContent({ cullingEnabled, staticCreatures, movingCreatures, movingPositionsRef, onRegisterUpdater, onStatsUpdate, onSpatialViewportMount, }) {
    const { app, isInitialised } = useApplication();
    const cullGroupRef = useRef(null);
    const updatersRef = useRef(new Map());
    // Texture creation strictly after async initialization completes
    const circleTexture = useMemo(() => {
        if (!isInitialised || !app || !app.renderer)
            return null;
        const g = new Graphics();
        g.circle(16, 16, 15).fill({ color: 0xffffff });
        return app.renderer.generateTexture(g);
    }, [app, isInitialised]);
    const localRegisterUpdater = useCallback((id, updater) => {
        updatersRef.current.set(id, updater);
        onRegisterUpdater(id, updater);
    }, [onRegisterUpdater]);
    // Pixi Ticker update with dt clamp (max 100ms) to prevent teleportation on freezes
    const lastFpsTime = useRef(performance.now());
    const frameCount = useRef(0);
    useTick((ticker) => {
        if (!isInitialised)
            return;
        // Clamp deltaMS to maximum 100ms (0.1s)
        const deltaMS = Math.min(ticker.deltaMS, 100);
        const dt = deltaMS / 16.666;
        for (let idx = 0; idx < movingCreatures.length; idx++) {
            const creature = movingCreatures[idx];
            const pos = movingPositionsRef.current[idx];
            let nextX = pos.x + creature.speedX * dt;
            let nextY = pos.y + creature.speedY * dt;
            if (nextX < 100 || nextX > 7900)
                creature.speedX *= -1;
            if (nextY < 100 || nextY > 7900)
                creature.speedY *= -1;
            nextX = Math.max(100, Math.min(7900, nextX));
            nextY = Math.max(100, Math.min(7900, nextY));
            movingPositionsRef.current[idx] = { x: nextX, y: nextY };
            const updater = updatersRef.current.get(creature.id);
            if (updater) {
                updater(nextX, nextY);
            }
        }
        frameCount.current++;
        const now = performance.now();
        if (now - lastFpsTime.current >= 500) {
            const calculatedFps = Math.round((frameCount.current * 1000) / (now - lastFpsTime.current));
            frameCount.current = 0;
            lastFpsTime.current = now;
            if (cullGroupRef.current) {
                onStatsUpdate(cullGroupRef.current.getStats(), calculatedFps);
            }
        }
    });
    const cullBounds = useMemo(() => ({ x: 0, y: 0, width: 8000, height: 8000 }), []);
    if (!isInitialised || !app || !app.renderer || !circleTexture) {
        return null;
    }
    return (_jsx(SpatialViewport, { ref: onSpatialViewportMount, targetElement: app.canvas, worldWidth: 8000, worldHeight: 8000, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, clamp: true, minZoom: 0.1, maxZoom: 4.0, initialCamera: { x: 4000, y: 4000, zoom: 0.5 }, children: _jsxs(CullGroup, { ref: cullGroupRef, bounds: cullBounds, overscan: 0.2, enabled: cullingEnabled, children: [_jsx("pixiContainer", { children: staticCreatures.map((c) => (_jsx(StaticSpriteItem, { creature: c, texture: circleTexture }, c.id))) }), _jsx("pixiContainer", { children: movingCreatures.map((c) => (_jsx(MovingSpriteItem, { creature: c, texture: circleTexture, onRegisterUpdater: localRegisterUpdater }, c.id))) })] }) }));
}
export default function App() {
    const [cullingEnabled, setCullingEnabled] = useState(true);
    const [stats, setStats] = useState({ total: 10000, visible: 0, culled: 0, rebuildCount: 0 });
    const [fps, setFps] = useState(60);
    const [domCount, setDomCount] = useState(0);
    const [vpHandle, setVpHandle] = useState(null);
    const updatersRef = useRef(new Map());
    // Generate 9,980 static background creatures and 20 moving creatures
    const { staticCreatures, movingCreatures } = useMemo(() => {
        const statics = [];
        const movings = [];
        const colors = [0x3b82f6, 0xec4899, 0x8b5cf6, 0x06b6d4, 0x10b981];
        let seed = 42;
        const rnd = () => {
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        };
        for (let i = 0; i < 20; i++) {
            movings.push({
                id: i,
                x: Math.floor(rnd() * 7600) + 200,
                y: Math.floor(rnd() * 7600) + 200,
                size: 28,
                color: 0xf59e0b,
                name: `Entity #${i + 1}`,
                hp: Math.floor(rnd() * 40) + 60,
                speedX: (rnd() - 0.5) * 6,
                speedY: (rnd() - 0.5) * 6,
            });
        }
        for (let i = 20; i < 10000; i++) {
            statics.push({
                id: i,
                x: Math.floor(rnd() * 7800) + 100,
                y: Math.floor(rnd() * 7800) + 100,
                size: 14,
                color: colors[i % colors.length],
            });
        }
        return { staticCreatures: statics, movingCreatures: movings };
    }, []);
    const movingPositionsRef = useRef(movingCreatures.map((m) => ({ x: m.x, y: m.y })));
    const handleRegisterUpdater = useCallback((id, updater) => {
        updatersRef.current.set(id, updater);
    }, []);
    const getMovingPos = useCallback((idx) => () => movingPositionsRef.current[idx], []);
    const handleStatsUpdate = useCallback((newStats, currentFps) => {
        setStats(newStats);
        setFps(currentFps);
        setDomCount(document.querySelectorAll('*').length);
    }, []);
    return (_jsxs("div", { style: { width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: '#090d16' }, children: [_jsx("div", { "data-testid": "spatial-viewport", style: {
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: 100,
                } }), _jsx(Application, { width: window.innerWidth, height: window.innerHeight, backgroundColor: 0x090d16, resizeTo: window, children: _jsx(SceneContent, { cullingEnabled: cullingEnabled, staticCreatures: staticCreatures, movingCreatures: movingCreatures, movingPositionsRef: movingPositionsRef, onRegisterUpdater: handleRegisterUpdater, onStatsUpdate: handleStatsUpdate, onSpatialViewportMount: setVpHandle }) }), vpHandle &&
                movingCreatures.map((c, idx) => (_jsx(CreaturePortal, { creature: c, viewport: vpHandle, getPosition: getMovingPos(idx) }, `portal-${c.id}`))), _jsxs("div", { style: {
                    position: 'absolute',
                    top: '20px',
                    right: '20px',
                    width: '340px',
                    padding: '20px',
                    borderRadius: '16px',
                    background: 'rgba(15, 23, 42, 0.88)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
                    color: '#f8fafc',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    zIndex: 1000,
                }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("h2", { style: { fontSize: '16px', fontWeight: 800, color: '#38bdf8' }, children: "pixi-react-spatial" }), _jsxs("span", { style: {
                                    padding: '4px 10px',
                                    borderRadius: '8px',
                                    backgroundColor: fps >= 45 ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
                                    color: fps >= 45 ? '#4ade80' : '#f87171',
                                    fontWeight: 800,
                                    fontSize: '14px',
                                    border: `1px solid ${fps >= 45 ? 'rgba(74, 222, 128, 0.4)' : 'rgba(248, 113, 113, 0.4)'}`,
                                }, children: [fps, " FPS"] })] }), _jsx("div", { style: { height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.1)' } }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }, children: [_jsxs("div", { style: { background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }, children: [_jsx("div", { style: { fontSize: '11px', color: '#94a3b8' }, children: "Total Sprites" }), _jsx("div", { style: { fontSize: '18px', fontWeight: 700, color: '#818cf8' }, children: stats.total.toLocaleString() })] }), _jsxs("div", { style: { background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }, children: [_jsx("div", { style: { fontSize: '11px', color: '#94a3b8' }, children: "Visible Sprites" }), _jsx("div", { style: { fontSize: '18px', fontWeight: 700, color: '#34d399' }, children: stats.visible.toLocaleString() })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }, children: [_jsxs("div", { style: { background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }, children: [_jsx("div", { style: { fontSize: '11px', color: '#94a3b8' }, children: "Culled Sprites" }), _jsx("div", { style: { fontSize: '18px', fontWeight: 700, color: '#fb923c' }, children: stats.culled.toLocaleString() })] }), _jsxs("div", { style: { background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }, children: [_jsx("div", { style: { fontSize: '11px', color: '#94a3b8' }, children: "Quadtree Rebuilds" }), _jsx("div", { style: { fontSize: '18px', fontWeight: 700, color: '#38bdf8' }, children: stats.rebuildCount })] })] }), _jsxs("div", { style: { background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: "DOM Elements Count:" }), _jsxs("span", { style: { fontSize: '13px', fontWeight: 800, color: domCount < 300 ? '#4ade80' : '#f87171' }, children: [domCount, " nodes (", domCount < 300 ? '< 300 PASS' : 'FAIL', ")"] })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("span", { style: { fontSize: '11px', color: '#94a3b8' }, children: "Renderer Type:" }), _jsx("span", { style: { fontSize: '12px', fontWeight: 700, color: '#67e8f9' }, children: "WebGL 2.0 (PixiJS v8)" })] })] }), _jsxs("label", { style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 600,
                        }, children: [_jsx("input", { type: "checkbox", checked: cullingEnabled, onChange: (e) => setCullingEnabled(e.target.checked), style: { width: '16px', height: '16px', accentColor: '#38bdf8', cursor: 'pointer' } }), "Culling Enabled (Quadtree)"] }), _jsxs("div", { style: { fontSize: '11px', color: '#64748b', lineHeight: '1.4' }, children: ["\u2022 Drag mouse / touch to Pan", _jsx("br", {}), "\u2022 Scroll wheel / Pinch to Zoom", _jsx("br", {}), "\u2022 10,000 PixiJS Sprites rendered on 1 WebGL canvas", _jsx("br", {}), "\u2022 20 HTML WorldPortal healthbars rendered in react-dom tree"] })] })] }));
}

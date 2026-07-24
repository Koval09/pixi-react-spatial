import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Application, extend, useApplication, useTick } from '@pixi/react';
import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import {
  SpatialViewport,
  CullGroup,
  WorldPortal,
  useCullable,
  type CullGroupHandle,
  type CullStats,
  type ViewportHandle,
  type Rect,
} from 'pixi-react-spatial';

// Register PixiJS display objects for @pixi/react v8 JSX elements (<pixiContainer>, <pixiSprite>)
extend({ Container, Sprite, Graphics });

interface StaticCreature {
  id: number;
  x: number;
  y: number;
  size: number;
  color: number;
}

interface MovingCreature {
  id: number;
  x: number;
  y: number;
  size: number;
  color: number;
  name: string;
  hp: number;
  speedX: number;
  speedY: number;
}

// Memoized Static Sprite Item (9,980 items rendered inside WebGL canvas)
const StaticSpriteItem = React.memo(function StaticSpriteItem({
  creature,
  texture,
}: {
  creature: StaticCreature;
  texture: Texture;
}) {
  const spriteRef = useRef<Sprite | null>(null);

  const getRect = useCallback(
    () => ({
      x: creature.x - creature.size / 2,
      y: creature.y - creature.size / 2,
      width: creature.size,
      height: creature.size,
    }),
    [creature.x, creature.y, creature.size]
  );

  useCullable(spriteRef, getRect);

  return (
    <pixiSprite
      ref={spriteRef}
      texture={texture}
      x={creature.x}
      y={creature.y}
      width={creature.size}
      height={creature.size}
      anchor={0.5}
      tint={creature.color}
    />
  );
});

// Individual Moving Sprite Item (20 items rendered inside WebGL canvas)
function MovingSpriteItem({
  creature,
  texture,
  onRegisterUpdater,
}: {
  creature: MovingCreature;
  texture: Texture;
  onRegisterUpdater: (id: number, updater: (x: number, y: number) => void) => void;
}) {
  const spriteRef = useRef<Sprite | null>(null);
  const posRef = useRef({ x: creature.x, y: creature.y });

  const getRect = useCallback(
    () => ({
      x: posRef.current.x - creature.size / 2,
      y: posRef.current.y - creature.size / 2,
      width: creature.size,
      height: creature.size,
    }),
    [creature.size]
  );

  const { markDirty } = useCullable(spriteRef, getRect);

  useEffect(() => {
    onRegisterUpdater(creature.id, (newX: number, newY: number) => {
      posRef.current = { x: newX, y: newY };
      if (spriteRef.current) {
        spriteRef.current.position.set(newX, newY);
      }
      markDirty();
    });
  }, [creature.id, markDirty, onRegisterUpdater]);

  return (
    <pixiSprite
      ref={spriteRef}
      texture={texture}
      x={creature.x}
      y={creature.y}
      width={creature.size}
      height={creature.size}
      anchor={0.5}
      tint={creature.color}
      zIndex={10}
    />
  );
}

/**
 * WorldPortal Healthbar Overlay
 * RENDERED IN THE REACT-DOM TREE (siblings of Application), NOT INSIDE <Application>.
 */
function CreaturePortal({
  creature,
  viewport,
  getPosition,
}: {
  creature: MovingCreature;
  viewport: ViewportHandle;
  getPosition: () => { x: number; y: number };
}) {
  const portalAtGetter = useCallback(() => {
    const p = getPosition();
    return { x: p.x, y: p.y - creature.size / 2 - 14 };
  }, [creature.size, getPosition]);

  return (
    <WorldPortal viewport={viewport} at={portalAtGetter} anchor={0.5} hideWhenOffscreen={true}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '3px',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
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
          }}
        >
          {creature.name}
        </div>
        <div
          style={{
            width: '46px',
            height: '5px',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            borderRadius: '3px',
            overflow: 'hidden',
            border: '1px solid rgba(255, 255, 255, 0.3)',
          }}
        >
          <div
            style={{
              width: `${creature.hp}%`,
              height: '100%',
              backgroundColor: creature.hp > 50 ? '#22c55e' : '#ef4444',
              borderRadius: '3px',
            }}
          />
        </div>
      </div>
    </WorldPortal>
  );
}

// Inner Scene component running inside @pixi/react <Application> context (PixiJS tree only!)
function SceneContent({
  cullingEnabled,
  staticCreatures,
  movingCreatures,
  movingPositionsRef,
  onRegisterUpdater,
  onStatsUpdate,
  onSpatialViewportMount,
}: {
  cullingEnabled: boolean;
  staticCreatures: StaticCreature[];
  movingCreatures: MovingCreature[];
  movingPositionsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  onRegisterUpdater: (id: number, updater: (x: number, y: number) => void) => void;
  onStatsUpdate: (stats: CullStats, fps: number) => void;
  onSpatialViewportMount: (handle: ViewportHandle | null) => void;
}) {
  const { app, isInitialised } = useApplication();
  const cullGroupRef = useRef<CullGroupHandle | null>(null);
  const updatersRef = useRef<Map<number, (x: number, y: number) => void>>(new Map());

  // Texture creation strictly after async initialization completes
  const circleTexture = useMemo(() => {
    if (!isInitialised || !app || !app.renderer) return null;
    const g = new Graphics();
    g.circle(16, 16, 15).fill({ color: 0xffffff });
    return app.renderer.generateTexture(g);
  }, [app, isInitialised]);

  const localRegisterUpdater = useCallback(
    (id: number, updater: (x: number, y: number) => void) => {
      updatersRef.current.set(id, updater);
      onRegisterUpdater(id, updater);
    },
    [onRegisterUpdater]
  );

  // Pixi Ticker update with dt clamp (max 100ms) to prevent teleportation on freezes
  const lastFpsTime = useRef(performance.now());
  const frameCount = useRef(0);

  useTick((ticker) => {
    if (!isInitialised) return;

    // Clamp deltaMS to maximum 100ms (0.1s)
    const deltaMS = Math.min(ticker.deltaMS, 100);
    const dt = deltaMS / 16.666;

    for (let idx = 0; idx < movingCreatures.length; idx++) {
      const creature = movingCreatures[idx];
      const pos = movingPositionsRef.current[idx];
      let nextX = pos.x + creature.speedX * dt;
      let nextY = pos.y + creature.speedY * dt;

      if (nextX < 100 || nextX > 7900) creature.speedX *= -1;
      if (nextY < 100 || nextY > 7900) creature.speedY *= -1;

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

  const cullBounds: Rect = useMemo(() => ({ x: 0, y: 0, width: 8000, height: 8000 }), []);

  if (!isInitialised || !app || !app.renderer || !circleTexture) {
    return null;
  }

  return (
    <SpatialViewport
      ref={onSpatialViewportMount}
      targetElement={app.canvas as HTMLElement}
      worldWidth={8000}
      worldHeight={8000}
      clamp={true}
      minZoom={0.1}
      maxZoom={4.0}
      initialCamera={{ x: 4000, y: 4000, zoom: 0.5 }}
    >
      <CullGroup ref={cullGroupRef} bounds={cullBounds} overscan={0.2} enabled={cullingEnabled}>
        {/* LAYER 1: 9,980 Static Sprites (Single GPU Batch Draw Call) */}
        <pixiContainer>
          {staticCreatures.map((c) => (
            <StaticSpriteItem key={c.id} creature={c} texture={circleTexture} />
          ))}
        </pixiContainer>

        {/* LAYER 2: 20 Moving Creature Sprites */}
        <pixiContainer>
          {movingCreatures.map((c) => (
            <MovingSpriteItem
              key={c.id}
              creature={c}
              texture={circleTexture}
              onRegisterUpdater={localRegisterUpdater}
            />
          ))}
        </pixiContainer>
      </CullGroup>
    </SpatialViewport>
  );
}

export default function App() {
  const [cullingEnabled, setCullingEnabled] = useState(true);
  const [stats, setStats] = useState<CullStats>({ total: 10000, visible: 0, culled: 0, rebuildCount: 0 });
  const [fps, setFps] = useState(60);
  const [domCount, setDomCount] = useState(0);
  const [vpHandle, setVpHandle] = useState<ViewportHandle | null>(null);

  const updatersRef = useRef<Map<number, (x: number, y: number) => void>>(new Map());

  // Generate 9,980 static background creatures and 20 moving creatures
  const { staticCreatures, movingCreatures } = useMemo(() => {
    const statics: StaticCreature[] = [];
    const movings: MovingCreature[] = [];
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

  const movingPositionsRef = useRef<Array<{ x: number; y: number }>>(
    movingCreatures.map((m) => ({ x: m.x, y: m.y }))
  );

  const handleRegisterUpdater = useCallback(
    (id: number, updater: (x: number, y: number) => void) => {
      updatersRef.current.set(id, updater);
    },
    []
  );

  const getMovingPos = useCallback((idx: number) => () => movingPositionsRef.current[idx], []);

  const handleStatsUpdate = useCallback((newStats: CullStats, currentFps: number) => {
    setStats(newStats);
    setFps(currentFps);
    setDomCount(document.querySelectorAll('*').length);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', backgroundColor: '#090d16' }}>
      {/* Target DOM Overlay container for WorldPortals */}
      <div
        data-testid="spatial-viewport"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 100,
        }}
      />

      {/* WebGL Canvas Application containing ONLY PixiJS elements */}
      <Application
        width={window.innerWidth}
        height={window.innerHeight}
        backgroundColor={0x090d16}
        resizeTo={window}
      >
        <SceneContent
          cullingEnabled={cullingEnabled}
          staticCreatures={staticCreatures}
          movingCreatures={movingCreatures}
          movingPositionsRef={movingPositionsRef}
          onRegisterUpdater={handleRegisterUpdater}
          onStatsUpdate={handleStatsUpdate}
          onSpatialViewportMount={setVpHandle}
        />
      </Application>

      {/* 20 HTML WorldPortal Healthbar Overlay Badges rendered in react-dom tree next to Application */}
      {vpHandle &&
        movingCreatures.map((c, idx) => (
          <CreaturePortal
            key={`portal-${c.id}`}
            creature={c}
            viewport={vpHandle}
            getPosition={getMovingPos(idx)}
          />
        ))}

      {/* Glassmorphism HUD Overlay */}
      <div
        style={{
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
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 800, color: '#38bdf8' }}>pixi-react-spatial</h2>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: '8px',
              backgroundColor: fps >= 45 ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)',
              color: fps >= 45 ? '#4ade80' : '#f87171',
              fontWeight: 800,
              fontSize: '14px',
              border: `1px solid ${fps >= 45 ? 'rgba(74, 222, 128, 0.4)' : 'rgba(248, 113, 113, 0.4)'}`,
            }}
          >
            {fps} FPS
          </span>
        </div>

        <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.1)' }} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Total Sprites</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#818cf8' }}>{stats.total.toLocaleString()}</div>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Visible Sprites</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#34d399' }}>{stats.visible.toLocaleString()}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Culled Sprites</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#fb923c' }}>
              {stats.culled.toLocaleString()}
            </div>
          </div>
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Quadtree Rebuilds</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#38bdf8' }}>
              {stats.rebuildCount}
            </div>
          </div>
        </div>

        {/* DOM Nodes Acceptance Check (< 300) & Canvas Status */}
        <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '10px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>DOM Elements Count:</span>
            <span style={{ fontSize: '13px', fontWeight: 800, color: domCount < 300 ? '#4ade80' : '#f87171' }}>
              {domCount} nodes ({domCount < 300 ? '< 300 PASS' : 'FAIL'})
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Renderer Type:</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#67e8f9' }}>WebGL 2.0 (PixiJS v8)</span>
          </div>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <input
            type="checkbox"
            checked={cullingEnabled}
            onChange={(e) => setCullingEnabled(e.target.checked)}
            style={{ width: '16px', height: '16px', accentColor: '#38bdf8', cursor: 'pointer' }}
          />
          Culling Enabled (Quadtree)
        </label>

        <div style={{ fontSize: '11px', color: '#64748b', lineHeight: '1.4' }}>
          • Drag mouse / touch to Pan<br />
          • Scroll wheel / Pinch to Zoom<br />
          • 10,000 PixiJS Sprites rendered on 1 WebGL canvas<br />
          • 20 HTML WorldPortal healthbars rendered in react-dom tree
        </div>
      </div>
    </div>
  );
}

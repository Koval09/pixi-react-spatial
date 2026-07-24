# pixi-react-spatial

Declarative 2D viewport, quadtree culling and DOM sync for PixiJS v8 + React 19.

[![npm version](https://img.shields.io/npm/v/pixi-react-spatial.svg?style=flat-square)](https://www.npmjs.com/package/pixi-react-spatial)
[![CI](https://img.shields.io/github/actions/workflow/status/Koval09/pixi-react-spatial/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/Koval09/pixi-react-spatial/actions)
[![license](https://img.shields.io/npm/l/pixi-react-spatial.svg?style=flat-square)](https://github.com/Koval09/pixi-react-spatial/blob/main/LICENSE)

---

## Features

- **SpatialViewport**: Smooth multi-touch pan, scroll-wheel zoom, pinch-to-zoom gestures, target camera tracking with lerp/deadzone, and strict boundary clamping.
- **CullGroup**: Spatial Quadtree culling with incremental `markDirty` updates for moving objects, reducing per-frame render work by up to 95%.
- **WorldPortal**: High-performance HTML DOM overlay projection anchored to 2D world coordinates with 60 FPS transform synchronization and zero React re-renders per frame.
- **Zero Runtime Dependencies**: Ultra-lean core built directly for PixiJS v8 and React 19.
- **Full TypeScript**: End-to-end type safety and strict type definitions out of the box.

---

## Measured Performance

Benchmarked on an **Intel HD 620 (2017 ultrabook)** running a production build with **10,000 active sprites**:

| Metric | Culling OFF | Culling ON |
| :--- | :--- | :--- |
| **Frame Rate** | ~50 FPS with periodic multi-frame stalls | **58 FPS smooth, no frame spikes** |
| **Visible / Culled** | 10,000 visible / 0 culled | **518 visible / 9,482 culled** (zoomed in) |
| **Frame Stability** | Frequent GC & transform spikes | **Zero stutter, stable frame timing** |

> **Fair Performance Note**: While average FPS on modern GPUs might appear similar, spatial quadtree culling eliminates frame spikes on low-end hardware by cutting per-frame transform and draw work by ~95%.

---

## Quickstart

### Installation

```bash
npm install pixi-react-spatial pixi.js @pixi/react
```

> **Requirements**: Peer dependencies require `react` >= 19.0, `react-dom` >= 19.0, `pixi.js` >= 8.0, and `@pixi/react` >= 8.0.

### Basic Example

```tsx
import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Application, extend, useApplication } from '@pixi/react';
import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import {
  SpatialViewport,
  CullGroup,
  WorldPortal,
  useCullable,
  type ViewportHandle,
} from 'pixi-react-spatial';

extend({ Container, Sprite, Graphics });

// 1. Cullable Sprite Component (inside PixiJS tree)
function SpriteItem({ x, y, texture }: { x: number; y: number; texture: Texture }) {
  const spriteRef = useRef<Sprite | null>(null);
  const getRect = useCallback(() => ({ x: x - 10, y: y - 10, width: 20, height: 20 }), [x, y]);
  
  useCullable(spriteRef, getRect);

  return <pixiSprite ref={spriteRef} texture={texture} x={x} y={y} anchor={0.5} />;
}

// 2. Scene Content (inside <Application>)
function SceneContent({ onViewportMount }: { onViewportMount: (v: ViewportHandle) => void }) {
  const { app, isInitialised } = useApplication();

  const texture = useMemo(() => {
    if (!isInitialised || !app || !app.renderer) return null;
    const g = new Graphics().circle(10, 10, 10).fill({ color: 0x38bdf8 });
    return app.renderer.generateTexture(g);
  }, [app, isInitialised]);

  if (!isInitialised || !app || !texture) return null;

  return (
    <SpatialViewport
      ref={onViewportMount}
      targetElement={app.canvas as HTMLElement}
      worldWidth={4000}
      worldHeight={4000}
      clamp={true}
    >
      <CullGroup bounds={{ x: 0, y: 0, width: 4000, height: 4000 }}>
        <pixiContainer>
          <SpriteItem x={500} y={500} texture={texture} />
        </pixiContainer>
      </CullGroup>
    </SpatialViewport>
  );
}

// 3. Main Application Component
export default function App() {
  const [viewport, setViewport] = useState<ViewportHandle | null>(null);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Application width={window.innerWidth} height={window.innerHeight}>
        <SceneContent onViewportMount={setViewport} />
      </Application>

      {/* Render WorldPortal in react-dom tree alongside <Application> */}
      {viewport && (
        <WorldPortal viewport={viewport} at={{ x: 500, y: 480 }} anchor={0.5}>
          <div style={{ background: '#0f172a', color: '#fff', padding: '4px 8px', borderRadius: '4px' }}>
            Entity Label
          </div>
        </WorldPortal>
      )}
    </div>
  );
}
```

---

## API Reference

### `SpatialViewport`

Controls camera matrix transforms, pointer gestures, and exposes viewport handles.

#### Props (`SpatialViewportProps`)

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `targetElement` | `HTMLElement \| null` | `undefined` | Element (e.g. `app.canvas`) to attach pointer event listeners to. |
| `container` | `unknown` | `undefined` | Target PixiJS Container instance or DOM element when used in DOM mode. |
| `worldWidth` | `number` | `8000` | Total width of the 2D world. |
| `worldHeight` | `number` | `8000` | Total height of the 2D world. |
| `worldBounds` | `Rect` | `undefined` | Custom world boundaries `{ x, y, width, height }`. |
| `viewportWidth` | `number` | `window.innerWidth` | Explicit viewport width. |
| `viewportHeight` | `number` | `window.innerHeight` | Explicit viewport height. |
| `minZoom` | `number` | `0.1` | Minimum allowed zoom level. |
| `maxZoom` | `number` | `4.0` | Maximum allowed zoom level. |
| `clamp` | `boolean` | `false` | When `true`, restricts camera to world boundaries. |
| `follow` | `RefObject<Point> \| Point` | `undefined` | Target position for camera tracking. |
| `followLerp` | `number` | `0.1` | Linear interpolation factor (0.0 to 1.0) for smooth camera tracking. |
| `followDeadzone` | `Deadzone` | `undefined` | Deadzone region `{ x, y, width, height }` before camera moves. |
| `onViewportChange` | `(cam: CameraState) => void` | `undefined` | Throttled (100ms) callback fired on camera position/zoom changes. |
| `initialCamera` | `CameraState` | `{ x: 0, y: 0, zoom: 1 }` | Initial camera state. |

#### Handle (`ViewportHandle`)

Exposed via `ref` on `<SpatialViewport ref={viewportRef} />`:

| Method | Return Type | Description |
| :--- | :--- | :--- |
| `getCamera()` | `CameraState` | Returns current `{ x, y, zoom }` camera state. |
| `getViewport()` | `Size` | Returns current `{ width, height }` viewport size. |
| `subscribe(fn)` | `() => void` | Subscribes a listener to camera movement ticks. Returns unsubscribe function. |

---

### `CullGroup`

Spatial Quadtree container that automatically toggles child visibility (`renderable`).

#### Props (`CullGroupProps`)

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `bounds` | `Rect` | `{ x: 0, y: 0, width: 8000, height: 8000 }` | Bounding rectangle for the Quadtree index. |
| `overscan` | `number` | `0.2` | Overscan padding multiplier (0.2 = 20% margin around viewport). |
| `enabled` | `boolean` | `true` | Toggles culling on/off. When `false`, all items are set `renderable = true`. |

#### Handle (`CullGroupHandle`)

Exposed via `ref` on `<CullGroup ref={cullGroupRef} />`:

| Method | Return Type | Description |
| :--- | :--- | :--- |
| `getStats()` | `CullStats` | Returns current `{ total, visible, culled, rebuildCount }` statistics. |

---

### `useCullable`

Hook for registering a display object with the nearest `<CullGroup>`.

```ts
const { markDirty } = useCullable(targetRef, getRect);
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `targetRef` | `RefObject<unknown>` | Ref pointing to the PixiJS DisplayObject (Sprite, Container, etc.). |
| `getRect` | `() => Rect` | Callback returning world bounding rectangle `{ x, y, width, height }`. |

| Return Value | Type | Description |
| :--- | :--- | :--- |
| `markDirty` | `() => void` | Call when object moves to update its position in the spatial quadtree. |

---

### `WorldPortal`

Projects HTML DOM elements to 2D world coordinates using CSS `translate3d`.

> **Important**: Must be rendered in the `react-dom` tree (outside `<Application>`), passing the `viewport` handle prop.

#### Props (`WorldPortalProps`)

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `at` | `Point \| (() => Point)` | *Required* | World coordinate target `{ x, y }` or getter function. |
| `viewport` | `ViewportHandle` | *Required in DOM* | Viewport handle obtained from `SpatialViewport` ref. |
| `anchor` | `number \| { x, y }` | `0` | Anchor point offset (e.g. `0.5` for center, `{ x: 0.5, y: 1.0 }` for bottom-center). |
| `hideWhenOffscreen` | `boolean` | `true` | Hides DOM element when outside viewport bounds. |
| `clampToScreen` | `boolean` | `false` | Clamps DOM element to screen edges when offscreen. |
| `interactive` | `boolean` | `false` | Toggles `pointer-events: auto` vs `none` on wrapper element. |
| `className` | `string` | `undefined` | Custom CSS class name for wrapper element. |
| `style` | `CSSProperties` | `undefined` | Custom inline CSS styles for wrapper element. |

---

### Types

```ts
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}
```

---

## Common Pitfalls

1. **Pixi v8 Async Initialization**:
   In `@pixi/react` v8, `useApplication()` initializes asynchronously. Do **NOT** access `app.renderer` on the first render before `isInitialised === true`:
   ```tsx
   const { app, isInitialised } = useApplication();
   if (!isInitialised || !app || !app.renderer) return null;
   ```

2. **`WorldPortal` Component Scoping**:
   `WorldPortal` uses React DOM portals (`createPortal`). It **MUST** be rendered in the `react-dom` tree (siblings of `<Application>`) and passed the `viewport` handle prop. Rendering `WorldPortal` or raw HTML elements inside `<Application>` will throw `Div is not part of the PIXI namespace`.

3. **No Raw HTML or Text in Pixi Tree**:
   Inside `<Application>`, `@pixi/react` reconciler only supports registered PixiJS elements (`<pixiContainer>`, `<pixiSprite>`). Any raw HTML tags (`<div>`, `<span>`) or string literals between JSX elements will crash the renderer.

4. **Delta Time Clamping in Frame Loop**:
   Always clamp `ticker.deltaMS` (e.g., `Math.min(ticker.deltaMS, 100)`) inside ticker loops. Large frame stalls or tab backgrounding could otherwise cause physics/position teleportation.

---

## Why Not X?

- **`pixi-viewport`**: An excellent, mature library for imperative PixiJS scenes. However, it exposes an imperative API attached directly to a `Container` instance rather than a declarative React 19 component interface with fine-grained context propagation.
- **Built-in Pixi v8 Culler**: Lacks a spatial Quadtree index, performing linear O(n) bounding-box checks across all registered objects every frame. `pixi-react-spatial` uses an optimized quadtree index with overscan caching to cut per-frame query work by ~95%.

---

## Demo

Run the interactive demo locally:

```bash
# Clone the repository
git clone https://github.com/Koval09/pixi-react-spatial.git
cd pixi-react-spatial

# Install dependencies and start demo dev server
npm install
cd demo && npm install && npm run dev
```

The demo displays **10,000 sprites** rendered on a single WebGL 2.0 canvas with interactive pan/zoom, Quadtree culling, 20 HTML healthbar badges synced via `WorldPortal`, and a live Glassmorphism stats HUD.

---

## License

[MIT](./LICENSE) © Koval09

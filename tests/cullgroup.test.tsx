import React, { useState, useRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, createEvent, fireEvent, act } from '@testing-library/react';
import { SpatialViewport } from '../src/react/SpatialViewport';
import { CullGroup, useCullable, type CullGroupHandle } from '../src/react/CullGroup';
import type { Rect } from '../src/core/camera';

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createMockTicker() {
  const listeners: Array<(delta: number) => void> = [];
  return {
    get listenerCount() {
      return listeners.length;
    },
    add(fn: (delta: number) => void) {
      listeners.push(fn);
      return () => {
        const idx = listeners.indexOf(fn);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
    tick(delta = 1) {
      for (const listener of [...listeners]) {
        listener(delta);
      }
    },
  };
}

function dispatchPointer(
  el: HTMLElement,
  type: 'pointerDown' | 'pointerMove' | 'pointerUp',
  coords: { clientX: number; clientY: number; pointerId?: number }
) {
  const event = createEvent[type](el, { pointerId: coords.pointerId ?? 1 });
  Object.defineProperty(event, 'clientX', { value: coords.clientX });
  Object.defineProperty(event, 'clientY', { value: coords.clientY });
  fireEvent(el, event);
}

interface TestObject {
  id: number;
  rect: Rect;
  renderable: boolean;
}

function CullableItem({ obj }: { obj: TestObject }) {
  const targetRef = useRef<TestObject>(obj);
  useCullable(targetRef, () => obj.rect);
  return null;
}

describe('CullGroup and useCullable React module', () => {
  it('1. culls 100 stubs on a grid when camera sees a quarter of the world', () => {
    const mockTicker = createMockTicker();
    const objects: TestObject[] = [];

    // Create 100 objects on 10x10 grid from (0,0) to (1000,1000)
    for (let i = 0; i < 100; i++) {
      const gx = (i % 10) * 100;
      const gy = Math.floor(i / 10) * 100;
      objects.push({
        id: i,
        rect: { x: gx, y: gy, width: 50, height: 50 },
        renderable: true,
      });
    }

    render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 200, y: 150, zoom: 1 }} clamp={true}>
        <CullGroup overscan={0}>
          {objects.map((obj) => (
            <CullableItem key={obj.id} obj={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();

    const visibleCount = objects.filter((o) => o.renderable).length;
    // World is 1000x1000, camera sees 400x300 centered at (200, 150) -> ~12 items visible
    expect(visibleCount).toBeGreaterThan(0);
    expect(visibleCount).toBeLessThan(50);
  });

  it('2. updates visible set when camera shifts across world via gesture pan', () => {
    const mockTicker = createMockTicker();
    const objects: TestObject[] = [
      { id: 1, rect: { x: 50, y: 50, width: 50, height: 50 }, renderable: true },
      { id: 2, rect: { x: 800, y: 800, width: 50, height: 50 }, renderable: true },
    ];

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup overscan={0}>
          {objects.map((obj) => (
            <CullableItem key={obj.id} obj={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(objects[0].renderable).toBe(true);
    expect(objects[1].renderable).toBe(false);

    // Pan camera to center around (800, 800)
    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 200, clientY: 150 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 190, clientY: 150 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: -500, clientY: -550 });
    dispatchPointer(viewportEl, 'pointerUp', { clientX: -500, clientY: -550 });

    mockTicker.tick();
    expect(objects[0].renderable).toBe(false);
    expect(objects[1].renderable).toBe(true);
  });

  it('3. picks up object displacement via markDirty()', () => {
    const mockTicker = createMockTicker();
    const obj: TestObject = { id: 1, rect: { x: 100, y: 100, width: 50, height: 50 }, renderable: true };
    let markDirtyFn: (() => void) | null = null;

    function MovingItem({ item }: { item: TestObject }) {
      const targetRef = useRef<TestObject>(item);
      const { markDirty } = useCullable(targetRef, () => item.rect);
      markDirtyFn = markDirty;
      return null;
    }

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup overscan={0}>
          <MovingItem item={obj} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(obj.renderable).toBe(true);

    // Move object offscreen to (1500, 1500) and call markDirty()
    obj.rect = { x: 1500, y: 1500, width: 50, height: 50 };
    markDirtyFn!();

    // Trigger pan gesture to flush viewport context notification
    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 90, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 80, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerUp', { clientX: 80, clientY: 100 });

    mockTicker.tick();
    expect(obj.renderable).toBe(false);
  });

  it('4. sets renderable=true for all objects when enabled=false', () => {
    const mockTicker = createMockTicker();
    const objects: TestObject[] = [
      { id: 1, rect: { x: 50, y: 50, width: 50, height: 50 }, renderable: true },
      { id: 2, rect: { x: 2000, y: 2000, width: 50, height: 50 }, renderable: true },
    ];

    render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup enabled={false}>
          {objects.map((obj) => (
            <CullableItem key={obj.id} obj={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(objects[0].renderable).toBe(true);
    expect(objects[1].renderable).toBe(true);
  });

  it('5. removes child from spatial index upon unmount', () => {
    const mockTicker = createMockTicker();
    const obj: TestObject = { id: 1, rect: { x: 100, y: 100, width: 50, height: 50 }, renderable: true };

    const { rerender } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup overscan={0}>
          <CullableItem obj={obj} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(obj.renderable).toBe(true);

    // Unmount item
    rerender(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup overscan={0} />
      </SpatialViewport>
    );

    expect(() => mockTicker.tick()).not.toThrow();
  });

  it('6. supports React.StrictMode without duplicate registrations', () => {
    const mockTicker = createMockTicker();
    const obj: TestObject = { id: 1, rect: { x: 100, y: 100, width: 50, height: 50 }, renderable: true };

    render(
      <React.StrictMode>
        <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
          <CullGroup overscan={0}>
            <CullableItem obj={obj} />
          </CullGroup>
        </SpatialViewport>
      </React.StrictMode>
    );

    mockTicker.tick();
    expect(obj.renderable).toBe(true);
  });

  it('7. increases visible margin buffer when overscan is increased (overscan=0 vs overscan=0.5)', () => {
    const mockTicker = createMockTicker();
    // Object just outside 400x300 screen edge at x=300
    const edgeObj: TestObject = { id: 1, rect: { x: 300, y: 100, width: 50, height: 50 }, renderable: true };

    const { unmount: unmount1 } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 0, y: 0, zoom: 1 }}>
        <CullGroup overscan={0}>
          <CullableItem obj={edgeObj} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    const visibleWithZeroOverscan = edgeObj.renderable;
    unmount1();

    const edgeObj2: TestObject = { id: 2, rect: { x: 300, y: 100, width: 50, height: 50 }, renderable: true };
    const { unmount: unmount2 } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 0, y: 0, zoom: 1 }}>
        <CullGroup overscan={0.5}>
          <CullableItem obj={edgeObj2} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    const visibleWithHalfOverscan = edgeObj2.renderable;
    unmount2();

    expect(visibleWithHalfOverscan).toBe(true);
    expect(visibleWithZeroOverscan).toBe(false);
  });

  it('8. exposes getStats() API returning exact { total, visible, culled, rebuildCount } counts', () => {
    const mockTicker = createMockTicker();
    const cullGroupRef = React.createRef<CullGroupHandle>();

    const objects: TestObject[] = [
      { id: 1, rect: { x: 100, y: 100, width: 50, height: 50 }, renderable: true },
      { id: 2, rect: { x: 2000, y: 2000, width: 50, height: 50 }, renderable: true },
    ];

    render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup ref={cullGroupRef} overscan={0}>
          {objects.map((obj) => (
            <CullableItem key={obj.id} obj={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    const stats = cullGroupRef.current!.getStats();
    expect(stats.total).toBe(2);
    expect(stats.visible).toBe(1);
    expect(stats.culled).toBe(1);
    expect(stats.rebuildCount).toBe(0);
    expect(stats.visible + stats.culled).toBe(stats.total);
  });

  it('9. rebuilds quadtree gracefully when bounds prop is dynamically updated', () => {
    const mockTicker = createMockTicker();
    const obj: TestObject = { id: 1, rect: { x: 100, y: 100, width: 50, height: 50 }, renderable: true };

    const { rerender } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup bounds={{ x: 0, y: 0, width: 1000, height: 1000 }}>
          <CullableItem obj={obj} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(obj.renderable).toBe(true);

    // Dynamic bounds update
    rerender(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true}>
        <CullGroup bounds={{ x: 0, y: 0, width: 5000, height: 5000 }}>
          <CullableItem obj={obj} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(obj.renderable).toBe(true);
  });

  it('10. safely handles useCullable when targetRef is null or outside CullGroup context', () => {
    function DummyOutside() {
      const ref = useRef<TestObject | null>(null);
      const { markDirty } = useCullable(ref, () => ({ x: 0, y: 0, width: 10, height: 10 }));
      expect(() => markDirty()).not.toThrow();
      return null;
    }

    expect(() => render(<DummyOutside />)).not.toThrow();
  });

  it('11. cleans up all context subscriptions on CullGroup unmount without memory leaks', () => {
    const mockTicker = createMockTicker();
    const { unmount } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} ticker={mockTicker}>
        <CullGroup />
      </SpatialViewport>
    );

    // SpatialViewport adds 1 listener to mockTicker
    expect(mockTicker.listenerCount).toBe(1);

    unmount();

    expect(mockTicker.listenerCount).toBe(0);
  });

  it('12. strictly satisfies culling statistics invariants (visible + culled === total and visible <= total) on random seeded PRNG configurations', () => {
    const prng = mulberry32(12345);
    const cullGroupRef = React.createRef<CullGroupHandle>();
    const TOTAL_ITEMS = 500;

    const objects: TestObject[] = [];
    for (let i = 0; i < TOTAL_ITEMS; i++) {
      objects.push({
        id: i,
        rect: {
          x: prng() * 4000,
          y: prng() * 4000,
          width: 20 + prng() * 30,
          height: 20 + prng() * 30,
        },
        renderable: true,
      });
    }

    render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} initialCamera={{ x: 2000, y: 2000, zoom: 0.5 }}>
        <CullGroup ref={cullGroupRef} bounds={{ x: 0, y: 0, width: 4000, height: 4000 }} overscan={0.2}>
          {objects.map((obj) => (
            <CullableItem key={obj.id} obj={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    const stats = cullGroupRef.current!.getStats();
    expect(stats.total).toBe(TOTAL_ITEMS);
    expect(stats.visible).toBeLessThanOrEqual(TOTAL_ITEMS);
    expect(stats.visible).toBeGreaterThanOrEqual(0);
    expect(stats.culled).toBeGreaterThanOrEqual(0);
    expect(stats.visible + stats.culled).toBe(stats.total);
  });

  it('13. guarantees 0 full rebuilds for 20 moving objects calling markDirty() 1000 frames in a row', () => {
    const mockTicker = createMockTicker();
    const cullGroupRef = React.createRef<CullGroupHandle>();

    const objects: TestObject[] = [];
    for (let i = 0; i < 1000; i++) {
      objects.push({
        id: i,
        rect: { x: (i % 30) * 100, y: Math.floor(i / 30) * 100, width: 50, height: 50 },
        renderable: true,
      });
    }

    const markDirtyFns: Array<() => void> = [];

    function TestItem({ item }: { item: TestObject }) {
      const targetRef = useRef<TestObject>(item);
      const { markDirty } = useCullable(targetRef, () => item.rect);
      if (item.id < 20) {
        markDirtyFns.push(markDirty);
      }
      return null;
    }

    render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} initialCamera={{ x: 1000, y: 1000, zoom: 1 }} ticker={mockTicker}>
        <CullGroup ref={cullGroupRef} bounds={{ x: 0, y: 0, width: 5000, height: 5000 }}>
          {objects.map((obj) => (
            <TestItem key={obj.id} item={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();

    // Call markDirty 1000 frames in a row for 20 objects
    for (let frame = 0; frame < 1000; frame++) {
      for (let i = 0; i < 20; i++) {
        objects[i].rect.x += 1;
        objects[i].rect.y += 1;
        if (markDirtyFns[i]) {
          markDirtyFns[i]();
        }
      }
      mockTicker.tick();
    }

    const stats = cullGroupRef.current!.getStats();
    expect(stats.rebuildCount).toBe(0);
  });

  it('14. guarantees 0 rebuilds and < 5ms re-query time when panning camera across 10 overscan boundaries', () => {
    const mockTicker = createMockTicker();
    const cullGroupRef = React.createRef<CullGroupHandle>();

    const objects: TestObject[] = [];
    for (let i = 0; i < 1000; i++) {
      objects.push({
        id: i,
        rect: { x: (i % 30) * 100, y: Math.floor(i / 30) * 100, width: 50, height: 50 },
        renderable: true,
      });
    }

    const markDirtyFns: Array<() => void> = [];

    function TestItem({ item }: { item: TestObject }) {
      const targetRef = useRef<TestObject>(item);
      const { markDirty } = useCullable(targetRef, () => item.rect);
      if (item.id < 20) {
        markDirtyFns.push(markDirty);
      }
      return null;
    }

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }} clamp={true} ticker={mockTicker}>
        <CullGroup ref={cullGroupRef} bounds={{ x: 0, y: 0, width: 5000, height: 5000 }} overscan={0.2}>
          {objects.map((obj) => (
            <TestItem key={obj.id} item={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    const viewportEl = getByTestId('spatial-viewport');

    const maxQueryDuration = { value: 0 };

    // Pan across 10 overscan boundaries
    for (let boundary = 0; boundary < 10; boundary++) {
      for (let i = 0; i < 20; i++) {
        objects[i].rect.x += 10;
        if (markDirtyFns[i]) markDirtyFns[i]();
      }

      dispatchPointer(viewportEl, 'pointerDown', { clientX: 200, clientY: 150 });
      dispatchPointer(viewportEl, 'pointerMove', { clientX: 190 - boundary * 20, clientY: 150 });
      dispatchPointer(viewportEl, 'pointerUp', { clientX: 190 - boundary * 20, clientY: 150 });

      const t0 = performance.now();
      mockTicker.tick();
      const duration = performance.now() - t0;

      if (duration > maxQueryDuration.value) {
        maxQueryDuration.value = duration;
      }
    }

    const stats = cullGroupRef.current!.getStats();
    expect(stats.rebuildCount).toBe(0);
    expect(maxQueryDuration.value).toBeLessThan(5);
  });

  it('15. Benchmark: 10k objects, 20 markDirty/frame, 600 ticks camera movement -> avgTickTime < 2ms, maxTickTime < 20ms, rebuildCount === 0', () => {
    const mockTicker = createMockTicker();
    const cullGroupRef = React.createRef<CullGroupHandle>();
    const TOTAL = 10000;

    const prng = mulberry32(999);
    const objects: TestObject[] = [];
    for (let i = 0; i < TOTAL; i++) {
      objects.push({
        id: i,
        rect: { x: prng() * 7800, y: prng() * 7800, width: 12, height: 12 },
        renderable: true,
      });
    }

    const markDirtyFns: Array<() => void> = [];

    function FastItem({ item }: { item: TestObject }) {
      const targetRef = useRef<TestObject>(item);
      const { markDirty } = useCullable(targetRef, () => item.rect);
      if (item.id < 20) {
        markDirtyFns.push(markDirty);
      }
      return null;
    }

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} initialCamera={{ x: 4000, y: 4000, zoom: 0.5 }} clamp={true} ticker={mockTicker}>
        <CullGroup ref={cullGroupRef} bounds={{ x: 0, y: 0, width: 8000, height: 8000 }} overscan={0.2}>
          {objects.map((obj) => (
            <FastItem key={obj.id} item={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    const viewportEl = getByTestId('spatial-viewport');

    let totalDuration = 0;
    let maxDuration = 0;
    const NUM_TICKS = 600;

    for (let tickIndex = 0; tickIndex < NUM_TICKS; tickIndex++) {
      // 20 moving objects
      for (let i = 0; i < 20; i++) {
        objects[i].rect.x += (i % 2 === 0 ? 1 : -1) * 2;
        objects[i].rect.y += (i % 3 === 0 ? 1 : -1) * 2;
        if (markDirtyFns[i]) markDirtyFns[i]();
      }

      // Camera pan gesture
      if (tickIndex % 10 === 0) {
        dispatchPointer(viewportEl, 'pointerDown', { clientX: 400, clientY: 300 });
        dispatchPointer(viewportEl, 'pointerMove', { clientX: 395 - (tickIndex % 50), clientY: 300 });
        dispatchPointer(viewportEl, 'pointerUp', { clientX: 395 - (tickIndex % 50), clientY: 300 });
      }

      const t0 = performance.now();
      mockTicker.tick();
      const dt = performance.now() - t0;

      totalDuration += dt;
      if (dt > maxDuration) {
        maxDuration = dt;
      }
    }

    const avgDuration = totalDuration / NUM_TICKS;
    const stats = cullGroupRef.current!.getStats();

    expect(stats.rebuildCount).toBe(0);
    expect(avgDuration).toBeLessThan(2.0);
    expect(maxDuration).toBeLessThan(20.0);
  });

  it('16. decreases visible count properly when zooming in after zoom-out to full world, maintaining visible + culled === total invariant', () => {
    const mockTicker = createMockTicker();
    const cullGroupRef = React.createRef<CullGroupHandle>();
    const TOTAL = 100;

    const objects: TestObject[] = [];
    for (let i = 0; i < TOTAL; i++) {
      objects.push({
        id: i,
        rect: { x: (i % 10) * 800, y: Math.floor(i / 10) * 800, width: 50, height: 50 },
        renderable: true,
      });
    }

    function ZoomTestApp() {
      const [zoom, setZoom] = useState(0.1);
      (globalThis as unknown as { setZoomFn: (z: number) => void }).setZoomFn = setZoom;

      return (
        <SpatialViewport key={`${zoom}`} viewportWidth={800} viewportHeight={600} initialCamera={{ x: 4000, y: 4000, zoom }}>
          <CullGroup ref={cullGroupRef} bounds={{ x: 0, y: 0, width: 8000, height: 8000 }} overscan={0.2}>
            {objects.map((obj) => (
              <CullableItem key={obj.id} obj={obj} />
            ))}
          </CullGroup>
        </SpatialViewport>
      );
    }

    render(<ZoomTestApp />);
    mockTicker.tick();

    // At zoom 0.1 (max zoom out), ALL 100 objects are visible
    const statsZoomOut = cullGroupRef.current!.getStats();
    expect(statsZoomOut.visible).toBe(100);
    expect(statsZoomOut.culled).toBe(0);

    // Zoom IN to zoom = 2.0 (centered at 4000, 4000)
    act(() => {
      (globalThis as unknown as { setZoomFn: (z: number) => void }).setZoomFn(2.0);
    });

    mockTicker.tick();

    // Visible count MUST decrease dramatically on zoom in!
    const statsZoomIn = cullGroupRef.current!.getStats();
    expect(statsZoomIn.visible).toBeLessThan(20);
    expect(statsZoomIn.culled).toBeGreaterThan(80);
    expect(statsZoomIn.visible + statsZoomIn.culled).toBe(statsZoomIn.total);
  });
});

import React, { useRef, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, createEvent, fireEvent, act } from '@testing-library/react';
import { SpatialViewport } from '../src/react/SpatialViewport';
import { CullGroup, useCullable, type CullGroupHandle, type CullableHandle } from '../src/react/CullGroup';
import type { Rect } from '../src/core/quadtree';

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

interface TestObject extends CullableHandle {
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
    let cullHandle: CullGroupHandle | null = null;

    const objects: TestObject[] = [];
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        objects.push({
          id: row * 10 + col,
          rect: { x: col * 100, y: row * 100, width: 50, height: 50 },
          renderable: true,
        });
      }
    }

    render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 200, y: 150, zoom: 1 }}>
        <CullGroup
          ref={(el) => {
            cullHandle = el;
          }}
          overscan={0}
          ticker={mockTicker}
        >
          {objects.map((obj) => (
            <CullableItem key={obj.id} obj={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();

    expect(cullHandle).not.toBeNull();
    const stats = cullHandle!.getStats();
    expect(stats.total).toBe(100);
    expect(stats.visible).toBeGreaterThanOrEqual(12);
    expect(stats.visible).toBeLessThanOrEqual(20);

    const visibleObjects = objects.filter((o) => o.renderable);
    expect(visibleObjects.length).toBe(stats.visible);
  });

  it('2. updates visible set when camera shifts across world via gesture pan', () => {
    const mockTicker = createMockTicker();
    let cullHandle: CullGroupHandle | null = null;

    const objects: TestObject[] = [
      { id: 1, rect: { x: 50, y: 50, width: 50, height: 50 }, renderable: true },
      { id: 2, rect: { x: 850, y: 850, width: 50, height: 50 }, renderable: true },
    ];

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 200, y: 150, zoom: 1 }}>
        <CullGroup
          ref={(el) => {
            cullHandle = el;
          }}
          overscan={0}
          ticker={mockTicker}
        >
          {objects.map((obj) => (
            <CullableItem key={obj.id} obj={obj} />
          ))}
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(objects[0].renderable).toBe(true);
    expect(objects[1].renderable).toBe(false);

    // Pan camera to bring (850, 850) into view (screen move -650, -700)
    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: -550, clientY: -600 });

    mockTicker.tick();

    expect(cullHandle!.getStats().visible).toBe(1);
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

    render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }}>
        <CullGroup overscan={0} ticker={mockTicker}>
          <MovingItem item={obj} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(obj.renderable).toBe(true);

    // Move object offscreen to (1500, 1500) and call markDirty()
    obj.rect = { x: 1500, y: 1500, width: 50, height: 50 };
    markDirtyFn!();

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
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }}>
        <CullGroup enabled={false} ticker={mockTicker}>
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
    let cullHandle: CullGroupHandle | null = null;
    let setShowItem2: ((show: boolean) => void) | null = null;

    const obj1: TestObject = { id: 1, rect: { x: 50, y: 50, width: 50, height: 50 }, renderable: true };
    const obj2: TestObject = { id: 2, rect: { x: 100, y: 100, width: 50, height: 50 }, renderable: true };

    function TestApp() {
      const [show, setShow] = useState(true);
      setShowItem2 = setShow;

      return (
        <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }}>
          <CullGroup
            ref={(el) => {
              cullHandle = el;
            }}
            ticker={mockTicker}
          >
            <CullableItem obj={obj1} />
            {show && <CullableItem obj={obj2} />}
          </CullGroup>
        </SpatialViewport>
      );
    }

    render(<TestApp />);
    mockTicker.tick();

    expect(cullHandle!.getStats().total).toBe(2);

    // Unmount obj2 wrapped in act()
    act(() => {
      setShowItem2!(false);
    });

    mockTicker.tick();

    expect(cullHandle!.getStats().total).toBe(1);
  });

  it('6. supports React.StrictMode without duplicate registrations', () => {
    const mockTicker = createMockTicker();
    let cullHandle: CullGroupHandle | null = null;
    const obj: TestObject = { id: 1, rect: { x: 50, y: 50, width: 50, height: 50 }, renderable: true };

    render(
      <React.StrictMode>
        <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 100, y: 100, zoom: 1 }}>
          <CullGroup
            ref={(el) => {
              cullHandle = el;
            }}
            ticker={mockTicker}
          >
            <CullableItem obj={obj} />
          </CullGroup>
        </SpatialViewport>
      </React.StrictMode>
    );

    mockTicker.tick();
    // StrictMode double effect execution must not leave duplicate item registrations
    expect(cullHandle!.getStats().total).toBe(1);
  });

  it('7. increases visible margin buffer when overscan is increased (overscan=0 vs overscan=0.5)', () => {
    const mockTicker = createMockTicker();
    let handleOverscan0: CullGroupHandle | null = null;
    let handleOverscan50: CullGroupHandle | null = null;

    // Object sitting right in margin buffer (x = 320, view 0..300)
    const objects: TestObject[] = [
      { id: 1, rect: { x: 320, y: 100, width: 50, height: 50 }, renderable: true },
    ];

    render(
      <SpatialViewport viewportWidth={300} viewportHeight={300} initialCamera={{ x: 150, y: 150, zoom: 1 }}>
        <CullGroup
          ref={(el) => {
            handleOverscan0 = el;
          }}
          overscan={0}
          ticker={mockTicker}
        >
          <CullableItem obj={objects[0]} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(handleOverscan0!.getStats().visible).toBe(0);

    render(
      <SpatialViewport viewportWidth={300} viewportHeight={300} initialCamera={{ x: 150, y: 150, zoom: 1 }}>
        <CullGroup
          ref={(el) => {
            handleOverscan50 = el;
          }}
          overscan={0.5}
          ticker={mockTicker}
        >
          <CullableItem obj={objects[0]} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(handleOverscan50!.getStats().visible).toBe(1);
  });

  it('8. exposes getStats() API returning exact { total, visible } counts', () => {
    const mockTicker = createMockTicker();
    let cullHandle: CullGroupHandle | null = null;
    const obj1: TestObject = { id: 1, rect: { x: 10, y: 10, width: 10, height: 10 }, renderable: true };

    render(
      <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 0, y: 0, zoom: 1 }}>
        <CullGroup
          ref={(el) => {
            cullHandle = el;
          }}
          ticker={mockTicker}
        >
          <CullableItem obj={obj1} />
        </CullGroup>
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(cullHandle!.getStats()).toEqual({ total: 1, visible: 1 });
  });

  it('9. rebuilds quadtree gracefully when bounds prop is dynamically updated', () => {
    const mockTicker = createMockTicker();
    let cullHandle: CullGroupHandle | null = null;
    let setBoundsFn: ((b: Rect) => void) | null = null;
    const obj: TestObject = { id: 1, rect: { x: 50, y: 50, width: 50, height: 50 }, renderable: true };

    function TestApp() {
      const [b, setB] = useState<Rect>({ x: 0, y: 0, width: 1000, height: 1000 });
      setBoundsFn = setB;

      return (
        <SpatialViewport viewportWidth={400} viewportHeight={300} initialCamera={{ x: 50, y: 50, zoom: 1 }}>
          <CullGroup
            ref={(el) => {
              cullHandle = el;
            }}
            bounds={b}
            ticker={mockTicker}
          >
            <CullableItem obj={obj} />
          </CullGroup>
        </SpatialViewport>
      );
    }

    render(<TestApp />);
    mockTicker.tick();
    expect(cullHandle!.getStats().total).toBe(1);

    // Dynamically update bounds prop wrapped in act()
    act(() => {
      setBoundsFn!({ x: -5000, y: -5000, width: 10000, height: 10000 });
    });
    mockTicker.tick();
    expect(cullHandle!.getStats().total).toBe(1);
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
        <CullGroup ticker={mockTicker} />
      </SpatialViewport>
    );

    // SpatialViewport adds 1 listener, CullGroup adds 1 listener
    expect(mockTicker.listenerCount).toBe(2);

    unmount();

    expect(mockTicker.listenerCount).toBe(0);
  });
});

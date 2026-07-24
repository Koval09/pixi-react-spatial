import React, { useRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, createEvent, act } from '@testing-library/react';
import { SpatialViewport, type SpatialContainerHandle } from '../src/react/SpatialViewport';
import { useViewportContext } from '../src/react/context';

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
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
  coords: { clientX: number; clientY: number; pointerId?: number }
) {
  const event = createEvent[type](el, { pointerId: coords.pointerId ?? 1 });
  Object.defineProperty(event, 'clientX', { value: coords.clientX });
  Object.defineProperty(event, 'clientY', { value: coords.clientY });
  fireEvent(el, event);
}

function ChildConsumer({ onRender }: { onRender: (ctx: ReturnType<typeof useViewportContext>) => void }) {
  const ctx = useViewportContext();
  onRender(ctx);
  return <div data-testid="child-consumer" />;
}

describe('SpatialViewport React component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('provides ViewportContext to children', () => {
    let capturedCtx: ReturnType<typeof useViewportContext> | null = null;

    render(
      <SpatialViewport viewportWidth={800} viewportHeight={600}>
        <ChildConsumer onRender={(ctx) => (capturedCtx = ctx)} />
      </SpatialViewport>
    );

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(capturedCtx!.getViewport()).toEqual({ width: 800, height: 600 });
  });

  it('mutates container transforms direct on ticker frame after gesture events', () => {
    const mockTicker = createMockTicker();
    let handle: SpatialContainerHandle | null = null;

    const { getByTestId } = render(
      <SpatialViewport
        ref={(el) => {
          handle = el;
        }}
        viewportWidth={800}
        viewportHeight={600}
        ticker={mockTicker}
      />
    );

    const viewportEl = getByTestId('spatial-viewport');

    mockTicker.tick();
    expect(handle).not.toBeNull();
    expect(handle!.position.x).toBe(400);
    expect(handle!.position.y).toBe(300);

    // Pan gesture using dispatchPointer helper
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100, pointerId: 1 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100, pointerId: 1 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 150, clientY: 100, pointerId: 1 });

    // Tick frame to apply updated camera to container
    mockTicker.tick();

    // Camera.x moved to -45.
    // Container position.x = 400 - (-45 * 1) = 445
    expect(handle!.position.x).toBe(445);
    expect(handle!.position.y).toBe(300);
  });

  it('causes ZERO React re-renders during camera movement and ticker frames', () => {
    let renderCount = 0;
    function CountChild() {
      renderCount++;
      return <div data-testid="count-child" />;
    }

    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <CountChild />
      </SpatialViewport>
    );

    const initialRenders = renderCount;
    const viewportEl = getByTestId('spatial-viewport');

    // Perform pan gesture
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 200, clientY: 100 });

    // Run 10 ticker frames
    for (let i = 0; i < 10; i++) {
      mockTicker.tick();
    }

    // Zero re-renders during camera movement!
    expect(renderCount).toBe(initialRenders);
  });

  it('removes all ticker subscriptions on unmount and handles events after unmount gracefully', () => {
    const mockTicker = createMockTicker();
    const { getByTestId, unmount } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker} />
    );

    const viewportEl = getByTestId('spatial-viewport');

    expect(mockTicker.listenerCount).toBe(1);

    unmount();

    expect(mockTicker.listenerCount).toBe(0);

    // Dispatching events after unmount should not throw
    expect(() => {
      dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
      dispatchPointer(viewportEl, 'pointerMove', { clientX: 150, clientY: 100 });
      mockTicker.tick();
    }).not.toThrow();
  });

  it('supports React.StrictMode without duplicate ticker subscriptions or state corruption', () => {
    const mockTicker = createMockTicker();
    let handle: SpatialContainerHandle | null = null;

    const { getByTestId } = render(
      <React.StrictMode>
        <SpatialViewport
          ref={(el) => {
            handle = el;
          }}
          viewportWidth={800}
          viewportHeight={600}
          ticker={mockTicker}
        />
      </React.StrictMode>
    );

    // Double effect mount in StrictMode must result in exactly 1 active ticker subscription
    expect(mockTicker.listenerCount).toBe(1);

    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 150, clientY: 100 });

    mockTicker.tick();

    expect(handle!.position.x).toBe(445);
  });

  it('notifies subscribers via subscribe and updates getCamera()', () => {
    const mockTicker = createMockTicker();
    let capturedCtx: ReturnType<typeof useViewportContext> | null = null;

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <ChildConsumer onRender={(ctx) => (capturedCtx = ctx)} />
      </SpatialViewport>
    );

    const listener = vi.fn();
    const unsubscribe = capturedCtx!.subscribe(listener);

    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 150, clientY: 100 });

    expect(listener).toHaveBeenCalled();
    expect(capturedCtx!.getCamera().x).toBe(-45);

    // Unsubscribe
    listener.mockClear();
    unsubscribe();

    dispatchPointer(viewportEl, 'pointerMove', { clientX: 200, clientY: 100 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('tracks moving target via follow prop', () => {
    const mockTicker = createMockTicker();
    let handle: SpatialContainerHandle | null = null;
    let targetRefHolder: React.MutableRefObject<{ x: number; y: number }> | null = null;

    function TestContainer() {
      const targetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
      targetRefHolder = targetRef;

      return (
        <SpatialViewport
          ref={(el) => {
            handle = el;
          }}
          viewportWidth={800}
          viewportHeight={600}
          follow={targetRef}
          followLerp={0.5}
          ticker={mockTicker}
        />
      );
    }

    render(<TestContainer />);

    // Tick initial frame
    mockTicker.tick();
    expect(handle!.position.x).toBe(400);

    // Move target in world coords to x = 100
    if (targetRefHolder) {
      targetRefHolder.current = { x: 100, y: 0 };
    }

    // Tick frame (lerp factor 0.5 moves camera from 0 to 50)
    mockTicker.tick();

    // camera.x is now 50. Container position.x = 400 - 50*1 = 350
    expect(handle!.position.x).toBe(350);
  });

  it('monotonically approaches target over 3 frames and ignores deadzone micro-movements', () => {
    const mockTicker = createMockTicker();
    let handle: SpatialContainerHandle | null = null;
    let targetRefHolder: React.MutableRefObject<{ x: number; y: number }> | null = null;

    function TestContainer() {
      const targetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
      targetRefHolder = targetRef;

      return (
        <SpatialViewport
          ref={(el) => {
            handle = el;
          }}
          viewportWidth={800}
          viewportHeight={600}
          follow={targetRef}
          followLerp={0.5}
          followDeadzone={{ width: 40, height: 40 }}
          ticker={mockTicker}
        />
      );
    }

    render(<TestContainer />);
    mockTicker.tick(); // frame 0: camera = (0, 0)

    // Move target outside deadzone to x = 200 (dzX = 20, targetX = 180)
    targetRefHolder!.current = { x: 200, y: 0 };

    mockTicker.tick(); // frame 1: camera.x = 90 => pos.x = 400 - 90 = 310
    const posFrame1 = handle!.position.x;

    mockTicker.tick(); // frame 2: camera.x = 135 => pos.x = 400 - 135 = 265
    const posFrame2 = handle!.position.x;

    mockTicker.tick(); // frame 3: camera.x = 157.5 => pos.x = 400 - 157.5 = 242.5
    const posFrame3 = handle!.position.x;

    // Monotonic movement towards target
    expect(posFrame1).toBeLessThan(400);
    expect(posFrame2).toBeLessThan(posFrame1);
    expect(posFrame3).toBeLessThan(posFrame2);

    // Target micro-movement inside deadzone around current camera pos (157.5)
    // dzX is 20, so setting target to (167.5, 0) is 10px from camera (inside deadzone)
    targetRefHolder!.current = { x: 167.5, y: 0 };
    const posBeforeMicro = handle!.position.x;
    mockTicker.tick();

    expect(handle!.position.x).toBe(posBeforeMicro);
  });

  it('throttles onViewportChange to ~5-6 calls over 500ms of continuous motion with 16ms ticks', () => {
    const onViewportChange = vi.fn();
    const mockTicker = createMockTicker();

    const { getByTestId } = render(
      <SpatialViewport
        viewportWidth={800}
        viewportHeight={600}
        onViewportChange={onViewportChange}
        ticker={mockTicker}
      />
    );

    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100, pointerId: 1 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100, pointerId: 1 });

    // Simulate 500ms of motion (31 frames at 16ms per frame)
    for (let frame = 0; frame < 31; frame++) {
      dispatchPointer(viewportEl, 'pointerMove', { clientX: 105 + frame * 5, clientY: 100, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(16);
      });
      mockTicker.tick();
    }

    // Over 500ms with 100ms throttle, should be called 5-6 times
    expect(onViewportChange.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(onViewportChange.mock.calls.length).toBeLessThanOrEqual(6);

    // Final call contains latest camera position
    const finalCallCamera = onViewportChange.mock.calls[onViewportChange.mock.calls.length - 1][0];
    expect(finalCallCamera.x).toBeLessThan(0);
  });

  it('clamps camera within world bounds specified by worldWidth/worldHeight props', () => {
    const mockTicker = createMockTicker();
    let handle: SpatialContainerHandle | null = null;

    const { getByTestId } = render(
      <SpatialViewport
        ref={(el) => {
          handle = el;
        }}
        viewportWidth={800}
        viewportHeight={600}
        worldWidth={1000}
        worldHeight={1000}
        clamp={true}
        ticker={mockTicker}
      />
    );

    const viewportEl = getByTestId('spatial-viewport');
    mockTicker.tick();

    // Try to pan far beyond left boundary (-2000px screen)
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 2000, clientY: 100 });

    mockTicker.tick();

    // World bounds [0, 1000]. Viewport 800. Min camera.x = 400.
    // Container position.x = 400 - 400 = 0.
    expect(handle!.position.x).toBe(0);
  });
});

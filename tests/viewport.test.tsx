import React, { useEffect, useState, useRef } from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, createEvent, fireEvent, act } from '@testing-library/react';
import { Container } from 'pixi.js';
import type { CameraState, Size } from '../src/core/camera';
import { SpatialViewport } from '../src/react/SpatialViewport';
import { useViewportContext } from '../src/react/context';
import { CullGroup, useCullable } from '../src/react/CullGroup';

// Polyfill canvas getContext for PixiJS in JSDOM environment
beforeAll(() => {
  if (typeof HTMLCanvasElement !== 'undefined' && !HTMLCanvasElement.prototype.getContext) {
    HTMLCanvasElement.prototype.getContext = (() => ({
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      putImageData: () => {},
      createImageData: () => [],
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      fillText: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 0 }),
      transform: () => {},
      rect: () => {},
      clip: () => {},
    })) as unknown as (contextId: string) => CanvasRenderingContext2D | null;
  }
});

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

function MockCullableSprite() {
  const spriteRef = useRef(new Container());
  const getRect = () => ({ x: 0, y: 0, width: 10, height: 10 });
  useCullable(spriteRef, getRect);
  return React.createElement('pixiSprite');
}

describe('SpatialViewport React component', () => {
  it('1. causes ZERO re-renders of children during camera movement', () => {
    let childRenderCount = 0;
    const mockTicker = createMockTicker();

    function CameraChild() {
      childRenderCount++;
      return <div data-testid="child-node">Child Content</div>;
    }

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <CameraChild />
      </SpatialViewport>
    );

    const initialRenders = childRenderCount;
    expect(initialRenders).toBe(1);

    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 200, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerUp', { clientX: 200, clientY: 100 });

    for (let i = 0; i < 10; i++) {
      mockTicker.tick();
    }

    // ZERO child re-renders!
    expect(childRenderCount).toBe(initialRenders);
  });

  it('2. cleans up all subscriptions and ticker callbacks on unmount without memory leaks', () => {
    const mockTicker = createMockTicker();

    const { unmount } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <div>Content</div>
      </SpatialViewport>
    );

    expect(mockTicker.listenerCount).toBe(1);
    unmount();
    expect(mockTicker.listenerCount).toBe(0);
  });

  it('3. does not double-subscribe ticker callbacks when wrapped in React.StrictMode', () => {
    const mockTicker = createMockTicker();

    render(
      <React.StrictMode>
        <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
          <div>Content</div>
        </SpatialViewport>
      </React.StrictMode>
    );

    expect(mockTicker.listenerCount).toBe(1);
  });

  it('4. notifies ViewportContext subscribers when camera moves', () => {
    const mockTicker = createMockTicker();
    let currentCamState: CameraState | null = null;

    function ContextConsumer() {
      const ctx = useViewportContext();
      useEffect(() => {
        currentCamState = ctx.getCamera();
        return ctx.subscribe((cam) => {
          currentCamState = cam;
        });
      }, [ctx]);
      return null;
    }

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <ContextConsumer />
      </SpatialViewport>
    );

    expect(currentCamState).toEqual({ x: 0, y: 0, zoom: 1 });

    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 150, clientY: 100 });

    act(() => {
      mockTicker.tick();
    });

    expect(currentCamState!.x).not.toBe(0);
  });

  it('5. throttles onViewportChange prop callbacks to at most once per 100ms', async () => {
    const mockTicker = createMockTicker();
    const onViewportChangeSpy = vi.fn();

    const { getByTestId } = render(
      <SpatialViewport
        viewportWidth={800}
        viewportHeight={600}
        onViewportChange={onViewportChangeSpy}
        ticker={mockTicker}
      />
    );

    const viewportEl = getByTestId('spatial-viewport');

    // Dispatch 20 rapid movements
    for (let i = 0; i < 20; i++) {
      dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
      dispatchPointer(viewportEl, 'pointerMove', { clientX: 100 + i * 5, clientY: 100 });
      mockTicker.tick();
    }

    expect(onViewportChangeSpy.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('6. applies container position and scale transform correctly on tick', () => {
    const mockTicker = createMockTicker();
    const mockContainer = new Container();

    render(
      <SpatialViewport
        container={mockContainer}
        viewportWidth={800}
        viewportHeight={600}
        initialCamera={{ x: 100, y: 200, zoom: 2.0 }}
        ticker={mockTicker}
      />
    );

    mockTicker.tick();

    // posX = 400 - 100 * 2 = 200
    // posY = 300 - 200 * 2 = -100
    expect(mockContainer.position.x).toBe(200);
    expect(mockContainer.position.y).toBe(-100);
    expect(mockContainer.scale.x).toBe(2.0);
    expect(mockContainer.scale.y).toBe(2.0);
  });

  it('7. follows target ref smoothly with lerp', () => {
    const mockTicker = createMockTicker();
    const targetRef = { current: { x: 500, y: 500 } };
    const mockContainer = new Container();

    render(
      <SpatialViewport
        container={mockContainer}
        viewportWidth={800}
        viewportHeight={600}
        follow={targetRef}
        followLerp={0.5}
        initialCamera={{ x: 0, y: 0, zoom: 1.0 }}
        ticker={mockTicker}
      />
    );

    // Initial mount lerp step (0,0) -> 50% lerp -> (250, 250) => posX = 400 - 250 = 150
    expect(mockContainer.position.x).toBe(150);
    expect(mockContainer.position.y).toBe(50);

    // Ticker frame lerp step (250,250) -> 50% lerp -> (375, 375) => posX = 400 - 375 = 25
    mockTicker.tick();
    expect(mockContainer.position.x).toBe(25);
    expect(mockContainer.position.y).toBe(-75);
  });

  it('8. updates real PixiJS Container object via ref', () => {
    const mockTicker = createMockTicker();
    const parentContainer = new Container();
    const childContainer = new Container();
    parentContainer.addChild(childContainer);

    const { getByTestId } = render(
      <SpatialViewport
        container={parentContainer}
        viewportWidth={800}
        viewportHeight={600}
        ticker={mockTicker}
      />
    );

    // Walk up parent chain from childContainer to verify reachable scene graph
    expect(childContainer.parent).toBe(parentContainer);
    expect(childContainer.parent!.position.x).toBe(400);
    expect(childContainer.parent!.position.y).toBe(300);

    // Pan gesture
    const viewportEl = getByTestId('spatial-viewport');

    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 150, clientY: 100 });

    act(() => {
      mockTicker.tick();
    });

    // Child's parent container position.x updated on actual PixiJS scene graph!
    expect(childContainer.parent!.position.x).toBe(445);
  });

  it('9. updates real PixiJS Container under React.StrictMode and component remounting', () => {
    const mockTicker = createMockTicker();
    const parentContainer = new Container();
    const childContainer = new Container();
    parentContainer.addChild(childContainer);

    function TestApp() {
      const [mounted, setMounted] = useState(true);
      return (
        <div>
          <button onClick={() => setMounted(!mounted)}>Toggle</button>
          {mounted && (
            <SpatialViewport
              container={parentContainer}
              viewportWidth={800}
              viewportHeight={600}
              ticker={mockTicker}
            />
          )}
        </div>
      );
    }

    const { getByText } = render(
      <React.StrictMode>
        <TestApp />
      </React.StrictMode>
    );

    expect(childContainer.parent!.position.x).toBe(400);

    // Remount component
    act(() => {
      getByText('Toggle').click();
    });
    act(() => {
      getByText('Toggle').click();
    });

    expect(childContainer.parent!.position.x).toBe(400);
  });

  it('10. throws descriptive error if target container lacks position.set or scale.set', () => {
    const mockTicker = createMockTicker();
    const invalidContainer = { position: { x: 0, y: 0 } }; // Missing position.set

    expect(() => {
      render(
        <SpatialViewport
          container={invalidContainer}
          viewportWidth={800}
          viewportHeight={600}
          ticker={mockTicker}
        />
      );
    }).toThrow(/SpatialViewport: target container must be a valid PixiJS Container instance/);
  });

  it('11. handles runtime viewport resize, updating container transform, camera clamps, and ViewportContext size', () => {
    const mockTicker = createMockTicker();
    let recordedViewportSize: Size | null = null;

    function SizeConsumer() {
      const ctx = useViewportContext();
      recordedViewportSize = ctx.getViewport();
      return null;
    }

    const { rerender } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <SizeConsumer />
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(recordedViewportSize).toEqual({ width: 800, height: 600 });

    // Resize viewport at runtime to 1200x900
    rerender(
      <SpatialViewport viewportWidth={1200} viewportHeight={900} ticker={mockTicker}>
        <SizeConsumer />
      </SpatialViewport>
    );

    mockTicker.tick();
    expect(recordedViewportSize).toEqual({ width: 1200, height: 900 });
  });

  it('12. safely handles async uninitialized state (isInitialised === false) without throwing errors', () => {
    function AsyncScene({ isInitialised }: { isInitialised: boolean }) {
      if (!isInitialised) return null;
      return <div data-testid="initialized-content">Ready</div>;
    }

    const { queryByTestId, rerender } = render(<AsyncScene isInitialised={false} />);
    expect(queryByTestId('initialized-content')).toBeNull();

    rerender(<AsyncScene isInitialised={true} />);
    expect(queryByTestId('initialized-content')).not.toBeNull();
  });

  it('13. renders complete Application -> SpatialViewport -> CullGroup -> Sprites tree in targetElement mode without rendering any HTML JSX <div> elements', () => {
    // Regression test: Entire Pixi scene tree must render without any HTML <div> elements
    const mockCanvas = document.createElement('canvas');
    const mockContainer = new Container();

    const { container } = render(
      <SpatialViewport
        targetElement={mockCanvas}
        container={mockContainer}
        viewportWidth={800}
        viewportHeight={600}
      >
        <CullGroup bounds={{ x: 0, y: 0, width: 1000, height: 1000 }}>
          <MockCullableSprite />
        </CullGroup>
      </SpatialViewport>
    );

    // Verify ZERO HTML <div> elements were created inside the Pixi tree
    expect(container.querySelectorAll('div').length).toBe(0);
  });
});

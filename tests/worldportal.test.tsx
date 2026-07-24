import React, { useState } from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, act } from '@testing-library/react';
import { SpatialViewport } from '../src/react/SpatialViewport';
import { WorldPortal } from '../src/react/WorldPortal';
import type { ViewportHandle } from '../src/react/context';

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

describe('WorldPortal React component', () => {
  it('1. projects world coordinate (0, 0) to screen center (400, 300) when camera is at (0, 0)', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} ticker={mockTicker}>
          <div data-testid="portal-center">Portal Content</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const child = getByTestId('portal-center');
    const wrapper = child.parentElement!;

    mockTicker.tick();

    // Screen position = viewportSize / 2 = (400, 300)
    expect(wrapper.style.transform).toBe('translate3d(400px, 300px, 0)');
    expect(wrapper.style.position).toBe('absolute');
  });

  it('2. updates transform directly on frame tick without React component re-renders', () => {
    let renderCount = 0;
    const mockTicker = createMockTicker();

    function TrackedPortalContent() {
      renderCount++;
      return <div data-testid="portal-tracked">Content</div>;
    }

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 100, y: 100 }} ticker={mockTicker}>
          <TrackedPortalContent />
        </WorldPortal>
      </SpatialViewport>
    );

    const initialRenders = renderCount;
    expect(initialRenders).toBe(1);

    const child = getByTestId('portal-tracked');
    const wrapper = child.parentElement!;

    // Simulate 10 ticks
    for (let i = 0; i < 10; i++) {
      mockTicker.tick();
    }

    // ZERO re-renders of children during frame ticks!
    expect(renderCount).toBe(initialRenders);
    expect(wrapper.style.transform).toBe('translate3d(500px, 400px, 0)');
  });

  it('3. offsets anchor correctly when anchor is 0.5 (center) or 1.0 (bottom-right)', () => {
    const mockTicker = createMockTicker();

    const { getByTestId: get1 } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} anchor={0.5} ticker={mockTicker}>
          <div data-testid="portal-anchor-half">Anchor 0.5</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapperHalf = get1('portal-anchor-half').parentElement!;
    mockTicker.tick();
    expect(wrapperHalf.style.transform).toBe('translate3d(400px, 300px, 0) translate(-50%, -50%)');

    const { getByTestId: get2 } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} anchor={{ x: 1.0, y: 1.0 }} ticker={mockTicker}>
          <div data-testid="portal-anchor-full">Anchor 1.0</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapperFull = get2('portal-anchor-full').parentElement!;
    mockTicker.tick();
    expect(wrapperFull.style.transform).toBe('translate3d(400px, 300px, 0) translate(-100%, -100%)');
  });

  it('4. sets visibility to hidden when position is offscreen and hideWhenOffscreen=true', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 2000, y: 2000 }} hideWhenOffscreen={true} ticker={mockTicker}>
          <div data-testid="portal-offscreen">Offscreen</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-offscreen').parentElement!;
    mockTicker.tick();
    expect(wrapper.style.visibility).toBe('hidden');
  });

  it('5. sets visibility to visible when position is onscreen', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 100, y: 100 }} hideWhenOffscreen={true} ticker={mockTicker}>
          <div data-testid="portal-onscreen">Onscreen</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-onscreen').parentElement!;
    mockTicker.tick();
    expect(wrapper.style.visibility).toBe('visible');
  });

  it('6. toggles pointer-events between none and auto based on interactive prop', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} interactive={true} ticker={mockTicker}>
          <div data-testid="portal-interactive">Interactive</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-interactive').parentElement!;
    expect(wrapper.style.pointerEvents).toBe('auto');
  });

  it('7. clamps portal to screen edge when offscreen if clampToScreen=true', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 2000, y: 2000 }} clampToScreen={true} ticker={mockTicker}>
          <div data-testid="portal-clamped">Clamped</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-clamped').parentElement!;
    mockTicker.tick();

    // World position (2000, 2000) produces screen coords > (800, 600) -> clamped to (800, 600)
    expect(wrapper.style.transform).toBe('translate3d(800px, 600px, 0)');
    expect(wrapper.style.visibility).toBe('visible');
  });

  it('8. removes portal wrapper element from DOM on unmount without leaks', () => {
    const mockTicker = createMockTicker();
    const { getByTestId, unmount } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} ticker={mockTicker}>
          <div data-testid="portal-unmount">Content</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const child = getByTestId('portal-unmount');
    const wrapper = child.parentElement!;
    expect(wrapper.parentNode).not.toBeNull();

    unmount();
    expect(wrapper.parentNode).toBeNull();
  });

  it('9. supports React.StrictMode without duplicate DOM nodes or leaks', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <React.StrictMode>
        <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
          <WorldPortal at={{ x: 0, y: 0 }} ticker={mockTicker}>
            <div data-testid="portal-strict">Content</div>
          </WorldPortal>
        </SpatialViewport>
      </React.StrictMode>
    );

    const child = getByTestId('portal-strict');
    const wrapper = child.parentElement!;
    expect(wrapper.parentNode).not.toBeNull();
  });

  it('10. updates DOM transform dynamically when at prop changes', () => {
    const mockTicker = createMockTicker();
    let setAtFn: ((p: { x: number; y: number }) => void) | null = null;

    function TestApp() {
      const [pos, setPos] = useState({ x: 0, y: 0 });
      setAtFn = setPos;

      return (
        <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
          <WorldPortal at={pos} ticker={mockTicker}>
            <div data-testid="portal-dynamic-at">Content</div>
          </WorldPortal>
        </SpatialViewport>
      );
    }

    const { getByTestId } = render(<TestApp />);
    const wrapper = getByTestId('portal-dynamic-at').parentElement!;

    mockTicker.tick();
    expect(wrapper.style.transform).toBe('translate3d(400px, 300px, 0)');

    act(() => {
      setAtFn!({ x: 200, y: 100 });
    });

    mockTicker.tick();
    expect(wrapper.style.transform).toBe('translate3d(600px, 400px, 0)');
  });

  it('11. applies custom className and style props to portal wrapper', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal
          at={{ x: 0, y: 0 }}
          className="my-custom-portal"
          style={{ opacity: '0.8' }}
          ticker={mockTicker}
        >
          <div data-testid="portal-custom-style">Content</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-custom-style').parentElement!;
    expect(wrapper.className).toBe('my-custom-portal');
    expect(wrapper.style.opacity).toBe('0.8');
  });

  it('12. accepts getter function at={() => ({ x, y })} and follows moving target on ticker frames without React component re-renders', () => {
    let childRenderCount = 0;
    function PortalContent() {
      childRenderCount++;
      return <div data-testid="portal-getter-child">Getter Portal</div>;
    }

    const mockTicker = createMockTicker();
    let targetPos = { x: 0, y: 0 };
    const posGetter = () => targetPos;

    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={posGetter} ticker={mockTicker}>
          <PortalContent />
        </WorldPortal>
      </SpatialViewport>
    );

    const child = getByTestId('portal-getter-child');
    const wrapper = child.parentElement!;

    mockTicker.tick();
    expect(wrapper.style.transform).toBe('translate3d(400px, 300px, 0)');
    expect(childRenderCount).toBe(1);

    // Update target position directly (zero React re-renders)
    targetPos = { x: 250, y: 150 };
    mockTicker.tick();

    // 400 + 250 = 650, 300 + 150 = 450
    expect(wrapper.style.transform).toBe('translate3d(650px, 450px, 0)');
    expect(childRenderCount).toBe(1); // STILL ZERO RE-RENDERS!
  });

  it('13. returns null before DOM overlay attachment so raw text children never leak into custom reconciler trees', () => {
    const mockTicker = createMockTicker();
    const { getByText } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} ticker={mockTicker}>
          Raw Text Badge Content
        </WorldPortal>
      </SpatialViewport>
    );

    expect(getByText('Raw Text Badge Content')).not.toBeNull();
  });

  it('14. works rendered in react-dom tree using viewport handle prop without SpatialViewport context', () => {
    const mockTicker = createMockTicker();
    let vpHandle: ViewportHandle | null = null;
    let targetPos = { x: 100, y: 50 };

    function StandalonePortalApp() {
      return (
        <div>
          <SpatialViewport
            ref={(handle) => {
              vpHandle = handle;
            }}
            viewportWidth={800}
            viewportHeight={600}
            ticker={mockTicker}
          />
          {vpHandle && (
            <WorldPortal
              viewport={vpHandle}
              at={() => targetPos}
              anchor={0.5}
              ticker={mockTicker}
            >
              <div data-testid="portal-handle-prop">Handle Prop Portal</div>
            </WorldPortal>
          )}
        </div>
      );
    }

    const { getByTestId, rerender } = render(<StandalonePortalApp />);
    rerender(<StandalonePortalApp />);

    const child = getByTestId('portal-handle-prop');
    const wrapper = child.parentElement!;

    mockTicker.tick();
    // (400 + 100, 300 + 50) = (500, 350) with anchor 0.5
    expect(wrapper.style.transform).toBe('translate3d(500px, 350px, 0) translate(-50%, -50%)');

    // Update target
    targetPos = { x: 300, y: 200 };
    mockTicker.tick();
    expect(wrapper.style.transform).toBe('translate3d(700px, 500px, 0) translate(-50%, -50%)');
  });

  it('15. throws descriptive error when neither viewport prop nor ViewportContext is provided', () => {
    expect(() => {
      render(
        <WorldPortal at={{ x: 0, y: 0 }}>
          <div>No Context Portal</div>
        </WorldPortal>
      );
    }).toThrow('WorldPortal must receive a viewport prop or be rendered inside SpatialViewport.');
  });
});

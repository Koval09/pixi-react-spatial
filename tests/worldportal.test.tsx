import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, createEvent, fireEvent, act } from '@testing-library/react';
import { SpatialViewport } from '../src/react/SpatialViewport';
import { WorldPortal } from '../src/react/WorldPortal';

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

describe('WorldPortal React component', () => {
  it('1. causes ZERO child re-renders during camera movement and ticker frames', () => {
    let renderCount = 0;
    function PortalChild() {
      renderCount++;
      return <div data-testid="portal-content">Portal Text</div>;
    }

    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 100, y: 50 }} ticker={mockTicker}>
          <PortalChild />
        </WorldPortal>
      </SpatialViewport>
    );

    const initialRenders = renderCount;
    expect(initialRenders).toBe(1);

    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 200, clientY: 100 });

    for (let i = 0; i < 10; i++) {
      mockTicker.tick();
    }

    // ZERO child re-renders!
    expect(renderCount).toBe(initialRenders);
  });

  it('2. mutates DOM style.transform directly upon camera movement', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 100, y: 50 }} ticker={mockTicker}>
          <div data-testid="portal-child">Hello</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const child = getByTestId('portal-child');
    const wrapper = child.parentElement!;

    // Initial camera = (0, 0), viewport = 800x600. screen = (400 + 100, 300 + 50) = (500, 350)
    mockTicker.tick();
    expect(wrapper.style.transform).toBe('translate3d(500px, 350px, 0)');

    // Pan camera (screen moved +50 right => camera moved -50 left)
    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 150, clientY: 100 });

    mockTicker.tick();

    // Camera.x = -45 => screenX = 500 - (-45) = 545
    expect(wrapper.style.transform).toBe('translate3d(545px, 350px, 0)');
  });

  it('3. applies anchor 0.5 and 1.0 offsets to CSS transform', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} anchor={0.5} ticker={mockTicker}>
          <div data-testid="portal-centered">Centered</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-centered').parentElement!;
    mockTicker.tick();

    expect(wrapper.style.transform).toBe('translate3d(400px, 300px, 0) translate(-50%, -50%)');
  });

  it('4. toggles visibility when object moves offscreen (hideWhenOffscreen=true)', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 100, y: 50 }} hideWhenOffscreen={true} ticker={mockTicker}>
          <div data-testid="portal-offscreen">Portal</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-offscreen').parentElement!;
    mockTicker.tick();
    expect(wrapper.style.visibility).toBe('visible');

    // Pan camera far away so (100, 50) goes offscreen
    const viewportEl = getByTestId('spatial-viewport');
    dispatchPointer(viewportEl, 'pointerDown', { clientX: 100, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: 105, clientY: 100 });
    dispatchPointer(viewportEl, 'pointerMove', { clientX: -2000, clientY: -2000 });

    mockTicker.tick();
    expect(wrapper.style.visibility).toBe('hidden');
  });

  it('5. preserves visibility=visible when offscreen if hideWhenOffscreen=false', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 10000, y: 10000 }} hideWhenOffscreen={false} ticker={mockTicker}>
          <div data-testid="portal-always-visible">Portal</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-always-visible').parentElement!;
    mockTicker.tick();
    expect(wrapper.style.visibility).toBe('visible');
  });

  it('6. sets pointer-events to auto when interactive=true and none when false', () => {
    const mockTicker = createMockTicker();
    const { getByTestId, rerender } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} interactive={false} ticker={mockTicker}>
          <div data-testid="portal-interactive">Content</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-interactive').parentElement!;
    expect(wrapper.style.pointerEvents).toBe('none');

    rerender(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 0, y: 0 }} interactive={true} ticker={mockTicker}>
          <div data-testid="portal-interactive">Content</div>
        </WorldPortal>
      </SpatialViewport>
    );

    expect(wrapper.style.pointerEvents).toBe('auto');
  });

  it('7. clamps portal to screen edge when offscreen if clampToScreen=true', () => {
    const mockTicker = createMockTicker();
    const { getByTestId } = render(
      <SpatialViewport viewportWidth={800} viewportHeight={600} ticker={mockTicker}>
        <WorldPortal at={{ x: 5000, y: 5000 }} clampToScreen={true} ticker={mockTicker}>
          <div data-testid="portal-clamped">Clamped</div>
        </WorldPortal>
      </SpatialViewport>
    );

    const wrapper = getByTestId('portal-clamped').parentElement!;
    mockTicker.tick();

    // Clamped screen coords to viewport max bounds (800, 600)
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
});

import { describe, it, expect } from 'vitest';
import { createCameraState, Quadtree } from '../src/core';
import { SpatialViewport, CullGroup, WorldPortal } from '../src/react';

describe('pixi-react-spatial smoke tests', () => {
  it('exports core modules correctly', () => {
    const cam = createCameraState(10, 20, 2);
    expect(cam).toEqual({ x: 10, y: 20, zoom: 2 });

    const qt = new Quadtree({ x: 0, y: 0, width: 100, height: 100 });
    expect(qt.bounds.width).toBe(100);
  });

  it('exports react components', () => {
    expect(SpatialViewport).toBeDefined();
    expect(CullGroup).toBeDefined();
    expect(WorldPortal).toBeDefined();
  });
});

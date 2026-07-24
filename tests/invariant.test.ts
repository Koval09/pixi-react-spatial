import { describe, it, expect } from 'vitest';
import { screenToWorld, clampCamera, type CameraState } from '../src/core/camera';
import { Quadtree, type Rect } from '../src/core/quadtree';

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SpatialEntity {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

describe('Spatial Viewport & CullGroup Spatial Invariants', () => {
  it('strictly satisfies screen-to-world query coverage for 100 random cameras', () => {
    const rng = mulberry32(42);
    const WORLD_SIZE = 8000;
    const VIEWPORT_WIDTH = 800;
    const VIEWPORT_HEIGHT = 600;
    const OVERSCAN = 0.2;

    const entities: SpatialEntity[] = [];
    for (let i = 0; i < 1000; i++) {
      entities.push({
        id: i,
        x: rng() * WORLD_SIZE,
        y: rng() * WORLD_SIZE,
        width: 10 + rng() * 20,
        height: 10 + rng() * 20,
      });
    }

    const quadtree = new Quadtree<SpatialEntity>({
      x: 0,
      y: 0,
      width: WORLD_SIZE,
      height: WORLD_SIZE,
    });

    const getBounds = (item: SpatialEntity): Rect => ({
      x: item.x - item.width / 2,
      y: item.y - item.height / 2,
      width: item.width,
      height: item.height,
    });

    for (const ent of entities) {
      quadtree.insert(ent, getBounds);
    }

    for (let sample = 0; sample < 100; sample++) {
      const rawCam: CameraState = {
        x: rng() * WORLD_SIZE,
        y: rng() * WORLD_SIZE,
        zoom: 0.1 + rng() * 3.9,
      };

      const cam = clampCamera(rawCam, { x: 0, y: 0, width: WORLD_SIZE, height: WORLD_SIZE }, {
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
      });

      const visW = VIEWPORT_WIDTH / cam.zoom;
      const visH = VIEWPORT_HEIGHT / cam.zoom;
      const marginX = visW * OVERSCAN;
      const marginY = visH * OVERSCAN;

      const queryRect: Rect = {
        x: cam.x - visW / 2 - marginX,
        y: cam.y - visH / 2 - marginY,
        width: visW + 2 * marginX,
        height: visH + 2 * marginY,
      };

      const visibleEntities = quadtree.query(queryRect, getBounds);
      expect(Array.isArray(visibleEntities)).toBe(true);

      const centerScreenPoint = { x: VIEWPORT_WIDTH / 2, y: VIEWPORT_HEIGHT / 2 };
      const centerWorldPoint = screenToWorld(
        centerScreenPoint,
        cam,
        { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }
      );

      expect(centerWorldPoint.x).toBeGreaterThanOrEqual(queryRect.x);
      expect(centerWorldPoint.x).toBeLessThanOrEqual(queryRect.x + queryRect.width);
      expect(centerWorldPoint.y).toBeGreaterThanOrEqual(queryRect.y);
      expect(centerWorldPoint.y).toBeLessThanOrEqual(queryRect.y + queryRect.height);

      const screenCorners = [
        { x: 0, y: 0 },
        { x: VIEWPORT_WIDTH, y: 0 },
        { x: 0, y: VIEWPORT_HEIGHT },
        { x: VIEWPORT_WIDTH, y: VIEWPORT_HEIGHT },
      ];

      for (const corner of screenCorners) {
        const cornerWorld = screenToWorld(
          corner,
          cam,
          { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }
        );

        expect(cornerWorld.x).toBeGreaterThanOrEqual(queryRect.x);
        expect(cornerWorld.x).toBeLessThanOrEqual(queryRect.x + queryRect.width);
        expect(cornerWorld.y).toBeGreaterThanOrEqual(queryRect.y);
        expect(cornerWorld.y).toBeLessThanOrEqual(queryRect.y + queryRect.height);
      }
    }
  });
});

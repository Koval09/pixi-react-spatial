import { describe, it, expect } from 'vitest';
import {
  createCameraState,
  worldToScreen,
  screenToWorld,
  zoomAtPoint,
  clampCamera,
  followTarget,
  type Point,
  type Size,
  type Rect,
  type CameraState,
} from '../src/core/camera';

describe('camera core module', () => {
  it('creates default camera state', () => {
    const cam = createCameraState();
    expect(cam).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  describe('worldToScreen / screenToWorld reversibility', () => {
    it('is strictly reversible across a grid of world points, camera states, and viewports', () => {
      const worldPoints: Point[] = [
        { x: -1000, y: -500 },
        { x: 0, y: 0 },
        { x: 50.5, y: 200.25 },
        { x: 1920, y: 1080 },
      ];

      const cameraStates: CameraState[] = [
        { x: 0, y: 0, zoom: 1 },
        { x: 100, y: -50, zoom: 0.5 },
        { x: -300, y: 400, zoom: 2 },
        { x: 500, y: 500, zoom: 10 },
      ];

      const viewports: Size[] = [
        { width: 800, height: 600 },
        { width: 1920, height: 1080 },
      ];

      for (const vp of viewports) {
        for (const cam of cameraStates) {
          for (const wPoint of worldPoints) {
            const screenPoint = worldToScreen(wPoint, cam, vp);
            const recoveredWorldPoint = screenToWorld(screenPoint, cam, vp);

            expect(recoveredWorldPoint.x).toBeCloseTo(wPoint.x, 8);
            expect(recoveredWorldPoint.y).toBeCloseTo(wPoint.y, 8);

            const recoveredScreenPoint = worldToScreen(recoveredWorldPoint, cam, vp);
            expect(recoveredScreenPoint.x).toBeCloseTo(screenPoint.x, 8);
            expect(recoveredScreenPoint.y).toBeCloseTo(screenPoint.y, 8);
          }
        }
      }
    });
  });

  describe('zoomAtPoint', () => {
    it('keeps the world point under the cursor invariant after zoom', () => {
      const camera: CameraState = { x: 100, y: 200, zoom: 1 };
      const viewport: Size = { width: 800, height: 600 };
      const cursor: Point = { x: 350, y: 250 };

      const worldBefore = screenToWorld(cursor, camera, viewport);
      const zoomedCamera = zoomAtPoint(camera, cursor, 2.5, viewport);
      const worldAfter = screenToWorld(cursor, zoomedCamera, viewport);

      expect(zoomedCamera.zoom).toBe(2.5);
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 8);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 8);
    });

    it('respects minZoom and maxZoom constraints', () => {
      const camera: CameraState = { x: 0, y: 0, zoom: 1 };
      const viewport: Size = { width: 800, height: 600 };
      const cursor: Point = { x: 400, y: 300 };

      const clampedMin = zoomAtPoint(camera, cursor, 0.05, viewport, 0.2, 5);
      expect(clampedMin.zoom).toBe(0.2);

      const clampedMax = zoomAtPoint(camera, cursor, 10, viewport, 0.2, 5);
      expect(clampedMax.zoom).toBe(5);
    });

    it('returns original camera state if requested zoom equals current zoom', () => {
      const camera: CameraState = { x: 50, y: 50, zoom: 2 };
      const viewport: Size = { width: 800, height: 600 };
      const cursor: Point = { x: 100, y: 100 };

      const result = zoomAtPoint(camera, cursor, 2, viewport);
      expect(result).toBe(camera);
    });
  });

  describe('clampCamera', () => {
    const worldBounds: Rect = { x: 0, y: 0, width: 1000, height: 1000 };

    it('centers camera when world is smaller than viewport', () => {
      const viewport: Size = { width: 2000, height: 2000 };
      const camera: CameraState = { x: 100, y: 100, zoom: 1 };

      const clamped = clampCamera(camera, worldBounds, viewport);
      expect(clamped.x).toBe(500); // 0 + 1000 / 2
      expect(clamped.y).toBe(500);
    });

    it('clamps camera to left and top edges when world is larger than viewport', () => {
      const viewport: Size = { width: 400, height: 300 };
      const camera: CameraState = { x: -100, y: -50, zoom: 1 };

      const clamped = clampCamera(camera, worldBounds, viewport);
      expect(clamped.x).toBe(200); // worldBounds.x + 400 / 2
      expect(clamped.y).toBe(150); // worldBounds.y + 300 / 2
    });

    it('clamps camera to right and bottom edges', () => {
      const viewport: Size = { width: 400, height: 300 };
      const camera: CameraState = { x: 2000, y: 1500, zoom: 1 };

      const clamped = clampCamera(camera, worldBounds, viewport);
      expect(clamped.x).toBe(800); // 1000 - 400 / 2
      expect(clamped.y).toBe(850); // 1000 - 300 / 2
    });

    it('leaves camera untouched when inside valid bounds', () => {
      const viewport: Size = { width: 400, height: 300 };
      const camera: CameraState = { x: 500, y: 500, zoom: 1 };

      const clamped = clampCamera(camera, worldBounds, viewport);
      expect(clamped.x).toBe(500);
      expect(clamped.y).toBe(500);
    });
  });

  describe('followTarget', () => {
    it('converges smoothly over multiple steps without deadzone', () => {
      let camera: CameraState = { x: 0, y: 0, zoom: 1 };
      const target: Point = { x: 100, y: 200 };
      const lerpFactor = 0.5;

      for (let i = 0; i < 25; i++) {
        camera = followTarget(camera, target, lerpFactor);
      }

      expect(camera.x).toBeCloseTo(100, 3);
      expect(camera.y).toBeCloseTo(200, 3);
    });

    it('ignores target movement within deadzone', () => {
      const camera: CameraState = { x: 100, y: 100, zoom: 1 };
      const targetInside: Point = { x: 120, y: 80 };
      const deadzone: Size = { width: 100, height: 100 }; // dzX = 50, dzY = 50

      const result = followTarget(camera, targetInside, 0.5, deadzone);
      expect(result.x).toBe(100);
      expect(result.y).toBe(100);
    });

    it('follows target when moving outside deadzone', () => {
      let camera: CameraState = { x: 100, y: 100, zoom: 1 };
      const targetOutside: Point = { x: 300, y: 100 }; // dx = 200 > dzX(50)
      const deadzone = 50; // dzX = 50, dzY = 50

      for (let i = 0; i < 25; i++) {
        camera = followTarget(camera, targetOutside, 0.5, deadzone);
      }

      // targetX = 300 - 50 = 250
      expect(camera.x).toBeCloseTo(250, 3);
      expect(camera.y).toBeCloseTo(100, 3);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { createCameraState, screenToWorld } from '../src/core/camera';
import {
  createGestureState,
  handleGesture,
  type GestureConfig,
  type GestureState,
} from '../src/core/gestures';

describe('gestures core module', () => {
  const config: GestureConfig = {
    viewport: { width: 800, height: 600 },
    panThreshold: 3,
    minZoom: 0.5,
    maxZoom: 3.0,
  };

  it('handles 3px pan threshold against accidental clicks', () => {
    let state: GestureState = createGestureState();
    let camera = createCameraState(0, 0, 1);

    // pointerdown at (100, 100)
    let res = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 100, pointerId: 1 }, config);
    state = res.state;
    camera = res.camera;

    expect(state.mode).toBe('drag_pending');
    expect(camera.x).toBe(0);

    // move 2px to (102, 100) -> below 3px threshold
    res = handleGesture(state, camera, { type: 'pointermove', x: 102, y: 100, pointerId: 1 }, config);
    state = res.state;
    camera = res.camera;

    expect(state.mode).toBe('drag_pending');
    expect(camera.x).toBe(0);

    // move to (105, 100) -> 5px total move >= 3px threshold -> transitions to panning
    res = handleGesture(state, camera, { type: 'pointermove', x: 105, y: 100, pointerId: 1 }, config);
    state = res.state;
    camera = res.camera;

    expect(state.mode).toBe('panning');
    expect(camera.x).toBe(0); // prev set on threshold transition

    // next move to (125, 100) -> delta 20px right
    res = handleGesture(state, camera, { type: 'pointermove', x: 125, y: 100, pointerId: 1 }, config);
    state = res.state;
    camera = res.camera;

    expect(camera.x).toBe(-20); // screen moved right (+20) => camera moved left (-20)

    // pointerup -> returns to idle
    res = handleGesture(state, camera, { type: 'pointerup', x: 125, y: 100, pointerId: 1 }, config);
    state = res.state;

    expect(state.mode).toBe('idle');
  });

  it('locks threshold behavior at exactly 3px (dist < 3 is drag_pending, dist >= 3 is panning)', () => {
    let state = createGestureState();
    const camera = createCameraState(0, 0, 1);

    state = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 100, pointerId: 1 }, config).state;

    // Move to (102.9, 100) -> distance = 2.9 < 3
    let res = handleGesture(state, camera, { type: 'pointermove', x: 102.9, y: 100, pointerId: 1 }, config);
    expect(res.state.mode).toBe('drag_pending');

    // Move to (103.0, 100) -> distance = 3.0 >= 3
    res = handleGesture(state, camera, { type: 'pointermove', x: 103.0, y: 100, pointerId: 1 }, config);
    expect(res.state.mode).toBe('panning');
  });

  it('pans with zoom factor scaling (zoom=2: screen 10px = world 5; zoom=0.5: screen 10px = world 20)', () => {
    let state = createGestureState();

    // Test at zoom = 2
    let camera = createCameraState(0, 0, 2);
    state = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 100, pointerId: 1 }, config).state;
    state = handleGesture(state, camera, { type: 'pointermove', x: 105, y: 100, pointerId: 1 }, config).state;
    let res = handleGesture(state, camera, { type: 'pointermove', x: 115, y: 100, pointerId: 1 }, config);
    expect(res.camera.x).toBe(-5);

    // Test at zoom = 0.5
    state = createGestureState();
    camera = createCameraState(0, 0, 0.5);
    state = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 100, pointerId: 1 }, config).state;
    state = handleGesture(state, camera, { type: 'pointermove', x: 105, y: 100, pointerId: 1 }, config).state;
    res = handleGesture(state, camera, { type: 'pointermove', x: 115, y: 100, pointerId: 1 }, config);
    expect(res.camera.x).toBe(-20);
  });

  it('wheel zoom direction and min/max zoom clamping', () => {
    const state = createGestureState();
    const camera = createCameraState(0, 0, 1);

    // Negative deltaY (scroll up) zooms in
    let res = handleGesture(state, camera, { type: 'wheel', x: 400, y: 300, deltaY: -500 }, config);
    expect(res.camera.zoom).toBeGreaterThan(1);

    // Positive deltaY (scroll down) zooms out
    res = handleGesture(state, camera, { type: 'wheel', x: 400, y: 300, deltaY: 500 }, config);
    expect(res.camera.zoom).toBeLessThan(1);

    // Extreme wheel scroll up does not exceed maxZoom (3.0)
    res = handleGesture(state, camera, { type: 'wheel', x: 400, y: 300, deltaY: -5000 }, config);
    expect(res.camera.zoom).toBe(3.0);

    // Extreme wheel scroll down does not drop below minZoom (0.5)
    res = handleGesture(state, camera, { type: 'wheel', x: 400, y: 300, deltaY: 5000 }, config);
    expect(res.camera.zoom).toBe(0.5);
  });

  it('handles wheel zoom to cursor point', () => {
    const state = createGestureState();
    const camera = createCameraState(0, 0, 1);

    const cursor = { x: 300, y: 250 };
    const worldBefore = screenToWorld(cursor, camera, config.viewport);

    const res = handleGesture(
      state,
      camera,
      { type: 'wheel', x: cursor.x, y: cursor.y, deltaY: -100 },
      config
    );

    expect(res.camera.zoom).toBeGreaterThan(1);
    const worldAfter = screenToWorld(cursor, res.camera, config.viewport);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('handles pinch zoom with two pointers', () => {
    let state = createGestureState();
    let camera = createCameraState(0, 0, 1);

    // p1 down at (100, 200)
    let res = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 200, pointerId: 1 }, config);
    state = res.state;

    // p2 down at (300, 200) -> distance = 200
    res = handleGesture(state, camera, { type: 'pointerdown', x: 300, y: 200, pointerId: 2 }, config);
    state = res.state;

    expect(state.mode).toBe('pinching');

    // move p2 to (500, 200) -> distance = 400 (2x scale)
    res = handleGesture(state, camera, { type: 'pointermove', x: 500, y: 200, pointerId: 2 }, config);
    state = res.state;
    camera = res.camera;

    expect(camera.zoom).toBe(2);
  });

  it('handles pinch with simultaneous midpoint shift (zoom + pan in one gesture)', () => {
    let state = createGestureState();
    const camera = createCameraState(0, 0, 1);

    // p1 at (100, 200), p2 at (300, 200) -> initial dist = 200, initial mid = (200, 200)
    state = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 200, pointerId: 1 }, config).state;
    state = handleGesture(state, camera, { type: 'pointerdown', x: 300, y: 200, pointerId: 2 }, config).state;

    // Move p1 to (200, 200) and p2 to (600, 200) -> new dist = 400 (2x zoom), new mid = (400, 200) (shifted right by +200)
    let res = handleGesture(state, camera, { type: 'pointermove', x: 600, y: 200, pointerId: 2 }, config);
    res = handleGesture(res.state, res.camera, { type: 'pointermove', x: 200, y: 200, pointerId: 1 }, config);

    expect(res.camera.zoom).toBe(2);
    // Midpoint shifted right by +200px, so camera.x shifts left
    expect(res.camera.x).toBeLessThan(0);
  });

  it('degrades smoothly from pinch to pan without camera jump on 1 finger release', () => {
    let state = createGestureState();
    let camera = createCameraState(0, 0, 1);

    // p1 down at (100, 200), p2 down at (300, 200)
    state = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 200, pointerId: 1 }, config).state;
    let res = handleGesture(state, camera, { type: 'pointerdown', x: 300, y: 200, pointerId: 2 }, config);
    state = res.state;
    camera = res.camera;

    // pinch move p2 to (500, 200)
    res = handleGesture(state, camera, { type: 'pointermove', x: 500, y: 200, pointerId: 2 }, config);
    state = res.state;
    camera = res.camera;

    const cameraBeforeUp = { ...camera };

    // release p2 -> degrade to 1-finger pan with p1
    res = handleGesture(state, camera, { type: 'pointerup', x: 500, y: 200, pointerId: 2 }, config);
    state = res.state;
    camera = res.camera;

    expect(state.mode).toBe('panning');
    // Camera position MUST NOT jump on pointerup!
    expect(camera.x).toBe(cameraBeforeUp.x);
    expect(camera.y).toBe(cameraBeforeUp.y);

    // subsequent move of remaining finger p1 by (10, 0)
    res = handleGesture(state, camera, { type: 'pointermove', x: 110, y: 200, pointerId: 1 }, config);
    camera = res.camera;

    expect(camera.x).toBeCloseTo(cameraBeforeUp.x - 10 / camera.zoom, 6);
  });

  it('resets state on pointercancel during pan and pinch without camera jump', () => {
    let state = createGestureState();
    let camera = createCameraState(0, 0, 1);

    // Start pan and move
    state = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 100, pointerId: 1 }, config).state;
    state = handleGesture(state, camera, { type: 'pointermove', x: 105, y: 100, pointerId: 1 }, config).state;
    let res = handleGesture(state, camera, { type: 'pointermove', x: 125, y: 100, pointerId: 1 }, config);
    camera = res.camera;
    state = res.state;

    const panCamPosition = { ...camera };

    // Cancel pointer
    res = handleGesture(state, camera, { type: 'pointercancel', x: 125, y: 100, pointerId: 1 }, config);
    state = res.state;
    expect(state.mode).toBe('idle');
    expect(state.pointers).toHaveLength(0);
    expect(res.camera).toEqual(panCamPosition);

    // Fresh pointerdown works cleanly from fresh state
    res = handleGesture(state, camera, { type: 'pointerdown', x: 50, y: 50, pointerId: 5 }, config);
    expect(res.state.mode).toBe('drag_pending');
    expect(res.state.pointers).toHaveLength(1);
  });

  it('ignores a 3rd pointerdown during pinch and keeps pinch working for original pointers', () => {
    let state = createGestureState();
    const camera = createCameraState(0, 0, 1);

    state = handleGesture(state, camera, { type: 'pointerdown', x: 100, y: 200, pointerId: 1 }, config).state;
    state = handleGesture(state, camera, { type: 'pointerdown', x: 300, y: 200, pointerId: 2 }, config).state;

    expect(state.mode).toBe('pinching');

    // 3rd pointer down
    let res = handleGesture(state, camera, { type: 'pointerdown', x: 500, y: 500, pointerId: 3 }, config);
    state = res.state;
    expect(state.mode).toBe('pinching');
    expect(state.pointers).toHaveLength(3);

    // Move p2 from 300 to 500 -> distance 400 (2x zoom)
    res = handleGesture(state, camera, { type: 'pointermove', x: 500, y: 200, pointerId: 2 }, config);
    expect(res.camera.zoom).toBe(2);
  });
});

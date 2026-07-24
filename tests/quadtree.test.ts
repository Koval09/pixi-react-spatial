import { describe, it, expect } from 'vitest';
import { Quadtree, intersects, type Rect } from '../src/core/quadtree';

interface TestItem {
  id: number;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRandomRect(
  random: () => number,
  minX = 0,
  minY = 0,
  maxX = 1000,
  maxY = 1000
): Rect {
  const x = minX + random() * (maxX - minX);
  const y = minY + random() * (maxY - minY);
  const width = random() * 50 + 1;
  const height = random() * 50 + 1;
  return { x, y, width, height };
}

describe('Quadtree core module', () => {
  it('correctly handles size and clear operations', () => {
    const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 1000, height: 1000 });
    expect(qt.size).toBe(0);

    const item1 = { id: 1 };
    const item2 = { id: 2 };
    qt.insert(item1, { x: 10, y: 10, width: 20, height: 20 });
    qt.insert(item2, { x: 50, y: 50, width: 30, height: 30 });

    expect(qt.size).toBe(2);
    qt.clear();
    expect(qt.size).toBe(0);
    expect(qt.query({ x: 0, y: 0, width: 100, height: 100 })).toHaveLength(0);
  });

  describe('property-based query correctness vs naive O(n) scan', () => {
    it('matches naive linear scan on 1000 random items', () => {
      const seed = Date.now();
      console.log(`Property test seed: ${seed}`);
      const random = mulberry32(seed);

      const bounds: Rect = { x: 0, y: 0, width: 1000, height: 1000 };
      const qt = new Quadtree<TestItem>(bounds, 8, 6);
      const items: Array<{ item: TestItem; rect: Rect }> = [];

      for (let i = 0; i < 1000; i++) {
        const rect = createRandomRect(random, 0, 0, 950, 950);
        const item = { id: i };
        items.push({ item, rect });
        qt.insert(item, rect);
      }

      expect(qt.size).toBe(1000);

      // Perform 50 random queries
      for (let q = 0; q < 50; q++) {
        const queryRect = createRandomRect(random, 0, 0, 900, 900);

        const naiveResults = items
          .filter((entry) => intersects(entry.rect, queryRect))
          .map((entry) => entry.item);

        const qtResults = qt.query(queryRect);

        expect(qtResults.length).toBe(new Set(qtResults).size);
        expect(new Set(qtResults)).toEqual(new Set(naiveResults));
      }
    });
  });

  describe('split on overflow', () => {
    it('splits node when object count exceeds maxObjects', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 100, height: 100 }, 4, 4);

      // Insert 5 items into top-left quadrant (0..50, 0..50)
      for (let i = 0; i < 5; i++) {
        qt.insert({ id: i }, { x: i * 5, y: i * 5, width: 2, height: 2 });
      }

      expect(qt.size).toBe(5);

      const queryTopLeft = qt.query({ x: 0, y: 0, width: 49, height: 49 });
      expect(queryTopLeft).toHaveLength(5);

      const queryBottomRight = qt.query({ x: 51, y: 51, width: 49, height: 49 });
      expect(queryBottomRight).toHaveLength(0);
    });
  });

  describe('remove and update', () => {
    it('removes objects correctly O(1)', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 500, height: 500 });
      const item1 = { id: 1 };
      const item2 = { id: 2 };

      qt.insert(item1, { x: 10, y: 10, width: 20, height: 20 });
      qt.insert(item2, { x: 100, y: 100, width: 20, height: 20 });

      expect(qt.remove(item1)).toBe(true);
      expect(qt.remove(item1)).toBe(false);
      expect(qt.size).toBe(1);

      const results = qt.query({ x: 0, y: 0, width: 500, height: 500 });
      expect(results).toEqual([item2]);
    });

    it('handles partial lazy updates (< 30% dirty)', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 1000, height: 1000 });
      const items: TestItem[] = [];

      for (let i = 0; i < 10; i++) {
        const item = { id: i };
        items.push(item);
        qt.insert(item, { x: i * 20, y: i * 20, width: 10, height: 10 });
      }

      // Update 2 items (20% dirty)
      qt.update(items[0], { x: 800, y: 800, width: 10, height: 10 });
      qt.update(items[1], { x: 900, y: 900, width: 10, height: 10 });

      // Before query, updated items are not in old location
      const oldLocationResults = qt.query({ x: 0, y: 0, width: 30, height: 30 });
      expect(oldLocationResults).not.toContain(items[0]);
      expect(oldLocationResults).not.toContain(items[1]);

      // Query new locations
      const newLocationResults = qt.query({ x: 750, y: 750, width: 200, height: 200 });
      expect(newLocationResults).toContain(items[0]);
      expect(newLocationResults).toContain(items[1]);
    });

    it('triggers full rebuild when lazy updates exceed 30% threshold', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 1000, height: 1000 });
      const items: TestItem[] = [];

      for (let i = 0; i < 10; i++) {
        const item = { id: i };
        items.push(item);
        qt.insert(item, { x: i * 20, y: i * 20, width: 10, height: 10 });
      }

      expect(qt.rebuildCount).toBe(0);

      // Update 4 items (40% dirty > 30%)
      for (let i = 0; i < 4; i++) {
        qt.update(items[i], { x: 500 + i * 20, y: 500 + i * 20, width: 10, height: 10 });
      }

      expect(qt.rebuildCount).toBe(1);

      const results = qt.query({ x: 450, y: 450, width: 200, height: 200 });
      expect(results).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        expect(results).toContain(items[i]);
      }
    });

    it('safely queries frozen objects (Object.freeze) using WeakMap fallback without errors', () => {
      const qt = new Quadtree<Record<string, unknown>>({ x: 0, y: 0, width: 1000, height: 1000 });
      const frozenItem = Object.freeze({ id: 99, x: 100, y: 100, width: 20, height: 20 });

      expect(() => {
        qt.insert(frozenItem);
      }).not.toThrow();

      expect(() => {
        const res = qt.query({ x: 0, y: 0, width: 500, height: 500 });
        expect(res).toContain(frozenItem);
      }).not.toThrow();
    });

    it('always includes objects positioned far outside quadtree bounds in query results', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 1000, height: 1000 });
      const oobItem = { id: 888 };

      qt.insert(oobItem, { x: 15000, y: 15000, width: 100, height: 100 });

      // Query anywhere in the world
      const res = qt.query({ x: 0, y: 0, width: 500, height: 500 });
      expect(res).toContain(oobItem);
    });
  });

  describe('quadrant boundaries and degenerate shapes', () => {
    it('handles objects spanning quadrant boundaries', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 1000, height: 1000 }, 2, 4);

      // Boundary object straddling x = 500 line
      const boundaryItem = { id: 999 };
      qt.insert(boundaryItem, { x: 490, y: 490, width: 20, height: 20 });

      // Add other items to force split
      for (let i = 0; i < 5; i++) {
        qt.insert({ id: i }, { x: i * 10, y: i * 10, width: 5, height: 5 });
      }

      // Query left side of boundary
      const leftResults = qt.query({ x: 0, y: 0, width: 495, height: 1000 });
      expect(leftResults).toContain(boundaryItem);

      // Query right side of boundary
      const rightResults = qt.query({ x: 505, y: 0, width: 495, height: 1000 });
      expect(rightResults).toContain(boundaryItem);
    });

    it('handles zero-sized (point) objects and out-of-bounds objects gracefully', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 500, height: 500 });

      const pointItem = { id: 100 };
      const outOfBoundsItem = { id: 200 };

      qt.insert(pointItem, { x: 100, y: 100, width: 0, height: 0 });
      qt.insert(outOfBoundsItem, { x: -50, y: -50, width: 20, height: 20 });

      const pointQuery = qt.query({ x: 90, y: 90, width: 20, height: 20 });
      expect(pointQuery).toContain(pointItem);

      const oobQuery = qt.query({ x: -100, y: -100, width: 100, height: 100 });
      expect(oobQuery).toContain(outOfBoundsItem);
    });
  });

  describe.skip('Benchmark test (10_000 objects, 60 queries)', () => {
    it('executes 60 queries on 10,000 objects efficiently', () => {
      const qt = new Quadtree<TestItem>({ x: 0, y: 0, width: 10000, height: 10000 }, 16, 8);
      const items: TestItem[] = [];
      const random = mulberry32(12345);

      for (let i = 0; i < 10_000; i++) {
        const item = { id: i };
        items.push(item);
        qt.insert(item, createRandomRect(random, 0, 0, 9900, 9900));
      }

      const start = performance.now();
      for (let q = 0; q < 60; q++) {
        qt.query({ x: 1000, y: 1000, width: 1000, height: 1000 });
      }
      const duration = performance.now() - start;

      // Ensure queries run under reasonable time threshold
      expect(duration).toBeLessThan(1000);
    });
  });
});

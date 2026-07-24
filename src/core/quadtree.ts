export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

export function intersects(a: Rect, b: Rect): boolean {
  return rectsOverlap(a, b);
}

export interface QuadtreeConfig {
  maxObjects?: number;
  maxLevels?: number;
}

export class Quadtree<T> {
  private bounds: Rect;
  private maxObjects: number;
  private maxLevels: number;
  private level: number;
  private objects: T[] = [];
  private nodes: Quadtree<T>[] = [];
  private boundsMap: Map<T, Rect>;
  private dirtySet: Set<T> = new Set<T>();
  private outOfBoundsObjects: Set<T> = new Set<T>();
  private queryStampMap = new WeakMap<object, number>();
  private currentQueryStamp = 0;
  private _rebuildCount = 0;

  constructor(
    bounds: Rect,
    config?: QuadtreeConfig | number,
    maxLevels?: number,
    level = 0,
    boundsMap?: Map<T, Rect>
  ) {
    this.bounds = bounds;
    if (typeof config === 'number') {
      this.maxObjects = config;
      this.maxLevels = maxLevels ?? 4;
    } else {
      this.maxObjects = config?.maxObjects ?? 10;
      this.maxLevels = config?.maxLevels ?? 4;
    }
    this.level = level;
    this.boundsMap = boundsMap ?? new Map();
  }

  public get size(): number {
    return this.boundsMap.size;
  }

  public get rebuildCount(): number {
    return this._rebuildCount;
  }

  public clear(): void {
    this.objects = [];
    for (const node of this.nodes) {
      node.clear();
    }
    this.nodes = [];
    if (this.level === 0) {
      this.boundsMap.clear();
      this.dirtySet.clear();
      this.outOfBoundsObjects.clear();
    }
  }

  private split(): void {
    const nextLevel = this.level + 1;
    const subWidth = this.bounds.width / 2;
    const subHeight = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;

    const config: QuadtreeConfig = {
      maxObjects: this.maxObjects,
      maxLevels: this.maxLevels,
    };

    // Top-Right (0)
    this.nodes[0] = new Quadtree<T>(
      { x: x + subWidth, y, width: subWidth, height: subHeight },
      config,
      this.maxLevels,
      nextLevel,
      this.boundsMap
    );
    // Top-Left (1)
    this.nodes[1] = new Quadtree<T>(
      { x, y, width: subWidth, height: subHeight },
      config,
      this.maxLevels,
      nextLevel,
      this.boundsMap
    );
    // Bottom-Left (2)
    this.nodes[2] = new Quadtree<T>(
      { x, y: y + subHeight, width: subWidth, height: subHeight },
      config,
      this.maxLevels,
      nextLevel,
      this.boundsMap
    );
    // Bottom-Right (3)
    this.nodes[3] = new Quadtree<T>(
      { x: x + subWidth, y: y + subHeight, width: subWidth, height: subHeight },
      config,
      this.maxLevels,
      nextLevel,
      this.boundsMap
    );
  }

  private getIndices(itemBounds: Rect): number[] {
    const indices: number[] = [];
    if (this.nodes.length === 0) return indices;

    for (let i = 0; i < 4; i++) {
      if (rectsOverlap(itemBounds, this.nodes[i].bounds)) {
        indices.push(i);
      }
    }
    return indices;
  }

  private getItemBounds(item: T, boundsParam?: Rect | ((item: T) => Rect)): Rect {
    if (boundsParam) {
      if (typeof boundsParam === 'function') {
        return boundsParam(item);
      }
      return boundsParam;
    }
    if (this.boundsMap.has(item)) {
      return this.boundsMap.get(item)!;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      if (typeof obj.getRect === 'function') {
        return (obj.getRect as () => Rect)();
      }
      if (obj.rect && typeof (obj.rect as Rect).x === 'number') {
        return obj.rect as Rect;
      }
      if (typeof obj.x === 'number' && typeof obj.width === 'number') {
        return obj as unknown as Rect;
      }
    }
    return item as unknown as Rect;
  }

  public insert(item: T, boundsParam?: Rect | ((item: T) => Rect)): void {
    const itemBounds = this.getItemBounds(item, boundsParam);
    this.boundsMap.set(item, itemBounds);

    if (this.level === 0 && !rectsOverlap(this.bounds, itemBounds)) {
      this.outOfBoundsObjects.add(item);
      return;
    }

    if (this.nodes.length > 0) {
      const indices = this.getIndices(itemBounds);
      for (const index of indices) {
        this.nodes[index].insert(item, itemBounds);
      }
      return;
    }

    this.objects.push(item);

    if (this.objects.length > this.maxObjects && this.level < this.maxLevels) {
      if (this.nodes.length === 0) {
        this.split();
      }

      const oldObjects = this.objects;
      this.objects = [];

      for (const obj of oldObjects) {
        const b = this.getItemBounds(obj);
        const indices = this.getIndices(b);
        if (indices.length > 0) {
          for (const index of indices) {
            this.nodes[index].insert(obj, b);
          }
        } else {
          this.objects.push(obj);
        }
      }
    }
  }

  public remove(item: T, boundsParam?: Rect | ((item: T) => Rect), preserveDirty = false): boolean {
    const itemBounds = this.getItemBounds(item, boundsParam);

    if (this.level === 0 && this.outOfBoundsObjects.has(item)) {
      this.outOfBoundsObjects.delete(item);
      this.boundsMap.delete(item);
      if (!preserveDirty) {
        this.dirtySet.delete(item);
      }
      return true;
    }

    if (!rectsOverlap(this.bounds, itemBounds)) {
      return false;
    }

    let removed = false;
    const index = this.objects.indexOf(item);
    if (index !== -1) {
      this.objects.splice(index, 1);
      removed = true;
    }

    if (this.nodes.length > 0) {
      const indices = this.getIndices(itemBounds);
      for (const i of indices) {
        if (this.nodes[i].remove(item, itemBounds, preserveDirty)) {
          removed = true;
        }
      }
    }

    if (removed && this.level === 0) {
      this.boundsMap.delete(item);
      if (!preserveDirty) {
        this.dirtySet.delete(item);
      }
    }
    return removed;
  }

  public update(item: T, boundsParam?: Rect | ((item: T) => Rect)): void {
    const itemBounds = this.getItemBounds(item, boundsParam);
    this.boundsMap.set(item, itemBounds);

    // Pointwise update without full rebuild, preserving dirtySet entry
    this.remove(item, itemBounds, true);
    this.insert(item, itemBounds);
    this.dirtySet.add(item);

    // Trigger full rebuild ONLY if UNIQUE dirty items exceed 30% of total
    if (this.dirtySet.size > 0 && this.dirtySet.size > this.boundsMap.size * 0.3) {
      this._rebuildCount++;
      const allEntries = Array.from(this.boundsMap.entries());
      this.clear();
      for (const [entryItem, entryBounds] of allEntries) {
        this.insert(entryItem, entryBounds);
      }
    }
  }

  public query(
    queryBounds: Rect,
    getBounds?: (item: T) => Rect,
    outResult?: T[]
  ): T[] {
    const result = outResult ?? [];
    if (outResult) {
      outResult.length = 0;
    }

    const stamp = ++this.currentQueryStamp;

    // Out-of-bounds objects are ALWAYS included ("out of index = visible" safe fallback)
    if (this.level === 0 && this.outOfBoundsObjects.size > 0) {
      for (const item of this.outOfBoundsObjects) {
        this._markStampAndPush(item, stamp, result);
      }
    }

    if (!rectsOverlap(this.bounds, queryBounds)) {
      return result;
    }

    this._queryInternal(queryBounds, getBounds, result, stamp);
    return result;
  }

  private _markStampAndPush(obj: T, stamp: number, result: T[]): void {
    if (obj && typeof obj === 'object') {
      const targetObj = obj as unknown as { _queryStamp?: number };
      if (Object.isExtensible(targetObj)) {
        if (targetObj._queryStamp === stamp) return;
        targetObj._queryStamp = stamp;
      } else {
        if (this.queryStampMap.get(targetObj) === stamp) return;
        this.queryStampMap.set(targetObj, stamp);
      }
    }
    result.push(obj);
  }

  private _queryInternal(
    queryBounds: Rect,
    getBounds: ((item: T) => Rect) | undefined,
    result: T[],
    stamp: number
  ): void {
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      const b = this.getItemBounds(obj, getBounds);
      if (rectsOverlap(queryBounds, b)) {
        this._markStampAndPush(obj, stamp, result);
      }
    }

    if (this.nodes.length > 0) {
      for (let i = 0; i < 4; i++) {
        const node = this.nodes[i];
        if (rectsOverlap(node.bounds, queryBounds)) {
          node._queryInternal(queryBounds, getBounds, result, stamp);
        }
      }
    }
  }
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function intersects(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function contains(parent: Rect, child: Rect): boolean {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}

export interface QuadtreeEntry<T> {
  item: T;
  rect: Rect;
  node: QuadtreeNode<T> | null;
  dirty: boolean;
}

export class QuadtreeNode<T> {
  public bounds: Rect;
  public depth: number;
  public maxObjects: number;
  public maxDepth: number;
  public objects: Array<QuadtreeEntry<T>> = [];
  public nodes: [QuadtreeNode<T>, QuadtreeNode<T>, QuadtreeNode<T>, QuadtreeNode<T>] | null = null;

  constructor(bounds: Rect, depth: number, maxObjects: number, maxDepth: number) {
    this.bounds = bounds;
    this.depth = depth;
    this.maxObjects = maxObjects;
    this.maxDepth = maxDepth;
  }

  public split(): void {
    if (this.nodes !== null) return;

    const subWidth = this.bounds.width / 2;
    const subHeight = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;
    const nextDepth = this.depth + 1;

    this.nodes = [
      // Top-Left (0)
      new QuadtreeNode<T>({ x, y, width: subWidth, height: subHeight }, nextDepth, this.maxObjects, this.maxDepth),
      // Top-Right (1)
      new QuadtreeNode<T>({ x: x + subWidth, y, width: subWidth, height: subHeight }, nextDepth, this.maxObjects, this.maxDepth),
      // Bottom-Left (2)
      new QuadtreeNode<T>({ x, y: y + subHeight, width: subWidth, height: subHeight }, nextDepth, this.maxObjects, this.maxDepth),
      // Bottom-Right (3)
      new QuadtreeNode<T>({ x: x + subWidth, y: y + subHeight, width: subWidth, height: subHeight }, nextDepth, this.maxObjects, this.maxDepth),
    ];

    const currentObjects = this.objects;
    this.objects = [];

    for (let i = 0; i < currentObjects.length; i++) {
      const entry = currentObjects[i];
      this.insertEntry(entry);
    }
  }

  public getSubNodeIndex(rect: Rect): number {
    if (this.nodes === null) return -1;

    for (let i = 0; i < 4; i++) {
      if (contains(this.nodes[i].bounds, rect)) {
        return i;
      }
    }
    return -1;
  }

  public insertEntry(entry: QuadtreeEntry<T>): void {
    if (this.nodes !== null) {
      const index = this.getSubNodeIndex(entry.rect);
      if (index !== -1) {
        this.nodes[index].insertEntry(entry);
        return;
      }
    }

    this.objects.push(entry);
    entry.node = this;

    if (
      this.nodes === null &&
      this.objects.length > this.maxObjects &&
      this.depth < this.maxDepth
    ) {
      this.split();
    }
  }
}

export class Quadtree<T = unknown> {
  public bounds: Rect;
  public maxObjects: number;
  public maxDepth: number;

  private root: QuadtreeNode<T>;
  private itemMap: Map<T, QuadtreeEntry<T>> = new Map();
  private dirtyCount = 0;

  constructor(bounds: Rect, maxObjects = 8, maxDepth = 8) {
    this.bounds = bounds;
    this.maxObjects = maxObjects;
    this.maxDepth = maxDepth;
    this.root = new QuadtreeNode<T>(bounds, 0, maxObjects, maxDepth);
  }

  public get size(): number {
    return this.itemMap.size;
  }

  public insert(item: T, rect: Rect): void {
    if (this.itemMap.has(item)) {
      this.remove(item);
    }

    const entry: QuadtreeEntry<T> = {
      item,
      rect: { ...rect },
      node: null,
      dirty: false,
    };

    this.itemMap.set(item, entry);
    this.root.insertEntry(entry);
  }

  public remove(item: T): boolean {
    const entry = this.itemMap.get(item);
    if (!entry) return false;

    if (entry.dirty) {
      this.dirtyCount--;
    }

    if (entry.node) {
      const idx = entry.node.objects.indexOf(entry);
      if (idx !== -1) {
        entry.node.objects.splice(idx, 1);
      }
      entry.node = null;
    }

    this.itemMap.delete(item);
    return true;
  }

  public update(item: T, rect: Rect): void {
    const entry = this.itemMap.get(item);
    if (!entry) {
      this.insert(item, rect);
      return;
    }

    entry.rect = { ...rect };
    if (!entry.dirty) {
      entry.dirty = true;
      this.dirtyCount++;
    }
  }

  private processLazyUpdates(): void {
    if (this.dirtyCount === 0) return;

    const total = this.itemMap.size;
    if (total > 0 && this.dirtyCount / total > 0.3) {
      // Full rebuild
      this.root = new QuadtreeNode<T>(this.bounds, 0, this.maxObjects, this.maxDepth);
      for (const entry of this.itemMap.values()) {
        entry.dirty = false;
        entry.node = null;
        this.root.insertEntry(entry);
      }
    } else {
      // Partial updates
      for (const entry of this.itemMap.values()) {
        if (entry.dirty) {
          if (entry.node) {
            const idx = entry.node.objects.indexOf(entry);
            if (idx !== -1) {
              entry.node.objects.splice(idx, 1);
            }
            entry.node = null;
          }
          entry.dirty = false;
          this.root.insertEntry(entry);
        }
      }
    }

    this.dirtyCount = 0;
  }

  public query(rect: Rect): T[] {
    this.processLazyUpdates();

    const results: T[] = [];
    this.queryNode(this.root, rect, results);
    return results;
  }

  private queryNode(node: QuadtreeNode<T>, searchRect: Rect, results: T[]): void {
    if (!intersects(node.bounds, searchRect)) {
      return;
    }

    for (let i = 0; i < node.objects.length; i++) {
      const entry = node.objects[i];
      if (intersects(entry.rect, searchRect)) {
        results.push(entry.item);
      }
    }

    if (node.nodes !== null) {
      for (let i = 0; i < 4; i++) {
        this.queryNode(node.nodes[i], searchRect, results);
      }
    }
  }

  public clear(): void {
    this.itemMap.clear();
    this.dirtyCount = 0;
    this.root = new QuadtreeNode<T>(this.bounds, 0, this.maxObjects, this.maxDepth);
  }
}

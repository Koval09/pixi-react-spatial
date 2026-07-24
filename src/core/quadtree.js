export function rectsOverlap(a, b) {
    return (a.x <= b.x + b.width &&
        a.x + a.width >= b.x &&
        a.y <= b.y + b.height &&
        a.y + a.height >= b.y);
}
export function intersects(a, b) {
    return rectsOverlap(a, b);
}
export class Quadtree {
    bounds;
    maxObjects;
    maxLevels;
    level;
    objects = [];
    nodes = [];
    boundsMap;
    dirtySet = new Set();
    currentQueryStamp = 0;
    _rebuildCount = 0;
    constructor(bounds, config, maxLevels, level = 0, boundsMap) {
        this.bounds = bounds;
        if (typeof config === 'number') {
            this.maxObjects = config;
            this.maxLevels = maxLevels ?? 4;
        }
        else {
            this.maxObjects = config?.maxObjects ?? 10;
            this.maxLevels = config?.maxLevels ?? 4;
        }
        this.level = level;
        this.boundsMap = boundsMap ?? new Map();
    }
    get size() {
        return this.boundsMap.size;
    }
    get rebuildCount() {
        return this._rebuildCount;
    }
    clear() {
        this.objects = [];
        for (const node of this.nodes) {
            node.clear();
        }
        this.nodes = [];
        if (this.level === 0) {
            this.boundsMap.clear();
            this.dirtySet.clear();
        }
    }
    split() {
        const nextLevel = this.level + 1;
        const subWidth = this.bounds.width / 2;
        const subHeight = this.bounds.height / 2;
        const x = this.bounds.x;
        const y = this.bounds.y;
        const config = {
            maxObjects: this.maxObjects,
            maxLevels: this.maxLevels,
        };
        // Top-Right (0)
        this.nodes[0] = new Quadtree({ x: x + subWidth, y, width: subWidth, height: subHeight }, config, this.maxLevels, nextLevel, this.boundsMap);
        // Top-Left (1)
        this.nodes[1] = new Quadtree({ x, y, width: subWidth, height: subHeight }, config, this.maxLevels, nextLevel, this.boundsMap);
        // Bottom-Left (2)
        this.nodes[2] = new Quadtree({ x, y: y + subHeight, width: subWidth, height: subHeight }, config, this.maxLevels, nextLevel, this.boundsMap);
        // Bottom-Right (3)
        this.nodes[3] = new Quadtree({ x: x + subWidth, y: y + subHeight, width: subWidth, height: subHeight }, config, this.maxLevels, nextLevel, this.boundsMap);
    }
    getIndices(itemBounds) {
        const indices = [];
        if (this.nodes.length === 0)
            return indices;
        for (let i = 0; i < 4; i++) {
            if (rectsOverlap(itemBounds, this.nodes[i].bounds)) {
                indices.push(i);
            }
        }
        return indices;
    }
    getItemBounds(item, boundsParam) {
        if (boundsParam) {
            if (typeof boundsParam === 'function') {
                return boundsParam(item);
            }
            return boundsParam;
        }
        if (this.boundsMap.has(item)) {
            return this.boundsMap.get(item);
        }
        if (item && typeof item === 'object') {
            const obj = item;
            if (typeof obj.getRect === 'function') {
                return obj.getRect();
            }
            if (obj.rect && typeof obj.rect.x === 'number') {
                return obj.rect;
            }
            if (typeof obj.x === 'number' && typeof obj.width === 'number') {
                return obj;
            }
        }
        return item;
    }
    insert(item, boundsParam) {
        const itemBounds = this.getItemBounds(item, boundsParam);
        this.boundsMap.set(item, itemBounds);
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
                }
                else {
                    this.objects.push(obj);
                }
            }
        }
    }
    remove(item, boundsParam) {
        const itemBounds = this.getItemBounds(item, boundsParam);
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
                if (this.nodes[i].remove(item, itemBounds)) {
                    removed = true;
                }
            }
        }
        if (removed && this.level === 0) {
            this.boundsMap.delete(item);
            this.dirtySet.delete(item);
        }
        return removed;
    }
    update(item, boundsParam) {
        const itemBounds = this.getItemBounds(item, boundsParam);
        this.boundsMap.set(item, itemBounds);
        this.dirtySet.add(item);
        // Pointwise update without full rebuild
        this.remove(item, itemBounds);
        this.insert(item, itemBounds);
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
    query(queryBounds, getBounds, outResult) {
        const result = outResult ?? [];
        if (outResult) {
            outResult.length = 0;
        }
        if (!rectsOverlap(this.bounds, queryBounds)) {
            return result;
        }
        const stamp = ++this.currentQueryStamp;
        this._queryInternal(queryBounds, getBounds, result, stamp);
        return result;
    }
    _queryInternal(queryBounds, getBounds, result, stamp) {
        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            const targetObj = obj;
            if (targetObj && typeof targetObj === 'object') {
                if (targetObj._queryStamp === stamp) {
                    continue;
                }
                const b = this.getItemBounds(obj, getBounds);
                if (rectsOverlap(queryBounds, b)) {
                    targetObj._queryStamp = stamp;
                    result.push(obj);
                }
            }
            else {
                const b = this.getItemBounds(obj, getBounds);
                if (rectsOverlap(queryBounds, b)) {
                    result.push(obj);
                }
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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Quadtree {
  constructor(public bounds: Rect, public maxObjects = 10, public maxDepth = 4) {}
}

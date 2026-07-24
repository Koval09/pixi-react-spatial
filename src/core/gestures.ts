export interface PointerEventPayload {
  x: number;
  y: number;
  pointerId: number;
  deltaY?: number;
}

export function handleGesture(payload: PointerEventPayload): PointerEventPayload {
  return payload;
}

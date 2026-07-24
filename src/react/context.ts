import { createContext, useContext } from 'react';
import type { CameraState } from '../core/camera';

export interface ViewportContextValue {
  camera: CameraState;
}

export const ViewportContext = createContext<ViewportContextValue | null>(null);

export function useViewportContext(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (!ctx) {
    throw new Error('useViewportContext must be used within a SpatialViewport');
  }
  return ctx;
}

import { createContext, useContext } from 'react';
import type { CameraState, Size } from '../core/camera';

export type CameraListener = (camera: CameraState) => void;

export interface ViewportContextValue {
  getCamera: () => CameraState;
  getViewport: () => Size;
  subscribe: (listener: CameraListener) => () => void;
  getOverlayElement: () => HTMLElement | null;
}

export type ViewportHandle = ViewportContextValue;

export const ViewportContext = createContext<ViewportContextValue | null>(null);

export function useOptionalViewportContext(): ViewportContextValue | null {
  return useContext(ViewportContext);
}

export function useViewportContext(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (!ctx) {
    throw new Error('useViewportContext must be used within a SpatialViewport');
  }
  return ctx;
}

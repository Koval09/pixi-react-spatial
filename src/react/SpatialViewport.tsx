import React, { type ReactNode } from 'react';
import { ViewportContext } from './context';

export interface SpatialViewportProps {
  children?: ReactNode;
  worldWidth?: number;
  worldHeight?: number;
  minZoom?: number;
  maxZoom?: number;
}

export function SpatialViewport({ children }: SpatialViewportProps): React.JSX.Element {
  return (
    <ViewportContext.Provider value={{ camera: { x: 0, y: 0, zoom: 1 } }}>
      {children}
    </ViewportContext.Provider>
  );
}

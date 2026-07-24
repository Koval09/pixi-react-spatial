import React, { type ReactNode } from 'react';
import type { Rect } from '../core/quadtree';

export interface CullGroupProps {
  children?: ReactNode;
  bounds?: Rect;
  overscan?: number;
  enabled?: boolean;
}

export function CullGroup({ children }: CullGroupProps): React.JSX.Element {
  return <>{children}</>;
}

export function useCullable(): { update: () => void } {
  return { update: () => {} };
}

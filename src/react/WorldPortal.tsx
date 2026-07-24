import React, { type ReactNode } from 'react';

export interface WorldPortalProps {
  children?: ReactNode;
  at?: { x: number; y: number };
}

export function WorldPortal({ children }: WorldPortalProps): React.JSX.Element {
  return <div style={{ position: 'absolute' }}>{children}</div>;
}

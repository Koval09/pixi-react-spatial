import { createContext, useContext } from 'react';
export const ViewportContext = createContext(null);
export function useOptionalViewportContext() {
    return useContext(ViewportContext);
}
export function useViewportContext() {
    const ctx = useContext(ViewportContext);
    if (!ctx) {
        throw new Error('useViewportContext must be used within a SpatialViewport');
    }
    return ctx;
}

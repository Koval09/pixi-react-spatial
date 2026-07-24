export function createCameraState(x = 0, y = 0, zoom = 1) {
    return { x, y, zoom };
}
export function worldToScreen(worldPoint, camera, viewport) {
    return {
        x: (worldPoint.x - camera.x) * camera.zoom + viewport.width / 2,
        y: (worldPoint.y - camera.y) * camera.zoom + viewport.height / 2,
    };
}
export function screenToWorld(screenPoint, camera, viewport) {
    return {
        x: (screenPoint.x - viewport.width / 2) / camera.zoom + camera.x,
        y: (screenPoint.y - viewport.height / 2) / camera.zoom + camera.y,
    };
}
export function zoomAtPoint(camera, screenPoint, nextZoom, viewport, minZoom, maxZoom) {
    const targetZoom = Math.max(minZoom ?? 0.0001, Math.min(maxZoom ?? Infinity, nextZoom));
    if (targetZoom === camera.zoom) {
        return camera;
    }
    const worldBefore = screenToWorld(screenPoint, camera, viewport);
    const newCamera = { ...camera, zoom: targetZoom };
    const worldAfter = screenToWorld(screenPoint, newCamera, viewport);
    return {
        ...newCamera,
        x: camera.x + (worldBefore.x - worldAfter.x),
        y: camera.y + (worldBefore.y - worldAfter.y),
    };
}
export function clampCamera(camera, worldBounds, viewport) {
    const visibleWidth = viewport.width / camera.zoom;
    const visibleHeight = viewport.height / camera.zoom;
    let newX = camera.x;
    let newY = camera.y;
    if (visibleWidth >= worldBounds.width) {
        newX = worldBounds.x + worldBounds.width / 2;
    }
    else {
        const minX = worldBounds.x + visibleWidth / 2;
        const maxX = worldBounds.x + worldBounds.width - visibleWidth / 2;
        newX = Math.max(minX, Math.min(maxX, camera.x));
    }
    if (visibleHeight >= worldBounds.height) {
        newY = worldBounds.y + worldBounds.height / 2;
    }
    else {
        const minY = worldBounds.y + visibleHeight / 2;
        const maxY = worldBounds.y + worldBounds.height - visibleHeight / 2;
        newY = Math.max(minY, Math.min(maxY, camera.y));
    }
    return {
        ...camera,
        x: newX,
        y: newY,
    };
}
export function followTarget(camera, target, lerpFactor, deadzone) {
    let targetX = target.x;
    let targetY = target.y;
    if (deadzone !== undefined) {
        const dzX = typeof deadzone === 'number' ? deadzone : deadzone.width / 2;
        const dzY = typeof deadzone === 'number' ? deadzone : deadzone.height / 2;
        const dx = target.x - camera.x;
        const dy = target.y - camera.y;
        if (Math.abs(dx) <= dzX) {
            targetX = camera.x;
        }
        else {
            targetX = target.x - Math.sign(dx) * dzX;
        }
        if (Math.abs(dy) <= dzY) {
            targetY = camera.y;
        }
        else {
            targetY = target.y - Math.sign(dy) * dzY;
        }
    }
    const factor = Math.max(0, Math.min(1, lerpFactor));
    const newX = camera.x + (targetX - camera.x) * factor;
    const newY = camera.y + (targetY - camera.y) * factor;
    return {
        ...camera,
        x: newX,
        y: newY,
    };
}

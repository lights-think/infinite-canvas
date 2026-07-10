const TOOLBAR_VIEWPORT_MARGIN = 12;

export function canvasHoverToolbarMaxWidth(viewportWidth: number) {
    return Math.max(0, viewportWidth - TOOLBAR_VIEWPORT_MARGIN * 2);
}

export function clampCanvasHoverToolbarCenter(preferredCenter: number, toolbarWidth: number, viewportWidth: number) {
    const halfWidth = Math.min(toolbarWidth, canvasHoverToolbarMaxWidth(viewportWidth)) / 2;
    const minimum = TOOLBAR_VIEWPORT_MARGIN + halfWidth;
    const maximum = viewportWidth - TOOLBAR_VIEWPORT_MARGIN - halfWidth;
    if (maximum < minimum) return viewportWidth / 2;
    return Math.min(maximum, Math.max(minimum, preferredCenter));
}

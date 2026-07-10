import type { CSSProperties } from "react";

export function buildMentionLayerStyles(style: CSSProperties | undefined, textColor: string, showOverlay: boolean) {
    return {
        textareaStyle: {
            ...(style || {}),
            position: "relative",
            zIndex: 1,
            color: showOverlay ? "transparent" : style?.color,
            caretColor: style?.color || textColor,
            ...(showOverlay ? { background: "transparent", backgroundColor: "transparent" } : {}),
        } satisfies CSSProperties,
        overlayStyle: { ...(style || {}), zIndex: 0, color: textColor } satisfies CSSProperties,
    };
}

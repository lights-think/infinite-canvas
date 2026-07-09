import type { CSSProperties } from "react";
import { ArrowLeft, BookOpen, Keyboard, Settings2 } from "lucide-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL } from "@/constant/env";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { aicyIconUrl, isAicyCanvasMode, requestAicyReturnToAicy } from "@/services/aicy-integration";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const aicyMode = isAicyCanvasMode();
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const gitHubClassName = "size-7 text-base";
    const gitHubStyle = iconStyle;

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {!aicyMode ? (
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label="文档" title="文档">
                    <BookOpen className="size-4" />
                </a>
            ) : null}
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            <VersionReleaseModal style={versionStyle} />
            {aicyMode ? <AicyReturnAction variant={variant} style={gitHubStyle} /> : <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />}
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}

function AicyReturnAction({ variant, style }: { variant: "default" | "canvas"; style?: CSSProperties }) {
    const theme = useThemeStore((state) => state.theme);
    const canvasTheme = canvasThemes[theme];
    const iconUrl = aicyIconUrl();
    const buttonStyle: CSSProperties | undefined =
        variant === "canvas"
            ? {
                  background: canvasTheme.toolbar.panel,
                  borderColor: canvasTheme.toolbar.border,
                  color: canvasTheme.node.text,
                  boxShadow: "0 10px 30px rgba(28,25,23,.10)",
              }
            : style;
    return (
        <button
            type="button"
            className={cn(
                "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm font-medium tracking-normal transition hover:bg-stone-100 dark:hover:bg-white/10",
                variant === "canvas" && "h-10 rounded-xl border px-3",
            )}
            style={buttonStyle}
            onClick={requestAicyReturnToAicy}
            aria-label="回到Aicy"
            title="回到Aicy"
        >
            {iconUrl ? <img src={iconUrl} alt="" className="size-4 shrink-0 rounded-sm" /> : <ArrowLeft className="size-4 shrink-0" />}
            <span>回到Aicy</span>
        </button>
    );
}

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createManagedAicyConfig, createModelChannel, useConfigStore } from "@/stores/use-config-store";
import { isAicyCanvasMode, requestAicyCanvasSession } from "@/services/aicy-integration";
import { fetchChatgpt2apiModels } from "@/services/chatgpt2api-config";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const aicyModeHint = window.location.search.includes("aicy=1");
        if (aicyModeHint || isAicyCanvasMode()) {
            handledConfigParams.current = true;
            void requestAicyCanvasSession().then(async () => {
                useConfigStore.setState((state) => ({ config: createManagedAicyConfig(state.config), isConfigOpen: false }));
                try {
                    const models = await fetchChatgpt2apiModels();
                    useConfigStore.setState((state) => ({ config: createManagedAicyConfig(state.config, models), isConfigOpen: false }));
                } catch (error) {
                    console.warn(error);
                }
            });
            return;
        }
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}

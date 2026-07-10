import type { PersistStorage, StorageValue } from "zustand/middleware";

import { aicyFetch, isAicyCanvasMode, requestAicyCanvasSession } from "@/services/aicy-integration";
import { createAicyRemoteStateCoordinator, createAicyRemoteStateHttpTransport, normalizeAicyRemoteState, resolveAicyRemoteStatePath, type AicyRemoteSaveOptions, type AicyStateSlice } from "@/services/aicy-remote-state-core";

export { AicyRemoteStateConflictError, returnToAicyAfterFlush } from "@/services/aicy-remote-state-core";

let lifecycleHandlersStarted = false;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const remoteStateTransport = createAicyRemoteStateHttpTransport(async (init) => {
    const activeSession = await requestAicyCanvasSession();
    if (!activeSession) throw new Error("Aicy canvas session is unavailable.");
    const path = resolveAicyRemoteStatePath(activeSession.statePath, activeSession.stateWritePath, init.method);
    return aicyFetch(path, init);
});

const remoteStateCoordinator = createAicyRemoteStateCoordinator({
    async load() {
        if (!isAicyCanvasMode()) return normalizeAicyRemoteState(null);
        return remoteStateTransport.load();
    },
    save: remoteStateTransport.save,
    onBackgroundError(error) {
        console.error("[Aicy Canvas] remote state save failed", error);
    },
});

export function flushAicyRemoteState(options: AicyRemoteSaveOptions = {}) {
    return remoteStateCoordinator.flush(options);
}

function startLifecycleSaveHandlers() {
    if (lifecycleHandlersStarted || typeof window === "undefined") return;
    lifecycleHandlersStarted = true;
    const flushBestEffort = () => {
        // 页面卸载不能可靠等待异步完成；keepalive 只作为最后一次尽力提交。
        void flushAicyRemoteState({ keepalive: true }).catch((error) => {
            console.error("[Aicy Canvas] lifecycle state flush failed", error);
        });
    };
    window.addEventListener("pagehide", flushBestEffort);
    window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushBestEffort();
    });
}

function incomingState(value: StorageValue<unknown>) {
    return isRecord(value.state) ? value.state : {};
}

function storedValueForSlice(slice: AicyStateSlice, value: unknown[] | Record<string, unknown>) {
    if (slice === "canvas") return { projects: value };
    if (slice === "assets") return { assets: value };
    return { config: value };
}

function nextSliceValue(slice: AicyStateSlice, value: StorageValue<unknown>) {
    const incoming = incomingState(value);
    if (slice === "canvas") return Array.isArray(incoming.projects) ? incoming.projects : [];
    if (slice === "assets") return Array.isArray(incoming.assets) ? incoming.assets : [];
    return isRecord(incoming.config) ? incoming.config : {};
}

export function createAicyPersistStorage<T>(slice: AicyStateSlice): PersistStorage<T> {
    startLifecycleSaveHandlers();
    return {
        getItem: async () => {
            const value = await remoteStateCoordinator.readSlice(slice);
            return { state: storedValueForSlice(slice, value) as T, version: 0 };
        },
        setItem: async (_name, value) => {
            await remoteStateCoordinator.writeSlice(slice, nextSliceValue(slice, value as StorageValue<unknown>));
        },
        removeItem: async () => {
            await remoteStateCoordinator.writeSlice(slice, slice === "preferences" ? {} : []);
        },
    };
}

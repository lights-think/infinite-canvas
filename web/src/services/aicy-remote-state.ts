import type { PersistStorage, StorageValue } from "zustand/middleware";

import { aicyFetch, isAicyCanvasMode, requestAicyCanvasSession } from "@/services/aicy-integration";

type AicyStateSlice = "canvas" | "assets" | "preferences";
type AicyRemoteState = {
    version: 1;
    projects: unknown[];
    assets: unknown[];
    preferences: Record<string, unknown>;
    updatedAt?: number | null;
};

const defaultRemoteState: AicyRemoteState = {
    version: 1,
    projects: [],
    assets: [],
    preferences: {},
    updatedAt: null,
};

let cachedState: AicyRemoteState | null = null;
let loadPromise: Promise<AicyRemoteState> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeRemoteState(value: unknown): AicyRemoteState {
    const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AicyRemoteState>) : {};
    return {
        version: 1,
        projects: Array.isArray(source.projects) ? source.projects : [],
        assets: Array.isArray(source.assets) ? source.assets : [],
        preferences: source.preferences && typeof source.preferences === "object" && !Array.isArray(source.preferences) ? source.preferences : {},
        updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : null,
    };
}

async function loadAicyRemoteState() {
    if (!isAicyCanvasMode()) return defaultRemoteState;
    if (cachedState) return cachedState;
    if (!loadPromise) {
        loadPromise = (async () => {
            const activeSession = await requestAicyCanvasSession();
            if (!activeSession) return defaultRemoteState;
            const response = await aicyFetch(activeSession.statePath, { method: "GET" });
            if (!response.ok) throw new Error(await response.text());
            cachedState = normalizeRemoteState(await response.json());
            return cachedState;
        })().finally(() => {
            loadPromise = null;
        });
    }
    return loadPromise;
}

function scheduleSave(nextState: AicyRemoteState) {
    cachedState = nextState;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        const activeSession = await requestAicyCanvasSession();
        if (!activeSession || !cachedState) return;
        const response = await aicyFetch(activeSession.statePath, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cachedState),
        });
        if (!response.ok) throw new Error(await response.text());
        cachedState = normalizeRemoteState(await response.json());
    }, 400);
}

function valueForSlice(slice: AicyStateSlice, state: AicyRemoteState) {
    if (slice === "canvas") return { projects: state.projects };
    if (slice === "assets") return { assets: state.assets };
    return { config: state.preferences };
}

function updateSlice(slice: AicyStateSlice, state: AicyRemoteState, value: StorageValue<unknown>) {
    const incoming = value.state && typeof value.state === "object" ? (value.state as Record<string, unknown>) : {};
    if (slice === "canvas") {
        return { ...state, projects: Array.isArray(incoming.projects) ? incoming.projects : [] };
    }
    if (slice === "assets") {
        return { ...state, assets: Array.isArray(incoming.assets) ? incoming.assets : [] };
    }
    const config = incoming.config && typeof incoming.config === "object" && !Array.isArray(incoming.config) ? incoming.config : {};
    return { ...state, preferences: config as Record<string, unknown> };
}

export function createAicyPersistStorage<T>(slice: AicyStateSlice): PersistStorage<T> {
    return {
        getItem: async () => {
            const state = await loadAicyRemoteState();
            return { state: valueForSlice(slice, state) as T, version: 0 };
        },
        setItem: async (_name, value) => {
            const state = await loadAicyRemoteState();
            scheduleSave(updateSlice(slice, state, value as StorageValue<unknown>));
        },
        removeItem: async () => {
            const state = await loadAicyRemoteState();
            scheduleSave(updateSlice(slice, state, { state: {}, version: 0 }));
        },
    };
}

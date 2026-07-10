export type AicyCanvasSession = {
    aiBasePath: string;
    expiresAt: number;
    filesPath: string;
    gatewayUrl: string;
    protocolVersion: 2;
    statePath: string;
    stateWritePath: string;
    token: string;
};

type AicyCanvasSessionMessage = Omit<Partial<AicyCanvasSession>, "protocolVersion"> & {
    protocolVersion?: number;
    type?: string;
};

const SESSION_REFRESH_SKEW_MS = 60_000;
const SESSION_WAIT_TIMEOUT_MS = 15_000;
const AICY_CANVAS_AI_BASE_PATH = "/api/infinite-canvas/ai/v1";
const AICY_CANVAS_STATE_WRITE_PATH = "/api/infinite-canvas/state/cas";
const AICY_CANVAS_AI_METHODS = new Map([
    ["/models", "GET"],
    ["/responses", "POST"],
    ["/images/generations", "POST"],
    ["/images/edits", "POST"],
]);
let session: AicyCanvasSession | null = null;
let listenerStarted = false;
let pendingSessionRequest: Promise<AicyCanvasSession> | null = null;
const waiters = new Set<(session: AicyCanvasSession) => void>();

export function isAicyCanvasMode() {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("aicy") !== "1") return false;
    // 托管模式必须由带明确双端 origin 的 Aicy iframe 启动，禁止通配 parent 消息源。
    return Boolean(queryOrigin("aicyParentOrigin") && queryOrigin("aicyGateway"));
}

export function isAicyManagedCanvasMode() {
    return isAicyCanvasMode();
}

function queryOrigin(name: string) {
    if (typeof window === "undefined") return "";
    const value = new URLSearchParams(window.location.search).get(name) || "";
    try {
        return value ? new URL(value).origin : "";
    } catch {
        return "";
    }
}

function parentOrigin() {
    return queryOrigin("aicyParentOrigin");
}

function aicyAppOrigin() {
    return queryOrigin("aicyParentOrigin") || queryOrigin("aicyGateway") || "";
}

function defaultGatewayUrl() {
    return queryOrigin("aicyGateway") || (typeof window !== "undefined" ? window.location.origin : "");
}

export function normalizeAicyCanvasSessionMessage(message: AicyCanvasSessionMessage): AicyCanvasSession | null {
    if (message.type !== "aicy.canvas.session") return null;
    if (!message.token || !message.expiresAt) return null;
    if (message.protocolVersion !== 2) return null;
    if (message.aiBasePath !== AICY_CANVAS_AI_BASE_PATH) return null;
    if (message.stateWritePath !== AICY_CANVAS_STATE_WRITE_PATH) return null;
    const gatewayUrl = message.gatewayUrl || defaultGatewayUrl();
    if (!gatewayUrl) return null;
    return {
        aiBasePath: message.aiBasePath,
        expiresAt: Number(message.expiresAt),
        filesPath: message.filesPath || "/api/infinite-canvas/files",
        gatewayUrl,
        protocolVersion: 2,
        statePath: message.statePath || "/api/infinite-canvas/state",
        stateWritePath: message.stateWritePath,
        token: message.token,
    };
}

function isFreshSession(value: AicyCanvasSession | null) {
    return Boolean(value && value.expiresAt - Date.now() > SESSION_REFRESH_SKEW_MS);
}

function startSessionListener() {
    if (listenerStarted || typeof window === "undefined") return;
    listenerStarted = true;
    window.addEventListener("message", (event: MessageEvent<AicyCanvasSessionMessage>) => {
        if (event.source !== window.parent) return;
        const expectedParentOrigin = parentOrigin();
        if (!expectedParentOrigin || event.origin !== expectedParentOrigin) return;
        const nextSession = normalizeAicyCanvasSessionMessage(event.data || {});
        if (!nextSession) return;
        session = nextSession;
        for (const resolve of waiters) resolve(nextSession);
        waiters.clear();
    });
}

function postAicyCanvasMessage(type: "aicy.canvas.ready" | "aicy.canvas.requestSession") {
    if (typeof window === "undefined" || !window.parent) return;
    window.parent.postMessage({ type }, parentOrigin());
}

export function requestAicyReturnToAicy() {
    if (!isAicyCanvasMode() || typeof window === "undefined") return false;
    if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "aicy.canvas.returnToAicy" }, parentOrigin());
        return true;
    }
    const origin = aicyAppOrigin();
    if (origin) window.location.assign(origin);
    return true;
}

export function aicyIconUrl() {
    const origin = aicyAppOrigin();
    return origin ? `${origin}/aicy.png` : "";
}

export function hasAicyCanvasSession() {
    return isFreshSession(session);
}

export async function requestAicyCanvasSession(forceRefresh = false) {
    if (!isAicyCanvasMode()) return null;
    startSessionListener();
    if (!forceRefresh && isFreshSession(session)) return session;
    if (pendingSessionRequest) return pendingSessionRequest;

    pendingSessionRequest = new Promise<AicyCanvasSession>((resolve, reject) => {
        let timeout: number;
        const resolveSession = (nextSession: AicyCanvasSession) => {
            window.clearTimeout(timeout);
            resolve(nextSession);
        };
        timeout = window.setTimeout(() => {
            waiters.delete(resolveSession);
            reject(new Error("Aicy canvas session timed out."));
        }, SESSION_WAIT_TIMEOUT_MS);
        waiters.add(resolveSession);
        postAicyCanvasMessage(forceRefresh ? "aicy.canvas.requestSession" : "aicy.canvas.ready");
    }).finally(() => {
        pendingSessionRequest = null;
    });
    return pendingSessionRequest;
}

function aicyApiUrl(activeSession: AicyCanvasSession, path: string) {
    return `${activeSession.gatewayUrl.replace(/\/+$/, "")}${path}`;
}

async function aicySessionFetch(pathForSession: (value: AicyCanvasSession) => string, init: RequestInit) {
    const activeSession = await requestAicyCanvasSession();
    if (!activeSession) throw new Error("Aicy canvas mode is not enabled.");
    const requestWithSession = (value: AicyCanvasSession) => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${value.token}`);
        return fetch(aicyApiUrl(value, pathForSession(value)), { ...init, headers });
    };
    const response = await requestWithSession(activeSession);
    if (response.status !== 401) return response;

    const refreshed = await requestAicyCanvasSession(true);
    if (!refreshed) return response;
    return requestWithSession(refreshed);
}

export async function aicyFetch(path: string, init: RequestInit = {}) {
    return aicySessionFetch(() => path, init);
}

export async function aicyAiFetch(path: string, init: RequestInit = {}) {
    const method = (init.method || "GET").toUpperCase();
    if (AICY_CANVAS_AI_METHODS.get(path) !== method) throw new Error("Unsupported Aicy canvas AI route.");
    return aicySessionFetch((activeSession) => `${activeSession.aiBasePath}${path}`, init);
}

export async function readAicyCanvasFile(storageKey: string) {
    const activeSession = await requestAicyCanvasSession();
    if (!activeSession) return null;
    const response = await aicyFetch(`${activeSession.filesPath}/${encodeURIComponent(storageKey)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await response.text());
    return response.blob();
}

export async function saveAicyCanvasFile(storageKey: string, blob: Blob) {
    const activeSession = await requestAicyCanvasSession();
    if (!activeSession) throw new Error("Aicy canvas mode is not enabled.");
    const response = await aicyFetch(`${activeSession.filesPath}/${encodeURIComponent(storageKey)}`, {
        method: "PUT",
        headers: { "x-aicy-mime-type": blob.type || "application/octet-stream" },
        body: blob,
    });
    if (!response.ok) throw new Error(await response.text());
}

export async function deleteAicyCanvasFile(storageKey: string) {
    const activeSession = await requestAicyCanvasSession();
    if (!activeSession) return;
    const response = await aicyFetch(`${activeSession.filesPath}/${encodeURIComponent(storageKey)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) throw new Error(await response.text());
}

export async function listAicyCanvasFiles() {
    const activeSession = await requestAicyCanvasSession();
    if (!activeSession) return [];
    const response = await aicyFetch(activeSession.filesPath);
    if (!response.ok) throw new Error(await response.text());
    const payload = (await response.json()) as { files?: Array<{ storageKey?: string }> };
    return (payload.files || []).map((file) => file.storageKey).filter((value): value is string => Boolean(value));
}

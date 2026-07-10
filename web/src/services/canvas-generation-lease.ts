type LeaseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type GenerationLease = {
    expiresAt: number;
    ownerId: string;
};

type LeaseManagerOptions = {
    storage: LeaseStorage | null;
    ownerId: string;
    now?: () => number;
    ttlMs?: number;
};

const LEASE_PREFIX = "infinite-canvas:generation-lease:v1";
const DEFAULT_LEASE_TTL_MS = 15 * 60_000;

export function createCanvasGenerationLeaseManager({ storage, ownerId, now = Date.now, ttlMs = DEFAULT_LEASE_TTL_MS }: LeaseManagerOptions) {
    const ownedKeys = new Set<string>();

    const read = (key: string): GenerationLease | null => {
        if (!storage) return null;
        try {
            const parsed = JSON.parse(storage.getItem(key) || "null") as Partial<GenerationLease> | null;
            if (!parsed || parsed.ownerId === undefined || !Number.isFinite(parsed.expiresAt)) return null;
            return { ownerId: String(parsed.ownerId), expiresAt: Number(parsed.expiresAt) };
        } catch {
            return null;
        }
    };

    const begin = (projectId: string, nodeId: string) => {
        if (!storage) return;
        const key = leaseKey(projectId, nodeId);
        try {
            storage.setItem(key, JSON.stringify({ ownerId, expiresAt: now() + ttlMs } satisfies GenerationLease));
            ownedKeys.add(key);
        } catch {
            // localStorage 不可用时退回原有单标签行为，不能阻断生成请求。
        }
    };

    const end = (projectId: string, nodeId: string) => {
        const key = leaseKey(projectId, nodeId);
        ownedKeys.delete(key);
        if (!storage) return;
        try {
            if (read(key)?.ownerId === ownerId) storage.removeItem(key);
        } catch {
            // 清理失败会由 TTL 自动失效。
        }
    };

    const isActive = (projectId: string, nodeId: string) => {
        if (!storage) return false;
        const key = leaseKey(projectId, nodeId);
        const lease = read(key);
        if (!lease) return false;
        if (lease.expiresAt > now()) return true;
        try {
            storage.removeItem(key);
        } catch {
            // 过期租约即使无法删除，也不能再保护 loading 节点。
        }
        return false;
    };

    const releaseAll = () => {
        for (const key of Array.from(ownedKeys)) {
            ownedKeys.delete(key);
            if (!storage) continue;
            try {
                if (read(key)?.ownerId === ownerId) storage.removeItem(key);
            } catch {
                // 页面离开阶段只做尽力清理。
            }
        }
    };

    return { begin, end, isActive, releaseAll };
}

const manager = createCanvasGenerationLeaseManager({
    storage: browserStorage(),
    ownerId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
});

if (typeof window !== "undefined") window.addEventListener("pagehide", () => manager.releaseAll());

export const beginCanvasGenerationLease = manager.begin;
export const endCanvasGenerationLease = manager.end;
export const hasActiveCanvasGenerationLease = manager.isActive;

function browserStorage(): LeaseStorage | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function leaseKey(projectId: string, nodeId: string) {
    return `${LEASE_PREFIX}:${encodeURIComponent(projectId)}:${encodeURIComponent(nodeId)}`;
}

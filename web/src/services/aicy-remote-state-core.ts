export type AicyStateSlice = "canvas" | "assets" | "preferences";

export type AicyRemoteState = {
    version: 1;
    projects: unknown[];
    assets: unknown[];
    preferences: Record<string, unknown>;
    revision: number;
    updatedAt: number | null;
};

export type AicyRemoteSaveOptions = {
    keepalive?: boolean;
};

type Mutation = {
    slice: AicyStateSlice;
    value: unknown[] | Record<string, unknown>;
};

type CoordinatorOptions = {
    load: () => Promise<AicyRemoteState>;
    save: (baseRevision: number, state: AicyRemoteState, options?: AicyRemoteSaveOptions) => Promise<AicyRemoteState>;
    debounceMs?: number;
    retryMs?: number;
    maxConflictRetries?: number;
    onBackgroundError?: (error: unknown) => void;
};

type MergeResult = {
    state: AicyRemoteState;
    conflicts: string[];
};

type Coordinator = {
    flush: (options?: AicyRemoteSaveOptions) => Promise<void>;
    readSlice: (slice: AicyStateSlice) => Promise<unknown[] | Record<string, unknown>>;
    writeSlice: (slice: AicyStateSlice, value: unknown[] | Record<string, unknown>) => Promise<void>;
};

export class AicyRemoteStateConflictError extends Error {
    readonly current: AicyRemoteState;
    readonly conflicts: string[];

    constructor(current: AicyRemoteState, conflicts: string[] = []) {
        super(conflicts.length > 0 ? `Aicy remote state conflicts: ${conflicts.join(", ")}` : "Aicy remote state revision conflict");
        this.name = "AicyRemoteStateConflictError";
        this.current = current;
        this.conflicts = conflicts;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAicyRemoteState(value: unknown): AicyRemoteState {
    const source = isRecord(value) ? value : {};
    const revision = Number(source.revision);
    return {
        version: 1,
        projects: Array.isArray(source.projects) ? source.projects : [],
        assets: Array.isArray(source.assets) ? source.assets : [],
        preferences: isRecord(source.preferences) ? source.preferences : {},
        revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
        updatedAt: typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : null,
    };
}

async function responsePayload(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function responseMessage(payload: unknown, fallback: string) {
    return isRecord(payload) && typeof payload.message === "string" ? payload.message : typeof payload === "string" && payload ? payload : fallback;
}

export function resolveAicyRemoteStatePath(statePath: string, stateWritePath: string | undefined, method: string | undefined) {
    if (method?.toUpperCase() !== "PUT") return statePath;
    return stateWritePath || `${statePath.replace(/\/+$/, "")}/cas`;
}

export function createAicyRemoteStateHttpTransport(request: (init: RequestInit) => Promise<Response>) {
    return {
        async load() {
            const response = await request({ method: "GET" });
            const payload = await responsePayload(response);
            if (!response.ok) throw new Error(responseMessage(payload, "Failed to load Aicy canvas state."));
            return normalizeAicyRemoteState(payload);
        },
        async save(baseRevision: number, state: AicyRemoteState, options: AicyRemoteSaveOptions = {}) {
            const response = await request({
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                ...(options.keepalive ? { keepalive: true } : {}),
                body: JSON.stringify({
                    baseRevision,
                    state: { version: 1, projects: state.projects, assets: state.assets, preferences: state.preferences },
                }),
            });
            const payload = await responsePayload(response);
            if (response.status === 409 && isRecord(payload) && payload.code === "INFINITE_CANVAS_STATE_CONFLICT") {
                throw new AicyRemoteStateConflictError(normalizeAicyRemoteState(payload.current));
            }
            if (!response.ok) throw new Error(responseMessage(payload, "Failed to save Aicy canvas state."));
            return normalizeAicyRemoteState(payload);
        },
    };
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

function selectMergedValue(path: string, base: { present: boolean; value: unknown }, local: { present: boolean; value: unknown }, remote: { present: boolean; value: unknown }, conflicts: string[]) {
    const localChanged = base.present !== local.present || (base.present && local.present && !deepEqual(base.value, local.value));
    const remoteChanged = base.present !== remote.present || (base.present && remote.present && !deepEqual(base.value, remote.value));

    if (!localChanged) return remote;
    if (!remoteChanged) return local;
    if (local.present === remote.present && (!local.present || deepEqual(local.value, remote.value))) return local;

    conflicts.push(path);
    return remote;
}

function keyedItems(items: unknown[]) {
    const values = new Map<string, unknown>();
    const order: string[] = [];
    for (const item of items) {
        if (!isRecord(item) || (typeof item.id !== "string" && typeof item.id !== "number")) return null;
        const id = String(item.id);
        if (values.has(id)) return null;
        values.set(id, item);
        order.push(id);
    }
    return { order, values };
}

function sameOrder(left: string[], right: string[]) {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

function orderChanged(base: string[], side: string[]) {
    const baseIds = new Set(base);
    const sideIds = new Set(side);
    return !sameOrder(
        base.filter((id) => sideIds.has(id)),
        side.filter((id) => baseIds.has(id)),
    );
}

function addOrderEdges(edges: Map<string, Set<string>>, order: string[], includePair: (left: string, right: string) => boolean) {
    for (let index = 1; index < order.length; index += 1) {
        const left = order[index - 1]!;
        const right = order[index]!;
        if (left === right || !includePair(left, right)) continue;
        edges.get(left)?.add(right);
    }
}

function addAdditionAnchorEdges(edges: Map<string, Set<string>>, order: string[], baseIds: Set<string>) {
    const positions = new Map(order.map((id, index) => [id, index]));
    for (const addition of order) {
        if (baseIds.has(addition)) continue;
        for (const existing of order) {
            if (!baseIds.has(existing)) continue;
            if (positions.get(addition)! < positions.get(existing)!) edges.get(addition)?.add(existing);
            else edges.get(existing)?.add(addition);
        }
    }
}

function topologicalKeyOrder(nodes: string[], edges: Map<string, Set<string>>, rank: Map<string, number>) {
    const indegree = new Map(nodes.map((id) => [id, 0]));
    for (const targets of edges.values()) {
        for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }

    const ready = nodes.filter((id) => indegree.get(id) === 0);
    const result: string[] = [];
    const compareRank = (left: string, right: string) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right);
    while (ready.length > 0) {
        ready.sort(compareRank);
        const id = ready.shift()!;
        result.push(id);
        for (const target of edges.get(id) ?? []) {
            const nextIndegree = (indegree.get(target) ?? 0) - 1;
            indegree.set(target, nextIndegree);
            if (nextIndegree === 0) ready.push(target);
        }
    }
    return result.length === nodes.length ? result : null;
}

function mergeKeyOrder(path: string, base: string[], local: string[], remote: string[], conflicts: string[]) {
    const localChanged = orderChanged(base, local);
    const remoteChanged = orderChanged(base, remote);
    let primary = base;
    if (localChanged && !remoteChanged) primary = local;
    if (remoteChanged && !localChanged) primary = remote;
    if (localChanged && remoteChanged) {
        const common = new Set(base.filter((id) => local.includes(id) && remote.includes(id)));
        const localCommon = local.filter((id) => common.has(id));
        const remoteCommon = remote.filter((id) => common.has(id));
        if (!sameOrder(localCommon, remoteCommon)) conflicts.push(`${path}:order`);
        primary = sameOrder(localCommon, remoteCommon) ? local : remote;
    }

    const nodes = [...new Set([...primary, ...local, ...remote, ...base])];
    const edges = new Map(nodes.map((id) => [id, new Set<string>()]));
    const baseIds = new Set(base);
    addOrderEdges(edges, primary, () => true);
    // 基础实体的重排由 primary 决定；两侧新增项仍保留各自相邻锚点。
    const includesAddition = (left: string, right: string) => !baseIds.has(left) || !baseIds.has(right);
    addOrderEdges(edges, local, includesAddition);
    addOrderEdges(edges, remote, includesAddition);
    // 新增项必须保持在该侧所有既有项的同一侧，避免另一侧重排把头插项夹进列表中间。
    addAdditionAnchorEdges(edges, local, baseIds);
    addAdditionAnchorEdges(edges, remote, baseIds);

    const stablePreference = [...new Set([...local, ...remote, ...primary, ...base])];
    const rank = new Map(stablePreference.map((id, index) => [id, index]));
    const merged = topologicalKeyOrder(nodes, edges, rank);
    if (merged) return merged;
    const orderConflict = `${path}:order`;
    if (!conflicts.includes(orderConflict)) conflicts.push(orderConflict);
    return nodes;
}

function mergeKeyedArray(path: string, base: unknown[], local: unknown[], remote: unknown[], conflicts: string[]) {
    const baseItems = keyedItems(base);
    const localItems = keyedItems(local);
    const remoteItems = keyedItems(remote);
    if (!baseItems || !localItems || !remoteItems) {
        const selected = selectMergedValue(path, { present: true, value: base }, { present: true, value: local }, { present: true, value: remote }, conflicts);
        return selected.value as unknown[];
    }

    const ids = mergeKeyOrder(path, baseItems.order, localItems.order, remoteItems.order, conflicts);
    const result: unknown[] = [];
    for (const id of ids) {
        const selected = selectMergedValue(
            `${path}:${id}`,
            { present: baseItems.values.has(id), value: baseItems.values.get(id) },
            { present: localItems.values.has(id), value: localItems.values.get(id) },
            { present: remoteItems.values.has(id), value: remoteItems.values.get(id) },
            conflicts,
        );
        if (selected.present) result.push(selected.value);
    }
    return result;
}

function mergePreferences(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>, conflicts: string[]) {
    const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])];
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const selected = selectMergedValue(`preferences:${key}`, { present: Object.hasOwn(base, key), value: base[key] }, { present: Object.hasOwn(local, key), value: local[key] }, { present: Object.hasOwn(remote, key), value: remote[key] }, conflicts);
        if (selected.present) result[key] = selected.value;
    }
    return result;
}

export function mergeAicyRemoteStates(base: AicyRemoteState, local: AicyRemoteState, remote: AicyRemoteState): MergeResult {
    const conflicts: string[] = [];
    return {
        state: {
            version: 1,
            projects: mergeKeyedArray("projects", base.projects, local.projects, remote.projects, conflicts),
            assets: mergeKeyedArray("assets", base.assets, local.assets, remote.assets, conflicts),
            preferences: mergePreferences(base.preferences, local.preferences, remote.preferences, conflicts),
            revision: remote.revision,
            updatedAt: remote.updatedAt,
        },
        conflicts,
    };
}

function applyMutation(state: AicyRemoteState, mutation: Mutation): AicyRemoteState {
    if (mutation.slice === "canvas") return { ...state, projects: mutation.value as unknown[] };
    if (mutation.slice === "assets") return { ...state, assets: mutation.value as unknown[] };
    return { ...state, preferences: mutation.value as Record<string, unknown> };
}

function applyMutations(state: AicyRemoteState, mutations: Mutation[]) {
    return mutations.reduce(applyMutation, state);
}

function stateMutations(state: AicyRemoteState): Mutation[] {
    return [
        { slice: "canvas", value: state.projects },
        { slice: "assets", value: state.assets },
        { slice: "preferences", value: state.preferences },
    ];
}

function valueForSlice(slice: AicyStateSlice, state: AicyRemoteState) {
    if (slice === "canvas") return state.projects;
    if (slice === "assets") return state.assets;
    return state.preferences;
}

export function createAicyRemoteStateCoordinator(options: CoordinatorOptions): Coordinator {
    const debounceMs = options.debounceMs ?? 400;
    const retryMs = options.retryMs ?? 1_500;
    const maxConflictRetries = options.maxConflictRetries ?? 3;
    let baseState: AicyRemoteState | null = null;
    let optimisticState: AicyRemoteState | null = null;
    let loadPromise: Promise<AicyRemoteState> | null = null;
    let pendingMutations: Mutation[] = [];
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let drainPromise: Promise<void> | null = null;
    let mutationVersion = 0;

    function clearTimers() {
        if (saveTimer) clearTimeout(saveTimer);
        if (retryTimer) clearTimeout(retryTimer);
        saveTimer = null;
        retryTimer = null;
    }

    async function ensureLoaded() {
        if (baseState) return baseState;
        if (!loadPromise) {
            loadPromise = options.load().then((state) => {
                baseState = state;
                optimisticState = applyMutations(state, pendingMutations);
                return state;
            });
        }
        try {
            return await loadPromise;
        } finally {
            loadPromise = null;
        }
    }

    function restoreFailedBatch(batch: Mutation[], nextBase = baseState) {
        if (nextBase) baseState = nextBase;
        // 失败批次放回队首，保存期间产生的新变更仍在其后，保证新值最终覆盖旧值。
        pendingMutations = [...batch, ...pendingMutations];
        if (baseState) optimisticState = applyMutations(baseState, pendingMutations);
    }

    async function saveNextBatch(saveOptions: AicyRemoteSaveOptions) {
        const loaded = await ensureLoaded();
        const batch = pendingMutations.splice(0);
        if (batch.length === 0) return;

        let attemptBase = baseState ?? loaded;
        let attemptState = applyMutations(attemptBase, batch);
        let recoverableBatch = batch;

        for (let attempt = 0; ; attempt += 1) {
            try {
                const saved = await options.save(attemptBase.revision, attemptState, saveOptions);
                baseState = saved;
                optimisticState = applyMutations(saved, pendingMutations);
                return;
            } catch (error) {
                if (!(error instanceof AicyRemoteStateConflictError)) {
                    restoreFailedBatch(recoverableBatch, attemptBase);
                    throw error;
                }

                const merged = mergeAicyRemoteStates(attemptBase, attemptState, error.current);
                if (merged.conflicts.length > 0) {
                    // 同一实体的冲突必须交给用户处理，绝不能用更新后的 revision 强行覆盖。
                    restoreFailedBatch(recoverableBatch, attemptBase);
                    throw new AicyRemoteStateConflictError(error.current, merged.conflicts);
                }

                attemptBase = error.current;
                attemptState = merged.state;
                recoverableBatch = stateMutations(merged.state);
                if (attempt >= maxConflictRetries) {
                    restoreFailedBatch(recoverableBatch, attemptBase);
                    throw new AicyRemoteStateConflictError(error.current, ["revision"]);
                }
            }
        }
    }

    function startDrain(saveOptions: AicyRemoteSaveOptions = {}): Promise<void> {
        if (drainPromise) return drainPromise;
        const currentDrain = (async () => {
            while (true) {
                while (pendingMutations.length > 0) await saveNextBatch(saveOptions);
                const quietVersion = mutationVersion;
                // 等一个完整事件循环，覆盖 drain 判空后、flush 调用方恢复前入队的写入。
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                if (pendingMutations.length === 0 && mutationVersion === quietVersion) return;
            }
        })();
        drainPromise = currentDrain.then(
            () => {
                drainPromise = null;
                // 成功收尾时若又有 mutation 入队，原 flush 继续等待下一轮 drain。
                return pendingMutations.length > 0 ? startDrain(saveOptions) : undefined;
            },
            (error) => {
                drainPromise = null;
                throw error;
            },
        );
        return drainPromise;
    }

    function scheduleRetry() {
        if (retryTimer || pendingMutations.length === 0) return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void startDrain().catch(handleBackgroundError);
        }, retryMs);
    }

    function handleBackgroundError(error: unknown) {
        options.onBackgroundError?.(error);
        if (!(error instanceof AicyRemoteStateConflictError)) scheduleRetry();
    }

    function scheduleSave() {
        if (drainPromise) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void startDrain().catch(handleBackgroundError);
        }, debounceMs);
    }

    return {
        async readSlice(slice) {
            await ensureLoaded();
            return valueForSlice(slice, optimisticState ?? baseState!);
        },
        async writeSlice(slice, value) {
            const mutation = { slice, value };
            // 先同步入队，确保紧随其后的 flush 能看到仍在等待首次加载的写入。
            mutationVersion += 1;
            pendingMutations.push(mutation);
            if (optimisticState ?? baseState) optimisticState = applyMutation(optimisticState ?? baseState!, mutation);
            scheduleSave();
            await ensureLoaded();
        },
        async flush(saveOptions = {}) {
            clearTimers();
            try {
                await startDrain(saveOptions);
            } catch (error) {
                clearTimers();
                throw error;
            }
        },
    };
}

export async function returnToAicyAfterFlush(flush: () => Promise<void>, returnToAicy: () => void | Promise<void>) {
    await flush();
    await returnToAicy();
}

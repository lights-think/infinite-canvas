import assert from "node:assert/strict";
import test from "node:test";

import * as remoteStateCore from "../src/services/aicy-remote-state-core.ts";

type Item = { id: string; value: string };
type RemoteState = {
    version: 1;
    projects: Item[];
    assets: Item[];
    preferences: Record<string, unknown>;
    revision: number;
    updatedAt: number | null;
};

function state(overrides: Partial<RemoteState> = {}): RemoteState {
    return {
        version: 1,
        projects: [],
        assets: [],
        preferences: {},
        revision: 0,
        updatedAt: null,
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

test("Aicy remote state exposes a coordinator for serialized persistence", () => {
    assert.equal(typeof remoteStateCore.createAicyRemoteStateCoordinator, "function");
});

test("concurrent canvas and asset writes are saved together without losing a slice", async () => {
    let remote = state();
    const saves: Array<{ baseRevision: number; next: RemoteState }> = [];
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 60_000,
        load: async () => remote,
        save: async (baseRevision: number, next: RemoteState) => {
            saves.push({ baseRevision, next: structuredClone(next) });
            remote = { ...structuredClone(next), revision: baseRevision + 1, updatedAt: 10 };
            return remote;
        },
    });

    await Promise.all([coordinator.writeSlice("canvas", [{ id: "project-new", value: "canvas" }]), coordinator.writeSlice("assets", [{ id: "asset-new", value: "asset" }])]);
    await coordinator.flush();

    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.baseRevision, 0);
    assert.deepEqual(saves[0]?.next.projects, [{ id: "project-new", value: "canvas" }]);
    assert.deepEqual(saves[0]?.next.assets, [{ id: "asset-new", value: "asset" }]);
});

test("a mutation added while a save is in flight is persisted by the same flush", async () => {
    const firstSave = deferred<RemoteState>();
    const firstSaveStarted = deferred<void>();
    const saves: Array<{ baseRevision: number; next: RemoteState }> = [];
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 60_000,
        load: async () => state(),
        save: async (baseRevision: number, next: RemoteState) => {
            saves.push({ baseRevision, next: structuredClone(next) });
            if (saves.length === 1) {
                firstSaveStarted.resolve();
                return firstSave.promise;
            }
            return { ...structuredClone(next), revision: baseRevision + 1, updatedAt: 20 };
        },
    });

    await coordinator.writeSlice("canvas", [{ id: "project-new", value: "canvas" }]);
    const flushPromise = coordinator.flush();
    await firstSaveStarted.promise;
    await coordinator.writeSlice("assets", [{ id: "asset-later", value: "asset" }]);
    firstSave.resolve({ ...structuredClone(saves[0]!.next), revision: 1, updatedAt: 10 });
    await flushPromise;

    assert.equal(saves.length, 2);
    assert.equal(saves[1]?.baseRevision, 1);
    assert.deepEqual(saves[1]?.next.projects, [{ id: "project-new", value: "canvas" }]);
    assert.deepEqual(saves[1]?.next.assets, [{ id: "asset-later", value: "asset" }]);
});

test("flush drains a mutation queued at the drain completion boundary", async () => {
    const firstSave = deferred<RemoteState>();
    const firstSaveStarted = deferred<void>();
    const saves: Array<{ baseRevision: number; next: RemoteState }> = [];
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 10,
        load: async () => state(),
        save: async (baseRevision: number, next: RemoteState) => {
            saves.push({ baseRevision, next: structuredClone(next) });
            if (saves.length === 1) {
                firstSaveStarted.resolve();
                return firstSave.promise;
            }
            return { ...structuredClone(next), revision: baseRevision + 1, updatedAt: 20 };
        },
    });

    await coordinator.writeSlice("canvas", [{ id: "project-new", value: "canvas" }]);
    const flushPromise = coordinator.flush();
    await firstSaveStarted.promise;
    firstSave.resolve({ ...structuredClone(saves[0]!.next), revision: 1, updatedAt: 10 });

    queueMicrotask(() =>
        queueMicrotask(() =>
            queueMicrotask(() =>
                queueMicrotask(() =>
                    queueMicrotask(() => {
                        void coordinator.writeSlice("assets", [{ id: "asset-boundary", value: "asset" }]);
                    }),
                ),
            ),
        ),
    );

    await flushPromise;

    assert.equal(saves.length, 2);
    assert.equal(saves[1]?.baseRevision, 1);
    assert.deepEqual(saves[1]?.next.assets, [{ id: "asset-boundary", value: "asset" }]);
});

test("flush waits for a write whose initial remote load is still in flight", async () => {
    const initialLoad = deferred<RemoteState>();
    const saved: RemoteState[] = [];
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 60_000,
        load: () => initialLoad.promise,
        save: async (baseRevision: number, next: RemoteState) => {
            saved.push(structuredClone(next));
            return { ...structuredClone(next), revision: baseRevision + 1 };
        },
    });

    const writePromise = coordinator.writeSlice("canvas", [{ id: "project-loading", value: "canvas" }]);
    let flushSettled = false;
    const flushPromise = coordinator.flush().then(() => {
        flushSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledBeforeLoad = flushSettled;

    initialLoad.resolve(state());
    await Promise.all([writePromise, flushPromise]);
    await coordinator.flush();

    assert.equal(settledBeforeLoad, false);
    assert.deepEqual(saved[0]?.projects, [{ id: "project-loading", value: "canvas" }]);
});

test("flush rejects on a final save failure and retains pending mutations for retry", async () => {
    let shouldFail = true;
    let calls = 0;
    let remote = state();
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 60_000,
        load: async () => remote,
        save: async (baseRevision: number, next: RemoteState) => {
            calls += 1;
            if (shouldFail) throw new Error("network unavailable");
            remote = { ...structuredClone(next), revision: baseRevision + 1, updatedAt: 10 };
            return remote;
        },
    });

    await coordinator.writeSlice("canvas", [{ id: "project-pending", value: "canvas" }]);
    await assert.rejects(coordinator.flush(), /network unavailable/);
    assert.equal(calls, 1);

    shouldFail = false;
    await coordinator.flush();
    assert.equal(calls, 2);
    assert.deepEqual(remote.projects, [{ id: "project-pending", value: "canvas" }]);
});

test("three-way merge combines disjoint project changes", () => {
    const base = state({
        projects: [
            { id: "project-local", value: "old-local" },
            { id: "project-remote", value: "old-remote" },
        ],
    });
    const local = state({
        projects: [
            { id: "project-local", value: "new-local" },
            { id: "project-remote", value: "old-remote" },
        ],
    });
    const remote = state({
        projects: [
            { id: "project-local", value: "old-local" },
            { id: "project-remote", value: "new-remote" },
        ],
        revision: 1,
        updatedAt: 10,
    });

    const result = remoteStateCore.mergeAicyRemoteStates(base, local, remote);

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.state.projects, [
        { id: "project-local", value: "new-local" },
        { id: "project-remote", value: "new-remote" },
    ]);
    assert.equal(result.state.revision, 1);
});

test("three-way merge preserves a local project reorder across a disjoint remote edit", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
        ],
    });
    const local = state({
        projects: [
            { id: "b", value: "b" },
            { id: "a", value: "a" },
            { id: "c", value: "c" },
        ],
    });
    const remote = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "remote" },
        ],
        revision: 1,
    });

    const result = remoteStateCore.mergeAicyRemoteStates(base, local, remote);

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
        result.state.projects.map((project) => project.id),
        ["b", "a", "c"],
    );
    assert.equal(result.state.projects[2]?.value, "remote");
});

test("three-way merge keeps a remote head addition ahead of every locally reordered base project", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
    });
    const local = state({
        projects: [
            { id: "b", value: "b" },
            { id: "a", value: "a" },
        ],
    });
    const remote = state({
        projects: [
            { id: "x", value: "x" },
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
        revision: 1,
    });

    const result = remoteStateCore.mergeAicyRemoteStates(base, local, remote);

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
        result.state.projects.map((project) => project.id),
        ["x", "b", "a"],
    );
});

test("three-way merge applies addition anchors symmetrically across concurrent reorders", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
    });
    const local = state({
        projects: [
            { id: "head", value: "head" },
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
    });
    const remote = state({
        projects: [
            { id: "b", value: "b" },
            { id: "a", value: "a" },
        ],
        revision: 1,
    });

    const result = remoteStateCore.mergeAicyRemoteStates(base, local, remote);

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
        result.state.projects.map((project) => project.id),
        ["head", "b", "a"],
    );
});

test("three-way merge keeps concurrent head additions ahead of every reordered base project", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
    });
    const local = state({
        projects: [
            { id: "local-head", value: "local-head" },
            { id: "b", value: "b" },
            { id: "a", value: "a" },
        ],
    });
    const remote = state({
        projects: [
            { id: "remote-head", value: "remote-head" },
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
        revision: 1,
    });

    const result = remoteStateCore.mergeAicyRemoteStates(base, local, remote);

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
        result.state.projects.map((project) => project.id),
        ["local-head", "remote-head", "b", "a"],
    );
});

test("three-way merge reports an order conflict when an addition anchor contradicts a concurrent reorder", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
    });
    const local = state({
        projects: [
            { id: "b", value: "b" },
            { id: "a", value: "a" },
        ],
    });
    const remote = state({
        projects: [
            { id: "a", value: "a" },
            { id: "middle", value: "middle" },
            { id: "b", value: "b" },
        ],
        revision: 1,
    });

    assert.deepEqual(remoteStateCore.mergeAicyRemoteStates(base, local, remote).conflicts, ["projects:order"]);
});

test("three-way merge preserves the anchor of a local-only project addition", () => {
    const base = state({ projects: [{ id: "a", value: "a" }] });
    const local = state({
        projects: [
            { id: "new", value: "new" },
            { id: "a", value: "a" },
        ],
    });
    const remote = state({ projects: [{ id: "a", value: "a" }], revision: 1 });

    const result = remoteStateCore.mergeAicyRemoteStates(base, local, remote);

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
        result.state.projects.map((project) => project.id),
        ["new", "a"],
    );
});

test("three-way merge deterministically preserves anchors for concurrent additions", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
        ],
    });
    const local = state({
        projects: [
            { id: "local-head", value: "local-head" },
            { id: "a", value: "a" },
            { id: "local-gap", value: "local-gap" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
            { id: "local-tail", value: "local-tail" },
        ],
    });
    const remote = state({
        projects: [
            { id: "a", value: "a" },
            { id: "remote-gap", value: "remote-gap" },
            { id: "b", value: "b" },
            { id: "remote-before-c", value: "remote-before-c" },
            { id: "c", value: "c" },
        ],
        revision: 1,
    });

    const result = remoteStateCore.mergeAicyRemoteStates(base, local, remote);

    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
        result.state.projects.map((project) => project.id),
        ["local-head", "a", "local-gap", "remote-gap", "b", "remote-before-c", "c", "local-tail"],
    );
});

test("three-way merge reports incompatible anchors for the same concurrent addition", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
        ],
    });
    const local = state({
        projects: [
            { id: "a", value: "a" },
            { id: "new", value: "new" },
            { id: "b", value: "b" },
        ],
    });
    const remote = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "new", value: "new" },
        ],
        revision: 1,
    });

    assert.deepEqual(remoteStateCore.mergeAicyRemoteStates(base, local, remote).conflicts, ["projects:order"]);
});

test("three-way merge reports incompatible concurrent project reorders", () => {
    const base = state({
        projects: [
            { id: "a", value: "a" },
            { id: "b", value: "b" },
            { id: "c", value: "c" },
        ],
    });
    const local = state({
        projects: [
            { id: "b", value: "b" },
            { id: "a", value: "a" },
            { id: "c", value: "c" },
        ],
    });
    const remote = state({
        projects: [
            { id: "a", value: "a" },
            { id: "c", value: "c" },
            { id: "b", value: "b" },
        ],
        revision: 1,
    });

    assert.deepEqual(remoteStateCore.mergeAicyRemoteStates(base, local, remote).conflicts, ["projects:order"]);
});

test("coordinator retries a disjoint CAS conflict with the current revision", async () => {
    const base = state({
        projects: [
            { id: "project-local", value: "old-local" },
            { id: "project-remote", value: "old-remote" },
        ],
    });
    const current = state({
        projects: [
            { id: "project-local", value: "old-local" },
            { id: "project-remote", value: "new-remote" },
        ],
        revision: 1,
        updatedAt: 10,
    });
    const revisions: number[] = [];
    let saved = base;
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 60_000,
        load: async () => base,
        save: async (baseRevision: number, next: RemoteState) => {
            revisions.push(baseRevision);
            if (revisions.length === 1) {
                throw new remoteStateCore.AicyRemoteStateConflictError(current);
            }
            saved = { ...structuredClone(next), revision: baseRevision + 1, updatedAt: 20 };
            return saved;
        },
    });

    await coordinator.writeSlice("canvas", [
        { id: "project-local", value: "new-local" },
        { id: "project-remote", value: "old-remote" },
    ]);
    await coordinator.flush();

    assert.deepEqual(revisions, [0, 1]);
    assert.deepEqual(saved.projects, [
        { id: "project-local", value: "new-local" },
        { id: "project-remote", value: "new-remote" },
    ]);
    assert.equal(saved.revision, 2);
});

test("three-way merge reports same-project modify/modify and delete/modify conflicts", () => {
    const base = state({ projects: [{ id: "project-1", value: "old" }] });
    const modifiedLocally = state({ projects: [{ id: "project-1", value: "local" }] });
    const deletedLocally = state({ projects: [] });
    const remote = state({ projects: [{ id: "project-1", value: "remote" }], revision: 1 });

    assert.deepEqual(remoteStateCore.mergeAicyRemoteStates(base, modifiedLocally, remote).conflicts, ["projects:project-1"]);
    assert.deepEqual(remoteStateCore.mergeAicyRemoteStates(base, deletedLocally, remote).conflicts, ["projects:project-1"]);
});

test("a conflicting CAS response is surfaced without an overwrite retry", async () => {
    const base = state({ projects: [{ id: "project-1", value: "old" }] });
    const current = state({ projects: [{ id: "project-1", value: "remote" }], revision: 1 });
    let calls = 0;
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 60_000,
        load: async () => base,
        save: async () => {
            calls += 1;
            throw new remoteStateCore.AicyRemoteStateConflictError(current);
        },
    });

    await coordinator.writeSlice("canvas", [{ id: "project-1", value: "local" }]);
    await assert.rejects(coordinator.flush(), (error: unknown) => {
        assert.ok(error instanceof remoteStateCore.AicyRemoteStateConflictError);
        assert.deepEqual(error.conflicts, ["projects:project-1"]);
        return true;
    });
    assert.equal(calls, 1);
});

test("a background semantic conflict is retained without an automatic retry loop", async () => {
    const base = state({ projects: [{ id: "project-1", value: "old" }] });
    const current = state({ projects: [{ id: "project-1", value: "remote" }], revision: 1 });
    const backgroundError = deferred<void>();
    let allowSave = false;
    let calls = 0;
    const coordinator = remoteStateCore.createAicyRemoteStateCoordinator({
        debounceMs: 0,
        retryMs: 5,
        load: async () => base,
        save: async (baseRevision: number, next: RemoteState) => {
            calls += 1;
            if (!allowSave) throw new remoteStateCore.AicyRemoteStateConflictError(current);
            return { ...structuredClone(next), revision: baseRevision + 1 };
        },
        onBackgroundError: () => backgroundError.resolve(),
    });

    await coordinator.writeSlice("canvas", [{ id: "project-1", value: "local" }]);
    await backgroundError.promise;
    allowSave = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);

    await coordinator.flush();
    assert.equal(calls, 2);
});

test("HTTP transport sends the global base revision and persistent state payload", async () => {
    const requests: RequestInit[] = [];
    const transport = remoteStateCore.createAicyRemoteStateHttpTransport(async (init: RequestInit) => {
        requests.push(init);
        return new Response(JSON.stringify(state({ revision: 3, updatedAt: 30 })), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
    const local = state({ projects: [{ id: "project-1", value: "local" }], revision: 2, updatedAt: 20 });

    const saved = await transport.save(2, local, { keepalive: true });

    assert.equal(saved.revision, 3);
    assert.equal(requests[0]?.method, "PUT");
    assert.equal(requests[0]?.keepalive, true);
    assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
        baseRevision: 2,
        state: {
            version: 1,
            projects: [{ id: "project-1", value: "local" }],
            assets: [],
            preferences: {},
        },
    });
});

test("HTTP transport converts a 409 response into a revision conflict", async () => {
    const current = state({ projects: [{ id: "project-1", value: "remote" }], revision: 4, updatedAt: 40 });
    const transport = remoteStateCore.createAicyRemoteStateHttpTransport(
        async () =>
            new Response(JSON.stringify({ code: "INFINITE_CANVAS_STATE_CONFLICT", current, message: "changed" }), {
                status: 409,
                headers: { "Content-Type": "application/json" },
            }),
    );

    await assert.rejects(transport.save(3, state({ revision: 3 })), (error: unknown) => {
        assert.ok(error instanceof remoteStateCore.AicyRemoteStateConflictError);
        assert.deepEqual(error.current, current);
        return true;
    });
});

test("state writes prefer the advertised CAS path and fall back to the derived CAS path", () => {
    assert.equal(remoteStateCore.resolveAicyRemoteStatePath("/api/infinite-canvas/state", "/custom/state-write", "PUT"), "/custom/state-write");
    assert.equal(remoteStateCore.resolveAicyRemoteStatePath("/api/infinite-canvas/state", undefined, "PUT"), "/api/infinite-canvas/state/cas");
    assert.equal(remoteStateCore.resolveAicyRemoteStatePath("/api/infinite-canvas/state", "/custom/state-write", "GET"), "/api/infinite-canvas/state");
});

test("return to Aicy runs only after a successful flush", async () => {
    let returnCalls = 0;
    const returnToAicy = () => {
        returnCalls += 1;
    };

    await assert.rejects(
        remoteStateCore.returnToAicyAfterFlush(async () => Promise.reject(new Error("save failed")), returnToAicy),
        /save failed/,
    );
    assert.equal(returnCalls, 0);

    await remoteStateCore.returnToAicyAfterFlush(async () => undefined, returnToAicy);
    assert.equal(returnCalls, 1);
});

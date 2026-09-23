export interface SynchronizerResult {
  readonly latestChangeSequence?: number;
}

export type Synchronizer = () => Promise<SynchronizerResult | void>;
export type SynchronizerPhase = "reconcile" | "replay";

export type SyncStatus = "idle" | "syncing" | "live" | "offline" | "update-required";

export class SyncCoordinator {
  readonly #reconcilers = new Map<string, Synchronizer>();
  readonly #replayers = new Map<string, Synchronizer>();
  readonly #listeners = new Set<(status: SyncStatus) => void>();
  #status: SyncStatus = "idle";
  #dirtyCounter = 0;
  #highestHintedChangeSequence = 0;
  #running: Promise<void> | null = null;
  #rerun = false;
  #stopped = false;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #failureCount = 0;

  get status(): SyncStatus {
    return this.#status;
  }

  register(
    name: string,
    synchronizer: Synchronizer,
    phase: SynchronizerPhase = "reconcile",
  ): () => void {
    const collection = phase === "replay" ? this.#replayers : this.#reconcilers;
    collection.set(name, synchronizer);
    return () => {
      if (collection.get(name) === synchronizer) collection.delete(name);
    };
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#status);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Reverses a prior stop() so this coordinator can be reused by a fresh
   * start() cycle (for example when an owning runtime is stopped and
   * restarted, as React StrictMode's mount/cleanup/mount double-invoke does
   * in development). Without this, stop() left #stopped permanently true
   * and every later requestSync() silently no-op'd forever, which stranded
   * queued offline mutations even after connectivity and the realtime
   * socket had fully recovered.
   */
  resume(): void {
    this.#stopped = false;
    this.#rerun = false;
  }

  markOffline(): void {
    this.#setStatus("offline");
  }

  markUpdateRequired(): void {
    this.#setStatus("update-required");
  }

  markDirty(changeSequence?: number): void {
    this.#dirtyCounter += 1;
    if (changeSequence !== undefined) {
      this.#highestHintedChangeSequence = Math.max(
        this.#highestHintedChangeSequence,
        changeSequence,
      );
    }
  }

  requestSync(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    if (this.#status === "update-required") return Promise.resolve();
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.markOffline();
      return Promise.resolve();
    }
    if (this.#running) {
      this.#rerun = true;
      return this.#running;
    }
    this.#running = this.#run().finally(() => {
      this.#running = null;
      if (!this.#stopped && this.#rerun) {
        this.#rerun = false;
        void this.requestSync();
      }
    });
    return this.#running;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#rerun = false;
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = null;
    }
    this.#reconcilers.clear();
    this.#replayers.clear();
    await this.#running?.catch(() => undefined);
    this.#listeners.clear();
  }

  async #run(): Promise<void> {
    for (let pass = 0; pass < 8; pass += 1) {
      if (this.#stopped) return;
      const dirtyAtStart = this.#dirtyCounter;
      const targetChangeSequence = this.#highestHintedChangeSequence;
      this.#setStatus("syncing");

      let observedChangeSequence = 0;
      try {
        // Snapshot the registered synchronizers before iterating. A
        // reconciler's own completion commonly triggers a React state update
        // that causes its owning component to re-register itself (tear down
        // and set up again) with a new closure under the same name. Iterating
        // the live Map directly is vulnerable to that: Map iterators visit
        // entries inserted during iteration, so a reconciler re-registering
        // itself while this loop is still running caused this pass to revisit
        // it indefinitely and never reach the replay phase below.
        for (const synchronizer of [...this.#reconcilers.values()]) {
          const result = await synchronizer();
          if (this.#stopped) return;
          if (result?.latestChangeSequence !== undefined) {
            observedChangeSequence = Math.max(observedChangeSequence, result.latestChangeSequence);
          }
        }

        const dirtyAfterReconcile = this.#dirtyCounter !== dirtyAtStart;
        const behindHint =
          targetChangeSequence > 0 && observedChangeSequence < targetChangeSequence;

        if (dirtyAfterReconcile || behindHint) continue;

        for (const replayer of [...this.#replayers.values()]) {
          await replayer();
          if (this.#stopped) return;
        }
      } catch {
        // A reconciler or replayer failed, most commonly from a transient
        // network error while the browser still reports itself online (for
        // example a reachable Wi-Fi link but an unreachable backend). Do not
        // let that permanently strand queued work: schedule a backoff retry
        // instead of leaving dirty state and queued outbox operations with
        // no future attempt to drain them.
        this.#scheduleRetryAfterFailure();
        return;
      }

      const dirtiedDuringPass = this.#dirtyCounter !== dirtyAtStart;
      if (!dirtiedDuringPass) {
        this.#failureCount = 0;
        this.#setStatus("live");
        return;
      }
    }

    this.#rerun = true;
    this.#setStatus("syncing");
  }

  #scheduleRetryAfterFailure(): void {
    if (this.#stopped) return;
    this.#failureCount += 1;
    const delay = Math.min(10_000, 250 * 2 ** Math.min(this.#failureCount - 1, 6));
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.requestSync();
    }, delay);
  }

  #setStatus(status: SyncStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }
}

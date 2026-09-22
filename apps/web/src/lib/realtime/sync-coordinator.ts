export interface SynchronizerResult {
  readonly latestChangeSequence?: number;
}

export type Synchronizer = () => Promise<SynchronizerResult | void>;

export type SyncStatus =
  | "idle"
  | "syncing"
  | "live"
  | "offline"
  | "update-required";

export class SyncCoordinator {
  readonly #synchronizers = new Map<string, Synchronizer>();
  readonly #listeners = new Set<(status: SyncStatus) => void>();
  #status: SyncStatus = "idle";
  #dirtyCounter = 0;
  #highestHintedChangeSequence = 0;
  #running: Promise<void> | null = null;
  #rerun = false;

  get status(): SyncStatus {
    return this.#status;
  }

  register(name: string, synchronizer: Synchronizer): () => void {
    this.#synchronizers.set(name, synchronizer);
    return () => {
      if (this.#synchronizers.get(name) === synchronizer) {
        this.#synchronizers.delete(name);
      }
    };
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#status);
    return () => this.#listeners.delete(listener);
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
    if (this.#status === "update-required") return Promise.resolve();
    if (this.#running) {
      this.#rerun = true;
      return this.#running;
    }
    this.#running = this.#run().finally(() => {
      this.#running = null;
      if (this.#rerun) {
        this.#rerun = false;
        void this.requestSync();
      }
    });
    return this.#running;
  }

  async #run(): Promise<void> {
    for (let pass = 0; pass < 8; pass += 1) {
      const dirtyAtStart = this.#dirtyCounter;
      const targetChangeSequence = this.#highestHintedChangeSequence;
      this.#setStatus("syncing");

      let observedChangeSequence = 0;
      for (const synchronizer of this.#synchronizers.values()) {
        const result = await synchronizer();
        if (result?.latestChangeSequence !== undefined) {
          observedChangeSequence = Math.max(
            observedChangeSequence,
            result.latestChangeSequence,
          );
        }
      }

      const dirtiedDuringPass = this.#dirtyCounter !== dirtyAtStart;
      const behindHint =
        targetChangeSequence > 0 &&
        observedChangeSequence < targetChangeSequence;

      if (!dirtiedDuringPass && !behindHint) {
        this.#setStatus("live");
        return;
      }
    }

    this.#rerun = true;
    this.#setStatus("syncing");
  }

  #setStatus(status: SyncStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }
}

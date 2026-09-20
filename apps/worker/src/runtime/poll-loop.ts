function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runPollLoop(
  name: string,
  signal: AbortSignal,
  pollIntervalMs: number,
  iteration: () => Promise<void>,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await iteration();
    } catch (error) {
      console.error("WORKER_LOOP_ERROR", {
        loop: name,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }

    if (!signal.aborted) {
      await abortableDelay(pollIntervalMs, signal);
    }
  }
}

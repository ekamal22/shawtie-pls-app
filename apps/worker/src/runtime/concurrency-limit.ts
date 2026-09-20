export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("concurrency must be a positive integer");
  }

  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) await worker(item);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
    run(),
  );
  await Promise.all(runners);
}

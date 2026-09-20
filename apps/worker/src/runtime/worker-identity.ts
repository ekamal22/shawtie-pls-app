import { randomUUID } from "node:crypto";

export function createWorkerIdentity(prefix = "worker"): string {
  return `${prefix}:${process.pid}:${randomUUID()}`;
}

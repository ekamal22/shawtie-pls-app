export interface WorkerApplication {
  readonly kind: "durable-worker";
}

export const workerApplication: WorkerApplication = {
  kind: "durable-worker",
};

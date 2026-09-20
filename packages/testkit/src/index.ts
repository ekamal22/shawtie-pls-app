export {
  closeDatabasePool,
  requireDisposableDatabase,
} from "./database/test-database.ts";
export { withTwoClients } from "./database/concurrent-session.ts";

export const testkitDataPolicy = "synthetic-only" as const;

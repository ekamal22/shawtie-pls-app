import type { Pool, PoolClient } from "pg";

export type QueryExecutor = Pool | PoolClient;

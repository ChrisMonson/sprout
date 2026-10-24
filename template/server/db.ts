import { DatabaseSync } from 'node:sqlite';

// One connection, kept across hot reloads. The greenhouse applies
// migrations/*.sql before this runs; never create or alter tables here.
const g = globalThis as { __sproutDb?: DatabaseSync };
export const db = (g.__sproutDb ??= new DatabaseSync(process.env.SPROUT_DB!));

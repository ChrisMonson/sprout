import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Copy a live SQLite database safely, WAL included, using SQLite's backup API. */
export async function backupDb(source: string, dest: string): Promise<boolean> {
  if (!existsSync(source)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  const db = new DatabaseSync(source);
  try {
    await backup(db, dest);
    return true;
  } finally {
    db.close();
  }
}

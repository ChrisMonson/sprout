// Migrations may only add. Code can be rolled back; data can't, so a schema
// change must never break the code that ran before it. (Port of Og-World's
// gate/check-migrations.py.)

export interface FileChange { status: string; path: string }

const NAME = /^migrations\/(\d{3})_[a-z0-9_]+\.sql$/;

const FORBIDDEN: [RegExp, string][] = [
  [/\bDROP\b/i, 'drops something'],
  [/\bRENAME\b/i, 'renames something'],
  [/\bDELETE\s+FROM\b/i, 'deletes rows'],
  [/\bUPDATE\s+[\w"`[\]]+\s+SET\b/i, 'rewrites rows'],
  [/\bTRUNCATE\b/i, 'empties a table'],
  [/\bREPLACE\s+INTO\b/i, 'overwrites rows'],
  [/\bALTER\s+TABLE\s+[\w"`[\]]+\s+(?!ADD\b)/i, 'alters a table in a way other than adding a column'],
];

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * @param changes  files changed between live and the proposed version (git diff --name-status)
 * @param added    contents of each added migration, by path
 * @param existing migration paths already live
 */
export function checkMigrations(changes: FileChange[], added: Record<string, string>, existing: string[]): string[] {
  const problems: string[] = [];
  const highest = Math.max(0, ...existing.map(p => Number(NAME.exec(p)?.[1] ?? 0)));
  for (const change of changes) {
    if (!change.path.startsWith('migrations/')) continue;
    if (!change.status.startsWith('A')) {
      problems.push(`${change.path} already exists and can't be changed or removed. Add a new migration instead.`);
      continue;
    }
    const m = NAME.exec(change.path);
    if (!m) {
      problems.push(`${change.path} should be named like migrations/00N_what_it_adds.sql.`);
      continue;
    }
    if (Number(m[1]) <= highest) {
      problems.push(`${change.path} must be numbered after the newest live migration (${String(highest).padStart(3, '0')}).`);
    }
    const sql = stripComments(added[change.path] ?? '');
    for (const [pattern, what] of FORBIDDEN) {
      if (pattern.test(sql)) problems.push(`${change.path} ${what}. Migrations may only add tables, columns, indexes or rows.`);
    }
  }
  return problems;
}

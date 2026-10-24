// Keeps an agent's file tools inside its sprout's work folder. The Bash tool is
// confined separately by the Claude Code sandbox; this covers Read, Write,
// Edit, Glob, Grep and friends, which the sandbox does not.

import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const PATH_PARAMS: Record<string, string[]> = {
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Glob: ['path', 'pattern'],
  Grep: ['path'],
};

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Resolve symlinks for the deepest existing ancestor so links can't point outside. */
function real(p: string): string {
  let probe = p;
  const rest: string[] = [];
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return p;
    rest.unshift(probe.slice(parent.length + 1));
    probe = parent;
  }
  return [realpathSync(probe), ...rest].join(sep);
}

export function inside(root: string, target: string): boolean {
  const rel = relative(real(root), real(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * @param root     the folder the agent works in
 * @param liveRoot the live copy; migrations that exist there are frozen
 */
export function checkToolUse(tool: string, input: Record<string, unknown>, root: string, liveRoot?: string): Verdict {
  const params = PATH_PARAMS[tool];
  if (!params) return { ok: true };
  for (const param of params) {
    const value = input[param];
    if (typeof value !== 'string' || value === '') continue;
    // A glob pattern is only a path when it is absolute or climbs out.
    if (param === 'pattern' && !isAbsolute(value) && !value.split(/[\\/]/).includes('..')) continue;
    const target = resolve(root, value);
    if (!inside(root, target)) {
      return { ok: false, reason: `${value} is outside this sprout. Only files in ${root} can be used.` };
    }
    const parts = relative(root, target).split(sep);
    if (parts.includes('.git')) return { ok: false, reason: 'The .git folder is managed by the greenhouse.' };
    if (parts.includes('node_modules')) return { ok: false, reason: 'Dependencies are managed by the greenhouse and cannot be changed.' };
    if (WRITE_TOOLS.has(tool) && parts[0] === 'migrations' && liveRoot && existsSync(resolve(liveRoot, ...parts))) {
      return { ok: false, reason: 'Existing migrations can never change. Add a new numbered file instead.' };
    }
  }
  return { ok: true };
}

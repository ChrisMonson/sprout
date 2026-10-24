import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const AUTHOR = {
  GIT_AUTHOR_NAME: 'Sprout',
  GIT_AUTHOR_EMAIL: 'sprout@localhost',
  GIT_COMMITTER_NAME: 'Sprout',
  GIT_COMMITTER_EMAIL: 'sprout@localhost',
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    env: { ...process.env, ...AUTHOR, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function head(cwd: string): Promise<string> {
  return git(cwd, 'rev-parse', 'HEAD');
}

/** True when the working tree has uncommitted changes (including untracked files). */
export async function dirty(cwd: string): Promise<boolean> {
  return (await git(cwd, 'status', '--porcelain')).length > 0;
}

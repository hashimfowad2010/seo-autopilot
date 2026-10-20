import { spawnSync } from 'node:child_process';

function git(dir, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', ...opts });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() || r.error?.message || '' };
}

export const isGitRepo = (dir) => git(dir, ['rev-parse', '--is-inside-work-tree']).out === 'true';
export const currentBranch = (dir) => git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out || null;

export function lastCommitDate(dir, file) {
  const r = git(dir, ['log', '-1', '--format=%cI', '--', file]);
  return r.ok && r.out ? r.out.slice(0, 10) : null;
}

// Commit only the given files, then push. Push inherits the terminal so credential prompts work.
export function commitAndPush(dir, files, message) {
  let r = git(dir, ['add', '--', ...files]);
  if (!r.ok) return { ok: false, error: `git add failed: ${r.err}` };
  r = git(dir, ['commit', '-m', message, '--', ...files]);
  if (!r.ok && !/nothing (added )?to commit/i.test(r.out + r.err)) return { ok: false, error: `git commit failed: ${r.err || r.out}` };
  const push = spawnSync('git', ['push'], { cwd: dir, stdio: 'inherit' });
  if (push.status !== 0) return { ok: false, error: 'git push failed (see the message above)' };
  return { ok: true };
}

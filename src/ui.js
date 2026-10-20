import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { stdin, stdout } from 'node:process';

const useColor = stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { bold: wrap(1), dim: wrap(2), red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34), cyan: wrap(36) };

// Lines are queued so answers typed or piped ahead of a question are never lost.
let rl = null;
let closed = false;
const lines = [];
const waiters = [];
function readLine(text) {
  if (!rl) {
    rl = readline.createInterface({ input: stdin, output: stdout });
    rl.on('line', (l) => (waiters.length ? waiters.shift()(l) : lines.push(l)));
    rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(''); });
    rl.on('SIGINT', () => { stdout.write('\n'); process.exit(130); });
  }
  if (closed) { stdout.write(`${text}\n`); return Promise.resolve(lines.shift() ?? ''); }
  rl.setPrompt(text);
  rl.prompt();
  if (lines.length) {
    const l = lines.shift();
    if (!stdin.isTTY) stdout.write(`${l}\n`);
    return Promise.resolve(l);
  }
  return new Promise((resolve) => waiters.push(resolve));
}
export function closePrompts() {
  rl?.close();
  rl = null;
}

export async function ask(question, def = '') {
  const suffix = def ? c.dim(` (${def})`) : '';
  const answer = (await readLine(`${c.cyan('?')} ${question}${suffix} `)).trim();
  return answer || def;
}

export async function confirm(question, def = true) {
  const answer = (await readLine(`${c.cyan('?')} ${question} ${c.dim(def ? '(Y/n)' : '(y/N)')} `)).trim().toLowerCase();
  return answer ? answer.startsWith('y') : def;
}

export const log = {
  step: (s) => console.log(`\n${c.bold(c.blue('▸'))} ${c.bold(s)}`),
  ok: (s) => console.log(`  ${c.green('✓')} ${s}`),
  warn: (s) => console.log(`  ${c.yellow('!')} ${s}`),
  err: (s) => console.log(`  ${c.red('✗')} ${s}`),
  info: (s) => console.log(`  ${c.dim('·')} ${s}`),
};

export function progress(text) {
  if (!stdout.isTTY) return;
  const max = (stdout.columns || 80) - 4;
  stdout.write(`\r\x1b[K  ${c.dim(text.length > max ? text.slice(0, max - 1) + '…' : text)}`);
}
export function progressDone() {
  if (stdout.isTTY) stdout.write('\r\x1b[K');
}

// Open a URL in the default browser without going through a shell (OAuth URLs contain '&').
export function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

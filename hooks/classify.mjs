// Which shell commands the guard denies outright. `classify` is the whole interface: a PreToolUse event in, the
// verdicts out, one per catastrophic simple command. Three kinds, read from plain, common command text only:
//   - a recursive delete of the filesystem root, a system directory or the home directory
//   - deleting the remote main or master branch
//   - force-pushing the remote main or master branch
// It reads the words as written. A command hidden behind a variable, an interpreter (`bash -c`, `pwsh -Command`,
// `eval`), a subshell or a pipe is not looked for: the guard is a seat belt for the obvious line, not a sandbox.
// Every verdict carries `deny: true`, and decision.mjs denies it. Nothing outside the guard reads these verdicts.
// Everything else gets no verdict and is left to Claude Code's own permission settings.
import { homedir } from 'node:os';
import { parse, unwrap, commandName } from './shell.mjs';

const verdict = (detail, consequence) => ({ category: 'catastrophic', deny: true, detail, consequence });

/**
 * @param {{tool_name: string, tool_input?: object}} event
 * @returns {Array<{category: 'catastrophic', deny: boolean, detail: string, consequence: string}>}
 */
export function classify(event) {
  const tool = event.tool_name || '';
  if (tool !== 'Bash' && tool !== 'PowerShell') return [];
  const command = String(event.tool_input?.command || '');
  const out = [];
  for (const seg of parse(command, tool === 'PowerShell' ? 'powershell' : 'bash')) {
    const { argv } = unwrap(seg.argv);
    const name = commandName(argv[0]);
    const args = argv.slice(1);
    const line = argv.join(' ');
    const hit = name === 'git' ? gitRule(args, line) : DELETERS.has(name) ? deleteRule(name, args, line) : null;
    if (hit) out.push(hit);
  }
  return out;
}

// ---------- recursive deletes ----------

// `/d/code/x` (Git Bash) and `D:\code\x` compare equal; trailing slashes and a trailing `/*` do not matter.
const normalize = (p) =>
  p.replace(/\\/g, '/').replace(/^\/([a-z])(\/|$)/i, '$1:/').replace(/\/\*$/, '').replace(/\/+$/, '').toLowerCase();

const HOME_WORDS = /^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|\$env:home|%userprofile%)$/i;
const SYSTEM_WORDS = /^(\$env:systemroot|\$env:windir|%systemroot%|%windir%|\$env:programfiles|%programfiles%|\$env:programdata|%programdata%)$/i;
const UNIX_SYSTEM = ['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'lib32', 'lib64', 'opt', 'proc', 'root', 'run', 'sbin', 'srv', 'sys', 'usr', 'var', 'users', 'system', 'library', 'applications', 'private'];
const WINDOWS_SYSTEM = ['windows', 'program files', 'program files (x86)', 'programdata', 'users'];

/** What a recursive delete of `target` would wipe, or null when it is none of the three. */
export function catastrophicTarget(target) {
  const t = normalize(target.replace(/^[\\/]{2}[?.][\\/]/, '').replace(/,$/, ''));
  if (t === '' || t === '/' || /^[a-z]:$/.test(t)) return '檔案系統根目錄';
  if (HOME_WORDS.test(t) || t === normalize(homedir())) return '家目錄';
  if (SYSTEM_WORDS.test(t)) return '系統目錄';
  const unix = /^\/([^/]+)$/.exec(t);
  if (unix && UNIX_SYSTEM.includes(unix[1])) return '系統目錄';
  const win = /^[a-z]:\/([^/]+)$/.exec(t);
  if (win && (WINDOWS_SYSTEM.includes(win[1]) || UNIX_SYSTEM.includes(win[1]))) return '系統目錄';
  return null;
}

const DELETERS = new Set(['rm', 'rd', 'rmdir', 'del', 'erase', 'remove-item', 'ri']);
const shortFlags = (args) => new Set(args.filter((a) => /^-[a-z]+$/i.test(a)).flatMap((a) => [...a.slice(1)]));
const hasLong = (args, ...names) => args.some((a) => names.some((n) => a === n || a.startsWith(n + '=')));
const positionals = (args, valued = new Set()) => {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '--') return out.concat(args.slice(k + 1));
    if (args[k].startsWith('-')) {
      if (valued.has(args[k])) k++;
    } else out.push(args[k]);
  }
  return out;
};

function deleteRule(name, args, line) {
  let recursive;
  let targets;
  if (name === 'rm') {
    recursive = shortFlags(args).has('r') || shortFlags(args).has('R') || hasLong(args, '--recursive');
    targets = positionals(args);
  } else if (name === 'rd' || name === 'rmdir' || name === 'del' || name === 'erase') {
    // cmd: `rd /s /q C:\`; PowerShell aliases them to Remove-Item, which takes `-Recurse`.
    recursive = args.some((a) => /^\/s$/i.test(a)) || args.some((a) => /^-r(e(c(u(r(se?)?)?)?)?)?$/i.test(a));
    targets = args.filter((a) => !/^\/[a-z]$/i.test(a) && !a.startsWith('-'));
  } else {
    recursive = args.some((a) => /^-r(e(c(u(r(se?)?)?)?)?)?$/i.test(a));
    const path = args.findIndex((a) => /^-(path|literalpath|lp)$/i.test(a));
    targets = path !== -1 ? [args[path + 1] ?? ''] : positionals(args, new Set(['-Include', '-Exclude', '-Filter']));
  }
  if (!recursive) return null;
  const hits = targets.map((t) => [t, catastrophicTarget(t)]).filter(([, what]) => what);
  if (!hits.length) return null;
  return verdict(line, `遞迴刪除${hits.map(([t, what]) => `${what} ${t}`).join('、')}：不經資源回收筒，無法復原。`);
}

// ---------- git push to main / master ----------

const GIT_GLOBAL_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix']);
const PUSH_VALUED = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const MAIN = /^(refs\/heads\/)?(main|master)$/;

function gitRule(args, line) {
  let k = 0;
  while (k < args.length && args[k].startsWith('-')) k += GIT_GLOBAL_VALUED.has(args[k]) ? 2 : 1;
  if (args[k] !== 'push') return null;
  const rest = args.slice(k + 1);
  const flags = shortFlags(rest.filter((a, j) => !PUSH_VALUED.has(rest[j - 1])));
  const force = flags.has('f') || hasLong(rest, '--force', '--force-with-lease', '--force-if-includes');
  const deleting = flags.has('d') || hasLong(rest, '--delete');
  const [, ...refspecs] = positionals(rest, PUSH_VALUED);
  const dst = (r) => {
    const s = r.replace(/^\+/, '');
    return (s.includes(':') ? s.slice(s.lastIndexOf(':') + 1) : s).replace(/^refs\/heads\//, '');
  };
  const mains = (pick) => [...new Set(refspecs.filter(pick).map(dst).filter((b) => MAIN.test(b)))];
  const deleted = mains((r) => deleting || r.startsWith(':'));
  if (deleted.length) return verdict(line, `刪除遠端的 ${deleted.join('、')} 分支：分支上的歷史與以它為基底的 PR 都會失去依靠。`);
  if (deleting) return null;
  const forced = mains((r) => force || r.startsWith('+'));
  if (forced.length) return verdict(line, `強制推送遠端的 ${forced.join('、')} 分支：改寫共享歷史，其他人的 commit 可能遺失。`);
  return null;
}

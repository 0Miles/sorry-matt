// Which tool calls are permanent exceptions (ASKING.md section 5), which ones land changes on a
// protected branch around `gh pr merge`, and which ones merge a PR. `classify` is the whole
// interface: a PreToolUse event in, a verdict out. Whether a verdict is denied is decision.mjs's call.
import { tmpdir, homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, unwrap, commandName } from './shell.mjs';

export const CATEGORIES = {
  'force-push': 'force-push',
  merge: 'merging a pull request',
  'merge-bypass': 'landing changes on a protected branch outside `gh pr merge`',
  'outgoing-message': 'outgoing message',
  'install-or-clone': 'installing a package or cloning',
  credentials: 'touching credentials or secrets',
  'irrecoverable-delete': 'deleting data that cannot be recovered',
  payments: 'payments',
  permissions: 'changing permissions',
  production: 'changing production',
};

const hit = (category, detail) => ({ category, detail });

/**
 * @param {{tool_name: string, tool_input?: object, cwd?: string}} event
 * @returns {{category: keyof CATEGORIES, detail: string} | null}
 */
export function classify(event) {
  const tool = event.tool_name || '';
  const input = event.tool_input || {};
  const cwd = event.cwd || process.cwd();
  if (tool === 'Bash' || tool === 'PowerShell') {
    return classifyCommand(String(input.command || ''), tool === 'PowerShell' ? 'powershell' : 'bash', cwd);
  }
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep'].includes(tool)) {
    const path = String(input.file_path || input.notebook_path || input.path || '');
    if (path && isSecretPath(path)) return hit('credentials', `${tool} ${path}`);
    if (path && tool !== 'Read' && tool !== 'Grep' && isClaudeSettings(path)) return hit('permissions', `${tool} ${path}`);
    return null;
  }
  if (tool.startsWith('mcp__')) return classifyMcp(tool, input);
  return null;
}

// ---------- paths ----------

const SSH_PUBLIC = new Set(['known_hosts', 'known_hosts.old', 'config', 'authorized_keys']);

export function isSecretPath(path) {
  const p = path.replace(/\\/g, '/').toLowerCase();
  const base = p.split('/').pop();
  if (/^\.env(\..+)?$/.test(base)) return !/\.(example|sample|template|dist|defaults?)$/.test(base);
  if (/\.(key|p12|pfx|jks|keystore|ppk)$/.test(base)) return true;
  if (/(^|[-_.])(privkey|private|private[-_]key|key)\.pem$/.test(base)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/.test(base)) return true;
  if (['.netrc', '_netrc', '.git-credentials', '.pgpass', '.pypirc', '.credentials.json', 'application_default_credentials.json'].includes(base)) return true;
  if (/(^|\/)\.ssh\//.test(p)) return !base.endsWith('.pub') && !SSH_PUBLIC.has(base);
  if (/(^|\/)\.(aws\/credentials|docker\/config\.json|kube\/config)$/.test(p)) return true;
  return /(^|\/)\.gnupg\//.test(p);
}

export const isClaudeSettings = (path) =>
  /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/i.test(path) || /(^|[\\/])managed-settings\.json$/i.test(path);

// `/d/code/x` (Git Bash) and `D:\code\x` compare equal.
const normalizePath = (p) =>
  p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase();
const isAbsolute = (p) => /^(\/|[a-z]:[\\/])/i.test(p);
const isUnder = (child, parent) => {
  const [c, q] = [normalizePath(child), normalizePath(parent)];
  return q !== '' && (c === q || c.startsWith(q + '/'));
};
const TEMP_DIRS = () => [tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR, '/tmp', '/var/tmp'].filter(Boolean);

// A recursive delete aimed at a home, a root, a parent, or a wildcard of everything, or at an
// absolute path outside the working directory and the temp directories.
function dangerousDeleteTarget(target, cwd) {
  const t = target.replace(/\\/g, '/');
  if (/^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|%userprofile%)(\/\*?)?$/i.test(t)) return true;
  if (/^(\/|\/\*|\*|\.|\.\/|\.\/\*|\.\.|\.\.\/.*|[a-z]:\/?\*?)$/i.test(t)) return true;
  const path = t.replace(/^(~|\$home|\$\{home\}|\$env:userprofile)(?=\/)/i, homedir().replace(/\\/g, '/'));
  if (isAbsolute(path)) return !isUnder(path, cwd) && !TEMP_DIRS().some((d) => isUnder(path, d));
  return false;
}

// ---------- shell commands ----------

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

// The first verdict that is always denied wins over a `merge`, which is denied only in some modes.
export function classifyCommand(command, dialect, cwd) {
  const segments = parse(command, dialect);
  let merge = null;
  for (let s = 0; s < segments.length; s++) {
    const verdict = classifySegment(segments[s], segments[s - 1], cwd);
    if (verdict?.category === 'merge') merge ??= verdict;
    else if (verdict) return verdict;
  }
  return merge;
}

const READERS = new Set(['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'less', 'more', 'jq', 'grep', 'rg', 'findstr', 'select-string', 'sls', 'wc', 'bat', 'ls', 'dir', 'stat', 'test', '[', 'diff']);
const DATA_WRITERS = new Set(['echo', 'printf', 'write-output', 'write-host']);
const PROD = /(^|[^a-z0-9])(prod|production|prd)([^a-z0-9]|$)/i;
const READ_ONLY_VERB = /^(get|describe|logs?|list|ls|show|status|top|explain|version|view|info|whoami|history|diff|plan|help|cat|tail|validate)([-_].*)?$/i;
const DEPLOY_TOOLS = new Set(['kubectl', 'helm', 'gcloud', 'aws', 'az', 'fly', 'flyctl', 'heroku', 'vercel', 'netlify', 'firebase', 'wrangler', 'serverless', 'sls', 'eb', 'ansible', 'ansible-playbook', 'kamal', 'cap', 'ssh', 'scp', 'rsync']);
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'mongosh', 'mongo', 'redis-cli', 'clickhouse-client', 'cockroach']);
const SQL_DESTROY = /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?\w)|\bflush(all|db)\b|dropDatabase\s*\(/i;
const SQL_WRITE = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|merge)\b/i;
const FETCHERS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm']);
const MAILERS = new Set(['sendmail', 'mail', 'mailx', 'mutt', 'msmtp', 'ssmtp', 'swaks', 'send-mailmessage']);
const SHELL_SINKS = new Set(['sh', 'bash', 'zsh', 'dash', 'iex', 'invoke-expression', 'pwsh', 'powershell', 'python', 'python3', 'node']);

function classifySegment(seg, prev, cwd) {
  const { argv, wrappers } = unwrap(seg.argv);
  const words = seg.argv.join(' ');
  const elevated = wrappers.find((w) => w === 'sudo' || w === 'doas');
  if (!argv.length) return elevated ? hit('permissions', seg.argv.join(' ')) : redirectVerdict(seg);
  const name = commandName(argv[0]);
  const args = argv.slice(1);
  const line = argv.join(' ');

  // Output redirected into a protected file, whatever the command.
  const redirected = redirectVerdict(seg);
  if (redirected) return redirected;

  // Fetch-and-run: `curl ... | sh`.
  if (SHELL_SINKS.has(name) && seg.op === '|' && FETCHERS.has(commandName(unwrap(prev.argv).argv[0]))) {
    return hit('install-or-clone', `${unwrap(prev.argv).argv.join(' ')} | ${line}`);
  }

  const byTool = commandRule(name, args, line, seg, cwd);
  if (byTool) return byTool;

  // Any argument naming a secret file, except text being printed.
  if (!DATA_WRITERS.has(name)) {
    const secret = args.find((a) => !/\s/.test(a) && !/^[a-z]+:\/\//i.test(a) && isSecretPath(a.replace(/^-[-\w]*=/, '')));
    if (secret) return hit('credentials', line);
  }
  // Writing Claude Code settings with anything but a reader.
  if (!READERS.has(name) && !(name === 'git' && /^(diff|log|show|status|blame|add|ls-files)$/.test(gitSub(args).sub))) {
    if (args.some((a) => isClaudeSettings(a.replace(/^-[-\w]*=/, '')))) return hit('permissions', line);
  }
  // Deploy tools pointed at production, unless the verb only reads.
  if (DEPLOY_TOOLS.has(name) && PROD.test(words)) {
    const verbs = positionals(args).slice(0, 3);
    if (name === 'ssh' || name === 'scp' || name === 'rsync' || !verbs.some((v) => READ_ONLY_VERB.test(v))) {
      return hit('production', line);
    }
  }
  if (SQL_CLIENTS.has(name)) {
    const sql = `${words}\n${seg.heredoc}\n${seg.op === '|' ? prev.argv.join(' ') : ''}`;
    if (SQL_DESTROY.test(sql)) return hit('irrecoverable-delete', line);
    if (PROD.test(words) && SQL_WRITE.test(sql)) return hit('production', line);
  }
  return elevated ? hit('permissions', seg.argv.join(' ')) : null;
}

function redirectVerdict(seg) {
  for (const target of seg.redirects) {
    if (isClaudeSettings(target)) return hit('permissions', `> ${target}`);
    if (isSecretPath(target)) return hit('credentials', `> ${target}`);
  }
  return null;
}

function commandRule(name, args, line, seg, cwd) {
  switch (name) {
    case 'git':
      return gitRule(args, line, cwd);
    case 'gh':
      return ghRule(args, line, seg);
    case 'hg':
      return args[0] === 'clone' ? hit('install-or-clone', line) : null;
    case 'svn':
      return /^(checkout|co|export)$/.test(args[0] ?? '') ? hit('install-or-clone', line) : null;
    case 'npm':
    case 'cnpm':
      if (args[0] === 'exec' || args[0] === 'x') return downloadsPackage(args.slice(1), cwd) ? hit('install-or-clone', line) : null;
      return packageRule(name, args, line, ['install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add'], [], ['publish']);
    case 'pnpm':
      if (args[0] === 'dlx') return hit('install-or-clone', line);
      return packageRule(name, args, line, ['install', 'i'], ['add'], ['publish']);
    case 'npx':
    case 'bunx':
      return downloadsPackage(args, cwd) ? hit('install-or-clone', line) : null;
    case 'uvx':
      return hit('install-or-clone', line);
    case 'yarn':
      if ((args[0] === 'global' && args[1] === 'add') || args[0] === 'dlx') return hit('install-or-clone', line);
      return packageRule(name, args, line, ['install'], ['add'], ['publish', 'npm']);
    case 'bun':
      return packageRule(name, args, line, ['install', 'i'], ['add', 'a'], ['publish']);
    case 'pip':
    case 'pip3':
      return pipRule(args, line);
    case 'python':
    case 'python3':
    case 'py': {
      const m = args.indexOf('-m');
      if (m !== -1 && /^pip3?$/.test(args[m + 1] ?? '')) return pipRule(args.slice(m + 2), line);
      return null;
    }
    case 'uv':
      if (args[0] === 'pip') return pipRule(args.slice(1), line);
      if (args[0] === 'add' || (args[0] === 'tool' && /^(install|run)$/.test(args[1] ?? ''))) return hit('install-or-clone', line);
      return null;
    case 'pipx':
      return args[0] === 'install' || args[0] === 'run' ? hit('install-or-clone', line) : null;
    case 'cargo':
      if (args[0] === 'add' || (args[0] === 'install' && !hasLong(args, '--path'))) return hit('install-or-clone', line);
      return args[0] === 'publish' ? hit('production', line) : null;
    case 'gem':
      if (args[0] === 'install') return hit('install-or-clone', line);
      return args[0] === 'push' ? hit('production', line) : null;
    case 'go':
      if (args[0] === 'get') return hit('install-or-clone', line);
      return args[0] === 'install' && positionals(args.slice(1)).some((p) => !p.startsWith('.')) ? hit('install-or-clone', line) : null;
    case 'poetry':
    case 'pdm':
    case 'bundle':
      return args[0] === 'add' ? hit('install-or-clone', line) : null;
    case 'conda':
    case 'mamba':
    case 'brew':
    case 'apt':
    case 'apt-get':
    case 'yum':
    case 'dnf':
    case 'zypper':
    case 'snap':
    case 'winget':
    case 'choco':
    case 'scoop':
    case 'port':
    case 'apk':
      return ['install', 'add', 'reinstall', 'upgrade'].includes(positionals(args)[0]) ? hit('install-or-clone', line) : null;
    case 'pacman':
      return /^-S[a-z]*$/.test(args[0] ?? '') && !/^-S[sig]/.test(args[0]) ? hit('install-or-clone', line) : null;
    case 'composer':
      return args[0] === 'require' ? hit('install-or-clone', line) : null;
    case 'dotnet':
      if ((args[0] === 'add' && args.includes('package')) || (args[0] === 'tool' && args[1] === 'install')) return hit('install-or-clone', line);
      return args[0] === 'nuget' && args[1] === 'push' ? hit('production', line) : null;
    case 'install-module':
    case 'install-package':
    case 'install-script':
      return hit('install-or-clone', line);
    case 'code':
      return hasLong(args, '--install-extension') ? hit('install-or-clone', line) : null;
    case 'claude':
      if ((args[0] === 'plugin' || args[0] === 'plugins') && (args[1] === 'install' || (args[1] === 'marketplace' && args[2] === 'add'))) return hit('install-or-clone', line);
      return args[0] === 'mcp' && args[1]?.startsWith('add') ? hit('install-or-clone', line) : null;
    case 'twine':
      return args[0] === 'upload' ? hit('production', line) : null;
    case 'vsce':
      return args[0] === 'publish' ? hit('production', line) : null;
    case 'terraform':
    case 'tofu':
    case 'terragrunt':
      return ['apply', 'destroy', 'import', 'taint'].includes(args[0]) || (args[0] === 'state' && /^(rm|mv|push)$/.test(args[1] ?? '')) ? hit('production', line) : null;
    case 'pulumi':
      return ['up', 'update', 'destroy'].includes(args[0]) ? hit('production', line) : null;
    case 'rm':
    case 'remove-item':
    case 'ri':
    case 'rd':
    case 'rmdir':
    case 'del':
    case 'erase':
      return deleteRule(name, args, line, cwd);
    case 'dropdb':
    case 'diskpart':
      return hit('irrecoverable-delete', line);
    case 'dd':
      return args.some((a) => /^of=\/dev\//.test(a)) ? hit('irrecoverable-delete', line) : null;
    case 'format':
      return args.some((a) => /^[a-z]:$/i.test(a)) ? hit('irrecoverable-delete', line) : null;
    case 'stripe':
      return args.some((a) => /^(create|update|delete|confirm|capture|pay|cancel|refund|void|finalize|send|post)$/.test(a)) ? hit('payments', line) : null;
    case 'chmod':
      return args.some((a) => /^[0-7]?777$|^[ugoa]*\+[rwxt]*s|^[oa]\+[rxt]*w/.test(a)) ? hit('permissions', line) : null;
    case 'chown':
    case 'chgrp':
    case 'takeown':
    case 'set-acl':
    case 'setfacl':
    case 'su':
    case 'runas':
      return hit('permissions', line);
    case 'icacls':
      return args.some((a) => /^\/(grant|deny|setowner|reset|remove|setintegritylevel)/i.test(a)) ? hit('permissions', line) : null;
    case 'start-process':
      return args.some((a) => /^runas$/i.test(a)) ? hit('permissions', line) : null;
    case 'ssh-keygen':
    case 'ssh-add':
    case 'cmdkey':
    case 'op':
    case 'bw':
    case 'get-secret':
      return hit('credentials', line);
    case 'security':
      return /^(find-.*-password|dump-keychain|export)$/.test(args[0] ?? '') ? hit('credentials', line) : null;
    case 'gpg':
      return hasLong(args, '--export-secret-keys', '--export-secret-subkeys') ? hit('credentials', line) : null;
    case 'vault':
      return /^(read|kv|token|login)$/.test(args[0] ?? '') ? hit('credentials', line) : null;
    case 'gcloud':
      return args[0] === 'auth' && /^(print-.*|login|application-default)$/.test(args[1] ?? '') ? hit('credentials', line) : null;
    case 'az':
      return args.includes('get-access-token') ? hit('credentials', line) : null;
    case 'docker':
      return args[0] === 'login' ? hit('credentials', line) : null;
    default:
      break;
  }
  if (MAILERS.has(name)) return hit('outgoing-message', line);
  if (/^mkfs/.test(name)) return hit('irrecoverable-delete', line);
  if (FETCHERS.has(name)) return fetchRule(args, line);
  return null;
}

// npm/pnpm/yarn/bun: restoring from the lockfile is fine; naming a package, or a global install, is not.
const PACKAGE_VALUED = new Set(['--registry', '--prefix', '--workspace', '-w', '--omit', '--include', '--cache', '--userconfig', '--tag', '--loglevel', '--filter', '--cwd', '-C', '--dir']);
function packageRule(name, args, line, installs, adds, publishes) {
  const sub = args[0] ?? '';
  const rest = args.slice(1);
  if (publishes.includes(sub)) return hit('production', line);
  if (adds.includes(sub)) return hit('install-or-clone', line);
  if (installs.includes(sub)) {
    const global = shortFlags(rest).has('g') || hasLong(rest, '--global') || rest.includes('--location=global');
    if (global || positionals(rest, PACKAGE_VALUED).length) return hit('install-or-clone', line);
  }
  return null;
}

// `npx`/`bunx`/`npm exec` run a bin from node_modules when the project has it, and download the
// package otherwise. `--package`/`-p` always names a package to fetch.
const NPX_VALUED = new Set(['-c', '--call', '--prefix', '--workspace', '-w', '--registry', '--cache']);
function downloadsPackage(args, cwd) {
  if (args.some((a) => a === '-p' || a.startsWith('--package'))) return true;
  const target = positionals(args, NPX_VALUED)[0];
  if (!target) return false;
  if (/^(\.|\/|[a-z]:[\\/])/i.test(target)) return false; // a local path
  // `pkg`, `@scope/pkg`: run the local bin if there is one. A version (`pkg@2`), URL, or git spec downloads.
  const m = /^(?:@[\w.-]+\/)?([\w.-]+)$/.exec(target);
  if (!m) return true;
  const bin = m[1];
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (['', '.cmd', '.ps1'].some((ext) => existsSync(join(dir, 'node_modules', '.bin', bin + ext)))) return false;
    if (dirname(dir) === dir) return true;
  }
}

const PIP_VALUED = new Set(['-r', '--requirement', '-c', '--constraint', '-e', '--editable', '-i', '--index-url', '--extra-index-url', '-t', '--target', '--prefix', '-f', '--find-links', '--root', '--python']);
function pipRule(args, line) {
  if (args[0] !== 'install') return null;
  const packages = positionals(args.slice(1), PIP_VALUED).filter((p) => !/^(\.|\/|[a-z]:[\\/])/i.test(p) && !/\.(whl|tar\.gz|zip)$/i.test(p));
  return packages.length ? hit('install-or-clone', line) : null;
}

function deleteRule(name, args, line, cwd) {
  let recursive;
  let targets;
  if (name === 'rm') {
    recursive = shortFlags(args).has('r') || shortFlags(args).has('R') || hasLong(args, '--recursive');
    targets = positionals(args);
  } else if (name === 'rd' || name === 'rmdir' || name === 'del' || name === 'erase') {
    recursive = args.some((a) => /^\/s$/i.test(a)) || args.some((a) => /^-r(ecurse)?$/i.test(a));
    targets = args.filter((a) => !a.startsWith('/') || isAbsolute(a)).filter((a) => !/^\/[a-z]$/i.test(a) && !a.startsWith('-'));
  } else {
    recursive = args.some((a) => /^-r(e(c(u(r(se?)?)?)?)?)?$/i.test(a));
    const path = args.findIndex((a) => /^-(path|literalpath|lp)$/i.test(a));
    targets = path !== -1 ? [args[path + 1] ?? ''] : positionals(args, new Set(['-Include', '-Exclude', '-Filter']));
  }
  if (!recursive) return null;
  return targets.some((t) => dangerousDeleteTarget(t.replace(/,$/, ''), cwd)) ? hit('irrecoverable-delete', line) : null;
}

// ---------- git ----------

const GIT_GLOBAL_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix']);
function gitSub(args) {
  let k = 0;
  while (k < args.length && args[k].startsWith('-')) k += GIT_GLOBAL_VALUED.has(args[k]) ? 2 : 1;
  return { sub: args[k] ?? '', rest: args.slice(k + 1) };
}

const PROTECTED_BRANCH = /^(refs\/heads\/)?(main|master)$/;

const git = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch {
    return '';
  }
};
// main, master, and the remote's default branch when the clone knows it.
function protectedBranches(dir, remote) {
  const names = new Set(['main', 'master']);
  if (/^[\w.-]+$/.test(remote || 'origin')) {
    const head = git(dir, 'symbolic-ref', '--short', '-q', `refs/remotes/${remote || 'origin'}/HEAD`);
    if (head) names.add(head.slice(head.indexOf('/') + 1));
  }
  return names;
}
// The directory git runs in: `-C` options resolve against the event's cwd.
function gitDir(args, cwd) {
  let dir = cwd;
  for (let k = 0; k < args.length && args[k].startsWith('-'); k++) {
    if (args[k] === '-C') dir = resolve(dir, args[++k] ?? '');
    else if (GIT_GLOBAL_VALUED.has(args[k])) k++;
  }
  return dir;
}
const PUSH_VALUED = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

function gitRule(args, line, cwd) {
  const { sub, rest } = gitSub(args);
  switch (sub) {
    case 'push': {
      const flags = shortFlags(rest.filter((a, k) => !PUSH_VALUED.has(rest[k - 1])));
      if (flags.has('f') || hasLong(rest, '--force', '--force-with-lease', '--force-if-includes', '--mirror')) return hit('force-push', line);
      const [remote, ...refspecs] = positionals(rest, PUSH_VALUED);
      if (refspecs.some((r) => r.startsWith('+'))) return hit('force-push', line);
      const dir = gitDir(args, cwd);
      const branches = protectedBranches(dir, remote);
      const isProtected = (ref) => branches.has(ref.replace(/^refs\/heads\//, ''));
      const dst = (r) => (r.includes(':') ? r.slice(r.lastIndexOf(':') + 1) : r);
      const deleting = flags.has('d') || hasLong(rest, '--delete');
      if (refspecs.some((r) => (deleting || r.startsWith(':')) && isProtected(dst(r)))) return hit('irrecoverable-delete', line);
      if (deleting) return null;
      if (hasLong(rest, '--all', '--branches')) return hit('merge-bypass', line);
      // No refspec pushes the current branch; `HEAD` and `@` name it too.
      const current = () => git(dir, 'symbolic-ref', '--short', '-q', 'HEAD');
      const targets = refspecs.length ? refspecs.map(dst) : hasLong(rest, '--tags') ? [] : ['HEAD'];
      const named = targets.map((t) => (t === 'HEAD' || t === '@' ? current() : t));
      return named.some((t) => t && isProtected(t)) ? hit('merge-bypass', line) : null;
    }
    case 'clone':
      return hit('install-or-clone', line);
    case 'submodule':
      return rest[0] === 'add' ? hit('install-or-clone', line) : null;
    case 'reset':
      return hasLong(rest, '--hard') ? hit('irrecoverable-delete', line) : null;
    case 'clean': {
      const dry = shortFlags(rest).has('n') || hasLong(rest, '--dry-run');
      return !dry && (shortFlags(rest).has('f') || hasLong(rest, '--force')) ? hit('irrecoverable-delete', line) : null;
    }
    case 'stash':
      return rest[0] === 'drop' || rest[0] === 'clear' ? hit('irrecoverable-delete', line) : null;
    case 'reflog':
      return rest[0] === 'expire' || rest[0] === 'delete' ? hit('irrecoverable-delete', line) : null;
    case 'gc':
      return rest.some((a) => /^--prune=(now|all)$/.test(a)) ? hit('irrecoverable-delete', line) : null;
    case 'filter-branch':
    case 'filter-repo':
      return hit('irrecoverable-delete', line);
    case 'credential':
    case 'credential-manager':
    case 'credential-manager-core':
      return hit('credentials', line);
    case 'config': {
      const reading = rest.some((a) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(a) || a === 'get' || a === 'list');
      return !reading && rest.some((a) => /^credential\./i.test(a)) ? hit('credentials', line) : null;
    }
    default:
      return null;
  }
}

// ---------- gh and HTTP APIs ----------

const GH_API_VALUED = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache']);
const GH_API_FIELD = new Set(['-f', '-F', '--field', '--raw-field']);

function ghRule(args, line, seg) {
  const [group, verb, ...rest] = args;
  const all = args.slice(1);
  switch (group) {
    case 'api':
      return ghApi(args.slice(1), line, seg);
    case 'pr':
      if (verb !== 'merge') return null;
      return hasLong(rest, '--admin') ? hit('merge-bypass', line) : hit('merge', line);
    case 'repo':
      if (verb === 'clone' || (verb === 'fork' && hasLong(rest, '--clone') && !rest.includes('--clone=false'))) return hit('install-or-clone', line);
      if (verb === 'delete') return hit('irrecoverable-delete', line);
      if (verb === 'edit' && hasLong(rest, '--visibility')) return hit('permissions', line);
      return null;
    case 'release':
      return verb === 'delete' || verb === 'delete-asset' ? hit('irrecoverable-delete', line) : null;
    case 'issue':
      return verb === 'delete' ? hit('irrecoverable-delete', line) : null;
    case 'secret':
      return /^(set|delete|remove)$/.test(verb ?? '') ? hit('credentials', line) : null;
    case 'auth':
      return /^(token|login|logout|refresh|setup-git|switch)$/.test(verb ?? '') ? hit('credentials', line) : null;
    case 'ssh-key':
    case 'gpg-key':
      return /^(add|delete)$/.test(verb ?? '') ? hit('credentials', line) : null;
    case 'extension':
    case 'ext':
      return verb === 'install' ? hit('install-or-clone', line) : null;
    case 'workflow':
      return verb === 'run' && PROD.test(all.join(' ')) ? hit('production', line) : null;
    default:
      return null;
  }
}

function ghApi(args, line, seg) {
  let method = '';
  let endpoint = '';
  let hasBody = false;
  const body = [seg.heredoc];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    const eq = /^(--method|--field|--raw-field|--input)=(.*)$/.exec(a);
    if (a === '-X' || a === '--method') method = args[++k] ?? '';
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (eq?.[1] === '--method') method = eq[2];
    else if (GH_API_FIELD.has(a)) {
      body.push(args[++k] ?? '');
      hasBody = true;
    } else if (eq) {
      body.push(eq[2]);
      hasBody = true;
    } else if (/^-[fF]./.test(a)) {
      body.push(a.slice(2));
      hasBody = true;
    } else if (a === '--input') {
      k++;
      hasBody = true;
    } else if (GH_API_VALUED.has(a)) k++;
    else if (!a.startsWith('-') && !endpoint) endpoint = a;
  }
  method = (method || (hasBody ? 'POST' : 'GET')).toUpperCase();
  return apiRule(method, endpoint, body.join('\n'), line);
}

const OWNER_REPO = 'repos/[^/]+/[^/]+';
const PERMISSION_PATHS = new RegExp(`^${OWNER_REPO}/(collaborators|invitations|branches/.+/protection|rulesets|actions/permissions|hooks|keys|teams|environments)(/|$)|^orgs/[^/]+/(members|memberships|teams|outside_collaborators|invitations)(/|$)`);
const SECRET_PATHS = new RegExp(`^${OWNER_REPO}/((actions|dependabot|codespaces)/secrets|environments/[^/]+/secrets)(/|$)|^orgs/[^/]+/(actions|dependabot|codespaces)/secrets(/|$)|^user/codespaces/secrets(/|$)`);

// One GitHub REST or GraphQL call, from `gh api` or from curl.
export function apiRule(method, rawEndpoint, body, line) {
  const endpoint = rawEndpoint.replace(/^https?:\/\/api\.github\.com/i, '').replace(/^\/+/, '').replace(/[?#].*$/, '');
  const reading = method === 'GET' || method === 'HEAD';
  if (new RegExp(`^${OWNER_REPO}/pulls/[^/]+/merge$`).test(endpoint) && !reading) return hit('merge-bypass', line);
  if (new RegExp(`^${OWNER_REPO}/merges$`).test(endpoint) && !reading) return hit('merge-bypass', line);
  if (endpoint === 'graphql') {
    if (/\b(mergePullRequest|enablePullRequestAutoMerge|mergeBranch)\b/.test(body)) return hit('merge-bypass', line);
    if (/\b(deleteRepository|deleteIssue)\b/.test(body)) return hit('irrecoverable-delete', line);
    if (/\b(updateRefs?)\b/.test(body) && /\bforce\s*:\s*true\b/.test(body)) return hit('force-push', line);
    if (/\bcreateCommitOnBranch\b/.test(body) && /(branchName|qualifiedBranchName)["']?\s*:\s*["']?(refs\/heads\/)?(main|master)\b/.test(body)) return hit('merge-bypass', line);
    return null;
  }
  if (reading) return null;
  if (new RegExp(`^${OWNER_REPO}/git/refs/`).test(endpoint) && /\bforce["']?\s*[=:]\s*["']?true\b/.test(body)) return hit('force-push', line);
  // Writing a protected branch's ref, or committing to it through the contents API, skips the PR.
  if (new RegExp(`^${OWNER_REPO}/git/refs/heads/(main|master)$`).test(endpoint)) {
    return hit(method === 'DELETE' ? 'irrecoverable-delete' : 'merge-bypass', line);
  }
  if (new RegExp(`^${OWNER_REPO}/git/refs$`).test(endpoint) && /refs\/heads\/(main|master)\b/.test(body)) return hit('merge-bypass', line);
  if (new RegExp(`^${OWNER_REPO}/contents/`).test(endpoint)) {
    const branch = /\bbranch["']?\s*[=:]\s*["']?([\w./-]+)/.exec(body)?.[1];
    if (!branch || PROTECTED_BRANCH.test(branch)) return hit('merge-bypass', line);
  }
  if (SECRET_PATHS.test(endpoint)) return hit('credentials', line);
  if (PERMISSION_PATHS.test(endpoint)) return hit('permissions', line);
  if (new RegExp(`^${OWNER_REPO}$`).test(endpoint)) {
    if (method === 'DELETE') return hit('irrecoverable-delete', line);
    if (/\b(visibility|private)\b/.test(body)) return hit('permissions', line);
  }
  if (method === 'DELETE' && new RegExp(`^${OWNER_REPO}/releases/[^/]+$`).test(endpoint)) return hit('irrecoverable-delete', line);
  return null;
}

const MESSAGE_URL = /^(smtps?:\/\/|https?:\/\/(hooks\.slack\.com|([^/]*\.)?slack\.com\/api\/(chat\.|files\.upload|conversations\.invite)|(discord|discordapp)\.com\/api\/(.*\/)?(webhooks|messages)|api\.telegram\.org\/bot[^/]*\/send|[^/]*\.webhook\.office\.com|outlook\.office(365)?\.com\/webhook|graph\.microsoft\.com\/.*(sendmail|\/messages|\/chats)|api\.sendgrid\.com|api\.mailgun\.net|api\.postmarkapp\.com|api\.(twitter|x)\.com|graph\.facebook\.com|api\.linkedin\.com|api\.twilio\.com|gmail\.googleapis\.com\/.*\/send))/i;
const PAYMENT_URL = /^https?:\/\/(api\.stripe\.com|api(-m)?\.(sandbox\.)?paypal\.com|connect\.squareup(sandbox)?\.com|api\.wise\.com|api\.braintreegateway\.com|checkout-test\.adyen\.com|[^/]*\.adyen\.com)\//i;
const FETCH_VALUED = new Set(['-X', '--request', '-H', '--header', '-o', '--output', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-Method', '-Headers', '-OutFile', '-ContentType']);
const FETCH_BODY = /^(-d|--data|--data-raw|--data-binary|--data-urlencode|--json|-F|--form|-T|--upload-file|--post-data|--post-file|-Body|-InFile)$/i;

function fetchRule(args, line) {
  let method = '';
  const body = [];
  let hasBody = false;
  const urls = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (/^(-X|--request|-Method|--method)$/i.test(a)) method = args[++k] ?? '';
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (/^--method=/i.test(a)) method = a.slice(9);
    else if (FETCH_BODY.test(a)) {
      body.push(args[++k] ?? '');
      hasBody = true;
    } else if (/^(--data[\w-]*|--json|--post-data)=/.test(a)) {
      body.push(a.replace(/^[^=]*=/, ''));
      hasBody = true;
    } else if (/^-Uri$/i.test(a)) urls.push(args[++k] ?? '');
    else if (FETCH_VALUED.has(a)) k++;
    else if (/^(https?|smtps?):\/\//i.test(a)) urls.push(a);
    else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(a) && !a.startsWith('-')) urls.push(`https://${a}`);
  }
  method = (method || (hasBody ? 'POST' : 'GET')).toUpperCase();
  for (const url of urls) {
    if (MESSAGE_URL.test(url)) return hit('outgoing-message', line);
    if (PAYMENT_URL.test(url) && method !== 'GET') return hit('payments', line);
    if (/^https?:\/\/api\.github\.com\//i.test(url)) {
      const verdict = apiRule(method, url, body.join('\n'), line);
      if (verdict) return verdict;
    }
  }
  return null;
}

// ---------- MCP tools ----------

const MESSAGING_SERVER = /(slack|gmail|mail|outlook|discord|teams|telegram|twitter|linkedin|whatsapp|sms|twilio|sendgrid|mailgun|mastodon|bluesky|reddit|signal)/i;
const MESSAGING_ACTION = /(^|_)(send|post|reply|forward|publish|schedule|broadcast|tweet|chat_postmessage)/i;
const PAYMENT_SERVER = /(stripe|paypal|square|braintree|adyen|wise|payment|billing|checkout)/i;
const PAYMENT_ACTION = /(^|_)(create|confirm|capture|refund|pay|transfer|payout|cancel|charge|void|finalize)/i;

const GIT_SERVER = /(git|github|gitlab|bitbucket|gitea|forgejo)/i;
const MERGE_ACTION = /(^|_)merge_(pull_request|pr|request|branch)($|_)/i;
const PUSH_ACTION = /(^|_)(push_files|push|create_or_update_file|update_file|delete_file|create_commit|commit_files)($|_)/i;

function classifyMcp(tool, input = {}) {
  const [, server = '', action = ''] = /^mcp__(.+?)__(.+)$/.exec(tool) || [];
  if ((MESSAGING_SERVER.test(server) || MESSAGING_SERVER.test(action)) && MESSAGING_ACTION.test(action)) return hit('outgoing-message', tool);
  if (PAYMENT_SERVER.test(server) && PAYMENT_ACTION.test(action)) return hit('payments', tool);
  // Merges go through `gh pr merge` only; pushes may not land on a protected branch.
  if (MERGE_ACTION.test(action) || (GIT_SERVER.test(server) && /(^|_)merge($|_)/i.test(action))) return hit('merge-bypass', tool);
  if (GIT_SERVER.test(server) && PUSH_ACTION.test(action)) {
    const branch = String(input.branch || input.ref || '');
    if (!branch || PROTECTED_BRANCH.test(branch)) return hit('merge-bypass', `${tool} ${branch || '(default branch)'}`.trim());
  }
  return null;
}

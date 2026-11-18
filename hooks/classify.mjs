// Which tool calls need the user's confirmation (ASKING.md section 5), and how much of it. `classify` is
// the whole interface: a PreToolUse event in, the verdicts out. Each verdict carries a level:
//   - double: two-step confirmation (catastrophic, outgoing-message, payments)
//   - ask: one confirmation (claude-settings, release-deploy)
//   - merge: merge-deploys, asked only when the merge would deploy to production; decision.mjs settles
//     that through deploy-on-merge.mjs from `target`
// Everything else gets no verdict and is left to Claude Code's own permission settings.
import { homedir, tmpdir } from 'node:os';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, unwrap, commandName } from './shell.mjs';

export const CATEGORIES = {
  catastrophic: { level: 'double', label: '災難級操作' },
  'outgoing-message': { level: 'double', label: '對外發訊' },
  payments: { level: 'double', label: '金流' },
  'claude-settings': { level: 'ask', label: '寫入 Claude Code 設定' },
  'release-deploy': { level: 'ask', label: '發布版本或部署正式環境' },
  'merge-deploys': { level: 'merge', label: '可能立即觸發正式部署的合併' },
};

const hit = (category, detail, extra = {}) => ({ category, level: CATEGORIES[category].level, detail, ...extra });
const catastrophic = (detail, consequence) => hit('catastrophic', detail, { consequence });
const message = (detail, destination) =>
  hit('outgoing-message', detail, { consequence: `對外發送訊息到 ${destination}：送出後無法收回。` });
const payment = (detail, endpoint) =>
  hit('payments', detail, { consequence: `金流操作 ${endpoint}：可能產生實際扣款、退款或付款物件，通常無法單方撤銷。` });
/** target: { kind: 'pr', arg, repo } | { kind: 'push', branch } | { kind: 'unknown', why } */
const merge = (detail, target) => hit('merge-deploys', detail, { target });

/**
 * @param {{tool_name: string, tool_input?: object, cwd?: string}} event
 * @returns {Array<{category: string, level: 'double'|'ask'|'merge', detail: string, consequence?: string, target?: object}>}
 */
export function classify(event) {
  const tool = event.tool_name || '';
  const input = event.tool_input || {};
  const cwd = event.cwd || process.cwd();
  if (tool === 'Bash' || tool === 'PowerShell') {
    return classifyCommand(String(input.command || ''), tool === 'PowerShell' ? 'powershell' : 'bash', cwd);
  }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const path = String(input.file_path || input.notebook_path || '');
    return path && isClaudeSettings(path) ? [hit('claude-settings', `${tool} ${path}`, { path })] : [];
  }
  if (tool.startsWith('mcp__')) return classifyMcp(tool, input, cwd);
  return [];
}

// ---------- paths ----------

export const isClaudeSettings = (path) =>
  /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/i.test(path) || /(^|[\\/])managed-settings\.json$/i.test(path);

// `/d/code/x` (Git Bash) and `D:\code\x` compare equal.
export const normalizePath = (p) =>
  p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase();
const isAbsolute = (p) => /^(\/|[a-z]:[\\/])/i.test(p);
const isUnder = (child, parent) => {
  const [c, q] = [normalizePath(child), normalizePath(parent)];
  return q !== '' && (c === q || c.startsWith(q + '/'));
};
const TEMP_DIRS = () => [tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR, '/tmp', '/var/tmp'].filter(Boolean);
const HOME = /^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|%userprofile%)(?=\/|$)/i;

// A recursive delete aimed at a home, a root, a parent, or a wildcard of everything, or at an
// absolute path outside the working directory and the temp directories.
function dangerousDeleteTarget(target, cwd) {
  const t = target.replace(/\\/g, '/');
  if (/^(~|\$home|\$\{home\}|\$env:userprofile|\$env:homepath|%userprofile%)(\/\*?)?$/i.test(t)) return true;
  if (/^(\/|\/\*|\*|\.|\.\/|\.\/\*|\.\.|\.\.\/.*|[a-z]:\/?\*?)$/i.test(t)) return true;
  const path = t.replace(HOME, homedir().replace(/\\/g, '/'));
  if (isAbsolute(path)) return !isUnder(path, cwd) && !TEMP_DIRS().some((d) => isUnder(path, d));
  return false;
}

// What the user would see deleted: the target as an absolute path.
function absoluteTarget(target, cwd) {
  const t = target.replace(/\\/g, '/').replace(HOME, homedir().replace(/\\/g, '/'));
  return isAbsolute(t) ? t : resolve(cwd, t).replace(/\\/g, '/');
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
const optionValue = (args, ...names) => {
  for (let k = 0; k < args.length; k++) {
    if (names.includes(args[k])) return args[k + 1] ?? '';
    const name = names.find((n) => n.startsWith('--') && args[k].startsWith(n + '='));
    if (name) return args[k].slice(name.length + 1);
  }
  return '';
};

/** Every verdict the command's simple commands produce, in order. */
export function classifyCommand(command, dialect, cwd) {
  const segments = parse(command, dialect);
  const out = [];
  for (let s = 0; s < segments.length; s++) {
    const verdict = classifySegment(segments[s], segments[s - 1], cwd);
    if (verdict) out.push(verdict);
  }
  return out;
}

const READERS = new Set(['cat', 'type', 'get-content', 'gc', 'head', 'tail', 'less', 'more', 'jq', 'grep', 'rg', 'findstr', 'select-string', 'sls', 'wc', 'bat', 'ls', 'dir', 'stat', 'test', '[', 'diff']);
const PROD = /(^|[^a-z0-9])(prod|production|prd)([^a-z0-9]|$)/i;
const READ_ONLY_VERB = /^(get|describe|logs?|list|ls|show|status|top|explain|version|view|info|whoami|history|diff|plan|help|cat|tail|validate)([-_].*)?$/i;
const DEPLOY_TOOLS = new Set(['kubectl', 'helm', 'gcloud', 'aws', 'az', 'fly', 'flyctl', 'heroku', 'vercel', 'netlify', 'firebase', 'wrangler', 'serverless', 'sls', 'eb', 'ansible', 'ansible-playbook', 'kamal', 'cap', 'ssh', 'scp', 'rsync']);
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'mongosh', 'mongo', 'redis-cli', 'clickhouse-client', 'cockroach']);
const SQL_DESTROY = /\b(drop\s+(table|database|schema)(\s+if\s+exists)?\s+([`"'\[]?[\w.$-]+)|truncate\s+(table\s+)?([`"'\[]?[\w.$-]+))|\b(flushall|flushdb)\b|\b([\w$]+\.)?dropDatabase\s*\(/gi;
const SQL_WRITE = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|merge)\b/i;
const FETCHERS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm']);
const MAILERS = new Set(['sendmail', 'mail', 'mailx', 'mutt', 'msmtp', 'ssmtp', 'swaks', 'send-mailmessage']);

function classifySegment(seg, prev, cwd) {
  const { argv } = unwrap(seg.argv);
  const words = seg.argv.join(' ');
  const redirected = seg.redirects.find((t) => isClaudeSettings(t));
  if (redirected) return hit('claude-settings', `> ${redirected}`, { path: redirected });
  if (!argv.length) return null;
  const name = commandName(argv[0]);
  const args = argv.slice(1);
  const line = argv.join(' ');

  const byTool = commandRule(name, args, line, seg, cwd);
  if (byTool) return byTool;

  // Writing Claude Code settings with anything but a reader.
  if (!READERS.has(name) && !(name === 'git' && /^(diff|log|show|status|blame|add|ls-files)$/.test(gitSub(args).sub))) {
    const path = args.map((a) => a.replace(/^-[-\w]*=/, '')).find((a) => isClaudeSettings(a));
    if (path) return hit('claude-settings', line, { path });
  }
  if (SQL_CLIENTS.has(name)) {
    const sql = `${words}\n${seg.heredoc}\n${seg.op === '|' ? prev.argv.join(' ') : ''}`;
    const statements = [...sql.matchAll(SQL_DESTROY)].map((m) => m[0].replace(/\s+/g, ' ').trim());
    if (statements.length) {
      const db = optionValue(args, '-d', '--dbname', '-D', '--database', '-n') || positionals(args, new Set(['-c', '-e', '-h', '-U', '-p', '-f', '-u', '-P', '-S', '-Q', '-i', '--eval'])).find((a) => !/\s/.test(a)) || '';
      const where = db ? `（資料庫 ${db}）` : '';
      return catastrophic(line, `用 ${name} 執行 ${[...new Set(statements)].join('、')}${where}：資料一併刪除，沒有備份就無法復原。`);
    }
    if (PROD.test(words) && SQL_WRITE.test(sql)) return hit('release-deploy', line);
  }
  // Deploy tools pointed at production, unless the verb only reads.
  if (DEPLOY_TOOLS.has(name) && PROD.test(words)) {
    const verbs = positionals(args).slice(0, 3);
    if (name === 'ssh' || name === 'scp' || name === 'rsync' || !verbs.some((v) => READ_ONLY_VERB.test(v))) {
      return hit('release-deploy', line);
    }
  }
  return null;
}

const DISK = (line, target) => catastrophic(line, `覆寫或清除 ${target}：上面的所有資料都會消失，無法復原。`);

function commandRule(name, args, line, seg, cwd) {
  switch (name) {
    case 'git':
      return gitRule(args, line, cwd);
    case 'gh':
      return ghRule(args, line, seg, cwd);
    case 'npm':
    case 'cnpm':
    case 'pnpm':
    case 'bun':
      return args[0] === 'publish' ? hit('release-deploy', line) : null;
    case 'yarn':
      return args[0] === 'publish' || (args[0] === 'npm' && args[1] === 'publish') ? hit('release-deploy', line) : null;
    case 'cargo':
      return args[0] === 'publish' ? hit('release-deploy', line) : null;
    case 'gem':
      return args[0] === 'push' ? hit('release-deploy', line) : null;
    case 'dotnet':
      return args[0] === 'nuget' && args[1] === 'push' ? hit('release-deploy', line) : null;
    case 'twine':
      return args[0] === 'upload' ? hit('release-deploy', line) : null;
    case 'vsce':
      return args[0] === 'publish' ? hit('release-deploy', line) : null;
    case 'terraform':
    case 'tofu':
    case 'terragrunt':
      return ['apply', 'destroy', 'import', 'taint'].includes(args[0]) || (args[0] === 'state' && /^(rm|mv|push)$/.test(args[1] ?? '')) ? hit('release-deploy', line) : null;
    case 'pulumi':
      return ['up', 'update', 'destroy'].includes(args[0]) ? hit('release-deploy', line) : null;
    case 'rm':
    case 'remove-item':
    case 'ri':
    case 'rd':
    case 'rmdir':
    case 'del':
    case 'erase':
      return deleteRule(name, args, line, cwd);
    case 'dropdb': {
      const db = positionals(args, new Set(['-h', '-p', '-U', '--host', '--port', '--username', '--maintenance-db'])).at(-1) || '(未指名)';
      return catastrophic(line, `刪除 PostgreSQL 資料庫 ${db}：資料一併刪除，沒有備份就無法復原。`);
    }
    case 'diskpart':
      return DISK(line, '磁碟分割（diskpart）');
    case 'dd': {
      const of = args.find((a) => /^of=\/dev\//.test(a));
      return of ? DISK(line, `裝置 ${of.slice(3)}`) : null;
    }
    case 'format': {
      const drive = args.find((a) => /^[a-z]:$/i.test(a));
      return drive ? DISK(line, `磁碟 ${drive.toUpperCase()}`) : null;
    }
    case 'stripe':
      return args.some((a) => /^(create|update|delete|confirm|capture|pay|cancel|refund|void|finalize|send|post)$/.test(a)) ? payment(line, `stripe ${args.join(' ')}`) : null;
    default:
      break;
  }
  if (MAILERS.has(name)) {
    const to = [...args.filter((a) => /^[^@\s]+@[^@\s]+$/.test(a)), optionValue(args, '-To', '--to')].filter(Boolean);
    return message(line, to.length ? `收件者 ${[...new Set(to)].join(', ')}` : `${name} 指定的收件者`);
  }
  if (/^mkfs/.test(name)) return DISK(line, `裝置 ${positionals(args).at(-1) || '(未指名)'}（${name} 建立新檔案系統）`);
  if (FETCHERS.has(name)) return fetchRule(args, line);
  return null;
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
  const hits = targets.map((t) => t.replace(/,$/, '')).filter((t) => dangerousDeleteTarget(t, cwd));
  if (!hits.length) return null;
  const paths = hits.map((t) => absoluteTarget(t, cwd)).join('、');
  return catastrophic(line, `遞迴刪除 ${paths}：不經資源回收筒，沒有備份就無法復原。`);
}

// ---------- git ----------

const GIT_GLOBAL_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '--super-prefix']);
function gitSub(args) {
  let k = 0;
  while (k < args.length && args[k].startsWith('-')) k += GIT_GLOBAL_VALUED.has(args[k]) ? 2 : 1;
  return { sub: args[k] ?? '', rest: args.slice(k + 1) };
}

const MAIN_NAMES = ['main', 'master'];
const MAIN = MAIN_NAMES.join('|');
const PROTECTED_BRANCH = new RegExp(`^(refs/heads/)?(${MAIN})$`);

const git = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch {
    return '';
  }
};
// main, master, and the remote's default branch when the clone knows it.
function protectedBranches(dir, remote) {
  const names = new Set(MAIN_NAMES);
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
const FORCE_PUSH = '改寫共享歷史，其他人的 commit 可能遺失。';

function gitRule(args, line, cwd) {
  const { sub, rest } = gitSub(args);
  if (sub !== 'push') return null;
  const flags = shortFlags(rest.filter((a, k) => !PUSH_VALUED.has(rest[k - 1])));
  const forceAll = flags.has('f') || hasLong(rest, '--force', '--force-with-lease', '--force-if-includes');
  const [remote, ...refspecs] = positionals(rest, PUSH_VALUED);
  const dir = gitDir(args, cwd);
  const branches = protectedBranches(dir, remote);
  const isProtected = (ref) => !!ref && branches.has(ref.replace(/^refs\/heads\//, ''));
  const dst = (r) => {
    const s = r.replace(/^\+/, '');
    return s.includes(':') ? s.slice(s.lastIndexOf(':') + 1) : s;
  };
  const deleting = flags.has('d') || hasLong(rest, '--delete');
  const deleted = refspecs.filter((r) => (deleting || r.startsWith(':')) && isProtected(dst(r))).map(dst);
  if (deleted.length) {
    return catastrophic(line, `刪除遠端的受保護分支 ${deleted.join('、')}：分支上的歷史與以它為基底的 PR 都會失去依靠，其他人可能無法取回。`);
  }
  if (deleting) return null;
  if (hasLong(rest, '--mirror')) return catastrophic(line, `以 --mirror 推送到 ${remote || '預設 remote'}：遠端每個 ref（含受保護分支）都會被覆寫或刪除，${FORCE_PUSH}`);
  // No refspec pushes the current branch; `HEAD` and `@` name it too.
  let currentBranch;
  const current = () => (currentBranch ??= git(dir, 'symbolic-ref', '--short', '-q', 'HEAD'));
  const named = (t) => (t === 'HEAD' || t === '@' ? current() : t);
  let targets;
  if (hasLong(rest, '--all', '--branches')) {
    targets = [...branches].filter((b) => git(dir, 'rev-parse', '--verify', '-q', `refs/heads/${b}`)).map((name) => ({ name, forced: forceAll }));
  } else if (refspecs.length) {
    targets = refspecs.map((r) => ({ name: named(dst(r)), forced: forceAll || r.startsWith('+') }));
  } else if (hasLong(rest, '--tags')) {
    targets = [];
  } else {
    targets = [{ name: current(), forced: forceAll }];
  }
  const hits = targets.filter((t) => isProtected(t.name));
  const forced = hits.filter((t) => t.forced).map((t) => t.name.replace(/^refs\/heads\//, ''));
  if (forced.length) return catastrophic(line, `強制推送到受保護分支 ${[...new Set(forced)].join('、')}：${FORCE_PUSH}`);
  if (hits.length) return merge(line, { kind: 'push', branch: hits[0].name.replace(/^refs\/heads\//, ''), dir });
  return null;
}

// ---------- gh and HTTP APIs ----------

const GH_API_VALUED = new Set(['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '-p', '--preview', '--cache']);
const GH_API_FIELD = new Set(['-f', '-F', '--field', '--raw-field']);
const GH_PR_MERGE_VALUED = new Set(['-b', '--body', '-F', '--body-file', '-t', '--subject', '-A', '--author-email', '--match-head-commit', '-R', '--repo']);

function ghRule(args, line, seg, cwd) {
  const [group, verb, ...rest] = args;
  switch (group) {
    case 'api':
      return ghApi(args.slice(1), line, seg, cwd);
    case 'pr':
      if (verb !== 'merge') return null;
      return merge(line, { kind: 'pr', arg: positionals(rest, GH_PR_MERGE_VALUED)[0] ?? '', repo: optionValue(rest, '-R', '--repo'), dir: cwd });
    case 'repo':
      if (verb !== 'delete') return null;
      return repoDelete(line, positionals(rest, new Set(['-R', '--repo']))[0] || '目前目錄的 repo');
    case 'release':
      return verb === 'create' ? hit('release-deploy', line) : null;
    case 'workflow':
      return verb === 'run' && PROD.test(args.slice(1).join(' ')) ? hit('release-deploy', line) : null;
    default:
      return null;
  }
}

const repoDelete = (line, repo) =>
  catastrophic(line, `刪除 GitHub repo ${repo}：連同 issues、PR、wiki、releases 一起刪除，可能無法還原。`);

// What gh sends from a file: `-F key=@path` and `--input path`. Unreadable or large files add nothing.
function fileBody(path, cwd) {
  if (!path || path === '-') return '';
  try {
    const full = resolve(cwd, path);
    return statSync(full).size <= 1 << 20 ? readFileSync(full, 'utf8') : '';
  } catch {
    return '';
  }
}

function ghApi(args, line, seg, cwd) {
  let method = '';
  let endpoint = '';
  let hasBody = false;
  const body = [seg.heredoc];
  // A typed field (-F, --field) whose value starts with @ is read from that file; a raw one is sent as written.
  const field = (flag, value) => {
    body.push(value);
    const file = /^[^=]*=@(.+)$/.exec(value)?.[1];
    if (file && (flag === '-F' || flag === '--field')) body.push(fileBody(file, cwd));
    hasBody = true;
  };
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    const eq = /^(--method|--field|--raw-field|--input)=(.*)$/.exec(a);
    if (a === '-X' || a === '--method') method = args[++k] ?? '';
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (eq?.[1] === '--method') method = eq[2];
    else if (GH_API_FIELD.has(a)) {
      field(a, args[++k] ?? '');
    } else if (eq?.[1] === '--input') {
      body.push(fileBody(eq[2], cwd));
      hasBody = true;
    } else if (eq) {
      field(eq[1], eq[2]);
    } else if (/^-[fF]./.test(a)) {
      field(a.slice(0, 2), a.slice(2));
    } else if (a === '--input') {
      body.push(fileBody(args[++k], cwd));
      hasBody = true;
    } else if (GH_API_VALUED.has(a)) k++;
    else if (!a.startsWith('-') && !endpoint) endpoint = a;
  }
  method = (method || (hasBody ? 'POST' : 'GET')).toUpperCase();
  return apiRule(method, endpoint, body.join('\n'), line, cwd);
}

const OWNER_REPO = '(repos/([^/]+/[^/]+))';
const bodyValue = (body, key) => new RegExp(String.raw`\b${key}["']?\s*[=:]\s*["']?([\w./-]+)`).exec(body)?.[1] ?? '';

// One GitHub REST or GraphQL call, from `gh api` or from curl.
export function apiRule(method, rawEndpoint, body, line, cwd = process.cwd()) {
  const endpoint = rawEndpoint.replace(/^https?:\/\/api\.github\.com/i, '').replace(/^\/+/, '').replace(/[?#].*$/, '');
  const reading = method === 'GET' || method === 'HEAD';
  const repoOf = (m) => (/[{}]/.test(m[2]) ? '' : m[2]);
  if (endpoint === 'graphql') {
    if (/\bdeleteRepository\b/.test(body)) return repoDelete(line, 'GraphQL deleteRepository 指定的 repo');
    if (/\b(updateRefs?)\b/.test(body) && /\bforce\s*:\s*true\b/.test(body) && new RegExp(String.raw`refs/heads/(${MAIN})\b`).test(body)) {
      return catastrophic(line, `強制改寫受保護分支（GraphQL updateRefs）：${FORCE_PUSH}`);
    }
    if (/\b(mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|mergeBranch)\b/.test(body)) {
      return merge(line, { kind: 'unknown', why: 'GraphQL 合併呼叫看不出目標分支' });
    }
    if (/\bcreateCommitOnBranch\b/.test(body)) {
      const branch = new RegExp(String.raw`(branchName|qualifiedBranchName)["']?\s*:\s*["']?(refs/heads/)?(${MAIN})\b`).exec(body)?.[3];
      if (branch) return merge(line, { kind: 'push', branch, dir: cwd });
    }
    return null;
  }
  if (reading) return null;
  let m;
  if ((m = new RegExp(`^${OWNER_REPO}/pulls/([^/]+)/merge$`).exec(endpoint))) {
    return merge(line, { kind: 'pr', arg: m[3], repo: repoOf(m), dir: cwd });
  }
  if (new RegExp(`^${OWNER_REPO}/merges$`).test(endpoint)) {
    const base = bodyValue(body, 'base');
    return merge(line, base ? { kind: 'push', branch: base, dir: cwd } : { kind: 'unknown', why: '看不出合併的目標分支' });
  }
  if ((m = new RegExp(`^${OWNER_REPO}/git/refs/heads/(.+)$`).exec(endpoint)) && PROTECTED_BRANCH.test(m[3])) {
    if (method === 'DELETE') return catastrophic(line, `刪除遠端的受保護分支 ${m[3]}：分支上的歷史與以它為基底的 PR 都會失去依靠，其他人可能無法取回。`);
    if (/\bforce["']?\s*[=:]\s*["']?true\b/.test(body)) return catastrophic(line, `強制改寫受保護分支 ${m[3]}：${FORCE_PUSH}`);
    return merge(line, { kind: 'push', branch: m[3], dir: cwd });
  }
  if (new RegExp(`^${OWNER_REPO}/git/refs$`).test(endpoint)) {
    const branch = new RegExp(String.raw`refs/heads/(${MAIN})\b`).exec(body)?.[1];
    if (branch) return merge(line, { kind: 'push', branch, dir: cwd });
  }
  if (new RegExp(`^${OWNER_REPO}/contents/`).test(endpoint)) {
    const branch = bodyValue(body, 'branch');
    if (!branch) return merge(line, { kind: 'unknown', why: '沒有指定分支，會寫進預設分支' });
    if (PROTECTED_BRANCH.test(branch)) return merge(line, { kind: 'push', branch: branch.replace(/^refs\/heads\//, ''), dir: cwd });
  }
  if ((m = new RegExp(`^${OWNER_REPO}$`).exec(endpoint)) && method === 'DELETE') return repoDelete(line, repoOf(m) || m[2]);
  return null;
}

const MESSAGE_URL = /^(smtps?:\/\/|https?:\/\/(hooks\.slack\.com|([^/]*\.)?slack\.com\/api\/(chat\.|files\.upload|conversations\.invite)|(discord|discordapp)\.com\/api\/(.*\/)?(webhooks|messages)|api\.telegram\.org\/bot[^/]*\/send|[^/]*\.webhook\.office\.com|outlook\.office(365)?\.com\/webhook|graph\.microsoft\.com\/.*(sendmail|\/messages|\/chats)|api\.sendgrid\.com|api\.mailgun\.net|api\.postmarkapp\.com|api\.(twitter|x)\.com|graph\.facebook\.com|api\.linkedin\.com|api\.twilio\.com|gmail\.googleapis\.com\/.*\/send))/i;
const PAYMENT_URL = /^https?:\/\/(api\.stripe\.com|api(-m)?\.(sandbox\.)?paypal\.com|connect\.squareup(sandbox)?\.com|api\.wise\.com|api\.braintreegateway\.com|checkout-test\.adyen\.com|[^/]*\.adyen\.com)\//i;
const FETCH_VALUED = new Set(['-X', '--request', '-H', '--header', '-o', '--output', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-Method', '-Headers', '-OutFile', '-ContentType']);
const FETCH_BODY = /^(-d|--data|--data-raw|--data-binary|--data-urlencode|--json|-F|--form|-T|--upload-file|--post-data|--post-file|-Body|-InFile)$/i;
const RECIPIENT = /(?:^|[&\s{,"'])(channel|channel_id|chat_id|to|recipient|recipients|email)["']?\s*[=:]\s*["']?([^&\s"',}]+)/i;

// Where a message goes, without secrets in the URL path (webhook URLs carry their token there).
function destination(url, body) {
  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;
  const rcpt = RECIPIENT.exec(body);
  const rcptArg = /--mail-rcpt\s+(\S+)/.exec(body)?.[1];
  return [host, rcpt ? `${rcpt[1]}=${rcpt[2]}` : '', rcptArg ? `收件者 ${rcptArg}` : ''].filter(Boolean).join('，');
}

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
    } else if (a === '--mail-rcpt') body.push(`--mail-rcpt ${args[++k] ?? ''}`);
    else if (/^(-Uri|--url)$/i.test(a)) urls.push(args[++k] ?? '');
    else if (FETCH_VALUED.has(a)) k++;
    else if (/^(https?|smtps?):\/\//i.test(a)) urls.push(a);
    else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(a) && !a.startsWith('-')) urls.push(`https://${a}`);
  }
  method = (method || (hasBody ? 'POST' : 'GET')).toUpperCase();
  for (const url of urls) {
    if (MESSAGE_URL.test(url)) return message(line, destination(url, body.join('\n')));
    if (PAYMENT_URL.test(url) && method !== 'GET') {
      const endpoint = url.replace(/[?#].*$/, '');
      return payment(line, `${method} ${endpoint}`);
    }
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
const ENQUEUE_ACTION = /(^|_)enqueue_?(pull_?request|pr)($|_)/i;
const PUSH_ACTION = /(^|_)(push_files|push|create_or_update_file|update_file|delete_file|create_commit|commit_files)($|_)/i;
const MCP_RECIPIENT_KEYS = ['channel', 'channel_id', 'channelId', 'chat_id', 'to', 'recipient', 'recipients', 'email', 'user', 'user_id', 'thread_ts'];

function classifyMcp(tool, input = {}, cwd = process.cwd()) {
  const [, server = '', action = ''] = /^mcp__(.+?)__(.+)$/.exec(tool) || [];
  if ((MESSAGING_SERVER.test(server) || MESSAGING_SERVER.test(action)) && MESSAGING_ACTION.test(action)) {
    const to = MCP_RECIPIENT_KEYS.filter((k) => input[k] !== undefined && input[k] !== '').map((k) => `${k}=${[].concat(input[k]).join(',')}`);
    return [message(tool, `MCP server ${server} 的 ${action}${to.length ? `（${to.join('，')}）` : ''}`)];
  }
  if (PAYMENT_SERVER.test(server) && PAYMENT_ACTION.test(action)) return [payment(tool, `MCP server ${server} 的 ${action}`)];
  if (MERGE_ACTION.test(action) || ENQUEUE_ACTION.test(action) || (GIT_SERVER.test(server) && /(^|_)merge($|_)/i.test(action))) {
    const pr = input.pull_number ?? input.pullNumber ?? input.number;
    const target = input.owner && input.repo && pr !== undefined
      ? { kind: 'pr', arg: String(pr), repo: `${input.owner}/${input.repo}`, dir: cwd }
      : { kind: 'unknown', why: 'MCP 合併呼叫看不出 repo 與 PR' };
    return [merge(tool, target)];
  }
  if (GIT_SERVER.test(server) && PUSH_ACTION.test(action)) {
    const branch = String(input.branch || input.ref || '').replace(/^refs\/heads\//, '');
    if (!branch) return [merge(`${tool} (預設分支)`, { kind: 'unknown', why: '沒有指定分支，會寫進預設分支' })];
    if (PROTECTED_BRANCH.test(branch)) return [merge(`${tool} ${branch}`, { kind: 'push', branch, dir: cwd })];
  }
  return [];
}

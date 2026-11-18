// Does landing changes on a branch deploy to production right away? The guard asks before a merge only
// when the answer is yes, or when it cannot tell. In order:
//   1. explicit setting: env SORRY_MATT_MERGE_DEPLOYS (yes/no), else `mergeDeploysProduction` (true/false) in
//      the repo's `.claude/sorry-matt.json`
//   2. detection: the base branch (`gh pr view <arg> --json baseRefName`, or the pushed ref), then every
//      `.github/workflows/*.y*ml` on `origin/<base>` (the working tree when that ref is missing). A workflow
//      deploys on merge when a push to the base triggers it and one of its jobs carries a deploy or release
//      signal that is not gated on a release tool's output (release-please, changesets) or on a tag.
// `analyzeWorkflows` is pure (workflow texts in, findings out); `mergeDeploys` does the I/O through `run`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------- a small YAML reader: block maps and sequences, block scalars, flow collections ----------

function stripComment(line) {
  let quote = null;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (k === 0 || /\s/.test(line[k - 1]))) return line.slice(0, k);
  }
  return line;
}

const unquote = (s) => {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
};

function parseFlow(text) {
  let i = 0;
  const ws = () => {
    while (/\s/.test(text[i] ?? '')) i++;
  };
  const scalarUntil = (stops) => {
    ws();
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i];
      const end = text.indexOf(q, i + 1);
      const v = text.slice(i + 1, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end + 1;
      return v;
    }
    let v = '';
    while (i < text.length && !stops.includes(text[i])) v += text[i++];
    return v.trim();
  };
  const value = (stops) => {
    ws();
    if (text[i] === '[') {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (text[i] === ']' || i >= text.length) break;
        arr.push(value([',', ']']));
        ws();
        if (text[i] === ',') i++;
      }
      i++;
      return arr;
    }
    if (text[i] === '{') {
      i++;
      const obj = {};
      for (;;) {
        ws();
        if (text[i] === '}' || i >= text.length) break;
        const key = scalarUntil([':', ',', '}']);
        let v = null;
        if (text[i] === ':') {
          i++;
          v = value([',', '}']);
        }
        obj[key] = v;
        ws();
        if (text[i] === ',') i++;
      }
      i++;
      return obj;
    }
    return scalarUntil(stops);
  };
  return value([]);
}

const scalar = (raw) => {
  const t = raw.trim();
  if (t.startsWith('[') || t.startsWith('{')) return parseFlow(t);
  if (t === '' || t === '~' || t === 'null') return null;
  return unquote(t);
};

const KEY = /^("[^"]*"|'[^']*'|[^\s"'#\-[{][^:]*?|-[^\s][^:]*?)\s*:(?:\s+(.*)|)$/;

/** Parse the block structure of a YAML document; anchors, tags and multi-documents are ignored. */
export function parseYaml(text) {
  const lines = text.replace(/\r/g, '').split('\n').map((raw) => {
    const stripped = stripComment(raw).replace(/\s+$/, '');
    return { raw, indent: raw.length - raw.trimStart().length, text: stripped.trim(), blank: stripped.trim() === '' };
  });
  let i = 0;
  const skip = () => {
    while (i < lines.length && (lines[i].blank || lines[i].text === '---')) i++;
  };
  const isItem = (l) => l.text === '-' || l.text.startsWith('- ');

  function blockScalar(parentIndent) {
    const out = [];
    while (i < lines.length && (lines[i].raw.trim() === '' || lines[i].indent > parentIndent)) out.push(lines[i++].raw.trim());
    return out.join('\n').trim();
  }
  function value(rest, indent) {
    if (rest === undefined || rest === '') {
      skip();
      if (i >= lines.length) return null;
      const next = lines[i];
      if (next.indent > indent) return node(next.indent);
      if (next.indent === indent && isItem(next)) return seq(indent);
      return null;
    }
    if (/^[|>][-+0-9]*$/.test(rest)) return blockScalar(indent);
    return scalar(rest);
  }
  function node(indent) {
    skip();
    if (i >= lines.length) return null;
    return isItem(lines[i]) ? seq(indent) : map(indent);
  }
  function map(indent) {
    const obj = {};
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent < indent || (l.indent === indent && isItem(l))) break;
      if (l.indent > indent) {
        i++;
        continue;
      }
      const m = KEY.exec(l.text);
      i++;
      if (!m) continue;
      obj[unquote(m[1])] = value(m[2], indent);
    }
    return obj;
  }
  function seq(indent) {
    const arr = [];
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent !== indent || !isItem(l)) break;
      const content = l.text === '-' ? '' : l.text.slice(2).trimStart();
      if (content === '') {
        i++;
        arr.push(value('', indent));
      } else if (KEY.test(content)) {
        // `- key: value` opens a map whose keys sit where `key` starts.
        const offset = l.raw.indexOf(content, l.indent + 1);
        lines[i] = { ...l, indent: offset, text: content };
        arr.push(map(offset));
      } else {
        i++;
        arr.push(/^[|>][-+0-9]*$/.test(content) ? blockScalar(indent) : scalar(content));
      }
    }
    return arr;
  }
  skip();
  return i < lines.length ? node(lines[i].indent) : null;
}

// ---------- workflow analysis ----------

// GitHub's filter patterns: `*` stops at `/`, `**` does not, `?` is one character, a leading `!` excludes.
function globToRegex(pattern) {
  let re = '';
  for (let k = 0; k < pattern.length; k++) {
    const c = pattern[k];
    if (c === '*' && pattern[k + 1] === '*') {
      re += '.*';
      k++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '.';
    else if (c === '+') re += '+';
    else if (c === '[') {
      const end = pattern.indexOf(']', k);
      re += end === -1 ? '\\[' : pattern.slice(k, end + 1);
      if (end !== -1) k = end;
    } else re += c.replace(/[.^$(){}|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesBranch(patterns, branch) {
  let matched = false;
  for (const p of [].concat(patterns ?? []).map(String)) {
    if (p.startsWith('!')) {
      if (globToRegex(p.slice(1)).test(branch)) matched = false;
    } else if (globToRegex(p).test(branch)) matched = true;
  }
  return matched;
}

/** Whether a push to `branch` starts this workflow, and why. */
function pushTrigger(on, branch) {
  if (on === 'push') return { triggered: true };
  if (Array.isArray(on)) return { triggered: on.map(String).includes('push') };
  if (!on || typeof on !== 'object' || !('push' in on)) return { triggered: false };
  const push = on.push;
  if (!push || typeof push !== 'object') return { triggered: true };
  if (push.branches !== undefined) return { triggered: matchesBranch(push.branches, branch) };
  if (push['branches-ignore'] !== undefined) return { triggered: !matchesBranch(push['branches-ignore'], branch) };
  // A push filter on tags alone never fires for a branch push.
  if (push.tags !== undefined || push['tags-ignore'] !== undefined) return { triggered: false };
  return { triggered: true };
}

const DEPLOY_ACTIONS = [
  /^actions\/deploy-pages$/,
  /^peaceiris\/actions-gh-pages$/,
  /^jamesives\/github-pages-deploy-action$/,
  /^cloudflare\/wrangler-action$/,
  /^superfly\/flyctl-actions(\/.*)?$/,
  /^amondnet\/vercel-action$/,
  /^aws-actions\/amazon-ecs-deploy-task-definition$/,
  /^azure\/webapps-deploy$/,
  /^google-github-actions\/deploy-[\w-]+$/,
];
const RELEASE_TOOLS = /^(googleapis|google-github-actions)\/release-please-action$|^changesets\/action$/;
const PROD = /(^|[^a-z0-9])(prod|production|prd)([^a-z0-9]|$)/i;
const RUN_SIGNALS = [
  [/\bvercel\b[^\n]*--prod\b/, 'vercel --prod'],
  [/\b(fly|flyctl)\s+deploy\b/, 'fly deploy'],
  [/\b(npm|pnpm|yarn|bun)\s+(npm\s+)?publish\b/, 'npm publish'],
  [/\bcargo\s+publish\b/, 'cargo publish'],
  [/\bgh\s+release\s+create\b/, 'gh release create'],
];
const KUBE = /\b(kubectl\s+apply|helm\s+upgrade)\b/;
// Conditions that hold the step back on an ordinary merge: a release tool's output, or a tag push.
const RELEASE_GATE = /\breleases?_created\b|\bsteps\.[\w-]+\.outputs\.release\b|\boutputs\.(release|published)\b/;
const TAG_GATE = /refs\/tags\/|github\.ref_type\s*==\s*['"]tag['"]/;

function stepSignals(step) {
  const out = [];
  if (!step || typeof step !== 'object') return out;
  const uses = String(step.uses ?? '').split('@')[0].toLowerCase();
  if (uses && DEPLOY_ACTIONS.some((re) => re.test(uses))) out.push(`uses: ${uses}`);
  const run = String(step.run ?? '');
  for (const [re, label] of RUN_SIGNALS) if (re.test(run)) out.push(`run: ${label}`);
  if (KUBE.test(run) && PROD.test(run)) out.push(`run: ${KUBE.exec(run)[1].replace(/\s+/g, ' ')}（prod）`);
  return out;
}

/**
 * @param {{name: string, text: string}[]} workflows
 * @param {string} branch the branch the merge lands on
 * @returns {{deploys: boolean, findings: string[], gated: string[]}}
 */
export function analyzeWorkflows(workflows, branch) {
  const findings = [];
  const gated = [];
  for (const { name, text } of workflows) {
    let doc;
    try {
      doc = parseYaml(text);
    } catch {
      findings.push(`${name}（無法解析，視為可能部署）`);
      continue;
    }
    if (!doc || typeof doc !== 'object') continue;
    const on = doc.on;
    if (!pushTrigger(on, branch).triggered) continue;
    const usesReleaseTool = Object.values(doc.jobs ?? {}).some((job) =>
      [].concat(job?.steps ?? []).some((s) => RELEASE_TOOLS.test(String(s?.uses ?? '').split('@')[0].toLowerCase())),
    );
    const isGated = (cond) => {
      const c = String(cond ?? '');
      return RELEASE_GATE.test(c) || TAG_GATE.test(c) || (usesReleaseTool && /\boutputs\./.test(c));
    };
    for (const [id, job] of Object.entries(doc.jobs ?? {})) {
      if (!job || typeof job !== 'object') continue;
      const jobGated = isGated(job.if);
      const signals = [];
      const env = typeof job.environment === 'object' && job.environment ? job.environment.name : job.environment;
      if (env && PROD.test(String(env))) signals.push({ what: `environment: ${env}`, gated: jobGated });
      for (const step of [].concat(job.steps ?? [])) {
        for (const what of stepSignals(step)) signals.push({ what, gated: jobGated || isGated(step?.if) });
      }
      for (const s of signals) (s.gated ? gated : findings).push(`${name} 的 job ${id}（${s.what}）`);
    }
  }
  return { deploys: findings.length > 0, findings, gated };
}

// ---------- I/O ----------

/** @returns {{ok: boolean, stdout: string}} */
export function runCommand(cmd, args, { cwd, timeout = 10000 } = {}) {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

const YES = /^(yes|true|1|on)$/i;
const NO = /^(no|false|0|off)$/i;

/** The explicit setting, or null when there is none. */
export function explicitSetting(env, repoRoot, read = readFileSync) {
  const value = String(env.SORRY_MATT_MERGE_DEPLOYS ?? '').trim();
  if (YES.test(value)) return { deploys: true, source: 'SORRY_MATT_MERGE_DEPLOYS' };
  if (NO.test(value)) return { deploys: false, source: 'SORRY_MATT_MERGE_DEPLOYS' };
  if (!repoRoot) return null;
  try {
    const config = JSON.parse(read(join(repoRoot, '.claude', 'sorry-matt.json'), 'utf8'));
    if (typeof config?.mergeDeploysProduction === 'boolean') return { deploys: config.mergeDeploysProduction, source: '.claude/sorry-matt.json' };
  } catch {
    // no file, or not JSON: fall through to detection
  }
  return null;
}

function workflowsAt(root, ref, run, fs) {
  const git = (...args) => run('git', ['-C', root, ...args]);
  if (git('rev-parse', '--verify', '-q', `${ref}^{commit}`).ok) {
    const list = git('ls-tree', '--name-only', ref, '.github/workflows/');
    if (!list.ok) return null;
    const out = [];
    for (const path of list.stdout.split('\n').map((s) => s.trim()).filter((p) => /\.ya?ml$/i.test(p))) {
      const file = git('show', `${ref}:${path}`);
      if (!file.ok) return null;
      out.push({ name: path.split('/').pop(), text: file.stdout });
    }
    return { source: ref, workflows: out };
  }
  const dir = join(root, '.github', 'workflows');
  if (!fs.exists(dir)) return { source: '工作樹', workflows: [] };
  try {
    const names = fs.list(dir).filter((n) => /\.ya?ml$/i.test(n));
    return { source: '工作樹', workflows: names.map((name) => ({ name, text: fs.read(join(dir, name), 'utf8') })) };
  } catch {
    return null;
  }
}

const defaultFs = { exists: existsSync, list: readdirSync, read: readFileSync };

/**
 * @param {{kind: 'pr'|'push'|'unknown', arg?: string, repo?: string, branch?: string, dir?: string, why?: string}} target
 * @returns {{deploys: true|false|null, reason: string}} null means it could not tell
 */
export function mergeDeploys(target, { cwd = process.cwd(), env = process.env, run = runCommand, fs = defaultFs } = {}) {
  const dir = target.dir || cwd;
  const top = run('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  const root = top.ok ? top.stdout.trim() : '';
  const setting = explicitSetting(env, root, fs.read);
  if (setting) return { deploys: setting.deploys, reason: `依 ${setting.source} 的設定` };
  if (target.kind === 'unknown') return { deploys: null, reason: target.why || '看不出合併的目標分支' };
  if (!root) return { deploys: null, reason: `${dir} 不在 git repo 內，讀不到 workflow` };

  let branch = target.branch;
  if (target.kind === 'pr') {
    if (target.repo) {
      const origin = run('git', ['-C', root, 'remote', 'get-url', 'origin']);
      if (!origin.ok || !origin.stdout.toLowerCase().includes(target.repo.toLowerCase())) {
        return { deploys: null, reason: `PR 屬於 ${target.repo}，不是這個 clone 的 origin，讀不到它的 workflow` };
      }
    }
    const args = ['pr', 'view', ...(target.arg ? [target.arg] : []), ...(target.repo ? ['--repo', target.repo] : []), '--json', 'baseRefName', '--jq', '.baseRefName'];
    const view = run('gh', args, { cwd: root, timeout: 10000 });
    branch = view.ok ? view.stdout.trim() : '';
    if (!branch) return { deploys: null, reason: `查不到 PR ${target.arg || '(目前分支)'} 的目標分支（gh pr view 失敗）` };
  }
  const found = workflowsAt(root, `origin/${branch}`, run, fs);
  if (!found) return { deploys: null, reason: `讀不到 origin/${branch} 上的 workflow` };
  const { deploys, findings, gated } = analyzeWorkflows(found.workflows, branch);
  if (deploys) return { deploys: true, reason: `合併到 ${branch} 會觸發：${findings.join('；')}（讀自 ${found.source}）` };
  const note = gated.length ? `；受 release 工具或 tag 控制、不會立即執行的：${gated.join('；')}` : '';
  return { deploys: false, reason: `${found.source} 上沒有合併到 ${branch} 就立即部署的 workflow${note}` };
}

// Does landing changes on a branch deploy to production right away? The guard asks before a merge only
// when the answer is yes, or when it cannot tell. In order:
//   1. explicit setting: env SORRY_MATT_MERGE_DEPLOYS (yes/no), else `mergeDeploysProduction` (true/false) in
//      the repo's `.claude/sorry-matt.json`
//   2. detection: the base branch (`gh pr view`, or the pushed ref), then every `.github/workflows/*.y*ml` the
//      merge leaves there: the PR head's (else `origin/<base>`, noted), or the pushed ref's tree; the working tree
//      when none of those refs exists locally. A workflow deploys on merge when a push to the base triggers it
//      and one of its jobs carries a deploy or release signal that is not gated on a release tool's output
//      (release-please, changesets) or on a tag. Merging the release tool's own release PR lifts that gate. A
//      job or step named like a deploy whose action is not recognized means "cannot tell".
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
  /^firebaseextended\/action-hosting-deploy$/,
];
const RELEASE_PLEASE = /^(googleapis|google-github-actions)\/release-please-action$/;
const CHANGESETS = /^changesets\/action$/;
const PROD = /(^|[^a-z0-9])(prod|production|prd)([^a-z0-9]|$)/i;
const RUN_SIGNALS = [
  [/\bvercel\b[^\n]*--prod\b/, 'vercel --prod'],
  [/\b(fly|flyctl)\s+deploy\b/, 'fly deploy'],
  [/\bwrangler\s+(pages\s+)?(deploy|publish)\b(?![^\n]*--dry-run)/, 'wrangler deploy'],
  [/\bfirebase\s+deploy\b/, 'firebase deploy'],
  [/\bnetlify\s+deploy\b[^\n]*--prod\b/, 'netlify deploy --prod'],
  [/\b(npm|pnpm|yarn|bun)\s+(-r\s+|--recursive\s+|npm\s+)?publish\b(?![^\n]*--dry-run)/, 'npm publish'],
  [/\bcargo\s+publish\b(?![^\n]*--dry-run)/, 'cargo publish'],
  [/\bgh\s+release\s+create\b/, 'gh release create'],
];
const KUBE = /\b(kubectl\s+apply|helm\s+upgrade)\b/;
const NAMED_LIKE_DEPLOY = /deploy|release|publish/i;
const REUSABLE = /^(\.\/|[\w.-]+\/[\w.-]+\/)\.github\/workflows\/[^@]+/i;
// Conditions that hold a step back on an ordinary merge: a release tool's output, or a tag push.
const RELEASE_GATE = /\breleases?_created\b|\bsteps\.[\w-]+\.outputs\.release\b|\boutputs\.(release|published)\b/;
const TAG_GATE = /refs\/tags\/|github\.ref_type\s*==\s*['"]tag['"]/;

const actionOf = (step) => String(step?.uses ?? '').split('@')[0].toLowerCase();

function stepSignals(step) {
  const out = [];
  if (!step || typeof step !== 'object') return out;
  const uses = actionOf(step);
  if (uses && DEPLOY_ACTIONS.some((re) => re.test(uses))) out.push(`uses: ${uses}`);
  const run = String(step.run ?? '');
  for (const [re, label] of RUN_SIGNALS) if (re.test(run)) out.push(`run: ${label}`);
  if (KUBE.test(run) && PROD.test(run)) out.push(`run: ${KUBE.exec(run)[1].replace(/\s+/g, ' ')}（prod）`);
  return out;
}

/**
 * @param {{name: string, text: string}[]} workflows
 * @param {string} branch the branch the merge lands on
 * @param {{releasePr?: boolean}} options releasePr: the merge is a release tool's own release PR, so steps gated
 *   on that tool's output run right away
 * @returns {{deploys: boolean, findings: string[], gated: string[], unsure: string[]}}
 */
export function analyzeWorkflows(workflows, branch, { releasePr = false } = {}) {
  const findings = [];
  const gated = [];
  const unsure = [];
  for (const { name, text } of workflows) {
    let doc;
    try {
      doc = parseYaml(text);
    } catch {
      unsure.push(`${name}（無法解析）`);
      continue;
    }
    if (!doc || typeof doc !== 'object') continue;
    if (!pushTrigger(doc.on, branch).triggered) continue;
    const jobs = Object.entries(doc.jobs ?? {}).filter(([, job]) => job && typeof job === 'object');
    const usesReleaseTool = jobs.some(([, job]) => [].concat(job.steps ?? []).some((s) => RELEASE_PLEASE.test(actionOf(s)) || CHANGESETS.test(actionOf(s))));
    // 'release' when held back by a release tool's output, 'tag' when by a tag, null when not held back.
    const gateOf = (cond) => {
      const c = String(cond ?? '');
      if (TAG_GATE.test(c)) return 'tag';
      if (RELEASE_GATE.test(c) || (usesReleaseTool && /\boutputs\./.test(c))) return 'release';
      return null;
    };
    const place = (where, what, gate) => {
      const text = `${name} 的 ${where}（${what}）`;
      if (!gate) findings.push(text);
      else if (gate === 'release' && releasePr) findings.push(`${text}，這是 release PR，合併後 release 工具的輸出成立`);
      else gated.push(text);
    };
    for (const [id, job] of jobs) {
      const jobGate = gateOf(job.if);
      const where = `job ${id}`;
      let recognized = false;
      const env = typeof job.environment === 'object' && job.environment ? job.environment.name : job.environment;
      if (env && PROD.test(String(env))) {
        place(where, `environment: ${env}`, jobGate);
        recognized = true;
      }
      const reusable = String(job.uses ?? '');
      if (REUSABLE.test(reusable)) {
        if (NAMED_LIKE_DEPLOY.test(reusable.split('@')[0].split('/').pop())) place(where, `uses: ${reusable}`, jobGate);
        else if (!jobGate) unsure.push(`${name} 的 ${where}（呼叫 ${reusable}，看不到裡面做什麼）`);
        recognized = true;
      }
      for (const [k, step] of [].concat(job.steps ?? []).entries()) {
        if (!step || typeof step !== 'object') continue;
        const gate = jobGate || gateOf(step.if);
        const label = `${where} 第 ${k + 1} 步${step.name ? `「${step.name}」` : ''}`;
        const signals = stepSignals(step);
        for (const what of signals) place(label, what, gate);
        // Merging a release tool's own PR is when the tool releases (release-please) or publishes (changesets).
        const tool = actionOf(step);
        if (RELEASE_PLEASE.test(tool) || CHANGESETS.test(tool)) {
          recognized = true;
          if (releasePr && gate !== 'tag') findings.push(`${name} 的 ${label}（${tool}：release PR 合併後建立 release${step.with?.publish ? ` 並執行 ${step.with.publish}` : ''}）`);
          continue;
        }
        if (signals.length) recognized = true;
        else if (!gate && NAMED_LIKE_DEPLOY.test(`${step.name ?? ''} ${step.id ?? ''}`)) unsure.push(`${name} 的 ${label}（名稱像部署或發布，但認不出確切動作）`);
      }
      if (!recognized && !jobGate && NAMED_LIKE_DEPLOY.test(`${id} ${job.name ?? ''}`)) {
        unsure.push(`${name} 的 ${where}（名稱像部署或發布，但認不出確切動作）`);
      }
    }
  }
  return { deploys: findings.length > 0, findings, gated, unsure };
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

/** The workflows in the first of `refs` that exists locally; the working tree when none does. */
function workflowsAt(root, refs, run, fs) {
  const git = (...args) => run('git', ['-C', root, ...args]);
  const ref = refs.find((r) => r && git('rev-parse', '--verify', '-q', `${r}^{commit}`).ok);
  if (ref) {
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
const RELEASE_HEAD = /^(release-please--|changeset-release\/)/;

/**
 * Whether the merge deploys, judged on the workflows the merge leaves on the branch: the PR head's (else the
 * base's, noted) for a PR, the pushed ref's tree for a push.
 * @param {{kind: 'pr'|'push'|'unknown', arg?: string, repo?: string, branch?: string, source?: string, dir?: string, why?: string}} target
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
  let refs;
  let releasePr = false;
  if (target.kind === 'pr') {
    if (target.repo) {
      const origin = run('git', ['-C', root, 'remote', 'get-url', 'origin']);
      if (!origin.ok || !origin.stdout.toLowerCase().includes(target.repo.toLowerCase())) {
        return { deploys: null, reason: `PR 屬於 ${target.repo}，不是這個 clone 的 origin，讀不到它的 workflow` };
      }
    }
    const args = ['pr', 'view', ...(target.arg ? [target.arg] : []), ...(target.repo ? ['--repo', target.repo] : []), '--json', 'baseRefName,headRefName,headRefOid,labels'];
    const view = run('gh', args, { cwd: root, timeout: 10000 });
    let pr = null;
    try {
      pr = view.ok ? JSON.parse(view.stdout) : null;
    } catch {
      pr = null;
    }
    branch = typeof pr?.baseRefName === 'string' ? pr.baseRefName : '';
    if (!branch) return { deploys: null, reason: `查不到 PR ${target.arg || '(目前分支)'} 的目標分支（gh pr view 失敗）` };
    const labels = [].concat(pr.labels ?? []).map((l) => String(l?.name ?? l));
    releasePr = RELEASE_HEAD.test(String(pr.headRefName ?? '')) || labels.includes('autorelease: pending');
    refs = [pr.headRefOid, pr.headRefName && `origin/${pr.headRefName}`, `origin/${branch}`];
  } else {
    refs = [target.source, `origin/${branch}`];
  }
  const found = workflowsAt(root, refs, run, fs);
  if (!found) return { deploys: null, reason: `讀不到 ${refs.filter(Boolean).join(' 或 ')} 上的 workflow` };
  const fallback = target.kind === 'pr' && found.source === `origin/${branch}` ? '；讀不到 PR head，改讀 base' : '';
  const from = `讀自 ${found.source}${fallback}`;
  const { findings, gated, unsure } = analyzeWorkflows(found.workflows, branch, { releasePr });
  if (findings.length) return { deploys: true, reason: `合併到 ${branch} 會觸發：${findings.join('；')}（${from}）` };
  if (unsure.length) return { deploys: null, reason: `合併到 ${branch} 會觸發看似部署、但認不出確切動作的 workflow：${unsure.join('；')}（${from}）` };
  const note = gated.length ? `；受 release 工具或 tag 控制、不會立即執行的：${gated.join('；')}` : '';
  return { deploys: false, reason: `${found.source} 上沒有合併到 ${branch} 就立即部署的 workflow${note}${fallback}` };
}

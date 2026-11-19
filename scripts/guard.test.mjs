// node --test scripts/guard.test.mjs
// The PreToolUse guard in hooks/: catastrophic actions, outgoing messages and payments get the two-step
// confirmation; releases, production deploys, Claude Code settings writes and merges that deploy are asked once;
// everything else is left to Claude Code's permission settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { classify } from '../hooks/classify.mjs';
import { decide as decideWith, confirmCommand, unattended, unattendedFile } from '../hooks/decision.mjs';
import { fileStore, tokenFor, TTL } from '../hooks/confirm-state.mjs';
import { approve } from '../hooks/confirm.mjs';

// Unless a test says otherwise the user is at the keyboard, whatever switch file this machine has.
const decide = (raw, env = {}, deps = {}) => decideWith(raw, env, { unattended: false, ...deps });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CWD = process.platform === 'win32' ? 'D:\\code\\repo' : '/home/me/code/repo';
const verdicts = (tool_name, tool_input, cwd = CWD) => classify({ tool_name, tool_input, cwd });
const first = (vs) => (vs.length ? vs[0].category : null);
const bash = (command, cwd) => first(verdicts('Bash', { command }, cwd));
const pwsh = (command) => first(verdicts('PowerShell', { command }));
const file = (tool_name, file_path) => first(verdicts(tool_name, { file_path }));
const mcp = (tool_name, input = {}) => first(verdicts(tool_name, input));

function withDir(fn) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-guard-')));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CLASSIFIED = {
  catastrophic: [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf "$HOME"',
    'rm -rf ..',
    'rm -rf ../sibling',
    'rm -rf *',
    'rm -fr .',
    'sudo rm -rf /',
    'bash -c "rm -rf ~"',
    'mkfs.ext4 /dev/sdb1',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    'diskpart /s wipe.txt',
    'format D:',
    'dropdb app',
    'psql -c "DROP TABLE users"',
    'echo "DROP DATABASE app" | mysql',
    'mysql -e "truncate table orders"',
    'redis-cli FLUSHALL',
    'mongosh --eval "db.dropDatabase()"',
    'gh repo delete o/r --yes',
    'gcloud projects delete my-proj',
    'terraform destroy -auto-approve',
    'terraform apply -destroy',
    'tofu destroy',
    'pulumi destroy --yes -s prod',
    'kubectl delete namespace shop --context prod',
    'kubectl --context production delete ns web',
    'az group delete -n rg1 --yes',
    'aws s3 rb s3://prod-assets --force',
    'aws cloudformation delete-stack --stack-name app-prod',
    'gh api -X DELETE repos/o/r',
    `gh api graphql -f query='mutation { deleteRepository(input: {repositoryId: "x"}) { clientMutationId } }'`,
    'git push -f origin main',
    'git push --force-with-lease=main:abc123 origin main',
    'git push origin +main',
    'git push origin +HEAD:refs/heads/master',
    'git push --mirror backup',
    'git push origin --delete main',
    'git push origin :master',
    'gh api -X DELETE repos/o/r/git/refs/heads/main',
    'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc -F force=true',
  ],
  'outgoing-message': [
    'curl -X POST -d \'{"text":"hi"}\' https://hooks.slack.com/services/T/B/X',
    'curl https://slack.com/api/chat.postMessage -d channel=C1 -d text=hi',
    'curl -H "Content-Type: application/json" -d @msg.json https://discord.com/api/webhooks/1/abc',
    'echo hi | mail -s subject someone@example.com',
    'sendmail someone@example.com < body.txt',
    'curl --url smtps://smtp.example.com --mail-rcpt a@example.com -T mail.txt',
    'git send-email --to=a@example.com 0001.patch',
    'curl "https://api.telegram.org/bot123:abc/sendMessage?chat_id=1&text=hi"',
  ],
  payments: [
    'stripe refunds create --charge ch_1',
    'curl https://api.stripe.com/v1/charges -u sk_test_x: -d amount=100',
  ],
  'claude-settings': [
    'echo {} > .claude/settings.local.json',
    "sed -i 's/ask/allow/' .claude/settings.json",
    'cp perms.json ~/.claude/settings.json',
    'echo {} > .claude/sorry-matt.json',
    'cp backup.json ~/.claude.json',
    'cp hook.sh .claude/hooks/pre-tool.sh',
    'echo {} > .mcp.json',
    'git checkout -- .claude/settings.json',
    'Copy-Item new.json -Destination .claude/settings.json',
  ],
  'release-deploy': [
    'npm publish',
    'pnpm publish --access public',
    'yarn npm publish',
    'cargo publish',
    'gem push app-1.0.0.gem',
    'dotnet nuget push app.nupkg',
    'twine upload dist/*',
    'vsce publish',
    'gh release create v1.0.0 --notes x',
    'terraform apply -auto-approve',
    'pulumi up --yes',
    'kubectl --context prod apply -f deploy.yaml',
    'kubectl delete pod web-1 -n production',
    'vercel deploy --prod',
    'ssh prod-db-1 "systemctl restart app"',
    'gh workflow run deploy.yml -f environment=production',
    'psql -h prod-db -c "UPDATE users SET admin = true"',
    'npx vercel --prod',
    'bunx vercel deploy --prod',
    'pnpm dlx vercel --prod',
    'npm exec -- vercel --prod',
    'pnpm -r publish',
    'pnpm --recursive publish --access public',
    'pnpm --filter app publish',
    'npm publish --workspaces',
    'yarn workspaces foreach -A npm publish',
    'fly deploy',
    'flyctl deploy -a shop',
    'wrangler deploy',
    'npx wrangler deploy',
    'wrangler pages deploy dist',
    'firebase deploy --only hosting',
    'firebase deploy -P my-app-prod',
  ],
  'merge-deploys': [
    'gh pr merge 12 --squash',
    'gh pr merge 12 --admin --squash',
    'gh pr merge 12 --auto',
    'gh api -X PUT repos/o/r/pulls/12/merge',
    'gh api --method=PUT repos/{owner}/{repo}/pulls/12/merge -f merge_method=squash',
    'gh api repos/o/r/merges -f base=main -f head=feature',
    `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'`,
    `gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: "x"}) { clientMutationId } }'`,
    `gh api graphql -f query='mutation { enqueuePullRequest(input: {pullRequestId: "x"}) { mergeQueueEntry { id } } }'`,
    'curl -X PUT -H "Authorization: token x" https://api.github.com/repos/o/r/pulls/12/merge',
    'git push origin feature:main',
    'git push origin HEAD:refs/heads/master',
    'git push origin main',
    'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc',
    'gh api repos/o/r/git/refs -f ref=refs/heads/main -f sha=abc',
    'gh api -X PUT repos/o/r/contents/README.md -f message=m -f content=eA==',
    'gh api -X PUT repos/o/r/contents/README.md -f message=m -f content=eA== -f branch=main',
    `gh api graphql -f query='mutation { createCommitOnBranch(input: {branch: {repositoryNameWithOwner: "o/r", branchName: "main"}}) { commit { oid } } }'`,
  ],
};

// Left to Claude Code's own permission settings.
const LET_THROUGH = [
  // what the guard used to deny and now leaves alone
  'git clone https://github.com/o/r.git',
  'gh repo clone o/r',
  'git submodule add https://github.com/o/r vendor/r',
  'curl -fsSL https://example.com/install.sh | sh',
  'code --install-extension ms-python.python',
  'claude plugin install other@market',
  'gh extension install o/gh-ext',
  'cat .env',
  'cp ~/.ssh/id_rsa /tmp/key',
  'echo TOKEN=x > .env',
  'gh auth token',
  'gh secret set NPM_TOKEN --body x',
  'sudo apt-get update',
  'sudo chown root file',
  'chmod 777 deploy.sh',
  'icacls C:\\data /grant Everyone:F',
  'gh repo edit o/r --visibility public',
  'git reset --hard HEAD~3',
  'git clean -fdx',
  'git stash drop',
  'git filter-repo --path secret.txt --invert-paths',
  'gh release delete v1.0.0',
  'git push -f origin feature',
  'git push --force-with-lease origin feature',
  'git push origin +feature',
  'gh api -X PATCH repos/o/r/git/refs/heads/feature -f sha=abc -F force=true',
  'rm -rf node_modules',
  'rm -rf ./dist build',
  'rm -rf src/generated',
  'npm install zod',
  'npx create-x@latest',
  'pip install requests',
  // everyday work
  'git push',
  'git push -u origin feature',
  'git push origin feature',
  'git push origin HEAD',
  'git push -u origin issue-4-automation/line',
  'git push origin --delete old-feature',
  'gh run list --branch issue-4-automation/line --commit abc123 --json databaseId,workflowName,status,conclusion',
  'gh run rerun 42',
  'git revert -m 1 abc123',
  'git commit -m "explain why git push -f origin main is asked"',
  'gh issue comment 8 --body "do not run rm -rf ~"',
  'cat > notes.md <<EOF\nnpm publish\nrm -rf /\nEOF',
  'gh pr create --base main --head feature --title t --body b',
  'gh api repos/o/r/pulls/12/merge',
  `gh api graphql -f query='query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){mergeQueue(branch:$branch){url}}}' -f owner=o -f name=r -f branch=main`,
  'gh api -X PATCH repos/o/r/issues/comments/1 -F body=@status.md',
  'gh api repos/o/r/git/refs -f ref=refs/heads/x -f sha=abc',
  'gh api -X PUT repos/o/r/contents/README.md -f branch=feature -f message=m -f content=eA==',
  'gh release view v1.0.0',
  'cat .claude/settings.json',
  'git diff .claude/settings.json',
  'kubectl get pods --context prod',
  'kubectl apply -f deploy.yaml',
  'terraform plan',
  'curl https://api.github.com/repos/o/r',
  'curl https://api.stripe.com/v1/charges',
  'psql -c "SELECT 1"',
  'docker build -t app:prod .',
  // read-only, dry runs, and targets named as non-production
  'ssh prod-web-1 uptime',
  'ssh prod-db-1 "systemctl status app"',
  'ssh -i key.pem prod-web-1 tail -n 100 /var/log/app.log',
  'ssh prod-web-1 "docker ps"',
  'npm publish --dry-run',
  'pnpm -r publish --dry-run',
  'cargo publish --dry-run',
  'terraform apply -var-file=staging.tfvars',
  'TF_WORKSPACE=dev terraform apply -auto-approve',
  'terraform -chdir=envs/staging apply',
  'fly deploy -a shop-staging',
  'wrangler deploy --env staging',
  'firebase deploy -P my-app-dev',
  'vercel deploy',
  'npx vercel',
  'kubectl delete namespace scratch',
  'aws s3 rb s3://scratch-bucket',
  'curl -s https://discord.com/api/webhooks/1/abc',
  'curl https://hooks.slack.com/services/T/B/X',
  // reading, printing, testing or committing a settings file writes nothing; a copy writes only its destination
  'Test-Path .claude/settings.local.json',
  'Get-ChildItem .claude/settings.json',
  'echo .claude/settings.json',
  'sha256sum .claude/settings.json',
  'cp .claude/settings.json /tmp/settings.backup.json',
  'git commit -m "allow gh" .claude/settings.json',
  'code .claude/settings.json',
];

test('cmd /c is read with cmd quoting: backslashes are paths, \\\\?\\ is a long path', () => {
  const pwshAt = (command) => first(verdicts('PowerShell', { command }, 'D:\\code\\repo'));
  // An agent cleaning up its own scratch worktree under the temp dir (seen in a real run).
  const temp = join(tmpdir(), 'claude', 'x', 'scratchpad', 'r453', 'review-453');
  assert.equal(pwshAt(`$p = '${temp}'; cmd /c "rd /s /q \\\\?\\$p"; Test-Path $p`), null);
  assert.equal(pwshAt(`cmd /c "rd /s /q ${temp}"`), null);
  // Before, the backslashes were eaten and this turned into a relative path that passed.
  assert.equal(pwshAt('cmd /c "rd /s /q D:\\other\\place"'), 'catastrophic');
  assert.equal(pwshAt('cmd /c "rd /s /q \\\\?\\D:\\other\\place"'), 'catastrophic');
  assert.equal(bash("cmd /c 'rd /s /q C:\\Users'"), 'catastrophic');
});

for (const [category, commands] of Object.entries(CLASSIFIED)) {
  test(`classified as ${category}`, () => {
    for (const command of commands) assert.equal(bash(command), category, command);
  });
}

test('everything else is let through', () => {
  for (const command of LET_THROUGH) assert.equal(bash(command), null, command);
});

test('verdict levels: double, ask, or a merge settled by deploy detection', () => {
  const level = (command) => verdicts('Bash', { command })[0]?.level ?? null;
  assert.equal(level('rm -rf ~'), 'double');
  assert.equal(level('curl https://hooks.slack.com/services/T/B/X -d x=1'), 'double');
  assert.equal(level('stripe refunds create --charge ch_1'), 'double');
  assert.equal(level('npm publish'), 'ask');
  assert.equal(level('echo {} > .claude/settings.json'), 'ask');
  assert.equal(level('gh pr merge 12'), 'merge');
  assert.equal(level('git status'), null);
});

test('the consequence names the concrete target', () => {
  const consequence = (command) => verdicts('Bash', { command })[0].consequence;
  assert.match(consequence('rm -rf ~'), new RegExp(`遞迴刪除 ${homedir().replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}：不經資源回收筒`));
  assert.match(consequence('rm -rf ..'), /遞迴刪除 .*：不經資源回收筒，沒有備份就無法復原/);
  assert.match(consequence('gh repo delete o/r --yes'), /o\/r：連同 issues、PR、wiki、releases 一起刪除/);
  assert.match(consequence('psql -d app -c "DROP TABLE users"'), /DROP TABLE users（資料庫 app）：資料一併刪除/);
  assert.match(consequence('git push -f origin main'), /受保護分支 main：改寫共享歷史/);
  assert.match(consequence('curl https://slack.com/api/chat.postMessage -d channel=C1 -d text=hi'), /slack\.com，channel=C1：送出後無法收回/);
  assert.match(consequence('echo hi | mail -s subject someone@example.com'), /收件者 someone@example\.com/);
  assert.match(consequence('curl https://api.stripe.com/v1/refunds -d charge=ch_1'), /POST https:\/\/api\.stripe\.com\/v1\/refunds：可能產生實際扣款/);
  // A webhook's secret path stays out of the prompt.
  assert.doesNotMatch(consequence('curl -d x=1 https://hooks.slack.com/services/T/B/SECRET'), /SECRET/);
});

test('PowerShell spellings are read with PowerShell quoting', () => {
  assert.equal(pwsh('Remove-Item -Recurse -Force C:\\Users'), 'catastrophic');
  assert.equal(pwsh('Remove-Item -Recurse -Force .\\dist'), null);
  assert.equal(pwsh('git push --force origin main'), 'catastrophic');
  assert.equal(pwsh('& git push -f origin feature'), null);
  assert.equal(pwsh('Get-Content C:\\Users\\me\\.ssh\\id_ed25519'), null);
  assert.equal(pwsh('Invoke-RestMethod -Method Put -Uri https://api.github.com/repos/o/r/pulls/1/merge'), 'merge-deploys');
  assert.equal(pwsh('Send-MailMessage -To a@example.com -Subject s -SmtpServer smtp'), 'outgoing-message');
  const encoded = Buffer.from('git push -f origin main', 'utf16le').toString('base64');
  assert.equal(bash(`pwsh -EncodedCommand ${encoded}`), 'catastrophic');
});

test('file tools: writing Claude Code settings is asked, secrets are not the guard\'s business', () => {
  assert.equal(file('Write', `${CWD}/.claude/settings.local.json`), 'claude-settings');
  assert.equal(file('Edit', '/home/me/.claude/settings.json'), 'claude-settings');
  assert.equal(file('MultiEdit', 'C:\\ProgramData\\ClaudeCode\\managed-settings.json'), 'claude-settings');
  assert.equal(file('Write', `${CWD}/.claude/hooks/guard.sh`), 'claude-settings');
  assert.equal(file('Edit', '/home/me/.claude.json'), 'claude-settings');
  assert.equal(file('Edit', `${CWD}/.claude/sorry-matt.json`), 'claude-settings');
  assert.equal(file('Write', `${CWD}/.mcp.json`), 'claude-settings');
  assert.equal(file('Write', `${CWD}/.claude/launch.json`), null);
  assert.equal(file('Read', `${CWD}/.claude/settings.json`), null);
  assert.equal(file('Read', `${CWD}/.env`), null);
  assert.equal(file('Edit', `${CWD}/.env`), null);
  assert.equal(file('Write', `${CWD}/src/settings.json`), null);
});

test('MCP tools: messages and payments are double, merges and protected pushes depend on deploys', () => {
  assert.equal(mcp('mcp__claude_ai_Slack__slack_send_message', { channel: 'C1' }), 'outgoing-message');
  assert.match(verdicts('mcp__claude_ai_Slack__slack_send_message', { channel: 'C1' })[0].consequence, /claude_ai_Slack 的 slack_send_message（channel=C1）/);
  assert.equal(mcp('mcp__gmail__send_email'), 'outgoing-message');
  assert.equal(mcp('mcp__stripe__create_refund'), 'payments');
  assert.equal(mcp('mcp__gmail__create_draft'), null);
  assert.equal(mcp('mcp__claude_ai_Slack__slack_read_channel'), null);
  assert.equal(mcp('mcp__stripe__list_customers'), null);
  assert.equal(mcp('mcp__github__create_pull_request'), null);
  assert.equal(mcp('mcp__github__merge_pull_request', { owner: 'o', repo: 'r', pull_number: 1 }), 'merge-deploys');
  assert.deepEqual(verdicts('mcp__github__merge_pull_request', { owner: 'o', repo: 'r', pull_number: 1 })[0].target.kind, 'pr');
  assert.equal(mcp('mcp__github__push_files', { branch: 'main', files: [] }), 'merge-deploys');
  assert.equal(mcp('mcp__github__create_or_update_file', { path: 'a' }), 'merge-deploys');
  assert.equal(mcp('mcp__github__enqueue_pull_request', { pull_number: 1 }), 'merge-deploys');
  assert.equal(mcp('mcp__gitlab__enqueue_pipeline'), null);
  assert.equal(mcp('mcp__github__push_files', { branch: 'feature', files: [] }), null);
  assert.equal(mcp('mcp__sheets__merge_cells'), null);
  assert.equal(mcp('mcp__github__delete_repository', { owner: 'o', repo: 'r' }), 'catastrophic');
  assert.match(verdicts('mcp__github__delete_repository', { owner: 'o', repo: 'r' })[0].consequence, /刪除 GitHub repo o\/r（MCP server github 的 delete_repository）：連同 issues/);
  assert.equal(mcp('mcp__gitlab__delete_repo', { repository: 'g/p' }), 'catastrophic');
});

test('cloud and infrastructure deletes spell out what goes', () => {
  const consequence = (command) => verdicts('Bash', { command })[0].consequence;
  assert.match(consequence('gcloud projects delete my-proj'), /刪除 GCP 專案 my-proj：/);
  assert.match(consequence('TF_WORKSPACE=prod terraform destroy'), /銷毀 terraform 管理的所有資源（workspace prod）/);
  assert.match(consequence('az group delete --name rg1'), /刪除 Azure 資源群組 rg1/);
  assert.match(consequence('kubectl delete ns web --context prod'), /namespace web（prod）/);
  assert.match(consequence('aws s3 rb s3://prod-assets --force'), /s3:\/\/prod-assets（--force：連同所有物件）/);
  assert.match(consequence('git send-email --to=a@example.com 0001.patch'), /收件者 a@example\.com/);
});

test('a push lands on a protected branch: the current one, HEAD, or the remote default', () => {
  withDir((dir) => {
    const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'init');
    const at = (command) => bash(command, dir);
    assert.equal(at('git push'), 'merge-deploys');
    assert.equal(at('git push origin HEAD'), 'merge-deploys');
    assert.equal(at('git push -f'), 'catastrophic');
    assert.equal(at('git push --force origin HEAD'), 'catastrophic');
    assert.equal(at('git push --all origin'), 'merge-deploys');
    assert.equal(at('git push --force --all origin'), 'catastrophic');
    assert.equal(at('git push --tags origin'), null);
    git('checkout', '-q', '-b', 'feature');
    assert.equal(at('git push'), null);
    assert.equal(at('git push -f'), null);
    assert.equal(at('git push -u origin HEAD'), null);
    git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    assert.equal(at('git push origin develop'), 'merge-deploys');
    assert.equal(at('git push -f origin develop'), 'catastrophic');
    assert.equal(at(`git -C ${JSON.stringify(dir)} push origin feature:develop`), 'merge-deploys');
  });
});

test('a GraphQL body read from a file is checked like an inline one', () => {
  withDir((dir) => {
    writeFileSync(join(dir, 'enqueue.graphql'), 'mutation($id:ID!){enqueuePullRequest(input:{pullRequestId:$id}){clientMutationId}}');
    writeFileSync(join(dir, 'body.json'), JSON.stringify({ query: 'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }' }));
    writeFileSync(join(dir, 'queue.graphql'), 'query{repository(owner:"o",name:"r"){mergeQueue(branch:"main"){url}}}');
    const at = (command) => bash(command, dir);
    assert.equal(at('gh api graphql -F query=@enqueue.graphql -f id=x'), 'merge-deploys');
    assert.equal(at('gh api graphql --input body.json'), 'merge-deploys');
    assert.equal(at('gh api graphql -F query=@queue.graphql'), null);
    // A raw field is sent as written, never read from a file.
    assert.equal(at('gh api graphql -f query=@enqueue.graphql'), null);
  });
});

// ---------- decisions ----------

const out = (result) => result?.hookSpecificOutput ?? null;
const event = (command, extra = {}) => JSON.stringify({ tool_name: 'Bash', tool_input: { command, description: 'd' }, cwd: CWD, session_id: 's1', ...extra });

test('ask-level verdicts are asked once, in every mode', () => {
  for (const mode of ['default', 'auto', 'acceptEdits', 'bypassPermissions']) {
    const result = out(decide(event('npm publish', { permission_mode: mode }), {}));
    assert.equal(result.permissionDecision, 'ask', mode);
    assert.match(result.permissionDecisionReason, /發布版本或部署正式環境/);
    assert.equal(result.updatedInput, undefined);
  }
  assert.match(out(decide(event('cp x .claude/settings.json'), {})).permissionDecisionReason, /寫入 Claude Code 設定檔 \.claude\/settings\.json/);
  assert.equal(decide(event('git status'), {}), null);
  assert.equal(decide(event('git clone https://github.com/o/r'), {}), null);
});

test('a merge is asked when it deploys or when that cannot be told, and let through when it does not', () => {
  const seen = [];
  const detect = (deploys, reason) => (target) => {
    seen.push(target);
    return { deploys, reason };
  };
  const yes = out(decide(event('gh pr merge 12 --squash', { permission_mode: 'auto' }), {}, { detect: detect(true, 'deploy.yml 的 job pages（uses: actions/deploy-pages）') }));
  assert.equal(yes.permissionDecision, 'ask');
  assert.match(yes.permissionDecisionReason, /會立即觸發正式部署.*deploy\.yml/);
  assert.deepEqual(seen.at(-1), { kind: 'pr', arg: '12', repo: '', dir: CWD });
  assert.equal(decide(event('gh pr merge 12 --admin', { permission_mode: 'bypassPermissions' }), {}, { detect: detect(false, 'none') }), null);
  const unknown = out(decide(event('gh pr merge 12 --auto'), {}, { detect: detect(null, '查不到 PR 12 的目標分支') }));
  assert.equal(unknown.permissionDecision, 'ask');
  assert.match(unknown.permissionDecisionReason, /無法判斷.*查不到 PR 12.*SORRY_MATT_MERGE_DEPLOYS=no/);
  // A harder verdict in the same command wins.
  assert.match(out(decide(event('gh pr merge 12 && rm -rf ~'), {}, { detect: detect(false, '') , store: memoryStore() })).permissionDecisionReason, /第一次確認/);
});

function memoryStore({ failRead = false, failWrite = false } = {}) {
  const sessions = {};
  return {
    sessions,
    read(session) {
      if (failRead) throw new Error('read failed');
      return structuredClone(sessions[session] ?? {});
    },
    update(session, fn) {
      if (failRead) throw new Error('read failed');
      const entries = structuredClone(sessions[session] ?? {});
      const result = fn(entries);
      if (failWrite) throw new Error('write failed');
      sessions[session] = entries;
      return result;
    },
    sessionOf(token) {
      return Object.keys(sessions).find((s) => token in sessions[s]) ?? null;
    },
  };
}

test('two-step confirmation: first ask runs confirm.mjs, the resend is asked again, once', () => {
  withDir((dir) => {
    const store = fileStore(dir);
    let now = 1_000_000;
    const deps = () => ({ store, now, pluginRoot: '/plugin' });
    const command = 'rm -rf ~';

    const step1 = out(decide(event(command), {}, deps()));
    assert.equal(step1.permissionDecision, 'ask');
    assert.match(step1.permissionDecisionReason, /^sorry-matt guard 第一次確認/);
    assert.match(step1.permissionDecisionReason, /不經資源回收筒/);
    const token = tokenFor('s1', 'Bash', { command });
    assert.equal(step1.updatedInput.command, confirmCommand('/plugin', token));
    assert.equal(step1.updatedInput.command, `node "/plugin/hooks/confirm.mjs" ${token}`);

    // The guard sees confirm.mjs itself: a live token is the first prompt.
    const confirmAsk = out(decide(event(step1.updatedInput.command), {}, deps()));
    assert.equal(confirmAsk.permissionDecision, 'ask');
    assert.match(confirmAsk.permissionDecisionReason, /第一次確認.*\n遞迴刪除/);
    assert.equal(confirmAsk.updatedInput, undefined);

    // Before confirm.mjs runs (the user said no), a resend is still the first step.
    assert.match(out(decide(event(command), {}, deps())).permissionDecisionReason, /第一次確認/);

    // The user allowed it: confirm.mjs records the approval.
    const approved = approve(token, { store, now });
    assert.equal(approved.ok, true);
    assert.match(approved.text, /第一次確認已記錄，請原樣重送原指令以進行第二次確認/);

    // Resent unchanged (a new description is the same call): the second step, without updatedInput.
    now += 60_000;
    const step2 = out(decide(event(command, { tool_input: { command, description: 'other' } }), {}, deps()));
    assert.equal(step2.permissionDecision, 'ask');
    assert.match(step2.permissionDecisionReason, /^sorry-matt guard 第二次確認/);
    assert.equal(step2.updatedInput, undefined);

    // Single use: the next resend starts over, and the spent token no longer confirms.
    assert.match(out(decide(event(command), {}, deps())).permissionDecisionReason, /第一次確認/);
    assert.equal(approve(token, { store, now }).ok, true, 'a fresh first step re-arms the same token');
    assert.match(out(decide(event(command), {}, deps())).permissionDecisionReason, /第二次確認/);
    assert.equal(out(decide(event(confirmCommand('/plugin', token)), {}, deps())).permissionDecision, 'deny');
  });
});

test('two-step confirmation: approvals expire and are not shared across inputs or sessions', () => {
  const store = memoryStore();
  let now = 5_000_000;
  const deps = () => ({ store, now, pluginRoot: '/plugin' });
  const command = 'gh repo delete o/r --yes';
  decide(event(command), {}, deps());
  const token = tokenFor('s1', 'Bash', { command });
  assert.equal(approve(token, { store, now }).ok, true);

  // Another command, another tool, or another session does not ride on this approval.
  assert.match(out(decide(event('gh repo delete o/other --yes'), {}, deps())).permissionDecisionReason, /第一次確認/);
  assert.match(out(decide(event(command, { tool_name: 'PowerShell' }), {}, deps())).permissionDecisionReason, /第一次確認/);
  assert.match(out(decide(event(command, { session_id: 's2' }), {}, deps())).permissionDecisionReason, /第一次確認/);
  // The approval is gone after TTL.
  now += TTL + 1;
  assert.match(out(decide(event(command), {}, deps())).permissionDecisionReason, /第一次確認/);

  // A pending token past TTL no longer confirms.
  now += TTL + 1;
  assert.equal(approve(token, { store, now }).ok, false);
  assert.equal(out(decide(event(confirmCommand('/plugin', token)), {}, deps())).permissionDecision, 'deny');
  // Tokens from nowhere, and confirm.mjs chained or rewritten, are denied.
  assert.equal(out(decide(event('node "/x/hooks/confirm.mjs" 0123456789abcdef'), {}, deps())).permissionDecision, 'deny');
  assert.equal(out(decide(event(`${confirmCommand('/plugin', token)} && echo hi`), {}, deps())).permissionDecision, 'deny');
  assert.equal(out(decide(event('node "/plugin/hooks/confirm.mjs" nothex'), {}, deps())).permissionDecision, 'deny');
  assert.equal(approve('nothex', { store, now }).ok, false);
  assert.equal(approve('0123456789abcdef', { store, now }).ok, false);
  // Any other confirm.mjs, by name, is denied: only the guard's own path runs.
  assert.equal(out(decide(event('node scripts/confirm.mjs 0123456789abcdef'), {}, deps())).permissionDecision, 'deny');
});

test('two-step confirmation: a state file that cannot be read or written never lets a call through', () => {
  const command = 'rm -rf ~';
  const token = tokenFor('s1', 'Bash', { command });
  // An approval exists, but reading it fails: back to the first step, which cannot record either, so deny.
  const broken = memoryStore();
  broken.sessions.s1 = { [token]: { tool: 'Bash', summary: 'x', created: 0, approved: true, approvedAt: 0, used: false } };
  const failing = { ...broken, read: () => { throw new Error('read failed'); }, update: () => { throw new Error('read failed'); } };
  const result = out(decide(event(command), {}, { store: failing, now: 1 }));
  assert.equal(result.permissionDecision, 'deny');
  assert.match(result.permissionDecisionReason, /確認紀錄無法寫入/);
  // Writes fail: the approval cannot be spent, so the second step is not given.
  const readOnly = memoryStore({ failWrite: true });
  readOnly.sessions.s1 = broken.sessions.s1;
  assert.equal(out(decide(event(command), {}, { store: readOnly, now: 1 })).permissionDecision, 'deny');
  // confirm.mjs cannot read the state: deny, and approve() records nothing.
  assert.equal(out(decide(event(confirmCommand('/p', token)), {}, { store: failing, now: 1 })).permissionDecision, 'deny');
  assert.equal(approve(token, { store: { ...failing, sessionOf: () => 's1' }, now: 1 }).ok, false);
});

test('two-step confirmation: bypassPermissions denies, auto mode asks', () => {
  const store = memoryStore();
  const bypass = out(decide(event('rm -rf ~', { permission_mode: 'bypassPermissions' }), {}, { store, now: 1 }));
  assert.equal(bypass.permissionDecision, 'deny');
  assert.match(bypass.permissionDecisionReason, /不經資源回收筒.*\n.*bypassPermissions 模式/s);
  assert.deepEqual(store.sessions, {}, 'nothing recorded');
  assert.equal(out(decide(event('rm -rf ~', { permission_mode: 'auto' }), {}, { store, now: 1 })).permissionDecision, 'ask');
  const token = tokenFor('s1', 'Bash', { command: 'rm -rf ~' });
  assert.equal(out(decide(event(confirmCommand('/p', token), { permission_mode: 'bypassPermissions' }), {}, { store, now: 1 })).permissionDecision, 'deny');
});

test('two-step confirmation: a tool that cannot be rewritten is denied first, with the confirm command', () => {
  const store = memoryStore();
  let now = 1;
  const deps = () => ({ store, now, pluginRoot: 'C:\\plugins\\sorry-matt' });
  const call = JSON.stringify({ tool_name: 'mcp__slack__send_message', tool_input: { channel: 'C1', text: 'hi' }, session_id: 's1' });
  const token = tokenFor('s1', 'mcp__slack__send_message', { text: 'hi', channel: 'C1' });
  const step1 = out(decide(call, {}, deps()));
  assert.equal(step1.permissionDecision, 'deny');
  assert.ok(step1.permissionDecisionReason.includes(`node "C:/plugins/sorry-matt/hooks/confirm.mjs" ${token}`));
  assert.match(step1.permissionDecisionReason, /送出後無法收回/);
  // The confirm command runs in either shell.
  assert.equal(out(decide(event(confirmCommand('C:\\plugins\\sorry-matt', token), { tool_name: 'PowerShell' }), {}, deps())).permissionDecision, 'ask');
  assert.equal(out(decide(event(confirmCommand('C:\\plugins\\sorry-matt', token)), {}, deps())).permissionDecision, 'ask');
  approve(token, { store, now });
  now += 1000;
  const step2 = out(decide(call, {}, deps()));
  assert.equal(step2.permissionDecision, 'ask');
  assert.match(step2.permissionDecisionReason, /第二次確認/);
});

test('the hook speaks the PreToolUse contract end to end and fails closed', () => {
  withDir((dir) => {
    // os.tmpdir() of the child points into dir, so the state stays inside the test.
    const env = { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, HOME: dir, USERPROFILE: dir, CLAUDE_PLUGIN_ROOT: root };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const run = (script, input, args = []) => spawnSync(process.execPath, [join(root, script), ...args], { input, encoding: 'utf8', env });
    const guard = (command) => {
      const result = run('hooks/guard.mjs', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD, session_id: 'e2e', permission_mode: 'default' }));
      assert.equal(result.status, 0, result.stderr);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
    };
    const step1 = guard('rm -rf ~');
    assert.equal(step1.hookEventName, 'PreToolUse');
    assert.equal(step1.permissionDecision, 'ask');
    const [, script, token] = /^node "(.+)" ([0-9a-f]{16})$/.exec(step1.updatedInput.command);
    assert.equal(script, join(root, 'hooks', 'confirm.mjs').replace(/\\/g, '/'));
    assert.equal(guard(step1.updatedInput.command).permissionDecision, 'ask');
    const confirmed = spawnSync(process.execPath, [script, token], { encoding: 'utf8', env });
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.match(confirmed.stdout, /第一次確認已記錄/);
    assert.match(guard('rm -rf ~').permissionDecisionReason, /第二次確認/);
    assert.match(guard('rm -rf ~').permissionDecisionReason, /第一次確認/);
    assert.equal(guard('git status'), null);
    assert.equal(spawnSync(process.execPath, [script, token], { encoding: 'utf8', env }).status, 0, 'the fresh first step re-armed it');
    assert.equal(spawnSync(process.execPath, [script, 'ffffffffffffffff'], { encoding: 'utf8', env }).status, 1);
  });
  assert.equal(decide('not json').hookSpecificOutput.permissionDecision, 'deny');
});

test('the first step cannot be completed without the prompt (M1 and the other bypasses)', () => {
  const store = memoryStore();
  const deps = { store, now: 1, pluginRoot: root };
  decide(event('rm -rf ~'), {}, deps);
  const token = tokenFor('s1', 'Bash', { command: 'rm -rf ~' });
  const hooksDir = join(root, 'hooks').replace(/\\/g, '/');
  const script = `${hooksDir}/confirm.mjs`;
  const state = join(tmpdir(), 'sorry-matt-guard', 's1.json').replace(/\\/g, '/');
  const decision = (command) => out(decide(event(command), {}, deps))?.permissionDecision ?? null;
  // The one form the guard hands out is asked; any spelling of the same file is too.
  assert.equal(decision(confirmCommand(root, token)), 'ask');
  assert.equal(decision(`node "${hooksDir}//confirm.mjs" ${token}`), 'ask');
  for (const command of [
    // M1: the confirm command chained with anything
    `${confirmCommand(root, token)} && rm -rf build`,
    `${confirmCommand(root, token)}; echo done`,
    `echo go && ${confirmCommand(root, token)}`,
    `bash -c '${confirmCommand(root, token)}'`,
    // other spellings and routes
    `cd "${hooksDir}" && node confirm.mjs ${token}`,
    `node --no-warnings "${script}" ${token}`,
    `node "${script}" ${token} extra`,
    `FOO=1 node "${script}" ${token}`,
    `node "${script}" ${token} > out.txt`,
    `node -e "import('${join(root, 'hooks', 'confirm-state.mjs').replace(/\\/g, '/')}').then((m) => m.fileStore())"`,
    `node -e "import('${script}')" ${token}`,
    `echo {} > "${state}"`,
    `cp fake.json "${state}"`,
    `python -c "open('${state}', 'w').write('{}')"`,
    'tee $TMP/sorry-matt-guard/s1.json < fake.json',
  ]) {
    assert.equal(decision(command), 'deny', command);
  }
  // Reading or committing the scripts is not running them.
  for (const command of ['cat hooks/confirm.mjs', 'git add hooks/confirm.mjs hooks/confirm-state.mjs', 'grep TOKEN hooks/confirm-state.mjs', 'git commit -m "touch confirm-state.mjs"']) {
    assert.equal(decision(command), null, command);
  }
  // File tools cannot write the state either.
  const write = (file_path) => out(decide(JSON.stringify({ tool_name: 'Write', tool_input: { file_path, content: '{}' }, session_id: 's1', cwd: CWD }), {}, deps))?.permissionDecision ?? null;
  assert.equal(write(join(tmpdir(), 'sorry-matt-guard', 's1.json')), 'deny');
  assert.equal(write('/tmp/sorry-matt-guard/s1.json'), 'deny');
  assert.equal(write(`${CWD}/src/app.js`), null);
  assert.deepEqual(Object.values(store.sessions.s1).map((e) => e.approved), [false], 'nothing was approved');
});

test('hooks.json wires the guard to every tool it classifies', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  const entry = config.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.command.includes('hooks/guard.mjs')));
  assert.ok(entry, 'PreToolUse has the guard');
  const matcher = new RegExp(`^(${entry.matcher})$`);
  for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__gmail__send_email']) {
    assert.ok(matcher.test(tool), tool);
  }
  assert.ok(!matcher.test('Agent'), 'Agent is left to its own entry');
  assert.ok(!config.hooks.PreToolUse.some((e) => e.hooks.some((h) => h.command.includes('confirm.mjs'))), 'confirm.mjs is not a hook');
});

test('the user can turn the guard off through the environment', () => {
  const call = event('rm -rf ~');
  const store = memoryStore();
  assert.equal(decide(call, { SORRY_MATT_GUARD: 'off' }, { store }), null);
  assert.equal(decide(call, { SORRY_MATT_GUARD: 'OFF' }, { store }), null);
  assert.ok(decide(call, {}, { store }));
  assert.ok(decide(call, { SORRY_MATT_GUARD: 'on' }, { store }));
});

test('a variable set earlier on the same line is read as its value', () => {
  const target = (command, tool = 'Bash') => verdicts(tool, { command }).find((v) => v.level === 'merge')?.target;
  assert.equal(target('R=0Miles/sheet-thief-studio; gh pr merge 181 --repo $R --merge && sleep 5').repo, '0Miles/sheet-thief-studio');
  assert.equal(target('export R=o/r && gh pr merge 1 -R "${R}"').repo, 'o/r');
  assert.equal(target('$Repo = "o/r"; gh pr merge 1 --repo $repo', 'PowerShell').repo, 'o/r');
  // Two different values, a dynamic value, or a use before the assignment: left as written.
  assert.equal(target('R=a/b; R=c/d; gh pr merge 1 --repo $R').repo, '$R');
  assert.equal(target('R=$(cat f); gh pr merge 1 --repo $R').repo, '$R');
  assert.equal(target('gh pr merge 1 --repo $R; R=o/r').repo, '$R');
  // It can only make a verdict sharper.
  assert.equal(bash('D=~; rm -rf $D'), 'catastrophic');
});

test('unattended: every ask becomes a deny the agent can park, and nothing is recorded', () => {
  const store = memoryStore();
  const away = { unattended: true, store, now: 1 };
  const check = (raw, deps = away) => {
    const result = out(decideWith(raw, {}, deps));
    assert.equal(result.permissionDecision, 'deny');
    assert.match(result.permissionDecisionReason, /無人值守模式.*\n[^]*人工作業清單/);
    assert.equal(result.updatedInput, undefined);
    return result.permissionDecisionReason;
  };
  assert.match(check(event('npm publish')), /發布版本或部署正式環境/);
  assert.match(check(event('gh pr merge 12'), { ...away, detect: () => ({ deploys: null, reason: '查不到' }) }), /無法判斷/);
  assert.match(check(event('rm -rf ~')), /不經資源回收筒[^]*要執行的是：rm -rf ~/);
  assert.deepEqual(store.sessions, {}, 'no two-step token was started');
  const token = tokenFor('s1', 'Bash', { command: 'rm -rf ~' });
  const pluginRoot = 'C:\\plugins\\sorry-matt';
  check(event(confirmCommand(pluginRoot, token)), { ...away, pluginRoot });
  // What was let through stays let through.
  assert.equal(decideWith(event('git status'), {}, away), null);
  assert.equal(decideWith(event('gh pr merge 12'), {}, { ...away, detect: () => ({ deploys: false, reason: '' }) }), null);
});

test('unattended is switched by a file in ~/.claude or by SORRY_MATT_UNATTENDED', () => {
  withDir((home) => {
    const file = unattendedFile(home);
    assert.equal(file, join(home, '.claude', 'sorry-matt-unattended'));
    const exists = (p) => p === file;
    assert.equal(unattended({}, () => false, home), false);
    assert.equal(unattended({}, exists, home), true);
    assert.equal(unattended({ SORRY_MATT_UNATTENDED: 'on' }, () => false, home), true);
    assert.equal(unattended({ SORRY_MATT_UNATTENDED: 'off' }, () => false, home), false);
    assert.equal(unattended({}, () => { throw new Error('EPERM'); }, home), false);
    // End to end: the hook process reads the file on every call.
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const guard = () => JSON.parse(spawnSync(process.execPath, [join(root, 'hooks', 'guard.mjs')], { input: event('npm publish'), encoding: 'utf8', env }).stdout).hookSpecificOutput.permissionDecision;
    assert.equal(guard(), 'ask');
    mkdirSync(join(home, '.claude'));
    writeFileSync(file, '');
    assert.equal(guard(), 'deny');
    // Creating the switch is not a Claude settings write.
    assert.equal(bash('touch ~/.claude/sorry-matt-unattended'), null);
  });
});

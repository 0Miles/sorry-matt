// node --test scripts/guard.test.mjs
// The PreToolUse guard in hooks/: catastrophic actions, outgoing messages and payments get the two-step
// confirmation; releases, production deploys, Claude Code settings writes and merges that deploy are asked once;
// everything else is left to Claude Code's permission settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { classify } from '../hooks/classify.mjs';
import { decide as decideWith, confirmCommand, confirmInvocation, enterCommand, enterInvocation, unattended, unattendedFile } from '../hooks/decision.mjs';
import { parse } from '../hooks/shell.mjs';
import { autoState, autoStateFile } from '../hooks/unattended-state.mjs';
import { enter } from '../hooks/enter-unattended.mjs';
import { fileStore, tokenFor, TTL } from '../hooks/confirm-state.mjs';
import { approve } from '../hooks/confirm.mjs';
import { onPromptSubmit, onStop, turnOrigin, REREAD_MS } from '../hooks/unattended-return.mjs';
import { onExpansion as onSwitchExpansion, onStop as onSwitchStop, COMMAND as SWITCH_COMMAND, PREFIX as SWITCH_PREFIX } from '../hooks/unattended-switch.mjs';
import { onPermissionRequest, waitMinutes, answeredIn } from '../hooks/unattended-timeout.mjs';

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

test('bash double quotes keep a backslash unless it escapes $, backtick, ", \\ or a newline', () => {
  const argv = (line, dialect = 'bash') => parse(line, dialect).map((seg) => seg.argv);
  assert.deepEqual(argv('echo "C:\\a\\b" "x\\"y" "\\$x" "a\\\\b"'), [['echo', 'C:\\a\\b', 'x"y', '$x', 'a\\b']]);
  assert.deepEqual(argv('echo "a\\`b"'), [['echo', 'a`b']]);
  assert.deepEqual(argv('echo "a\\\nb"'), [['echo', 'ab']]);
  assert.deepEqual(argv('echo "a\\\r\nb"'), [['echo', 'ab']]);
  // A lone CR is not a newline: the backslash and the CR are kept.
  assert.deepEqual(argv('echo "a\\\rb"'), [['echo', 'a\\\rb']]);
  assert.deepEqual(argv('echo "\\n" "\\\'" "a\\""'), [['echo', '\\n', "\\'", 'a"']]);
  // Outside quotes a backslash still escapes whatever follows it.
  assert.deepEqual(argv('echo C:\\a\\b'), [['echo', 'C:ab']]);
  // PowerShell and cmd quoting are not bash's.
  assert.deepEqual(argv('echo "C:\\a\\b" "x`"y"', 'powershell'), [['echo', 'C:\\a\\b', 'x"y']]);
  assert.deepEqual(argv('echo "C:\\a\\b" "a^b"', 'cmd'), [['echo', 'C:\\a\\b', 'a^b']]);
});

test('Bash: a double-quoted backslash path is read as that path', () => {
  const at = (command) => verdicts('Bash', { command }, 'D:/code/x')[0] ?? null;
  for (const [command, category, level] of [
    ['rm -rf "D:\\elsewhere\\proj"', 'catastrophic', 'double'],
    ['rm -rf "D:/elsewhere/proj"', 'catastrophic', 'double'],
    ['cp perms.json "C:\\Users\\me\\.claude\\settings.json"', 'claude-settings', 'ask'],
    ['cp perms.json "C:/Users/me/.claude/settings.json"', 'claude-settings', 'ask'],
  ]) {
    assert.equal(at(command)?.category, category, command);
    assert.equal(at(command)?.level, level, command);
  }
  // A delete inside the working directory is still let through.
  assert.equal(at('rm -rf "D:\\code\\x\\dist"'), null);
});

test('Bash: the confirm command with a double-quoted backslash path is the confirm command', () => {
  const token = '0123456789abcdef';
  const invocation = (command, tool_name = 'Bash') =>
    confirmInvocation({ tool_name, tool_input: { command }, cwd: 'D:/code/x' }, 'C:\\p\\sorry-matt');
  const backslashed = `node "C:\\p\\sorry-matt\\hooks\\confirm.mjs" ${token}`;
  assert.equal(invocation(backslashed), token);
  assert.equal(invocation(backslashed, 'PowerShell'), token);
  assert.equal(invocation(`node "C:/p/sorry-matt/hooks/confirm.mjs" ${token}`), token);
  assert.equal(invocation(`${backslashed}; echo x`), '');
  assert.equal(invocation(`${backslashed} > out.txt`), '');
  assert.equal(invocation(`node "C:\\p\\other\\hooks\\confirm.mjs" ${token}`), '');
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
  for (const tool of ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'mcp__gmail__send_email', 'AskUserQuestion']) {
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

// ---------- unattended: the automatic source ----------

const PLUGIN = process.platform === 'win32' ? 'C:\\plugins\\sorry-matt' : '/plugins/sorry-matt';
const ENTERED = { at: 1_700_000_000_000, reason: '使用者說要去睡了', by: 'agent', session: 's0' };
const decisionOf = (result) => out(result)?.permissionDecision ?? null;
const savedState = (home) => JSON.parse(readFileSync(autoStateFile(home), 'utf8'));

test('the automatic state blocks exactly what the switch file blocks, and records no confirmation', () => {
  const run = (home) => {
    const store = memoryStore();
    const deps = { home, store, now: 5, pluginRoot: PLUGIN, detect: () => ({ deploys: true, reason: 'deploy.yml' }) };
    const token = tokenFor('s1', 'Bash', { command: 'rm -rf ~' });
    const results = [
      event('npm publish'),
      event('gh pr merge 12'),
      event('rm -rf ~'),
      event(confirmCommand(PLUGIN, token)),
      JSON.stringify({ tool_name: 'mcp__slack__send_message', tool_input: { channel: 'C1', text: 'hi' }, session_id: 's1' }),
    ].map((raw) => out(decideWith(raw, {}, deps)));
    assert.deepEqual(store.sessions, {}, 'no two-step token was started or approved');
    assert.equal(decideWith(event('git status'), {}, deps), null);
    return results.map((r) => [r.permissionDecision, r.permissionDecisionReason.replaceAll(home.replace(/\\/g, '/'), '~'), r.updatedInput]);
  };
  withDir((autoHome) => withDir((switchHome) => {
    autoState(autoHome).enter(ENTERED);
    mkdirSync(join(switchHome, '.claude'));
    writeFileSync(unattendedFile(switchHome), '');
    const auto = run(autoHome);
    assert.deepEqual(auto.map(([decision]) => decision), ['deny', 'deny', 'deny', 'deny', 'deny']);
    for (const [, reason] of auto) assert.match(reason, /^sorry-matt guard 無人值守模式：/);
    assert.match(auto[0][1], /發布版本或部署正式環境/);
    assert.match(auto[1][1], /會立即觸發正式部署/);
    assert.match(auto[2][1], /不經資源回收筒/);
    assert.match(auto[3][1], /兩段確認的第一次確認指令/);
    assert.deepEqual(auto, run(switchHome));
  }));
});

test('with neither source the guard asks as before and writes no state', () => {
  withDir((home) => {
    const deps = { home, store: memoryStore(), now: 5 };
    assert.equal(decisionOf(decideWith(event('npm publish'), {}, deps)), 'ask');
    assert.match(out(decideWith(event('rm -rf ~'), {}, deps)).permissionDecisionReason, /第一次確認/);
    assert.equal(decideWith(event('git status'), {}, deps), null);
    assert.deepEqual(readdirSync(home), [], 'nothing was written under the home directory');
  });
});

test('the entry line is allowed without a prompt and puts every session in unattended mode', () => {
  withDir((home) => {
    const deps = (now) => ({ home, store: memoryStore(), now, pluginRoot: PLUGIN });
    const line = enterCommand(PLUGIN, '使用者說要離開兩小時');
    assert.equal(line, `node "${PLUGIN.replace(/\\/g, '/')}/hooks/enter-unattended.mjs" "使用者說要離開兩小時"`);
    assert.equal(decisionOf(decideWith(event('npm publish'), {}, deps(1000))), 'ask');

    const allowed = out(decideWith(event(line), {}, deps(2000)));
    assert.equal(allowed.permissionDecision, 'allow');
    assert.equal(allowed.updatedInput, undefined);
    assert.deepEqual(savedState(home), { entered: { at: 2000, reason: '使用者說要離開兩小時', by: 'agent', session: 's1' }, blocked: [] });

    // The same session and another one: the next call that needs the user is blocked.
    assert.equal(decisionOf(decideWith(event('npm publish'), {}, deps(3000))), 'deny');
    assert.equal(decisionOf(decideWith(event('rm -rf ~', { session_id: 's2' }), {}, deps(4000))), 'deny');
    assert.equal(decideWith(event('git status', { session_id: 's2' }), {}, deps(4500)), null);

    // Entering again changes nothing: the first time and reason stay, and so does the list.
    for (const again of [line, enterCommand(PLUGIN, '另一個原因')]) {
      assert.equal(decisionOf(decideWith(event(again, { session_id: 's2', tool_name: 'PowerShell' }), {}, deps(9000))), 'allow');
    }
    assert.equal(enter('第三個原因', { state: autoState(home), now: 9500 }).ok, true);
    const state = savedState(home);
    assert.deepEqual(state.entered, { at: 2000, reason: '使用者說要離開兩小時', by: 'agent', session: 's1' });
    assert.deepEqual(state.blocked.map((b) => [b.session, b.at, b.subject]), [['s1', 3000, 'npm publish'], ['s2', 4000, 'rm -rf ~']]);
  });
});

test('only the entry line itself, unchanged and alone, is allowed', () => {
  withDir((home) => {
    const deps = { home, store: memoryStore(), now: 1, pluginRoot: PLUGIN };
    const script = `${PLUGIN.replace(/\\/g, '/')}/hooks/enter-unattended.mjs`;
    const line = enterCommand(PLUGIN, 'away');
    for (const command of [
      `${line} && npm publish`,
      `${line}; echo done`,
      `echo go && ${line}`,
      `${line} | cat`,
      `${line} > out.txt`,
      `bash -c '${line}'`,
      `FOO=1 ${line}`,
      `node --no-warnings "${script}" "away"`,
      `node "${script}" "away" extra`,
      `node "${script}"`,
      `node "${script}" ""`,
      `node "${script}" away`,
      `node "${script}" "$(npm publish)"`,
      `node "${script}" "\`npm publish\`"`,
      `node "/elsewhere/hooks/enter-unattended.mjs" "away"`,
      `node "${PLUGIN.replace(/\\/g, '/')}/hooks/confirm-state.mjs" "away"`,
      `cd "${PLUGIN.replace(/\\/g, '/')}/hooks" && node enter-unattended.mjs "away"`,
      `node -e "import('${script}')" "away"`,
      `node "${script}" 'away'`,
    ]) {
      assert.notEqual(decisionOf(decideWith(event(command), {}, deps)), 'allow', command);
    }
    assert.equal(existsSync(autoStateFile(home)), false, 'none of them entered');
    assert.equal(decisionOf(decideWith(event(line), {}, deps)), 'allow');
    assert.equal(savedState(home).entered.reason, 'away');
  });
});

test('every block while unattended, from either source, is added to the list', () => {
  withDir((home) => {
    const deps = (now) => ({ home, store: memoryStore(), now, pluginRoot: PLUGIN });
    // The user's source alone: listed, and the automatic state stays off.
    decideWith(event('npm publish'), { SORRY_MATT_UNATTENDED: 'on' }, deps(100));
    assert.equal(savedState(home).entered, undefined);
    assert.equal(autoState(home).active(), false);
    // The automatic source.
    autoState(home).enter(ENTERED);
    decideWith(JSON.stringify({ tool_name: 'mcp__slack__send_message', tool_input: { channel: 'C1', text: 'hi' }, session_id: 's2' }), {}, deps(200));
    decideWith(event('git status'), {}, deps(300));
    const { blocked } = savedState(home);
    assert.equal(blocked.length, 2, 'what is let through is not listed');
    assert.deepEqual(blocked.map((b) => [b.session, b.at, b.subject]), [['s1', 100, 'npm publish'], ['s2', 200, 'mcp__slack__send_message']]);
    assert.match(blocked[0].reason, /發布版本或部署正式環境.*npm publish/);
    assert.match(blocked[1].reason, /送出後無法收回/);
  });
});

test('a blocked call stays denied when the list cannot be written', () => {
  const state = { active: () => true, record: () => { throw new Error('EACCES'); }, enter: () => { throw new Error('EACCES'); } };
  assert.equal(decisionOf(decideWith(event('npm publish'), {}, { state, store: memoryStore(), now: 1, home: '/nowhere' })), 'deny');
  assert.equal(decisionOf(decideWith(event('rm -rf ~'), {}, { state, store: memoryStore(), now: 1, home: '/nowhere' })), 'deny');
  // With the user's switch as the only source, too.
  const off = { ...state, active: () => false };
  assert.equal(decisionOf(decideWith(event('npm publish'), { SORRY_MATT_UNATTENDED: '1' }, { state: off, store: memoryStore(), now: 1, home: '/nowhere' })), 'deny');
  // The entry line is still let through: the script it runs writes the entry itself, and says so when it cannot.
  assert.equal(decisionOf(decideWith(event(enterCommand(PLUGIN, 'away')), {}, { state, pluginRoot: PLUGIN, store: memoryStore(), now: 1 })), 'allow');
  assert.deepEqual(enter('away', { state, now: 1 }).ok, false);
});

test('an automatic state that is missing, unreadable or damaged is no automatic state', () => {
  const damaged = ['', 'not json', '[]', 'null', '{"entered": "yes"}', '{"entered": {"reason": "no time"}}', '{"entered": {"at": "soon"}}', '{"blocked": [{"at": 1}]}',
    // A time no Date can hold, or no reason: damaged too, not an entry in force.
    '{"entered": {"at": 1e300, "reason": "r"}}', '{"entered": {"at": -1e300, "reason": "r"}}', '{"entered": {"at": 1e16, "reason": "r"}}', '{"entered": {"at": 1e300}}', '{"entered": {"at": 1}}', '{"entered": {"at": 1, "reason": 5}}'];
  for (const text of damaged) {
    withDir((home) => {
      mkdirSync(dirname(autoStateFile(home)), { recursive: true });
      writeFileSync(autoStateFile(home), text);
      const result = decideWith(event('npm publish'), {}, { home, store: memoryStore(), now: 1 });
      assert.equal(decisionOf(result), 'ask', text);
      assert.doesNotMatch(out(result).permissionDecisionReason, /guard 錯誤/, text);
      assert.equal(decideWith(event('git status'), {}, { home, store: memoryStore(), now: 1 }), null, text);
    });
  }
  withDir((home) => {
    // A directory where the file should be: it cannot be read at all.
    mkdirSync(autoStateFile(home), { recursive: true });
    assert.equal(decisionOf(decideWith(event('npm publish'), {}, { home, store: memoryStore(), now: 1 })), 'ask');
  });
  withDir((home) => {
    // A damaged file can still be entered over.
    mkdirSync(dirname(autoStateFile(home)), { recursive: true });
    writeFileSync(autoStateFile(home), 'not json');
    assert.equal(decisionOf(decideWith(event(enterCommand(PLUGIN, 'away')), {}, { home, pluginRoot: PLUGIN, store: memoryStore(), now: 7 })), 'allow');
    assert.deepEqual(savedState(home), { entered: { at: 7, reason: 'away', by: 'agent', session: 's1' }, blocked: [] });
  });
  withDir((home) => {
    // So can an entry whose time no Date can hold: the script enters and reports, with no RangeError.
    mkdirSync(dirname(autoStateFile(home)), { recursive: true });
    writeFileSync(autoStateFile(home), '{"entered": {"at": 1e300, "reason": "r"}}');
    const result = enter('away', { state: autoState(home), now: Date.UTC(2026, 10, 21) });
    assert.equal(result.ok, true, result.text);
    assert.match(result.text, /進入時間 2026-11-21T00:00:00\.000Z，原因：away/);
    assert.deepEqual(savedState(home).entered, { at: Date.UTC(2026, 10, 21), reason: 'away', by: 'agent', session: null });
  });
});

test('the unattended deny says how each source ends and that the agent ends neither', () => {
  withDir((home) => {
    autoState(home).enter(ENTERED);
    const reason = out(decideWith(event('npm publish'), {}, { home, store: memoryStore(), now: 1 })).permissionDecisionReason;
    assert.ok(reason.includes(`使用者移除開關檔 ${unattendedFile(home).replace(/\\/g, '/')} 或拿掉環境變數 SORRY_MATT_UNATTENDED`), reason);
    assert.match(reason, /自動進入的，使用者回來送出訊息後解除/);
    assert.match(reason, /agent 兩種都不能動/);
    assert.match(reason, /人工作業清單/);
  });
});

test('the entry line end to end: the hook process enters, and other sessions are blocked on their next call', () => {
  withDir((home) => {
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const guard = (command, session_id) => {
      const result = spawnSync(process.execPath, [join(root, 'hooks', 'guard.mjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD, session_id, permission_mode: 'default' }), encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
    };
    assert.equal(guard('npm publish', 'a').permissionDecision, 'ask');
    const before = Date.now();
    const allowed = guard(enterCommand(root, '提問沒有人回'), 'a');
    assert.equal(allowed.hookEventName, 'PreToolUse');
    assert.equal(allowed.permissionDecision, 'allow');
    const { entered } = savedState(home);
    assert.equal(entered.reason, '提問沒有人回');
    assert.equal(entered.session, 'a');
    assert.ok(entered.at >= before && entered.at <= Date.now(), 'the entry time is when the hook ran');

    // The line then runs: it reports the entry already in force and changes nothing.
    const ran = spawnSync(process.execPath, [join(root, 'hooks', 'enter-unattended.mjs'), '提問沒有人回'], { encoding: 'utf8', env });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /已進入無人值守模式.*原因：提問沒有人回/s);
    assert.deepEqual(savedState(home).entered, entered);
    assert.equal(spawnSync(process.execPath, [join(root, 'hooks', 'enter-unattended.mjs')], { encoding: 'utf8', env }).status, 1, 'no reason, no entry');

    assert.equal(guard('npm publish', 'a').permissionDecision, 'deny');
    assert.equal(guard('rm -rf ~', 'b').permissionDecision, 'deny');
    assert.equal(guard('git status', 'b'), null);
    assert.deepEqual(savedState(home).blocked.map((b) => [b.session, b.subject]), [['a', 'npm publish'], ['b', 'rm -rf ~']]);
  });
});

test('every session is handed the entry line at start: filled in and run as it is, it is allowed and enters', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  const entry = config.hooks.SessionStart.find((e) => e.hooks.some((h) => h.command.includes('hooks/unattended-intro.mjs')));
  assert.equal(entry.matcher, undefined, 'on every SessionStart source: startup, resume, clear and compact');
  assert.equal(entry.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/unattended-intro.mjs"');

  for (const tool_name of ['Bash', 'PowerShell']) {
    withDir((home) => {
      // CLAUDE_PLUGIN_ROOT as Claude Code sets it for every hook: native separators, backslashes on Windows.
      const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root };
      delete env.SORRY_MATT_GUARD;
      delete env.SORRY_MATT_UNATTENDED;
      const started = spawnSync(process.execPath, [join(root, 'hooks', 'unattended-intro.mjs')], { input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: CWD, session_id: 'a' }), encoding: 'utf8', env });
      assert.equal(started.status, 0, started.stderr);
      const handed = started.stdout.split(/\r?\n/).filter((l) => l.startsWith('node ') && l.endsWith('"<原因>"'));
      assert.equal(handed.length, 1, started.stdout);
      const command = handed[0].replace('<原因>', '使用者說要去開會');
      const result = spawnSync(process.execPath, [join(root, 'hooks', 'guard.mjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command }, cwd: CWD, session_id: 'a', permission_mode: 'default' }), encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'allow', `${tool_name} ${command}`);
      assert.equal(savedState(home).entered.reason, '使用者說要去開會');
      assert.equal(savedState(home).entered.session, 'a');
      // With the guard off there is nothing to hand out.
      const off = spawnSync(process.execPath, [join(root, 'hooks', 'unattended-intro.mjs')], { input: '{}', encoding: 'utf8', env: { ...env, SORRY_MATT_GUARD: 'off' } });
      assert.equal(off.status, 0, off.stderr);
      assert.equal(off.stdout, '');
    });
  }
});

test('hook processes writing the state at the same time lose nothing and leave no partial file', async () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-guard-')));
  try {
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root, SORRY_MATT_UNATTENDED: 'on' };
    delete env.SORRY_MATT_GUARD;
    const hook = (command, session_id) => new Promise((done, fail) => {
      const child = spawn(process.execPath, [join(root, 'hooks', 'guard.mjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.on('error', fail);
      child.on('close', (code) => done({ code, decision: stdout ? JSON.parse(stdout).hookSpecificOutput.permissionDecision : null }));
      child.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD, session_id, permission_mode: 'default' }));
    });
    const sessions = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const results = await Promise.all([
      ...sessions.map((s) => hook(`npm publish --tag ${s}`, s)),
      hook(enterCommand(root, 'first'), 'enter-1'),
      hook(enterCommand(root, 'second'), 'enter-2'),
    ]);
    assert.deepEqual(results.map((r) => r.code), Array(14).fill(0));
    assert.deepEqual(results.map((r) => r.decision), [...Array(12).fill('deny'), 'allow', 'allow']);
    const state = savedState(home);
    assert.deepEqual(state.blocked.map((b) => b.session).sort(), [...sessions].sort(), 'every block is on the list, once');
    assert.deepEqual(state.blocked.map((b) => b.subject).sort(), sessions.map((s) => `npm publish --tag ${s}`).sort());
    assert.ok(['first', 'second'].includes(state.entered.reason));
    assert.deepEqual(readdirSync(dirname(autoStateFile(home))), ['unattended.json'], 'no lock or temp file is left behind');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a state file that cannot be read is never written over: the entry and the list survive', () => {
  withDir((home) => {
    const state = autoState(home);
    state.enter(ENTERED);
    state.record({ session: 's1', at: 10, subject: 'npm publish', reason: 'r1' });
    state.record({ session: 's2', at: 20, subject: 'rm -rf ~', reason: 'r2' });
    const before = readFileSync(autoStateFile(home), 'utf8');
    for (const code of ['EIO', 'EBUSY']) {
      const unreadable = autoState(home, { read: () => { throw Object.assign(new Error(code), { code }); } });
      assert.throws(() => unreadable.record({ session: 's3', at: 30, subject: 'npm publish', reason: 'r3' }), { code });
      assert.throws(() => unreadable.enter({ at: 40, reason: 'later', by: 'agent', session: 's3' }), { code });
      // Reading still never throws, and the hook still denies under the user's switch.
      assert.equal(unreadable.active(), false);
      assert.deepEqual(unreadable.read(), { entered: null, pending: [], pendingOff: [], blocked: [] });
      assert.throws(() => unreadable.clear(), { code });
      assert.throws(() => unreadable.clearAll(), { code });
      assert.throws(() => unreadable.defer({ session: 's3', prompt_id: 'p1' }), { code });
      assert.throws(() => unreadable.deferOff({ session: 's3', prompt_id: 'p1' }), { code });
      assert.equal(decisionOf(decideWith(event('npm publish'), { SORRY_MATT_UNATTENDED: 'on' }, { state: unreadable, store: memoryStore(), now: 50, home })), 'deny', code);
      assert.equal(readFileSync(autoStateFile(home), 'utf8'), before, code);
    }
    assert.deepEqual(savedState(home).entered, ENTERED);
    assert.deepEqual(savedState(home).blocked.map((b) => b.subject), ['npm publish', 'rm -rf ~']);
  });
});

test('the entry line names the script as handed out: a case variant, even of the same file, gets no allow', () => {
  const slashed = (p) => p.replace(/\\/g, '/');
  const call = (path, tool_name = 'Bash') => ({ tool_name, tool_input: { command: `node "${path}" "away"` }, cwd: CWD });
  const variantsOf = (script) => [script.replace('enter-unattended.mjs', 'Enter-Unattended.mjs'), script.replace('enter-unattended.mjs', 'ENTER-UNATTENDED.MJS'), script.replace('/hooks/', '/Hooks/')];

  // A plugin root that is not on disk: only the spelling as handed out is the line, on every platform.
  const ghost = `${slashed(PLUGIN)}/hooks/enter-unattended.mjs`;
  assert.equal(enterInvocation(call(ghost), PLUGIN), 'away');
  for (const path of variantsOf(ghost)) assert.equal(enterInvocation(call(path), PLUGIN), null, path);

  withDir((dir) => {
    const plugin = join(dir, 'Plugin');
    const hooks = join(plugin, 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, 'enter-unattended.mjs'), '// the real one\n');
    const script = slashed(join(hooks, 'enter-unattended.mjs'));
    assert.equal(enterCommand(plugin, 'away'), `node "${script}" "away"`);
    assert.equal(enterInvocation(call(script), plugin), 'away');
    // Case-insensitive file systems open the real script under all of these; the guard still reads only the text.
    const spellings = [...variantsOf(script), script.replace('/Plugin/', '/plugin/')];
    if (/^[A-Za-z]:\//.test(script)) spellings.push(script[0].toLowerCase() + script.slice(1), script[0].toUpperCase() + script.slice(1));
    for (const path of spellings.filter((p) => p !== script)) {
      for (const tool_name of ['Bash', 'PowerShell']) assert.equal(enterInvocation(call(path, tool_name), plugin), null, `${tool_name} ${path}`);
      withDir((home) => {
        assert.notEqual(decisionOf(decideWith(event(`node "${path}" "away"`), {}, { home, pluginRoot: plugin, store: memoryStore(), now: 1 })), 'allow', path);
        assert.equal(existsSync(autoStateFile(home)), false, 'the state stays not entered');
      });
    }
  });
});

test('under PowerShell a curly quote ends a quoted word, so a line with one is not the entry line', () => {
  withDir((home) => {
    const script = `${PLUGIN.replace(/\\/g, '/')}/hooks/enter-unattended.mjs`;
    const deps = { home, pluginRoot: PLUGIN, store: memoryStore(), now: 1 };
    const commands = [
      // The reported bypass: the reason "ends" at a curly quote and a second command follows.
      `node "${script}" "away\u201d ; calc \u201cx"`,
      `node "${script}" 'away\u2019 ; calc \u2018x'`,
      `node "${script}\u201d ; calc \u201cx" "away"`,
      `node '${script}\u2019 ; calc \u2018x' 'away'`,
      // Each of the characters PowerShell takes for a quote, in the reason.
      ...['\u2018', '\u2019', '\u201a', '\u201b', '\u201c', '\u201d', '\u201e'].flatMap((q) => [`node "${script}" "a${q}way"`, `node "${script}" 'a${q}way'`]),
    ];
    for (const command of commands) {
      assert.equal(enterInvocation({ tool_name: 'PowerShell', tool_input: { command }, cwd: CWD }, PLUGIN), null, command);
      assert.notEqual(decisionOf(decideWith(event(command, { tool_name: 'PowerShell' }), {}, deps)), 'allow', command);
    }
    assert.equal(existsSync(autoStateFile(home)), false, 'the state stays not entered');
    // Plain quotes are still the line under PowerShell; under Bash a curly quote is an ordinary character of the reason.
    assert.equal(enterInvocation({ tool_name: 'PowerShell', tool_input: { command: `node "${script}" "away"` }, cwd: CWD }, PLUGIN), 'away');
    assert.equal(enterInvocation({ tool_name: 'Bash', tool_input: { command: `node "${script}" "他說\u201c晚安\u201d"` }, cwd: CWD }, PLUGIN), '他說\u201c晚安\u201d');
  });
});

test('a command with a line break in it is not the entry line, in either shell', () => {
  withDir((home) => {
    const script = `${PLUGIN.replace(/\\/g, '/')}/hooks/enter-unattended.mjs`;
    for (const tool_name of ['Bash', 'PowerShell']) {
      for (const command of [
        `node "${script}"\r"away"`,
        `node "${script}"\n"away"`,
        `node\r"${script}" "away"`,
        `node "${script}" "away"\r`,
        `node "${script}" "away"\n`,
        `\rnode "${script}" "away"`,
        `node "${script}" "a\rway"`,
        `node "${script}" 'a\nway'`,
        `node "${script}" "a\u2028way"`,
        `node "${script}"\f"away"`,
      ]) {
        assert.equal(enterInvocation({ tool_name, tool_input: { command }, cwd: CWD }, PLUGIN), null, JSON.stringify(command));
        assert.notEqual(decisionOf(decideWith(event(command, { tool_name }), {}, { home, pluginRoot: PLUGIN, store: memoryStore(), now: 1 })), 'allow', JSON.stringify(command));
      }
    }
    assert.equal(existsSync(autoStateFile(home)), false, 'the state stays not entered');
    assert.equal(autoState(home).active(), false);
  });
});

test('the path word of the entry line is the script path as written: no option, no .. and no other route to it', () => {
  withDir((dir) => withDir((home) => {
    const slashed = (p) => p.replace(/\\/g, '/');
    const plugin = join(dir, 'plugin');
    const work = join(dir, 'work');
    mkdirSync(join(plugin, 'hooks'), { recursive: true });
    mkdirSync(work);
    writeFileSync(join(plugin, 'hooks', 'enter-unattended.mjs'), '');
    writeFileSync(join(work, 'evil.js'), '');
    const script = slashed(join(plugin, 'hooks', 'enter-unattended.mjs'));
    const tail = 'plugin/hooks/enter-unattended.mjs';
    const refused = [
      // A node option in the path's place: node would run the second word as the script.
      `node "--title=x/../../${tail}" "evil.js"`,
      `node --title=x/../../${tail} "evil.js"`,
      `node '--title=x/../../${tail}' 'evil.js'`,
      `node "-r/../../${tail}" "evil.js"`,
      `node "--require=${script}" "evil.js"`,
      `node "-" "away"`,
      // The script reached through `..`, `.` or an empty segment, or relative to wherever the shell is.
      `node "${slashed(work)}/../${tail}" "away"`,
      `node "${script}/../enter-unattended.mjs" "away"`,
      `node "${slashed(plugin)}/./hooks/enter-unattended.mjs" "away"`,
      `node "${slashed(plugin)}/hooks//enter-unattended.mjs" "away"`,
      `node "${slashed(plugin)}/.. /plugin/hooks/enter-unattended.mjs" "away"`,
      `node "../${tail}" "away"`,
      `node calc/../../${tail} "away"`,
      `node "${script}/" "away"`,
      // The path not written as the one double-quoted literal the guard hands out.
      `node ${script} "away"`,
      `node '${script}' "away"`,
      `node "${script.replace(/\//g, '\\')}" "away"`,
      // Names that are not the plain file, and control characters anywhere.
      `node "${script}:evil" "away"`,
      `node "${script}::\$DATA" "away"`,
      `node "//?/${script}" "away"`,
      `node "${script}" "a\x1bway"`,
      `node "${script}" "a\x00way"`,
      `node "${script}\x7f" "away"`,
    ];
    for (const tool_name of ['Bash', 'PowerShell']) {
      for (const command of refused) {
        assert.equal(enterInvocation({ tool_name, tool_input: { command }, cwd: work }, plugin), null, `${tool_name} ${JSON.stringify(command)}`);
        assert.notEqual(decisionOf(decideWith(event(command, { tool_name, cwd: work }), {}, { home, pluginRoot: plugin, store: memoryStore(), now: 1 })), 'allow', `${tool_name} ${JSON.stringify(command)}`);
      }
    }
    assert.equal(existsSync(autoStateFile(home)), false, 'the state stays not entered');
    // The line as handed out is still the line, in both shells.
    for (const tool_name of ['Bash', 'PowerShell']) {
      assert.equal(enterInvocation({ tool_name, tool_input: { command: enterCommand(plugin, 'away') }, cwd: work }, plugin), 'away', tool_name);
    }
  }));
});

test('the entry line is the handed-out text byte for byte: no Git Bash /c/ spelling, other quotes or spacing', () => {
  withDir((home) => {
    const line = enterCommand(PLUGIN, 'away');
    const script = `${PLUGIN.replace(/\\/g, '/')}/hooks/enter-unattended.mjs`;
    // Git Bash's /c/ spelling of the script: the drive letter turned into a first segment. A POSIX root has no drive,
    // so there the same /c/ spelling is the script under a leading /c, still another text than the line.
    const gitBash = (path) => (/^[A-Za-z]:\//.test(path) ? path.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`) : `/c${path}`);
    const refused = [
      // Git Bash leaves a /c/… argument untranslated when it holds `'`, `;`, `[`, `]` or a `~` segment, or under
      // MSYS_NO_PATHCONV, and node then opens another path: so no /c/ spelling is the line, whatever it holds.
      `node "${gitBash(script)}" "away"`,
      `node "/c/Users/me/links/a;b/hooks/enter-unattended.mjs" "away"`,
      `node "/c/Users/me/links/o'b/hooks/enter-unattended.mjs" "away"`,
      `node "/c/Users/me/links/[b]/hooks/enter-unattended.mjs" "away"`,
      `node "/c/Users/me/~t/hooks/enter-unattended.mjs" "away"`,
      `MSYS_NO_PATHCONV=1 ${line}`,
      // Other spacing or quoting of the very same words.
      ` ${line}`,
      `${line} `,
      `${line}\t`,
      line.replace('node ', 'node  '),
      line.replace('node ', 'node\t'),
      line.replace('" "', '"  "'),
      `node "${script}" 'away'`,
      `"node" "${script}" "away"`,
      `node.exe "${script}" "away"`,
      `NODE "${script}" "away"`,
      `node "${script.replace(/\.mjs$/, '.MJS')}" "away"`,
      // The reason has to stay one literal word in both shells.
      enterCommand(PLUGIN, 'a"b'),
      enterCommand(PLUGIN, 'a$HOME'),
      enterCommand(PLUGIN, 'a`b`'),
      enterCommand(PLUGIN, 'a\\b'),
      enterCommand(PLUGIN, 'a\tb'),
      enterCommand(PLUGIN, ' '),
      enterCommand(PLUGIN, ''),
    ];
    // Each case is a rewrite of the line on every platform, never the line itself.
    for (const command of refused) assert.notEqual(command, line, JSON.stringify(command));
    for (const tool_name of ['Bash', 'PowerShell']) {
      for (const command of refused) {
        assert.equal(enterInvocation({ tool_name, tool_input: { command }, cwd: CWD }, PLUGIN), null, `${tool_name} ${JSON.stringify(command)}`);
        assert.notEqual(decisionOf(decideWith(event(command, { tool_name }), {}, { home, pluginRoot: PLUGIN, store: memoryStore(), now: 1 })), 'allow', `${tool_name} ${JSON.stringify(command)}`);
      }
    }
    // The handed-out prefix with no closing quote, or something else after the reason: neither shell runs it as the
    // line (Bash: unexpected EOF; PowerShell: missing terminator), so it is not the line.
    const [prefix] = enterCommand(PLUGIN, '\0').split('\0');
    for (const command of [`${prefix}awayX`, `${prefix}away\u201d`, `${prefix}away\n`, `${prefix}away" `, `${prefix}away"x`]) {
      for (const tool_name of ['Bash', 'PowerShell']) {
        assert.equal(enterInvocation({ tool_name, tool_input: { command }, cwd: CWD }, PLUGIN), null, `${tool_name} ${JSON.stringify(command)}`);
        assert.equal(decideWith(event(command, { tool_name }), {}, { home, pluginRoot: PLUGIN, store: memoryStore(), now: 1 }), null, `${tool_name} ${JSON.stringify(command)}`);
      }
    }
    assert.equal(autoState(home).active(), false);
    // Windows PowerShell 5.1 reads even a quoted `--%` as the stop-parsing token and drops the reason; Bash does not.
    assert.equal(enterInvocation({ tool_name: 'PowerShell', tool_input: { command: enterCommand(PLUGIN, '--%') }, cwd: CWD }, PLUGIN), null);
    assert.equal(enterInvocation({ tool_name: 'Bash', tool_input: { command: enterCommand(PLUGIN, '--%') }, cwd: CWD }, PLUGIN), '--%');
    // A plugin root the shell would expand is never the line, even as handed out.
    const odd = process.platform === 'win32' ? 'C:\\plugins\\$HOME' : '/plugins/$HOME';
    assert.equal(enterInvocation({ tool_name: 'Bash', tool_input: { command: enterCommand(odd, 'away') }, cwd: CWD }, odd), null);
    assert.equal(existsSync(autoStateFile(home)), false, 'the state stays not entered');

    // The line as handed out is the line in both shells, with the reason trimmed and free text inside it.
    for (const tool_name of ['Bash', 'PowerShell']) {
      assert.equal(enterInvocation({ tool_name, tool_input: { command: line }, cwd: CWD }, PLUGIN), 'away', tool_name);
      assert.equal(enterInvocation({ tool_name, tool_input: { command: enterCommand(PLUGIN, ' 睡了 (2h); 晚點見 ') }, cwd: CWD }, PLUGIN), '睡了 (2h); 晚點見', tool_name);
    }
  });
});

// ---------- unattended: AskUserQuestion (#93) ----------

// Shaped like Claude Code's AskUserQuestion input: one to four questions, each with a header and options.
const asking = (questions = ['要用哪個資料庫？', '要不要保留舊 API？'], extra = {}) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', session_id: 's4', cwd: CWD, permission_mode: 'default',
  tool_input: { questions: questions.map((question, i) => ({ question, header: `Q${i + 1}`, multiSelect: false, options: [{ label: '是', description: 'a' }, { label: '否', description: 'b' }] })) },
  ...extra,
});
const AWAY = {
  'the switch file': (home) => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(unattendedFile(home), '');
    return {};
  },
  SORRY_MATT_UNATTENDED: () => ({ SORRY_MATT_UNATTENDED: 'on' }),
  'the automatic state': (home) => {
    autoState(home).enter(ENTERED);
    return {};
  },
};

test('unattended, from any source, a question is denied: three ways on, no waiting, and it is listed with its text', () => {
  for (const [source, setUp] of Object.entries(AWAY)) {
    withDir((home) => {
      const env = setUp(home);
      const store = memoryStore();
      const result = out(decideWith(asking(), env, { home, store, now: 42 }));
      assert.equal(result.permissionDecision, 'deny', source);
      assert.equal(result.updatedInput, undefined, source);
      const reason = result.permissionDecisionReason;
      assert.match(reason, /^sorry-matt guard 無人值守模式：/, source);
      assert.ok(reason.includes('要用哪個資料庫？') && reason.includes('要不要保留舊 API？'), reason);
      // The three ways on of ASKING.md section 4, then the rest of the work.
      assert.match(reason, /依自己的判斷代答，並記錄/, source);
      assert.match(reason, /列為待裁決/, source);
      assert.match(reason, /列進人工作業清單/, source);
      assert.match(reason, /然後繼續做其他做得了的事/, source);
      assert.match(reason, /不要停下來等/, source);
      assert.match(reason, /不要重問/, source);
      assert.doesNotMatch(reason, /這個動作需要使用者確認/, 'not the generic park text');
      // How each source ends, and that the agent touches neither file.
      assert.match(reason, /不要刪除、改寫或搬移開關檔與自動進入的狀態檔/, source);
      assert.ok(reason.includes(unattendedFile(home).replace(/\\/g, '/')), reason);
      assert.deepEqual(store.sessions, {}, 'no two-step token');
      assert.deepEqual(savedState(home).blocked, [{ session: 's4', at: 42, subject: 'AskUserQuestion: 要用哪個資料庫？ / 要不要保留舊 API？', reason: '無人值守期間的提問' }], source);
    });
  }
});

test('a blocked question is listed by each of its questions, or by the tool name when it has none', () => {
  withDir((home) => {
    const deps = (now) => ({ home, store: memoryStore(), now });
    const env = { SORRY_MATT_UNATTENDED: '1' };
    assert.equal(decisionOf(decideWith(asking(['只有一題']), env, deps(1))), 'deny');
    assert.equal(decisionOf(decideWith(asking([], { tool_input: {} }), env, deps(2))), 'deny');
    assert.equal(decisionOf(decideWith(asking([], { tool_input: { questions: 'broken' } }), env, deps(3))), 'deny');
    // Blank and whitespace-only questions are left out of the subject and the deny text.
    const blanks = out(decideWith(asking(['', '  ', '只有一題']), env, deps(4))).permissionDecisionReason;
    assert.ok(blanks.includes('被擋下的提問：只有一題\n'), blanks);
    assert.deepEqual(savedState(home).blocked.map((b) => b.subject), ['AskUserQuestion: 只有一題', 'AskUserQuestion', 'AskUserQuestion', 'AskUserQuestion: 只有一題']);
  });
});

test('a blocked question stays denied when the list cannot be written', () => {
  const state = { active: () => true, record: () => { throw new Error('EACCES'); }, enter: () => { throw new Error('EACCES'); } };
  const result = out(decideWith(asking(), {}, { state, store: memoryStore(), now: 1, home: '/nowhere' }));
  assert.equal(result.permissionDecision, 'deny');
  assert.match(result.permissionDecisionReason, /列為待裁決/);
  const off = { ...state, active: () => false };
  assert.equal(decisionOf(decideWith(asking(), { SORRY_MATT_UNATTENDED: '1' }, { state: off, store: memoryStore(), now: 1, home: '/nowhere' })), 'deny');
});

test('with nobody away a question is left alone and nothing is written; with the guard off, even while away', () => {
  withDir((home) => {
    assert.equal(decideWith(asking(), {}, { home, store: memoryStore(), now: 1 }), null);
    assert.equal(decideWith(asking(), { SORRY_MATT_UNATTENDED: 'off' }, { home, store: memoryStore(), now: 1 }), null);
    assert.deepEqual(readdirSync(home), [], 'nothing was written under the home directory');
  });
  for (const [source, setUp] of Object.entries(AWAY)) {
    withDir((home) => {
      const env = { ...setUp(home), SORRY_MATT_GUARD: 'off' };
      const before = existsSync(autoStateFile(home)) ? readFileSync(autoStateFile(home), 'utf8') : null;
      assert.equal(decideWith(asking(), env, { home, store: memoryStore(), now: 1 }), null, source);
      assert.equal(existsSync(autoStateFile(home)) ? readFileSync(autoStateFile(home), 'utf8') : null, before, source);
    });
  }
});

test('a question end to end: the hook process lets it be, then denies and lists it once the user is away', () => {
  withDir((home) => {
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const guard = (extraEnv = {}) => {
      const result = spawnSync(process.execPath, [join(root, 'hooks', 'guard.mjs')], { input: asking(), encoding: 'utf8', env: { ...env, ...extraEnv } });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : null;
    };
    assert.equal(guard(), null);
    assert.equal(existsSync(autoStateFile(home)), false);
    mkdirSync(join(home, '.claude'));
    writeFileSync(unattendedFile(home), '');
    assert.equal(guard({ SORRY_MATT_GUARD: 'off' }), null);
    assert.equal(existsSync(autoStateFile(home)), false, 'the guard off writes nothing');
    const denied = guard();
    assert.equal(denied.hookEventName, 'PreToolUse');
    assert.equal(denied.permissionDecision, 'deny');
    assert.match(denied.permissionDecisionReason, /列為待裁決/);
    assert.deepEqual(savedState(home).blocked.map((b) => [b.session, b.subject, b.reason]), [['s4', 'AskUserQuestion: 要用哪個資料庫？ / 要不要保留舊 API？', '無人值守期間的提問']]);
  });
});

// ---------- unattended: the user is back (UserPromptSubmit and Stop) ----------

// Transcript fixtures, shaped like Claude Code's session JSONL (scripts/unattended.live.mjs): the user entry of a turn
// carries the hook's prompt_id as `promptId`, and where the turn came from as `turnOrigin`.
const userLine = (promptId, origin, extra = {}) => JSON.stringify({
  parentUuid: null, isSidechain: false, promptId, type: 'user', message: { role: 'user', content: 'hello' },
  uuid: `u-${promptId}-${origin}`, timestamp: '2026-11-22T01:00:00.000Z', ...(origin === undefined ? {} : { turnOrigin: origin }), ...extra,
});
const assistantLine = (promptId) => JSON.stringify({ type: 'assistant', promptId, turnOrigin: 'human', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
const EARLIER = [JSON.stringify({ type: 'summary', summary: 'earlier' }), userLine('p0', 'human'), assistantLine('p0'), '{"type": "user", broken'];
const TRANSCRIPTS = {
  human: [...EARLIER, userLine('p1', 'human', { promptSource: 'typed', origin: { kind: 'human' } }), assistantLine('p1')],
  desktop: [...EARLIER, userLine('p1', 'human', { promptSource: 'sdk', entrypoint: 'claude-desktop' })],
  scheduled: [...EARLIER, userLine('p1', 'scheduled', { wakeupSource: 'loop_wakeup' }), userLine('p1', 'human')],
  task_notification: [...EARLIER, userLine('p1', 'task_notification', { origin: { kind: 'task-notification' } })],
  peer: [...EARLIER, userLine('p1', 'peer')],
  sdk: [...EARLIER, userLine('p1', 'sdk')],
  other: [...EARLIER, userLine('p1', 'Human')],
  missingField: [...EARLIER, userLine('p1', undefined)],
  notYet: [...EARLIER, assistantLine('p1')],
};
const writeTranscript = (dir, lines, name = 'session.jsonl') => {
  const path = join(dir, name);
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
};
const submit = (transcript_path, extra = {}) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's3', transcript_path, cwd: CWD, prompt_id: 'p1', prompt: 'I am back', permission_mode: 'default', ...extra });
const stop = (transcript_path, extra = {}) => JSON.stringify({ hook_event_name: 'Stop', session_id: 's3', transcript_path, cwd: CWD, stop_hook_active: false, ...extra });
// A clock the rereads move forward, so no test waits half a second.
const fakeClock = () => {
  const clock = { t: 0, slept: 0 };
  clock.now = () => clock.t;
  clock.sleep = (ms) => {
    clock.t += ms;
    clock.slept += ms;
  };
  return clock;
};
// The automatic state, entered from session s0, with two blocks: one from s0 and one from s2.
function awayHome(home) {
  autoState(home).enter(ENTERED);
  const deps = (now) => ({ home, store: memoryStore(), now, pluginRoot: PLUGIN });
  assert.equal(decisionOf(decideWith(event('npm publish', { session_id: 's0' }), {}, deps(3000))), 'deny');
  assert.equal(decisionOf(decideWith(event('rm -rf ~', { session_id: 's2' }), {}, deps(4000))), 'deny');
  return readFileSync(autoStateFile(home), 'utf8');
}
const noSwitch = () => false;

test('a person\'s turn in any session ends the automatic state and hands the agent every blocked action', () => {
  for (const kind of ['human', 'desktop']) {
    withDir((home) => {
      awayHome(home);
      const clock = fakeClock();
      const result = onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS[kind])), {}, { home, exists: noSwitch, ...clock });
      assert.equal(clock.slept, 0, 'the entry was there: no reread');
      assert.equal(result.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
      const context = result.hookSpecificOutput.additionalContext;
      assert.match(context, /自動進入的無人值守模式已解除（進入時間 2023-11-14T22:13:20\.000Z，原因：使用者說要去睡了）/);
      assert.match(context, /擋下了 2 個需要使用者確認的動作。請把下面的清單完整告訴使用者/);
      assert.match(context, /1\. session s0，1970-01-01T00:00:03\.000Z\n {3}原指令：npm publish\n {3}理由：sorry-matt guard 確認：這是發布版本或部署正式環境的動作/);
      assert.match(context, /2\. session s2，1970-01-01T00:00:04\.000Z\n {3}原指令：rm -rf ~\n {3}理由：.*不經資源回收筒/);
      assert.deepEqual(Object.keys(result), ['hookSpecificOutput'], 'JSON additionalContext, nothing else');
      assert.deepEqual(savedState(home), { blocked: [] }, 'entered is gone and the list is emptied');
      // Every session is asked as before.
      assert.equal(decisionOf(decideWith(event('npm publish', { session_id: 's2' }), {}, { home, store: memoryStore(), now: 6000 })), 'ask');
      // The list is handed over once: the next turn finds no automatic state and says nothing.
      assert.equal(onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS.human), { prompt_id: 'p0' }), {}, { home, exists: noSwitch }), null);
    });
  }
});

test('with nothing blocked the agent is still told the automatic state ended', () => {
  withDir((home) => {
    autoState(home).enter(ENTERED);
    const context = onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS.human)), {}, { home, exists: noSwitch }).hookSpecificOutput.additionalContext;
    assert.match(context, /已解除/);
    assert.match(context, /沒有擋下任何動作/);
    assert.deepEqual(savedState(home), { blocked: [] });
  });
});

test('a turn no person sent, or one that cannot be told, leaves the automatic state and the list as they are', () => {
  for (const kind of ['scheduled', 'task_notification', 'peer', 'sdk', 'other', 'missingField']) {
    withDir((home) => {
      const before = awayHome(home);
      const clock = fakeClock();
      assert.equal(onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS[kind])), {}, { home, exists: noSwitch, ...clock }), null, kind);
      assert.equal(readFileSync(autoStateFile(home), 'utf8'), before, kind);
      assert.equal(clock.slept, 0, `${kind}: the entry was found, so there is no reread`);
      assert.equal(decisionOf(decideWith(event('npm publish', { session_id: 's2' }), {}, { home, store: memoryStore(), now: 9 })), 'deny', kind);
    });
  }
  withDir((home) => {
    // A transcript that cannot be read: a directory where the file should be, or a read that fails.
    const before = awayHome(home);
    const dir = join(home, 'transcript-dir.jsonl');
    mkdirSync(dir);
    assert.equal(onPromptSubmit(submit(dir), {}, { home, exists: noSwitch, ...fakeClock() }), null);
    const eacces = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    assert.equal(onPromptSubmit(submit(join(home, 'any.jsonl')), {}, { home, exists: noSwitch, read: eacces, ...fakeClock() }), null);
    // An event without a transcript path or a prompt id, or one that is not JSON.
    assert.equal(onPromptSubmit(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's3', prompt_id: 'p1' }), {}, { home }), null);
    assert.equal(onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS.human), { prompt_id: undefined }), {}, { home }), null);
    assert.equal(onPromptSubmit('not json', {}, { home }), null);
    assert.equal(readFileSync(autoStateFile(home), 'utf8'), before);
  });
  withDir((home) => {
    // A transcript file that is not there: not ended; the turn is left to the session's Stop.
    const before = JSON.parse(awayHome(home));
    const transcript = join(home, 'nowhere.jsonl');
    const clock = fakeClock();
    assert.equal(onPromptSubmit(submit(transcript), {}, { home, exists: noSwitch, ...clock }), null);
    assert.equal(clock.slept, 500, 'a file not there yet is reread like an entry not written yet');
    const after = savedState(home);
    assert.deepEqual([after.entered, after.blocked], [before.entered, before.blocked]);
    assert.deepEqual(after.pending, [{ session: 's3', prompt_id: 'p1' }]);
    // The file shows up with the person's entry by the time the turn stops: Stop ends the state.
    writeFileSync(transcript, JSON.stringify({ type: 'user', promptId: 'p1', turnOrigin: 'human' }) + '\n');
    assert.equal(onStop(stop(transcript, { session_id: 's3' }), {}, { home, exists: noSwitch }).decision, 'block');
    assert.deepEqual(savedState(home), { blocked: [] });
  });
});

test('the transcript is matched on the first user entry with the prompt id, past broken lines', () => {
  assert.deepEqual(turnOrigin(TRANSCRIPTS.human.join('\n'), 'p1'), { found: true, origin: 'human' });
  assert.deepEqual(turnOrigin(TRANSCRIPTS.scheduled.join('\r\n'), 'p1'), { found: true, origin: 'scheduled' });
  assert.deepEqual(turnOrigin(TRANSCRIPTS.missingField.join('\n'), 'p1'), { found: true, origin: undefined });
  assert.deepEqual(turnOrigin(TRANSCRIPTS.notYet.join('\n'), 'p1'), { found: false }, 'an assistant entry is not the turn');
  assert.deepEqual(turnOrigin('', 'p1'), { found: false });
});

test('the user\'s own switch is never ended by a person\'s turn; only the automatic state is', () => {
  for (const source of ['file', 'env']) {
    withDir((home) => {
      const env = source === 'env' ? { SORRY_MATT_UNATTENDED: 'on' } : {};
      if (source === 'file') {
        mkdirSync(join(home, '.claude'), { recursive: true });
        writeFileSync(unattendedFile(home), '');
      }
      awayHome(home);
      const result = onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS.human)), env, { home });
      const context = result.hookSpecificOutput.additionalContext;
      assert.match(context, /擋下了 2 個/, source);
      assert.match(context, /使用者自己開的無人值守.*仍然開著/, source);
      assert.deepEqual(savedState(home), { blocked: [] }, source);
      if (source === 'file') assert.equal(existsSync(unattendedFile(home)), true, 'the switch file is still there');
      assert.equal(decisionOf(decideWith(event('npm publish', { session_id: 's2' }), env, { home, store: memoryStore(), now: 9 })), 'deny', source);
    });
  }
  withDir((home) => {
    // The switch alone: the hook says nothing and leaves the state file (and the list kept under the switch) alone.
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(unattendedFile(home), '');
    decideWith(event('npm publish'), {}, { home, store: memoryStore(), now: 1 });
    const before = readFileSync(autoStateFile(home), 'utf8');
    const read = () => assert.fail('the transcript is not read without the automatic state');
    assert.equal(onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS.human)), {}, { home, read }), null);
    assert.equal(onStop(stop(join(home, 'session.jsonl')), {}, { home, read }), null);
    assert.equal(readFileSync(autoStateFile(home), 'utf8'), before);
    assert.equal(existsSync(unattendedFile(home)), true);
  });
  withDir((home) => {
    // Neither source: nothing is printed and nothing is written.
    const transcript = writeTranscript(home, TRANSCRIPTS.human);
    assert.equal(onPromptSubmit(submit(transcript), {}, { home }), null);
    assert.equal(onStop(stop(transcript), {}, { home }), null);
    assert.deepEqual(readdirSync(home), ['session.jsonl']);
  });
});

test('an entry not written yet is reread for up to 500 ms, then decided by that session\'s Stop', () => {
  assert.equal(REREAD_MS, 500);
  withDir((home) => {
    const before = JSON.parse(awayHome(home));
    const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
    const clock = fakeClock();
    assert.equal(onPromptSubmit(submit(transcript), {}, { home, exists: noSwitch, ...clock }), null);
    assert.equal(clock.slept, 500, 'reread until 500 ms, and no longer');
    assert.deepEqual(savedState(home), { ...before, pending: [{ session: 's3', prompt_id: 'p1' }] });

    // Another session's Stop leaves it alone.
    assert.equal(onStop(stop(transcript, { session_id: 's4' }), {}, { home, exists: noSwitch }), null);
    assert.deepEqual(savedState(home).pending, [{ session: 's3', prompt_id: 'p1' }]);

    // The entry is written by the time the turn stops: a person's turn ends the state and blocks the stop with the list.
    writeTranscript(home, TRANSCRIPTS.human);
    const blocked = onStop(stop(transcript), {}, { home, exists: noSwitch });
    assert.equal(blocked.decision, 'block');
    assert.match(blocked.reason, /已解除/);
    assert.match(blocked.reason, /1\. session s0，1970-01-01T00:00:03\.000Z\n {3}原指令：npm publish/);
    assert.match(blocked.reason, /2\. session s2，1970-01-01T00:00:04\.000Z\n {3}原指令：rm -rf ~/);
    assert.deepEqual(savedState(home), { blocked: [] }, 'the pending turn went with the state, before the block');
    assert.equal(decisionOf(decideWith(event('npm publish', { session_id: 's2' }), {}, { home, store: memoryStore(), now: 9 })), 'ask');
    // The stop that block causes comes back with stop_hook_active, and finds nothing to do.
    assert.equal(onStop(stop(transcript, { stop_hook_active: true }), {}, { home }), null);
  });
  withDir((home) => {
    // stop_hook_active on the pending turn's own Stop changes nothing: it is still decided.
    awayHome(home);
    const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
    onPromptSubmit(submit(transcript), {}, { home, ...fakeClock() });
    writeTranscript(home, TRANSCRIPTS.human);
    assert.equal(onStop(stop(transcript, { stop_hook_active: true }), {}, { home, exists: noSwitch }).decision, 'block');
  });
  for (const kind of ['scheduled', 'task_notification', 'notYet']) {
    withDir((home) => {
      // Any other answer at Stop only drops the pending turn.
      const before = JSON.parse(awayHome(home));
      const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
      onPromptSubmit(submit(transcript), {}, { home, ...fakeClock() });
      writeTranscript(home, TRANSCRIPTS[kind]);
      assert.equal(onStop(stop(transcript), {}, { home }), null, kind);
      assert.deepEqual(savedState(home), before, kind);
    });
  }
  withDir((home) => {
    // An entry that shows up during the rereads ends the state right there.
    awayHome(home);
    let reads = 0;
    const read = () => (++reads < 3 ? TRANSCRIPTS.notYet : TRANSCRIPTS.human).join('\n');
    const clock = fakeClock();
    const result = onPromptSubmit(submit(join(home, 'session.jsonl')), {}, { home, exists: noSwitch, read, ...clock });
    assert.match(result.hookSpecificOutput.additionalContext, /擋下了 2 個/);
    assert.equal(clock.slept, 50);
    assert.deepEqual(savedState(home), { blocked: [] });
  });
  withDir((home) => {
    // Without the automatic state nothing is left pending.
    const state = autoState(home);
    assert.equal(state.defer({ session: 's3', prompt_id: 'p1' }), false);
    assert.equal(existsSync(autoStateFile(home)), false);
    assert.equal(onPromptSubmit(submit(writeTranscript(home, TRANSCRIPTS.notYet)), {}, { home, ...fakeClock() }), null);
    assert.equal(existsSync(autoStateFile(home)), false);
  });
});

test('with the guard off neither hook prints or writes anything', () => {
  withDir((home) => {
    const before = awayHome(home);
    const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
    const env = { SORRY_MATT_GUARD: 'off' };
    assert.equal(onPromptSubmit(submit(transcript), env, { home, ...fakeClock() }), null);
    writeTranscript(home, TRANSCRIPTS.human);
    assert.equal(onPromptSubmit(submit(transcript), env, { home }), null);
    assert.equal(readFileSync(autoStateFile(home), 'utf8'), before);
    // A pending turn is left for the guard's Stop, which with the guard off does nothing either.
    writeTranscript(home, TRANSCRIPTS.notYet);
    onPromptSubmit(submit(transcript), {}, { home, ...fakeClock() });
    const pending = readFileSync(autoStateFile(home), 'utf8');
    assert.match(pending, /"pending"/);
    writeTranscript(home, TRANSCRIPTS.human);
    assert.equal(onStop(stop(transcript), env, { home }), null);
    assert.equal(readFileSync(autoStateFile(home), 'utf8'), pending);
  });
});

test('clearing is one locked step: it returns what it removed once, and nothing without the automatic state', () => {
  withDir((home) => {
    const state = autoState(home);
    assert.equal(state.clear(), null);
    assert.equal(existsSync(autoStateFile(home)), false, 'nothing written');
    state.enter(ENTERED);
    state.record({ session: 's1', at: 10, subject: 'npm publish', reason: 'r1' });
    assert.equal(state.defer({ session: 's3', prompt_id: 'p1' }), true);
    assert.equal(state.defer({ session: 's3', prompt_id: 'p1' }), true);
    assert.deepEqual(state.read().pending, [{ session: 's3', prompt_id: 'p1' }], 'once on the list');
    assert.deepEqual(state.clear(), { entered: ENTERED, pending: [{ session: 's3', prompt_id: 'p1' }], blocked: [{ session: 's1', at: 10, subject: 'npm publish', reason: 'r1' }] });
    assert.equal(state.clear(), null);
    assert.equal(state.settle({ session: 's3', prompt_id: 'p1' }), false);
    assert.deepEqual(savedState(home), { blocked: [] });
  });
});

test('hooks.json registers unattended-return.mjs on every UserPromptSubmit and every Stop', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  for (const name of ['UserPromptSubmit', 'Stop']) {
    const entries = config.hooks[name].filter((e) => e.hooks.some((h) => h.command.includes('hooks/unattended-return.mjs')));
    assert.equal(entries.length, 1, name);
    assert.equal(entries[0].matcher, undefined, name);
    assert.deepEqual(entries[0].hooks, [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/unattended-return.mjs"' }], name);
  }
});

test('the user is back end to end: the hook process ends the state and the guard asks again in another session', () => {
  withDir((home) => {
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const hook = (script, input) => {
      const result = spawnSync(process.execPath, [join(root, 'hooks', script)], { input, encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout ? JSON.parse(result.stdout) : null;
    };
    const guard = (command, session_id) => hook('guard.mjs', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD, session_id, permission_mode: 'default' }))?.hookSpecificOutput.permissionDecision ?? null;
    assert.equal(guard(enterCommand(root, '使用者說要去睡了'), 'a'), 'allow');
    assert.equal(guard('npm publish', 'a'), 'deny');
    assert.equal(guard('rm -rf ~', 'b'), 'deny');

    // A /loop wake-up in session a is not the user.
    assert.equal(hook('unattended-return.mjs', submit(writeTranscript(home, TRANSCRIPTS.scheduled, 'a.jsonl'), { session_id: 'a' })), null);
    assert.equal(guard('npm publish', 'b'), 'deny');

    // The user types in session c.
    const out = hook('unattended-return.mjs', submit(writeTranscript(home, TRANSCRIPTS.human, 'c.jsonl'), { session_id: 'c' }));
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /擋下了 3 個/);
    assert.match(out.hookSpecificOutput.additionalContext, /session a，.*\n {3}原指令：npm publish/);
    assert.match(out.hookSpecificOutput.additionalContext, /session b，.*\n {3}原指令：rm -rf ~/);
    assert.deepEqual(savedState(home), { blocked: [] });
    assert.equal(guard('npm publish', 'b'), 'ask');
    assert.equal(hook('unattended-return.mjs', stop(join(home, 'c.jsonl'), { session_id: 'c' })), null);
    assert.equal(hook('unattended-return.mjs', JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'c' })), null);
  });
});

test('sessions back at the same moment get the list once between them', async () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-guard-')));
  try {
    awayHome(home);
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const hook = (session_id) => new Promise((done, fail) => {
      const child = spawn(process.execPath, [join(root, 'hooks', 'unattended-return.mjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.on('error', fail);
      child.on('close', (code) => done({ code, stdout }));
      child.stdin.end(submit(writeTranscript(home, TRANSCRIPTS.human, `${session_id}.jsonl`), { session_id }));
    });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => hook(`c${i}`)));
    assert.deepEqual(results.map((r) => r.code), Array(8).fill(0));
    const handed = results.filter((r) => r.stdout);
    assert.equal(handed.length, 1, 'exactly one session hands the list over');
    assert.match(JSON.parse(handed[0].stdout).hookSpecificOutput.additionalContext, /擋下了 2 個/);
    assert.deepEqual(savedState(home), { blocked: [] });
    assert.deepEqual(readdirSync(dirname(autoStateFile(home))), ['unattended.json'], 'no lock or temp file is left behind');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------- unattended: the user's switch command (/sorry-matt:unattended, UserPromptExpansion) ----------

// A UserPromptExpansion event as Claude Code builds it for a typed `/sorry-matt:unattended <args>`.
const expansion = (command_args, extra = {}) => JSON.stringify({
  hook_event_name: 'UserPromptExpansion', session_id: 's3', transcript_path: join(tmpdir(), 'sorry-matt-no-such-transcript.jsonl'),
  cwd: CWD, prompt_id: 'p1', permission_mode: 'default', expansion_type: 'slash_command', command_name: 'sorry-matt:unattended',
  command_args, command_source: 'plugin', prompt: `/sorry-matt:unattended ${command_args}`.trim(), ...extra,
});
const contextOf = (result) => {
  assert.deepEqual(Object.keys(result), ['hookSpecificOutput'], 'JSON additionalContext, nothing else');
  assert.equal(result.hookSpecificOutput.hookEventName, 'UserPromptExpansion');
  assert.ok(result.hookSpecificOutput.additionalContext.startsWith(SWITCH_PREFIX));
  return result.hookSpecificOutput.additionalContext;
};
const switchOn = (home, content = '') => {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(unattendedFile(home), content);
};
const noRead = () => assert.fail('the transcript is not read here');
const publishDecision = (home, env = {}) => decisionOf(decideWith(event('npm publish', { session_id: 's9' }), env, { home, store: memoryStore(), now: 9 }));
// Every file under home, with its content and modification time.
const snapshot = (home) => {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else files[path] = [readFileSync(path, 'utf8'), info.mtimeMs];
    }
  };
  walk(home);
  return files;
};

test('/sorry-matt:unattended on creates the switch file, leaves the automatic state alone, and the guard then denies', () => {
  for (const args of ['on', '', ' ON ']) {
    withDir((home) => {
      const context = contextOf(onSwitchExpansion(expansion(args), {}, { home, read: noRead }));
      assert.match(context, /已開啟無人值守：建立了開關檔 .*\.claude\/sorry-matt-unattended/, args);
      assert.equal(existsSync(unattendedFile(home)), true, args);
      assert.equal(existsSync(autoStateFile(home)), false, `${args}: the automatic state file is not written`);
      assert.equal(publishDecision(home), 'deny', args);
    });
  }
  withDir((home) => {
    // Already on: still a success, and the file keeps what it held; the automatic state file is byte for byte the same.
    switchOn(home, 'kept');
    autoState(home).enter(ENTERED);
    const before = readFileSync(autoStateFile(home), 'utf8');
    const context = contextOf(onSwitchExpansion(expansion('on'), {}, { home, read: noRead }));
    assert.match(context, /原本就在，維持開啟/);
    assert.equal(readFileSync(unattendedFile(home), 'utf8'), 'kept');
    assert.equal(readFileSync(autoStateFile(home), 'utf8'), before);
  });
  withDir((home) => {
    // `on` asks no transcript, even from a scheduled turn.
    const transcript = writeTranscript(home, TRANSCRIPTS.scheduled);
    contextOf(onSwitchExpansion(expansion('on', { transcript_path: transcript }), {}, { home }));
    assert.equal(existsSync(unattendedFile(home)), true);
  });
  withDir((home) => {
    // A switch file that cannot be made (its home is a file): told so, and nothing is on.
    writeFileSync(join(home, 'blocker'), '');
    const failed = contextOf(onSwitchExpansion(expansion('on'), {}, { home: join(home, 'blocker') }));
    assert.match(failed, /無法建立開關檔.*無人值守沒有開啟。請使用者自己執行 `touch ~\/\.claude\/sorry-matt-unattended`/);
    assert.doesNotMatch(failed, /已開啟/);
  });
  withDir((home) => {
    // Another command, or no command name: no output, nothing read or written.
    for (const command_name of ['sorry-matt:get-to-work', 'unattended', 'other-plugin:unattended', 'sorry-matt:unattended-x', undefined]) {
      assert.equal(onSwitchExpansion(expansion('on', { command_name }), {}, { home, read: noRead }), null, command_name);
    }
    assert.equal(onSwitchExpansion('not json', {}, { home }), null);
    assert.deepEqual(readdirSync(home), []);
  });
});

test('/sorry-matt:unattended status lists each source that holds and writes nothing', () => {
  withDir((home) => {
    // None of the three.
    const context = contextOf(onSwitchExpansion(expansion('status'), {}, { home, read: noRead }));
    assert.match(context, /無人值守未開啟/);
    assert.deepEqual(readdirSync(home), []);
  });
  withDir((home) => {
    // The switch file and the automatic state, with two blocked actions.
    switchOn(home);
    awayHome(home);
    const before = snapshot(home);
    const context = contextOf(onSwitchExpansion(expansion('status'), {}, { home, read: noRead }));
    assert.match(context, /無人值守開著/);
    assert.match(context, /\n- 開關檔：.*\.claude\/sorry-matt-unattended\n/);
    assert.match(context, /\n- 自動進入：進入時間 2023-11-14T22:13:20\.000Z，原因：使用者說要去睡了，session s0\n/);
    assert.match(context, /擋下清單目前有 2 筆/);
    assert.doesNotMatch(context, /環境變數：/);
    assert.deepEqual(snapshot(home), before, 'content and modification time unchanged');
  });
  withDir((home) => {
    // The environment variable with the switch file: both listed, and `off` cannot end the variable.
    switchOn(home);
    const before = snapshot(home);
    const context = contextOf(onSwitchExpansion(expansion('status'), { SORRY_MATT_UNATTENDED: 'on' }, { home, read: noRead }));
    assert.match(context, /\n- 開關檔：/);
    assert.match(context, /\n- 環境變數：SORRY_MATT_UNATTENDED=on\n/);
    assert.doesNotMatch(context, /自動進入：/);
    assert.match(context, /擋下清單目前有 0 筆/);
    assert.match(context, /off 清不掉它；要關掉，請使用者從 settings 的 "env" 拿掉 SORRY_MATT_UNATTENDED/);
    assert.deepEqual(snapshot(home), before);
  });
});

test('/sorry-matt:unattended off on a person\'s turn removes the switch file, ends the automatic state and hands over the list', () => {
  for (const args of ['off', '']) {
    withDir((home) => {
      switchOn(home);
      awayHome(home);
      // A pending turn of the automatic state and a pending `off` from another session both go with it.
      autoState(home).defer({ session: 's7', prompt_id: 'p7' });
      autoState(home).deferOff({ session: 's8', prompt_id: 'p8' });
      const transcript = writeTranscript(home, TRANSCRIPTS.human);
      const context = contextOf(onSwitchExpansion(expansion(args, { transcript_path: transcript }), {}, { home, ...fakeClock() }));
      assert.match(context, /刪掉了開關檔 .*\.claude\/sorry-matt-unattended/, args);
      assert.match(context, /自動進入的無人值守已解除（進入時間 2023-11-14T22:13:20\.000Z，原因：使用者說要去睡了，session s0）/, args);
      assert.match(context, /無人值守已關閉/, args);
      assert.match(context, /擋下了 2 個需要使用者確認的動作（清單已清空）。請把下面的清單完整告訴使用者/, args);
      assert.match(context, /1\. session s0，1970-01-01T00:00:03\.000Z\n {3}原指令：npm publish\n {3}理由：sorry-matt guard 確認：這是發布版本/, args);
      assert.match(context, /2\. session s2，1970-01-01T00:00:04\.000Z\n {3}原指令：rm -rf ~\n {3}理由：.*不經資源回收筒/, args);
      assert.equal(existsSync(unattendedFile(home)), false, args);
      assert.deepEqual(savedState(home), { blocked: [] }, `${args}: entered, both pending lists and the list are gone`);
      assert.equal(publishDecision(home), 'ask', args);
    });
  }
  withDir((home) => {
    // Only the switch file: what was blocked under it is handed over and emptied too.
    switchOn(home);
    assert.equal(decisionOf(decideWith(event('npm publish', { session_id: 's1' }), {}, { home, store: memoryStore(), now: 5000 })), 'deny');
    assert.equal(autoState(home).active(), false);
    const context = contextOf(onSwitchExpansion(expansion('off', { transcript_path: writeTranscript(home, TRANSCRIPTS.human) }), {}, { home }));
    assert.doesNotMatch(context, /自動進入/);
    assert.match(context, /擋下了 1 個/);
    assert.match(context, /1\. session s1，1970-01-01T00:00:05\.000Z\n {3}原指令：npm publish/);
    assert.equal(existsSync(unattendedFile(home)), false);
    assert.deepEqual(savedState(home), { blocked: [] });
    assert.equal(publishDecision(home), 'ask');
  });
  withDir((home) => {
    // Only the automatic state, nothing blocked.
    autoState(home).enter(ENTERED);
    const context = contextOf(onSwitchExpansion(expansion('', { transcript_path: writeTranscript(home, TRANSCRIPTS.human) }), {}, { home }));
    assert.doesNotMatch(context, /開關檔/);
    assert.match(context, /自動進入的無人值守已解除/);
    assert.match(context, /沒有擋下任何動作/);
    assert.deepEqual(savedState(home), { blocked: [] });
  });
  withDir((home) => {
    // SORRY_MATT_UNATTENDED set: the files are cleared all the same, and the variable still holds.
    const env = { SORRY_MATT_UNATTENDED: '1' };
    switchOn(home);
    awayHome(home);
    const context = contextOf(onSwitchExpansion(expansion('off', { transcript_path: writeTranscript(home, TRANSCRIPTS.human) }), env, { home }));
    assert.match(context, /刪掉了開關檔/);
    assert.match(context, /無人值守仍因環境變數 SORRY_MATT_UNATTENDED 開著/);
    assert.doesNotMatch(context, /無人值守已關閉/);
    assert.match(context, /擋下了 2 個/);
    assert.equal(existsSync(unattendedFile(home)), false);
    assert.deepEqual(savedState(home), { blocked: [] });
    assert.equal(publishDecision(home, env), 'deny');
  });
  withDir((home) => {
    // Only the variable: the toggle goes the `off` way, says it cannot end it, and creates nothing.
    const env = { SORRY_MATT_UNATTENDED: 'on' };
    const transcript = writeTranscript(home, TRANSCRIPTS.human);
    const context = contextOf(onSwitchExpansion(expansion('', { transcript_path: transcript }), env, { home }));
    assert.match(context, /無人值守仍因環境變數 SORRY_MATT_UNATTENDED 開著/);
    assert.equal(existsSync(unattendedFile(home)), false, 'not turned on');
  });
  withDir((home) => {
    // None of the three: said so, nothing changed.
    const transcript = writeTranscript(home, TRANSCRIPTS.human);
    const before = snapshot(home);
    const context = contextOf(onSwitchExpansion(expansion('off', { transcript_path: transcript }), {}, { home }));
    assert.match(context, /無人值守本來就沒開/);
    assert.deepEqual(snapshot(home), before);
  });
  withDir((home) => {
    // A switch file that cannot be removed: the list is still handed over, and the user is told to remove it.
    switchOn(home);
    awayHome(home);
    const remove = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    const context = contextOf(onSwitchExpansion(expansion('off', { transcript_path: writeTranscript(home, TRANSCRIPTS.human) }), {}, { home, remove }));
    assert.match(context, /刪不掉（EPERM），仍然開著；請使用者執行 `rm ~\/\.claude\/sorry-matt-unattended`/);
    assert.doesNotMatch(context, /無人值守已關閉/);
    assert.match(context, /擋下了 2 個/);
  });
});

test('/sorry-matt:unattended off on a turn that cannot be told a person\'s changes nothing and points at the switch file', () => {
  const RM_HINT = /沒有關閉無人值守：.*請使用者在終端機執行 `rm ~\/\.claude\/sorry-matt-unattended`/;
  const cases = [
    ...['scheduled', 'task_notification', 'peer', 'sdk', 'other', 'missingField'].map((kind) => [kind, (home) => ({ transcript_path: writeTranscript(home, TRANSCRIPTS[kind]) })]),
    ['transcript is a directory', (home) => {
      mkdirSync(join(home, 'dir.jsonl'));
      return { transcript_path: join(home, 'dir.jsonl') };
    }],
    ['no prompt_id', (home) => ({ transcript_path: writeTranscript(home, TRANSCRIPTS.human), prompt_id: undefined })],
    ['no transcript_path', () => ({ transcript_path: undefined })],
    ['empty transcript_path', () => ({ transcript_path: '' })],
  ];
  for (const args of ['off', '']) {
    for (const [name, extra] of cases) {
      withDir((home) => {
        switchOn(home);
        awayHome(home);
        const fields = extra(home);
        const before = snapshot(home);
        const clock = fakeClock();
        const context = contextOf(onSwitchExpansion(expansion(args, fields), {}, { home, ...clock }));
        assert.match(context, RM_HINT, `${args} ${name}`);
        assert.equal(clock.slept, 0, `${args} ${name}: no reread`);
        assert.deepEqual(snapshot(home), before, `${args} ${name}: nothing changed`);
        assert.equal(publishDecision(home), 'deny', `${args} ${name}`);
      });
    }
  }
  withDir((home) => {
    // A read that fails.
    switchOn(home);
    const before = snapshot(home);
    const eacces = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    assert.match(contextOf(onSwitchExpansion(expansion('off', { transcript_path: join(home, 'x.jsonl') }), {}, { home, read: eacces, ...fakeClock() })), RM_HINT);
    assert.deepEqual(snapshot(home), before);
  });
});

test('an `off` whose entry is not written yet is reread for up to 500 ms, then decided by that session\'s Stop', () => {
  for (const args of ['off', '']) {
    withDir((home) => {
      switchOn(home);
      awayHome(home);
      const before = savedState(home);
      const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
      const clock = fakeClock();
      const context = contextOf(onSwitchExpansion(expansion(args, { transcript_path: transcript }), {}, { home, ...clock }));
      assert.equal(clock.slept, 500, 'reread until 500 ms, and no longer');
      assert.match(context, /還判不出是不是使用者親自送出的，所以先記成待判定/);
      assert.equal(existsSync(unattendedFile(home)), true);
      assert.deepEqual(savedState(home), { ...before, pendingOff: [{ session: 's3', prompt_id: 'p1' }] });

      // Another session's Stop leaves it alone.
      assert.equal(onSwitchStop(stop(transcript, { session_id: 's4' }), {}, { home }), null);
      assert.deepEqual(savedState(home).pendingOff, [{ session: 's3', prompt_id: 'p1' }]);

      // A person's turn by the time it stops: the `off` runs there and its result is the block reason.
      writeTranscript(home, TRANSCRIPTS.human);
      const blocked = onSwitchStop(stop(transcript), {}, { home });
      assert.deepEqual(Object.keys(blocked), ['decision', 'reason']);
      assert.equal(blocked.decision, 'block');
      assert.match(blocked.reason, /^\[sorry-matt unattended\] /);
      assert.match(blocked.reason, /刪掉了開關檔/);
      assert.match(blocked.reason, /自動進入的無人值守已解除/);
      assert.match(blocked.reason, /1\. session s0，1970-01-01T00:00:03\.000Z\n {3}原指令：npm publish/);
      assert.match(blocked.reason, /2\. session s2，1970-01-01T00:00:04\.000Z\n {3}原指令：rm -rf ~/);
      assert.equal(existsSync(unattendedFile(home)), false);
      assert.deepEqual(savedState(home), { blocked: [] });
      assert.equal(publishDecision(home), 'ask');
      // The stop that block causes finds nothing to do.
      assert.equal(onSwitchStop(stop(transcript, { stop_hook_active: true }), {}, { home }), null);
    });
  }
  withDir((home) => {
    // With only the switch file there is no automatic state, and the pending `off` is kept all the same.
    switchOn(home);
    const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
    contextOf(onSwitchExpansion(expansion('off', { transcript_path: transcript }), {}, { home, ...fakeClock() }));
    assert.deepEqual(savedState(home), { pendingOff: [{ session: 's3', prompt_id: 'p1' }], blocked: [] });
    // A person's turn at Stop in the automatic hook does not touch it; this hook's Stop does.
    writeTranscript(home, TRANSCRIPTS.human);
    assert.equal(onStop(stop(transcript), {}, { home }), null);
    assert.deepEqual(savedState(home).pendingOff, [{ session: 's3', prompt_id: 'p1' }]);
    assert.equal(onSwitchStop(stop(transcript), {}, { home }).decision, 'block');
    assert.equal(existsSync(unattendedFile(home)), false);
    assert.deepEqual(savedState(home), { blocked: [] });
  });
  for (const kind of ['scheduled', 'task_notification', 'notYet']) {
    withDir((home) => {
      // Any other answer at Stop only drops the pending `off`.
      switchOn(home);
      awayHome(home);
      const before = savedState(home);
      const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
      contextOf(onSwitchExpansion(expansion('off', { transcript_path: transcript }), {}, { home, ...fakeClock() }));
      writeTranscript(home, TRANSCRIPTS[kind]);
      assert.equal(onSwitchStop(stop(transcript), {}, { home }), null, kind);
      assert.deepEqual(savedState(home), before, kind);
      assert.equal(existsSync(unattendedFile(home)), true, kind);
    });
  }
  withDir((home) => {
    // A Stop without a transcript path drops it too.
    switchOn(home);
    const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
    contextOf(onSwitchExpansion(expansion('off', { transcript_path: transcript }), {}, { home, ...fakeClock() }));
    assert.equal(onSwitchStop(stop(undefined), {}, { home }), null);
    assert.deepEqual(savedState(home), { blocked: [] });
    assert.equal(existsSync(unattendedFile(home)), true);
  });
  withDir((home) => {
    // An entry that shows up during the rereads decides the `off` right there.
    switchOn(home);
    let reads = 0;
    const read = () => (++reads < 3 ? TRANSCRIPTS.notYet : TRANSCRIPTS.human).join('\n');
    const clock = fakeClock();
    const context = contextOf(onSwitchExpansion(expansion('off', { transcript_path: join(home, 'session.jsonl') }), {}, { home, read, ...clock }));
    assert.match(context, /刪掉了開關檔/);
    assert.equal(clock.slept, 50);
  });
});

test('/sorry-matt:unattended with the guard off, or with an argument it does not know, changes nothing', () => {
  withDir((home) => {
    switchOn(home);
    awayHome(home);
    const transcript = writeTranscript(home, TRANSCRIPTS.notYet);
    const before = snapshot(home);
    for (const args of ['on', 'off', 'status', '']) {
      const context = contextOf(onSwitchExpansion(expansion(args, { transcript_path: transcript }), { SORRY_MATT_GUARD: 'off' }, { home }));
      assert.match(context, /sorry-matt guard 已關閉（SORRY_MATT_GUARD=off），無人值守沒有作用，所以沒有改任何檔/, args);
    }
    assert.equal(onSwitchStop(stop(transcript), { SORRY_MATT_GUARD: 'off' }, { home }), null);
    for (const args of ['of', 'enable', 'on now', 'statu']) {
      const context = contextOf(onSwitchExpansion(expansion(args, { transcript_path: transcript }), {}, { home }));
      assert.match(context, new RegExp(`不認得的參數「${args}」，沒有改任何檔`), args);
      for (const form of ['/sorry-matt:unattended on', '/sorry-matt:unattended off', '/sorry-matt:unattended status', '/sorry-matt:unattended（不帶參數']) {
        assert.ok(context.includes(form), `${args}: ${form}`);
      }
    }
    assert.deepEqual(snapshot(home), before);
  });
});

test('the automatic clear keeps the pending `off` turns; clearAll takes everything once', () => {
  withDir((home) => {
    const state = autoState(home);
    assert.equal(state.clearAll(), null);
    assert.equal(existsSync(autoStateFile(home)), false, 'nothing written');
    state.enter(ENTERED);
    state.record({ session: 's1', at: 10, subject: 'npm publish', reason: 'r1' });
    state.defer({ session: 's3', prompt_id: 'p1' });
    assert.equal(state.deferOff({ session: 's4', prompt_id: 'p2' }), true);
    assert.equal(state.deferOff({ session: 's4', prompt_id: 'p2' }), true);
    assert.deepEqual(state.clear(), { entered: ENTERED, pending: [{ session: 's3', prompt_id: 'p1' }], blocked: [{ session: 's1', at: 10, subject: 'npm publish', reason: 'r1' }] });
    assert.deepEqual(savedState(home), { pendingOff: [{ session: 's4', prompt_id: 'p2' }], blocked: [] });
    state.record({ session: 's1', at: 11, subject: 'gh release create', reason: 'r2' });
    assert.deepEqual(state.clearAll(), { entered: null, pending: [], pendingOff: [{ session: 's4', prompt_id: 'p2' }], blocked: [{ session: 's1', at: 11, subject: 'gh release create', reason: 'r2' }] });
    assert.equal(state.clearAll(), null);
    assert.equal(state.settleOff({ session: 's4', prompt_id: 'p2' }), false);
    assert.deepEqual(savedState(home), { blocked: [] });
  });
});

test('hooks.json registers unattended-switch.mjs on the unattended command\'s expansion and on every Stop', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  const command = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/unattended-switch.mjs"';
  const [expansionEntry, ...more] = config.hooks.UserPromptExpansion;
  assert.equal(more.length, 0);
  assert.deepEqual(expansionEntry.hooks, [{ type: 'command', command }]);
  assert.equal(SWITCH_COMMAND, 'sorry-matt:unattended');
  assert.match(SWITCH_COMMAND, new RegExp(expansionEntry.matcher), 'the matcher lets the command through');
  for (const other of ['sorry-matt:get-to-work', 'unattended-x', 'x-unattended']) assert.doesNotMatch(other, new RegExp(expansionEntry.matcher), other);
  const stops = config.hooks.Stop.filter((e) => e.hooks.some((h) => h.command === command));
  assert.equal(stops.length, 1);
  assert.equal(stops[0].matcher, undefined);
});

test('the switch command end to end: the hook process turns unattended on and off and the guard follows', () => {
  withDir((home) => {
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const hook = (script, input) => {
      const result = spawnSync(process.execPath, [join(root, 'hooks', script)], { input, encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout ? JSON.parse(result.stdout) : null;
    };
    const guard = (command) => hook('guard.mjs', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD, session_id: 'a', permission_mode: 'default' }))?.hookSpecificOutput.permissionDecision ?? null;
    const switchHook = (args, extra) => contextOf(hook('unattended-switch.mjs', expansion(args, extra)));

    assert.equal(guard('npm publish'), 'ask');
    assert.match(switchHook('on'), /已開啟無人值守/);
    assert.equal(existsSync(join(home, '.claude', 'sorry-matt-unattended')), true);
    assert.equal(guard('npm publish'), 'deny');
    assert.match(switchHook('status'), /\n- 開關檔：.*\n擋下清單目前有 1 筆/);
    // A scheduled turn does not turn it off.
    assert.match(switchHook('off', { transcript_path: writeTranscript(home, TRANSCRIPTS.scheduled, 'a.jsonl') }), /沒有關閉無人值守/);
    assert.equal(guard('npm publish'), 'deny');
    // The user's own turn does.
    const off = switchHook('', { transcript_path: writeTranscript(home, TRANSCRIPTS.human, 'b.jsonl') });
    assert.match(off, /刪掉了開關檔/);
    assert.match(off, /擋下了 2 個/);
    assert.equal(existsSync(join(home, '.claude', 'sorry-matt-unattended')), false);
    assert.equal(guard('npm publish'), 'ask');
    // Other commands and other events: nothing.
    assert.equal(hook('unattended-switch.mjs', expansion('on', { command_name: 'sorry-matt:get-to-work' })), null);
    assert.equal(hook('unattended-switch.mjs', stop(join(home, 'b.jsonl'), { session_id: 'a' })), null);
    assert.equal(hook('unattended-switch.mjs', JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'a' })), null);
    assert.equal(existsSync(join(home, '.claude', 'sorry-matt-unattended')), false);
  });
});

// ---------- unattended: a permission dialog nobody answers (PermissionRequest) ----------

// A PermissionRequest event as spec #89 measured it: no tool_use_id, so the hook finds the call in the transcript.
const permission = (extra = {}) => JSON.stringify({
  hook_event_name: 'PermissionRequest', session_id: 's5', transcript_path: join(tmpdir(), 'sorry-matt-no-such-transcript.jsonl'),
  cwd: CWD, permission_mode: 'default', prompt_id: 'p5', tool_name: 'Bash', tool_input: { command: 'npm publish', description: 'publish' },
  permission_suggestions: [], ...extra,
});
const MINUTE = 60_000;
// Virtual time: a sleep resolves only when advance() moves the clock past it, so a ten-minute wait takes no time.
function virtualTime(start = 0) {
  const clock = { t: start, sleeps: [], timers: [] };
  clock.now = () => clock.t;
  clock.sleep = (ms) => {
    clock.sleeps.push(ms);
    return new Promise((resolve) => clock.timers.push({ at: clock.t + ms, resolve }));
  };
  const settle = () => new Promise((done) => setImmediate(done));
  clock.advance = async (ms) => {
    const end = clock.t + ms;
    for (;;) {
      await settle();
      clock.timers.sort((a, b) => a.at - b.at);
      if (!clock.timers.length || clock.timers[0].at > end) break;
      const next = clock.timers.shift();
      clock.t = next.at;
      next.resolve();
    }
    clock.t = end;
    await settle();
  };
  return clock;
}
async function withDirAsync(fn) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-guard-')));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const requestDecision = (result) => result?.hookSpecificOutput?.decision ?? null;
// The PreToolUse guard's unattended deny for `npm publish`, split around its one reason line.
const guardParkLines = (home) => out(decideWith(event('npm publish'), {}, { unattended: true, home, store: memoryStore(), now: 1 })).permissionDecisionReason.split('\n');

test('a permission dialog nobody answers is taken back at the deadline and enters unattended mode', () => withDirAsync(async (home) => {
  const clock = virtualTime(1_000_000);
  const checks = [];
  const deps = { home, now: clock.now, sleep: clock.sleep, answered: () => (checks.push(clock.t), false) };
  const pending = onPermissionRequest(permission(), {}, deps);
  await clock.advance(10 * MINUTE - 1);
  assert.equal(existsSync(autoStateFile(home)), false, 'nothing is written before the deadline');
  await clock.advance(1);
  const result = await pending;
  assert.equal(result.hookSpecificOutput.hookEventName, 'PermissionRequest');
  const decision = requestDecision(result);
  assert.equal(decision.behavior, 'deny');
  // The same deny the guard parks with, but for its reason line.
  const [head, reason, ...tail] = decision.message.split('\n');
  const [guardHead, , ...guardTail] = guardParkLines(home);
  assert.equal(head, guardHead);
  assert.deepEqual(tail, guardTail);
  assert.equal(reason, '權限確認框 10 分鐘沒有人回應。');
  assert.deepEqual(savedState(home), {
    entered: { at: 1_600_000, reason: '權限確認框 10 分鐘沒有回應：npm publish', by: 'timeout', session: 's5' },
    blocked: [{ session: 's5', at: 1_600_000, subject: 'npm publish', reason: '權限確認框 10 分鐘沒有人回應。' }],
  });
  // Asked about every 5 s, and once more at the deadline itself.
  assert.ok(clock.sleeps.every((ms) => ms > 0 && ms <= 5000), String(clock.sleeps));
  assert.equal(checks.length, 120);
  assert.equal(checks.at(-1), 1_600_000);
}));

test('dialogs waiting at the same time each run out on their own; the entry is written once, by the first', () => withDirAsync(async (home) => {
  const clock = virtualTime(0);
  const deps = { home, now: clock.now, sleep: clock.sleep, answered: () => false };
  const first = onPermissionRequest(permission({ session_id: 'a', tool_input: { command: 'npm publish' } }), {}, deps);
  await clock.advance(MINUTE);
  const second = onPermissionRequest(permission({ session_id: 'b', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }), {}, deps);
  await clock.advance(9 * MINUTE);
  assert.equal(requestDecision(await first).behavior, 'deny');
  assert.equal(savedState(home).entered.at, 10 * MINUTE);
  await clock.advance(MINUTE);
  assert.equal(requestDecision(await second).behavior, 'deny');
  const state = savedState(home);
  assert.deepEqual(state.entered, { at: 10 * MINUTE, reason: '權限確認框 10 分鐘沒有回應：npm publish', by: 'timeout', session: 'a' });
  assert.deepEqual(state.blocked.map((b) => [b.session, b.at, b.subject]), [['a', 10 * MINUTE, 'npm publish'], ['b', 11 * MINUTE, 'WebFetch']]);
}));

test('already unattended, from any source, a permission dialog is denied at once and added to the list', () => withDirAsync(async (home) => {
  const sources = {
    switchFile: () => {
      mkdirSync(join(home, '.claude'), { recursive: true });
      writeFileSync(unattendedFile(home), '');
      return {};
    },
    env: () => ({ SORRY_MATT_UNATTENDED: '1' }),
    automatic: () => {
      autoState(home).enter(ENTERED);
      return {};
    },
  };
  for (const [name, arm] of Object.entries(sources)) {
    rmSync(join(home, '.claude'), { recursive: true, force: true });
    const env = arm();
    for (const after of [undefined, 'off', '0']) {
      const clock = virtualTime(7);
      let asked = 0;
      const deps = { home, now: clock.now, sleep: clock.sleep, answered: () => (asked++, false) };
      const before = autoState(home).read().blocked.length;
      const result = await onPermissionRequest(permission({ tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }), { ...env, SORRY_MATT_UNATTENDED_AFTER: after }, deps);
      const decision = requestDecision(result);
      assert.equal(decision?.behavior, 'deny', `${name} ${after}`);
      const [head, reason, ...tail] = decision.message.split('\n');
      const [guardHead, , ...guardTail] = guardParkLines(home);
      assert.equal(head, guardHead);
      assert.deepEqual(tail, guardTail);
      assert.equal(reason, '這是 Claude Code 的權限提示（WebFetch）。');
      assert.deepEqual(clock.sleeps, [], `${name}: no wait`);
      assert.equal(asked, 0, `${name}: nothing to wait for`);
      const { blocked, entered } = autoState(home).read();
      assert.equal(blocked.length, before + 1, name);
      assert.deepEqual(blocked.at(-1), { session: 's5', at: 7, subject: 'WebFetch', reason: '這是 Claude Code 的權限提示（WebFetch）。' });
      assert.equal(entered?.by ?? null, name === 'automatic' ? 'agent' : null, `${name}: no entry of its own`);
    }
  }
  // A shell call is listed by its command.
  const result = await onPermissionRequest(permission(), { SORRY_MATT_UNATTENDED: 'on' }, { home, now: () => 8, sleep: () => assert.fail('no wait') });
  assert.equal(requestDecision(result).behavior, 'deny');
  assert.deepEqual(autoState(home).read().blocked.at(-1), { session: 's5', at: 8, subject: 'npm publish', reason: '這是 Claude Code 的權限提示（Bash）。' });
}));

test('a dialog answered before the deadline ends the wait and leaves nothing behind', () => withDirAsync(async (home) => {
  const clock = virtualTime(0);
  let checks = 0;
  const deps = { home, now: clock.now, sleep: clock.sleep, answered: () => ++checks === 3 };
  const pending = onPermissionRequest(permission(), {}, deps);
  await clock.advance(10 * MINUTE);
  assert.equal(await pending, null);
  assert.equal(checks, 3, 'the wait stopped at the answer');
  assert.equal(clock.timers.length, 0);
  assert.equal(existsSync(autoStateFile(home)), false, 'no state at all');
  // Answered at the last check, with a list already on disk: no entry, and nothing added.
  autoState(home).record({ session: 's1', at: 1, subject: 'npm publish', reason: 'r' });
  const listed = readFileSync(autoStateFile(home), 'utf8');
  const lastCheck = virtualTime(0);
  const late = onPermissionRequest(permission(), {}, { home, now: lastCheck.now, sleep: lastCheck.sleep, answered: () => lastCheck.t >= 10 * MINUTE });
  await lastCheck.advance(10 * MINUTE);
  assert.equal(await late, null, 'answered by the check at the deadline');
  assert.equal(readFileSync(autoStateFile(home), 'utf8'), listed);
}));

test('the wait is SORRY_MATT_UNATTENDED_AFTER minutes: 10 by default, at most 60, 0 or off turns it off', async () => {
  const cases = [
    [undefined, 10], ['', 10], ['10', 10], ['0.5', 0.5], [' 2 ', 2], ['.25', 0.25], ['60', 60], ['61', 60], ['90.5', 60],
    ['0', null], ['0.0', null], ['off', null], ['OFF', null], [' off ', null],
    ['-5', 10], ['abc', 10], ['5m', 10], ['1e1', 10], ['Infinity', 10], ['0x10', 10], ['NaN', 10],
  ];
  for (const [value, minutes] of cases) assert.equal(waitMinutes(value), minutes, JSON.stringify(value));
  await withDirAsync(async (home) => {
    const run = async (after, ms) => {
      const clock = virtualTime(0);
      const pending = onPermissionRequest(permission(), { SORRY_MATT_UNATTENDED_AFTER: after }, { home, now: clock.now, sleep: clock.sleep, answered: () => false });
      await clock.advance(ms - 1);
      const early = clock.timers.length;
      await clock.advance(1);
      const result = await pending;
      return { early, result, clock };
    };
    const half = await run('0.5', 30_000);
    assert.ok(half.early > 0, 'still waiting just before 30 s');
    assert.equal(requestDecision(half.result).behavior, 'deny');
    assert.match(requestDecision(half.result).message, /\n權限確認框 0\.5 分鐘沒有人回應。\n/);
    assert.equal(savedState(home).entered.reason, '權限確認框 0.5 分鐘沒有回應：npm publish');
    autoState(home).clear();
    const capped = await run('90', 60 * MINUTE);
    assert.ok(capped.early > 0, 'still waiting just before 60 minutes');
    assert.equal(savedState(home).entered.at, 60 * MINUTE);
    autoState(home).clear();
    for (const after of ['0', 'off']) {
      const clock = virtualTime(0);
      assert.equal(await onPermissionRequest(permission(), { SORRY_MATT_UNATTENDED_AFTER: after }, { home, now: clock.now, sleep: clock.sleep, answered: () => false }), null, after);
      assert.deepEqual(clock.sleeps, [], `${after}: no wait`);
    }
    assert.deepEqual(savedState(home), { blocked: [] }, 'turned off, nothing entered');
  });
});

test('with the guard off the PermissionRequest hook prints and writes nothing, away or not', () => withDirAsync(async (home) => {
  awayHome(home);
  for (const off of ['off', 'OFF']) {
    const clock = virtualTime(0);
    assert.equal(await onPermissionRequest(permission(), { SORRY_MATT_GUARD: off }, { home, now: clock.now, sleep: clock.sleep, answered: () => false }), null);
    assert.deepEqual(clock.sleeps, []);
  }
  autoState(home).clear();
  const clock = virtualTime(0);
  assert.equal(await onPermissionRequest(permission(), { SORRY_MATT_GUARD: 'off' }, { home, now: clock.now, sleep: clock.sleep, answered: () => false }), null);
  assert.deepEqual(clock.sleeps, []);
  assert.deepEqual(savedState(home), { blocked: [] });
  // Not a PermissionRequest, or not an event at all: nothing.
  for (const raw of ['not json', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm publish' } }), 'null']) {
    assert.equal(await onPermissionRequest(raw, {}, { home, now: clock.now, sleep: clock.sleep, answered: () => false }), null, raw);
  }
}));

// Transcript lines for the call the dialog is about: the assistant's tool_use, and the user's tool_result once answered.
const toolUse = (id, name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'running it' }, { type: 'tool_use', id, name, input }] } });
const toolResult = (id, isError = false) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'denied' : 'ok', is_error: isError }] } });
const CALL = { command: 'npm publish', description: 'publish' };

test('a call counts as answered when its last matching tool_use in the transcript has a tool_result', () => {
  const t = (...lines) => [JSON.stringify({ type: 'summary' }), userLine('p5', 'human'), ...lines].join('\n');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', CALL), toolResult('t1')), 'Bash', CALL), true, 'allowed and run');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', CALL), toolResult('t1', true)), 'Bash', CALL), true, 'denied by the user');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', { description: 'publish', command: 'npm publish' }), toolResult('t1')), 'Bash', CALL), true, 'key order does not matter');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', CALL)), 'Bash', CALL), false, 'still waiting');
  assert.equal(answeredIn(t(), 'Bash', CALL), false, 'no tool_use yet');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', { command: 'npm publish --tag next' }), toolResult('t1')), 'Bash', CALL), false, 'another input');
  assert.equal(answeredIn(t(toolUse('t1', 'PowerShell', CALL), toolResult('t1')), 'Bash', CALL), false, 'another tool');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', CALL), toolResult('t1'), toolUse('t2', 'Bash', CALL)), 'Bash', CALL), false, 'the same call again, not answered yet');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', CALL), '{"type": "user", broken', toolResult('t2')), 'Bash', CALL), false, 'another call\'s result');
  assert.equal(answeredIn(t(toolUse('t1', 'Bash', CALL), '{"type": "user", broken', toolResult('t1')), 'Bash', CALL), true, 'past a broken line');
  assert.equal(answeredIn('', 'Bash', CALL), false);
});

test('the hook reads the event\'s transcript: answered ends the wait early; a missing transcript is not answered', () => withDirAsync(async (home) => {
  const transcript = writeTranscript(home, [userLine('p5', 'human'), toolUse('t1', 'Bash', CALL)], 'session.jsonl');
  const clock = virtualTime(0);
  const pending = onPermissionRequest(permission({ transcript_path: transcript }), {}, { home, now: clock.now, sleep: clock.sleep });
  await clock.advance(MINUTE);
  writeTranscript(home, [userLine('p5', 'human'), toolUse('t1', 'Bash', CALL), toolResult('t1')], 'session.jsonl');
  await clock.advance(5000);
  assert.equal(await pending, null);
  assert.equal(existsSync(autoStateFile(home)), false);
  for (const transcript_path of [join(home, 'missing.jsonl'), home, undefined]) {
    const c = virtualTime(0);
    const p = onPermissionRequest(permission({ transcript_path }), {}, { home, now: c.now, sleep: c.sleep });
    await c.advance(10 * MINUTE);
    assert.equal(requestDecision(await p).behavior, 'deny', String(transcript_path));
    autoState(home).clear();
  }
}));

test('hooks.json registers the PermissionRequest hook for every tool, with a timeout past the 60-minute cap', () => {
  const config = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'));
  const entries = config.hooks.PermissionRequest;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].matcher, undefined, 'every tool');
  const [hook] = entries[0].hooks;
  assert.equal(entries[0].hooks.length, 1);
  assert.equal(hook.type, 'command');
  assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/permission-request.mjs"');
  assert.ok(hook.timeout > 3600, `timeout ${hook.timeout} s`);
});

test('the PermissionRequest hook end to end: dialogs run out, enter once, and the next one is denied at once', async () => {
  const home = realpathSync.native(mkdtempSync(join(tmpdir(), 'sorry-matt-guard-')));
  try {
    const env = { ...process.env, TMPDIR: home, TEMP: home, TMP: home, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: root, SORRY_MATT_UNATTENDED_AFTER: '0.002' };
    delete env.SORRY_MATT_GUARD;
    delete env.SORRY_MATT_UNATTENDED;
    const hook = (input, extra = {}) => new Promise((done, fail) => {
      const child = spawn(process.execPath, [join(root, 'hooks', 'permission-request.mjs')], { env: { ...env, ...extra }, stdio: ['pipe', 'pipe', 'inherit'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.on('error', fail);
      child.on('close', (code) => done({ code, stdout, out: stdout ? JSON.parse(stdout) : null }));
      child.stdin.end(input);
    });
    // Answered: nothing printed, nothing written.
    const answered = writeTranscript(home, [userLine('p5', 'human'), toolUse('t1', 'Bash', CALL), toolResult('t1')], 'answered.jsonl');
    const quiet = await hook(permission({ transcript_path: answered }));
    assert.equal(quiet.code, 0);
    assert.equal(quiet.stdout, '');
    assert.equal(existsSync(autoStateFile(home)), false);
    // Two dialogs nobody answers, at the same time.
    const waiting = writeTranscript(home, [userLine('p5', 'human'), toolUse('t1', 'Bash', CALL)], 'waiting.jsonl');
    const before = Date.now();
    const both = await Promise.all(['a', 'b'].map((session_id) => hook(permission({ session_id, transcript_path: waiting }))));
    for (const r of both) {
      assert.equal(r.code, 0);
      assert.equal(r.out.hookSpecificOutput.hookEventName, 'PermissionRequest');
      assert.equal(r.out.hookSpecificOutput.decision.behavior, 'deny');
      assert.match(r.out.hookSpecificOutput.decision.message, /^sorry-matt guard 無人值守模式：[^]*\n權限確認框 0\.002 分鐘沒有人回應。\n/);
    }
    const state = savedState(home);
    assert.equal(state.entered.by, 'timeout');
    assert.equal(state.entered.reason, '權限確認框 0.002 分鐘沒有回應：npm publish');
    assert.ok(['a', 'b'].includes(state.entered.session));
    assert.ok(state.entered.at >= before + 120 && state.entered.at <= Date.now(), 'entered at the deadline');
    assert.deepEqual(state.blocked.map((b) => b.session).sort(), ['a', 'b']);
    // Unattended now: the next dialog is denied without waiting, even with the timeout turned off.
    const next = await hook(permission({ session_id: 'c', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } }), { SORRY_MATT_UNATTENDED_AFTER: 'off' });
    assert.equal(next.out.hookSpecificOutput.decision.behavior, 'deny');
    assert.match(next.out.hookSpecificOutput.decision.message, /\n這是 Claude Code 的權限提示（WebFetch）。\n/);
    assert.deepEqual(savedState(home).blocked.at(-1).subject, 'WebFetch');
    assert.deepEqual(readdirSync(dirname(autoStateFile(home))), ['unattended.json'], 'no lock or temp file is left behind');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// node --test scripts/checks.test.mjs
// Each case builds a minimal repo in a temp dir and asserts what the checks report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { checkRepo as checkStructure } from './check-structure.mjs';
import { checkRepo as checkVendored } from './check-vendored.mjs';

const YAML = 'interface:\n  display_name: "Demo"\n';
const SRC = '---\nname: demo\ndescription: 示範\n---\n\n# demo\n\n## 1. 開始\n\n讀 [`REF.md`](REF.md)。\n\n完成判準：做完。\n';
const DIST = '---\nname: demo\ndescription: Demo\n---\n\n# demo\n\n## 1. Start\n\nRead [`REF.md`](REF.md).\n\nDone when: done.\n';

function repo(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sorry-matt-check-'));
  const files = {
    'src/skills/demo/SKILL.md': SRC,
    'src/skills/demo/REF.md': '# 參考\n',
    'src/skills/demo/agents/openai.yaml': YAML,
    'skills/demo/SKILL.md': DIST,
    'skills/demo/REF.md': '# Reference\n',
    'skills/demo/agents/openai.yaml': YAML,
    '.claude-plugin/plugin.json': JSON.stringify({ skills: ['./skills/demo'] }),
    'README.md': '| Skill | Description |\n| --- | --- |\n| `demo` | Demo |\n',
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function withRepo(overrides, fn) {
  const root = repo(overrides);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a reconciled repo is green, CRLF in the working tree included', () => {
  withRepo({ 'skills/demo/SKILL.md': DIST.replace(/\n/g, '\r\n') }, (root) => {
    assert.deepEqual(checkStructure(root), []);
  });
});

test('a missing heading, Done-when, or referenced file in dist is reported', () => {
  const dist = DIST.replace('## 1. Start\n', '').replace('Done when: done.\n', '').replace('[`REF.md`](REF.md)', 'it');
  withRepo({ 'skills/demo/SKILL.md': dist }, (root) => {
    const problems = checkStructure(root).join('\n');
    assert.match(problems, /heading structure differs/);
    assert.match(problems, /完成判準 count 1 in src, "Done when:" count 0/);
    assert.match(problems, /referenced files differ \(src only: REF\.md/);
  });
});

test('pending markers must match between src and dist', () => {
  withRepo({ 'src/skills/demo/SKILL.md': SRC + '<!-- pending #99 -->\n' }, (root) => {
    assert.match(checkStructure(root).join('\n'), /pending markers differ/);
  });
});

test('a skill missing from dist, plugin.json, or README is reported', () => {
  withRepo(
    {
      'src/skills/extra/SKILL.md': '---\nname: extra\ndescription: x\n---\n',
      'src/skills/extra/agents/openai.yaml': YAML,
      'README.md': '| Skill | Description |\n| --- | --- |\n',
      '.claude-plugin/plugin.json': JSON.stringify({ skills: [] }),
    },
    (root) => {
      const problems = checkStructure(root).join('\n');
      assert.match(problems, /skill extra exists in src but not in dist/);
      assert.match(problems, /plugin\.json skills is missing demo/);
      assert.match(problems, /README\.md skills table is missing demo/);
    },
  );
});

test('openai.yaml drift between src and dist is reported', () => {
  withRepo({ 'skills/demo/agents/openai.yaml': YAML + 'policy: {}\n' }, (root) => {
    assert.match(checkStructure(root).join('\n'), /agents\/openai\.yaml: must be identical/);
  });
});

test('a skill script ships to dist unchanged', () => {
  const script = "console.log('hi');\n";
  withRepo({ 'src/skills/demo/scripts/run.mjs': script, 'skills/demo/scripts/run.mjs': script.replace(/\n/g, '\r\n') }, (root) => {
    assert.deepEqual(checkStructure(root), []);
  });
  withRepo({ 'src/skills/demo/scripts/run.mjs': script, 'skills/demo/scripts/run.mjs': "console.log('bye');\n" }, (root) => {
    assert.match(checkStructure(root).join('\n'), /demo\/scripts\/run\.mjs: must be identical/);
  });
  withRepo({ 'src/skills/demo/scripts/run.mjs': script }, (root) => {
    assert.match(checkStructure(root).join('\n'), /scripts\/run\.mjs exists in src but not in dist/);
  });
});

const UPSTREAM = 'upstream text\n';
const HASH = createHash('sha256').update(UPSTREAM).digest('hex').toUpperCase();
const notice = (hash) =>
  `# Vendored upstream notice\n\n- Source: x\n- Pin: y\n- \`up.md\` ← \`skills/up/SKILL.md\`: \`${hash}\`\n\n## MIT License\n`;

test('a vendored file matching its LF-normalized pin is green', () => {
  withRepo(
    {
      'skills/demo/references/upstream/up.md': UPSTREAM.replace(/\n/g, '\r\n'),
      'skills/demo/references/upstream/NOTICE.md': notice(HASH),
    },
    (root) => assert.deepEqual(checkVendored(root), []),
  );
});

test('a vendored file that drifted from its pin, or has no pin, is reported', () => {
  withRepo(
    {
      'skills/demo/references/upstream/up.md': 'edited\n',
      'skills/demo/references/upstream/other.md': 'x\n',
      'skills/demo/references/upstream/NOTICE.md': notice(HASH),
    },
    (root) => {
      const problems = checkVendored(root).join('\n');
      assert.match(problems, /up\.md: SHA-256 .* does not match pinned/);
      assert.match(problems, /other\.md: no pinned hash/);
    },
  );
});

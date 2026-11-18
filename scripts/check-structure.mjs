#!/usr/bin/env node
// Reconcile the Traditional Chinese source (src/skills) with the English dist (skills/).
// The two are written in different languages, so this compares structure, not wording:
// file sets, heading levels and numbering, "Done when" counts, referenced file names,
// pending-ticket markers, frontmatter, and byte-identical metadata, scripts and vendored files.
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLF, listDirs, listFiles, frontmatter, proseLines, report } from './lib.mjs';

// Executed, not translated: skill scripts ship to dist unchanged, like metadata and vendored files.
const VERBATIM = (file) =>
  file.startsWith('references/upstream/') || file.startsWith('scripts/') || file.endsWith('.yaml');

// `## 2. Title` -> "2:2."; `### (a) Title` -> "3:(a)"; `## Title` -> "2:". The label is language-neutral.
export function headings(text) {
  const out = [];
  for (const line of proseLines(text)) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const label = /^(\d+(?:\.\d+)*\.?|\([a-z0-9]+\)|L\d+)(?=\s|$)/.exec(m[2]);
    out.push(`${m[1].length}:${label ? label[1] : ''}`);
  }
  return out;
}

export const doneWhenCount = (text, lang) =>
  (text.match(lang === 'src' ? /完成判準[：:]/g : /Done when:/g) || []).length;

// Relative markdown link targets and backticked file names.
export function references(text) {
  const refs = new Set();
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (!/^(https?:|#|mailto:)/.test(m[1])) refs.add(m[1].replace(/#.*$/, ''));
  }
  for (const m of text.matchAll(/`([^`\s]+\.(?:md|json|ya?ml|mjs|js|sh|ts|png))`/g)) refs.add(m[1]);
  return [...refs].sort();
}

export const linkTargets = (text) =>
  [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((t) => !/^(https?:|#|mailto:)/.test(t));

// `<!-- pending #N -->` marks a rule that a later ticket replaces with a script or hook.
export const pendingMarkers = (text) => [...text.matchAll(/<!--\s*pending\s+(#\d+)\s*-->/g)].map((m) => m[1]).sort();

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const diff = (a, b) => ({ onlyA: a.filter((x) => !b.includes(x)), onlyB: b.filter((x) => !a.includes(x)) });

export function checkSkill(root, name) {
  const problems = [];
  const srcDir = join(root, 'src/skills', name);
  const distDir = join(root, 'skills', name);
  const srcFiles = listFiles(srcDir);
  const distFiles = listFiles(distDir);
  const { onlyA, onlyB } = diff(srcFiles, distFiles);
  for (const f of onlyA) problems.push(`${name}: ${f} exists in src but not in dist`);
  for (const f of onlyB) problems.push(`${name}: ${f} exists in dist but not in src`);
  if (!distFiles.includes('agents/openai.yaml')) problems.push(`${name}: dist has no agents/openai.yaml`);

  for (const file of srcFiles.filter((f) => distFiles.includes(f))) {
    const src = readLF(join(srcDir, file));
    const dist = readLF(join(distDir, file));
    const where = `${name}/${file}`;
    if (VERBATIM(file)) {
      if (src !== dist) problems.push(`${where}: must be identical in src and dist`);
      continue;
    }
    if (!file.endsWith('.md')) continue;

    if (!sameList(headings(src), headings(dist))) {
      problems.push(`${where}: heading structure differs (src ${headings(src).join(' ')} | dist ${headings(dist).join(' ')})`);
    }
    const [ds, dd] = [doneWhenCount(src, 'src'), doneWhenCount(dist, 'dist')];
    if (ds !== dd) problems.push(`${where}: 完成判準 count ${ds} in src, "Done when:" count ${dd} in dist`);
    const refs = diff(references(src), references(dist));
    if (refs.onlyA.length || refs.onlyB.length) {
      problems.push(`${where}: referenced files differ (src only: ${refs.onlyA.join(', ') || '-'}; dist only: ${refs.onlyB.join(', ') || '-'})`);
    }
    if (!sameList(pendingMarkers(src), pendingMarkers(dist))) {
      problems.push(`${where}: pending markers differ (src ${pendingMarkers(src).join(' ')} | dist ${pendingMarkers(dist).join(' ')})`);
    }
    for (const target of linkTargets(dist)) {
      if (!existsSync(resolve(dirname(join(distDir, file)), target.replace(/#.*$/, '')))) {
        problems.push(`${where}: link target ${target} does not exist in dist`);
      }
    }
    if (file === 'SKILL.md') {
      const [fs, fd] = [frontmatter(src), frontmatter(dist)];
      if (!fs || !fd) {
        problems.push(`${where}: missing frontmatter`);
      } else {
        if (fs.name !== name || fd.name !== name) problems.push(`${where}: frontmatter name must be "${name}" in both`);
        if ((fs['disable-model-invocation'] || '') !== (fd['disable-model-invocation'] || '')) {
          problems.push(`${where}: disable-model-invocation differs between src and dist`);
        }
        if (!fd.description) problems.push(`${where}: dist has no description`);
      }
      for (const ref of distFiles.filter((f) => f.startsWith('references/upstream/') && !f.endsWith('NOTICE.md'))) {
        if (!dist.includes(ref)) problems.push(`${where}: does not reference vendored ${ref} by relative path`);
      }
    }
  }
  return problems;
}

export function checkRepo(root) {
  const problems = [];
  const srcSkills = listDirs(join(root, 'src/skills'));
  const distSkills = listDirs(join(root, 'skills'));
  const { onlyA, onlyB } = diff(srcSkills, distSkills);
  for (const s of onlyA) problems.push(`skill ${s} exists in src but not in dist`);
  for (const s of onlyB) problems.push(`skill ${s} exists in dist but not in src`);
  for (const s of srcSkills.filter((x) => distSkills.includes(x))) problems.push(...checkSkill(root, s));

  const pluginPath = join(root, '.claude-plugin/plugin.json');
  if (existsSync(pluginPath)) {
    const listed = (JSON.parse(readLF(pluginPath)).skills || []).map((p) => p.replace(/^\.\/skills\//, '')).sort();
    const d = diff(distSkills, listed);
    for (const s of d.onlyA) problems.push(`plugin.json skills is missing ${s}`);
    for (const s of d.onlyB) problems.push(`plugin.json skills lists ${s}, which has no dist directory`);
  }
  const readmePath = join(root, 'README.md');
  if (existsSync(readmePath)) {
    const rows = [...readLF(readmePath).matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((m) => m[1]).sort();
    const d = diff(distSkills, rows);
    for (const s of d.onlyA) problems.push(`README.md skills table is missing ${s}`);
    for (const s of d.onlyB) problems.push(`README.md skills table lists ${s}, which is not a skill`);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'));
  process.exit(report('src/dist structure', checkRepo(root)));
}

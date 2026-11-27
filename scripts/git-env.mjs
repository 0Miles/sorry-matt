// Imported first by the test files that start git (and by tick-world.mjs, the tick replays' harness). No tests here.
// Every git process a test starts, its own and those of the scripts under test, inherits process.env; this adds two
// config values to it through GIT_CONFIG_COUNT, after any the environment already carries:
//   maintenance.auto=false  a commit, merge, rebase, fetch or push does not start `git maintenance run --auto`
//   gc.auto=0               a `git gc --auto` that does start has nothing to do
// The repositories are throwaway; on Windows each of those extra processes cost 120-150 ms.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const VALUES = [
  ['maintenance.auto', 'false'],
  ['gc.auto', '0'],
];

const env = process.env;
let count = Number(env.GIT_CONFIG_COUNT) || 0;
const has = (key) => Array.from({ length: count }, (_, i) => env[`GIT_CONFIG_KEY_${i}`]).includes(key);
for (const [key, value] of VALUES) {
  if (has(key)) continue;
  env[`GIT_CONFIG_KEY_${count}`] = key;
  env[`GIT_CONFIG_VALUE_${count}`] = value;
  count += 1;
}
env.GIT_CONFIG_COUNT = String(count);

/**
 * A push into a local bare repository runs its receive-pack without the GIT_CONFIG_COUNT values (git clears them for
 * the other repository), and receive-pack starts `git gc --auto` after every push unless that repository's own config
 * says receive.autogc=false. Written into the bare repository's config file: no git process.
 */
export function noAutoGc(bare) {
  appendFileSync(join(bare, 'config'), '[receive]\n\tautogc = false\n');
}

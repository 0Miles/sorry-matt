// merges: which tickets a merge commit on the integration branch belongs to. Not a command itself. No dependencies.
//
// The one place that maps a merge to its tickets, so review-guide.mjs and ci.mjs map it the same way. The rules are
// the three in the header of review-guide.mjs: a recorded merge SHA first; then, only for tickets with no recorded
// SHA, git's default `Merge branch '<b>'` subject (with or without the `-ci` suffix of a red-light fix branch) and
// the `Merge <id> (+<id>)` subject.

const BRANCH_SUBJECT = /^Merge branch '([^']+)'/;
const ID_SUBJECT = /^Merge (\S+?)(?=[\s:(]|$)(?:\s*\(([^)]*)\))?/;

/** The ticket ids a merge subject names under rule 3: the leading id and its `(+<id>)` aliases. */
/**
 * #221: the command that merges a ticket's pull request, the one copy integrate.mjs's pr-merge --ready hands the
 * host and tick names (its fallback, the human-work list, a revert PR): `gh stack merge` for a PR in a stack (#199),
 * `gh pr merge` otherwise.
 */
export const mergeCommand = (pr, { stacked = false } = {}) => (stacked ? `gh stack merge ${pr} --yes --squash` : `gh pr merge ${pr}`);

export function subjectIds(subject) {
  const m = ID_SUBJECT.exec(subject);
  if (!m || m[1] === 'branch') return [];
  return [m[1], ...[...(m[2] ?? '').matchAll(/\+\s*([^\s,)]+)/g)].map((a) => a[1])];
}

/**
 * `tickets` are `{ id, branch, merges }` (`branch` null or a name, `merges` an array of SHAs or abbreviations);
 * `resolve(ref)` returns the full SHA of a commit and throws when there is none.
 *
 * Returns `owners(commit)` for a `{ sha, subject, parents }` commit: `{ owners: [ticket...], matchedBy }`, with
 * `matchedBy` "sha", "branch" or "id"; only a two-parent merge has owners. `recorded` maps each recorded full SHA
 * to the tickets that list it.
 */
export function ticketOwners(tickets, resolve) {
  // Rule 1: recorded merge SHAs.
  const recorded = new Map();
  for (const t of tickets) {
    for (const ref of t.merges) {
      const full = resolve(ref);
      recorded.set(full, [...(recorded.get(full) ?? []), t]);
    }
  }
  // Rules 2 and 3: only tickets without recorded SHAs.
  const unrecorded = tickets.filter((t) => !t.merges.length);
  const byBranch = new Map(unrecorded.filter((t) => t.branch).map((t) => [t.branch, t]));
  const byId = new Map(unrecorded.map((t) => [t.id, t]));
  const owners = (c) => {
    if (c.parents.length !== 2) return { owners: [] };
    if (recorded.has(c.sha)) return { owners: recorded.get(c.sha), matchedBy: 'sha' };
    const branch = (BRANCH_SUBJECT.exec(c.subject) || [])[1];
    const byB = branch && (byBranch.get(branch) || byBranch.get(branch.replace(/-ci$/, '')));
    if (byB) return { owners: [byB], matchedBy: 'branch' };
    const byI = subjectIds(c.subject).map((id) => byId.get(id)).filter(Boolean);
    return { owners: [...new Set(byI)], matchedBy: 'id' };
  };
  return { owners, recorded };
}

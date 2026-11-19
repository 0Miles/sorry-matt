// ticket: how get-to-work's scripts read a ticket's markdown. Not a command itself. No dependencies.
//
// The one place that recognizes fenced code and headings, so frontier.mjs and acceptance.mjs read a ticket the
// same way:
//   - A line opening with three or more backticks or tildes starts fenced code, up to a line opening with the same
//     character. A backtick line with another backtick after the opening run (```npm test``` runs first.) is
//     inline code, not a fence. Fenced lines are never headings and never count as ticket text.
//   - A heading is `#` to `######`, a space and the title; a closing run of `#` is not part of the title.
//   - A section is a heading's rows down to the next heading of the same or a higher level.
//   - Sections titled exactly `Comments`, or `sorry-matt …` (any level, any case) are not the ticket's own text.
//     The first level-1 heading is the ticket's title and never starts such a section, whatever it says.

const FENCE = /^\s*(`{3,}(?!.*`)|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HEADING_START = /^\s*#{1,6}\s/;
const SKIPPED_SECTION = /^(comments$|sorry-matt\b)/i;

/** Lines of the markdown, each `{ line }`, plus `fenced: true` inside fenced code or `level` and `title` on a heading. */
export function scan(text) {
  let fence = null;
  return text.split(/\r?\n/).map((line) => {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return { line, fenced: true };
    }
    if (fence) return { line, fenced: true };
    const h = HEADING.exec(line);
    return h ? { line, level: h[1].length, title: h[2].trim() } : { line };
  });
}

/** True when `line`, indented or not, starts like a heading; it ends a list item's continuation lines. */
export const startsHeading = (line) => HEADING_START.test(line);

/** The rows under the heading at `start`, up to the next heading of the same or a higher level. */
export function sectionAt(rows, start) {
  const out = [];
  for (const r of rows.slice(start + 1)) {
    if (r.level && r.level <= rows[start].level) break;
    out.push(r);
  }
  return out;
}

/** Index of the first heading whose title passes `test`, or -1. */
export const headingIndex = (rows, test) => rows.findIndex((r) => r.level && test(r.title));

/** Index of the last heading whose title passes `test`, or -1. */
export const lastHeadingIndex = (rows, test) => rows.findLastIndex((r) => r.level && test(r.title));

/** The rows under the first heading whose title passes `test`, or null when there is none. */
export function section(rows, test) {
  const start = headingIndex(rows, test);
  return start < 0 ? null : sectionAt(rows, start);
}

/**
 * The ticket's own rows: the same rows, with fenced code and every `Comments` / `sorry-matt …` section (heading
 * included) blanked to `{ line: '' }`, whatever their level. The title (the first level-1 heading) is never one.
 */
export function ownRows(rows) {
  const title = rows.findIndex((r) => r.level === 1);
  let skipBelow = null;
  return rows.map((r, i) => {
    if (r.level && skipBelow !== null && r.level <= skipBelow) skipBelow = null;
    if (r.level && skipBelow === null && i !== title && SKIPPED_SECTION.test(r.title)) skipBelow = r.level;
    return skipBelow !== null || r.fenced ? { line: '' } : r;
  });
}

/** The text lines of `rows`, fenced ones blanked. */
export const lines = (rows) => rows.map((r) => (r.fenced ? '' : r.line));

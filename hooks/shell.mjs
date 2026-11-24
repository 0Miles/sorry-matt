// A command line read the way the guard needs it: every top-level simple command, with its words, redirection
// targets, and the operator that joined it to the one before. Not a shell: it follows quotes, escapes, separators,
// redirections and heredocs, and keeps `$( )` and backticks inside the word they sit in. It does not look inside
// them, inside a script handed to another interpreter (`bash -c`, `pwsh -Command`, `eval`), or through variables.

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')']);

// Words that may stand before the real command and are skipped to reach it.
const PREFIXES = new Set(['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time', 'command', 'builtin', 'exec', 'nohup', 'stdbuf']);
// Prefixes that take options, some with a value, before the command.
const PREFIX_OPTIONS = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S']),
  nice: new Set(['-n']),
  timeout: new Set(['-s', '-k']),
  xargs: new Set(['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a']),
};

// `C:\Program Files\Git\bin\git.exe` -> `git`.
export const commandName = (word = '') =>
  word.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();

/**
 * Every top-level simple command in `line`.
 * @param {string} line
 * @param {'bash'|'powershell'|'cmd'} dialect cmd: `^` escapes, a backslash is a path separator, `'` and `#` are plain
 * @returns {{argv: string[], redirects: string[], op: string, heredoc: string}[]}
 */
export function parse(line, dialect = 'bash') {
  const segments = [];
  const escape = { powershell: '`', cmd: '^' }[dialect] ?? '\\';
  const cmd = dialect === 'cmd';
  const heredocs = [];
  let seg = { argv: [], redirects: [], op: '', heredoc: '' };
  let word = null;
  let target = null; // 'redirect' | 'herestring' for the next word
  let i = 0;

  const endWord = () => {
    if (word === null) return;
    if (target === 'redirect') seg.redirects.push(word);
    else if (target === 'herestring') seg.heredoc += word + '\n';
    else seg.argv.push(word);
    target = null;
    word = null;
  };
  const endSegment = (op) => {
    endWord();
    if (seg.argv.length || seg.redirects.length || seg.heredoc) segments.push(seg);
    seg = { argv: [], redirects: [], op, heredoc: '' };
  };
  // Index just past the `)` that closes a `(` opened before `from`; quoted text is skipped.
  const closeParen = (from) => {
    let depth = 1;
    let j = from;
    while (j < line.length && depth > 0) {
      const c = line[j];
      if (c === escape) j++;
      else if (c === "'") {
        const end = line.indexOf("'", j + 1);
        j = end === -1 ? line.length : end;
      } else if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    return j;
  };
  // `$( )` and backticks stay part of the word they sit in; their text is not read as commands.
  const substitution = closeParen;
  const backtick = (start) => {
    let j = start;
    while (j < line.length && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  // After a newline: read the bodies of the heredocs opened on the line that just ended.
  const readHeredocs = () => {
    while (heredocs.length) {
      const { delimiter, strip, owner } = heredocs.shift();
      const body = [];
      while (i < line.length) {
        const nl = line.indexOf('\n', i);
        const raw = line.slice(i, nl === -1 ? line.length : nl).replace(/\r$/, '');
        i = nl === -1 ? line.length : nl + 1;
        if ((strip ? raw.replace(/^\t+/, '') : raw) === delimiter) break;
        body.push(raw);
      }
      owner.heredoc += body.join('\n') + '\n';
    }
  };

  while (i < line.length) {
    const c = line[i];
    if (c === escape && (line[i + 1] === '\n' || (line[i + 1] === '\r' && line[i + 2] === '\n'))) {
      i += line[i + 1] === '\r' ? 3 : 2;
      continue;
    }
    if (c === escape) {
      word = (word ?? '') + (line[i + 1] ?? '');
      i += 2;
      continue;
    }
    if (c === "'" && !cmd) {
      const end = line.indexOf("'", i + 1);
      word = (word ?? '') + line.slice(i + 1, end === -1 ? line.length : end);
      i = end === -1 ? line.length : end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = '';
      while (j < line.length && line[j] !== '"') {
        const next = line[j + 1];
        if (line[j] === escape && dialect === 'bash' && !['$', '`', '"', '\\'].includes(next)) {
          // Bash keeps a backslash inside double quotes unless it escapes one of these (`"C:\a"` is `C:\a`),
          // or ends the line, which joins it to the next.
          if (next === '\n' || (next === '\r' && line[j + 2] === '\n')) j += next === '\r' ? 3 : 2;
          else text += line[j++];
        } else if (line[j] === escape && !cmd && j + 1 < line.length) {
          text += line[j + 1];
          j += 2;
        } else if (line[j] === '$' && line[j + 1] === '(') {
          const end = substitution(j + 2);
          text += line.slice(j, end);
          j = end;
        } else if (line[j] === '`' && dialect === 'bash') {
          const end = backtick(j + 1);
          text += line.slice(j, end);
          j = end;
        } else text += line[j++];
      }
      word = (word ?? '') + text;
      i = j + 1;
      continue;
    }
    if (c === '$' && line[i + 1] === '(') {
      const end = substitution(i + 2);
      word = (word ?? '') + line.slice(i, end);
      i = end;
      continue;
    }
    if (c === '`' && dialect === 'bash') {
      const end = backtick(i + 1);
      word = (word ?? '') + line.slice(i, end);
      i = end;
      continue;
    }
    if (c === '#' && word === null && !cmd) {
      const nl = line.indexOf('\n', i);
      i = nl === -1 ? line.length : nl;
      continue;
    }
    if ((c === '<' || c === '>') && line[i + 1] === '(' && dialect === 'bash') {
      i = substitution(i + 2);
      continue;
    }
    if (c === '<' || c === '>') {
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      let op = '';
      while (i < line.length && /[<>&|]/.test(line[i]) && op.length < 3) op += line[i++];
      if (op === '<<' && line[i] === '-') op += line[i++];
      if (op === '<<' || op === '<<-') {
        while (line[i] === ' ' || line[i] === '\t') i++;
        const m = /^(['"]?)([^\s'";&|<>()]+)\1/.exec(line.slice(i));
        if (m) {
          heredocs.push({ delimiter: m[2], strip: op === '<<-', owner: seg });
          i += m[0].length;
        }
        continue;
      }
      if (/&$/.test(op) && /[\d-]/.test(line[i] ?? '')) {
        // `2>&1`, `>&2`, `<&-`: the target is a descriptor, not a file.
        while (/[\d-]/.test(line[i] ?? '')) i++;
        continue;
      }
      target = op === '<<<' ? 'herestring' : 'redirect';
      while (line[i] === ' ' || line[i] === '\t') i++;
      continue;
    }
    if (SEPARATORS.has(c)) {
      let op = c;
      if ((c === '&' || c === '|') && line[i + 1] === c) op += c;
      i += op.length;
      endSegment(op);
      if (c === '\n') readHeredocs();
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
      continue;
    }
    word = (word ?? '') + c;
    i++;
  }
  endSegment('');
  return segments;
}

/**
 * The words of a simple command with leading assignments and wrappers (`sudo`, `env`, `xargs`, ...)
 * removed, so argv[0] is the program that runs. `wrappers` names what was removed.
 */
export function unwrap(argv) {
  let k = 0;
  const wrappers = [];
  while (k < argv.length) {
    const w = argv[k];
    const name = commandName(w);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) k++;
    else if (PREFIXES.has(name)) {
      wrappers.push(name);
      k++;
    } else if (PREFIX_OPTIONS[name]) {
      wrappers.push(name);
      k++;
      while (k < argv.length && argv[k].startsWith('-')) k += PREFIX_OPTIONS[name].has(argv[k]) ? 2 : 1;
      if (name === 'timeout' && k < argv.length) k++;
      if (name === 'nice' && /^-?\d+$/.test(argv[k] ?? '')) k++;
    } else break;
  }
  return { argv: argv.slice(k), wrappers };
}

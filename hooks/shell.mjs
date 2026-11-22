// A command line read the way a guard needs it: every simple command it would run, with its words,
// redirection targets, and the operator that joined it to the one before. Not a shell: it follows
// quotes, escapes, separators, subshells, `$( )` and backticks, redirections and heredocs; anything
// else it still splits on whitespace, so a hidden command shows up as words instead of vanishing.

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
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const POWERSHELLS = new Set(['pwsh', 'powershell']);

// `C:\Program Files\Git\bin\git.exe` -> `git`.
export const commandName = (word = '') =>
  word.replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();

/**
 * Every simple command in `line`, nested ones (`bash -c`, `$( )`, heredocs fed to a shell) included.
 * @param {string} line
 * @param {'bash'|'powershell'|'cmd'} dialect cmd: `^` escapes, a backslash is a path separator, `'` and `#` are plain
 * @returns {{argv: string[], redirects: string[], op: string, heredoc: string}[]}
 */
export function parse(line, dialect = 'bash') {
  const segments = [];
  const nested = [];
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
  const substitution = (start) => {
    const end = closeParen(start);
    nested.push(line.slice(start, end - 1));
    return end;
  };
  const backtick = (start) => {
    let j = start;
    while (j < line.length && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
    nested.push(line.slice(start, j));
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
  expandVariables(segments, dialect);

  const out = [];
  for (const s of segments) {
    out.push(s);
    const inner = innerScript(s.argv);
    if (inner) out.push(...parse(inner.text, inner.dialect));
    const shell = interpreter(s.argv);
    if (s.heredoc && shell) out.push(...parse(s.heredoc, shell));
  }
  for (const text of nested) out.push(...parse(text, dialect));
  return out;
}

// `R=owner/repo; gh pr merge 1 --repo $R`: a variable given a plain value earlier on the same line is read as that
// value from then on. A name given two different values, or a value that is itself an expansion, stays as written,
// and so does anything inside `$( )`, backticks or a nested script.
const NAME = '[A-Za-z_][A-Za-z0-9_]*';
function assignments(argv, dialect) {
  if (dialect === 'cmd') return null;
  if (dialect === 'powershell') {
    let m;
    if (argv.length === 3 && argv[1] === '=' && (m = new RegExp(`^\\$(${NAME})$`).exec(argv[0]))) return [[m[1], argv[2]]];
    if (argv.length === 1 && (m = new RegExp(`^\\$(${NAME})=(.*)$`, 's').exec(argv[0]))) return [[m[1], m[2]]];
    return null;
  }
  const words = ['export', 'local', 'readonly', 'declare', 'typeset'].includes(argv[0]) ? argv.slice(1) : argv;
  if (!words.length || !words.every((w) => new RegExp(`^${NAME}=`).test(w))) return null;
  return words.map((w) => [w.slice(0, w.indexOf('=')), w.slice(w.indexOf('=') + 1)]);
}

function expandVariables(segments, dialect) {
  const key = (name) => (dialect === 'powershell' ? name.toLowerCase() : name);
  const seen = new Map();
  for (const seg of segments) {
    for (const [name, value] of assignments(seg.argv, dialect) ?? []) {
      const k = key(name);
      seen.set(k, seen.has(k) && seen.get(k) !== value ? null : value);
    }
  }
  const values = new Map();
  const expand = (word) =>
    word.replace(new RegExp(`\\$\\{(${NAME})\\}|\\$(${NAME})(?![A-Za-z0-9_])`, 'g'), (whole, braced, bare) => {
      const k = key(braced ?? bare);
      return values.has(k) ? values.get(k) : whole;
    });
  for (const seg of segments) {
    const set = assignments(seg.argv, dialect);
    if (values.size) {
      seg.argv = seg.argv.map(expand);
      seg.redirects = seg.redirects.map(expand);
    }
    for (const [name, value] of set ?? []) {
      const k = key(name);
      if (seen.get(k) !== null && !/[$`]/.test(value)) values.set(k, value);
    }
  }
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

const interpreter = (argv) => {
  const name = commandName(unwrap(argv).argv[0]);
  if (SHELLS.has(name)) return 'bash';
  if (POWERSHELLS.has(name)) return 'powershell';
  return null;
};

// The script a command hands to another interpreter: `bash -c '...'`, `pwsh -Command ...`,
// `pwsh -EncodedCommand <base64>`, `cmd /c ...`, `eval ...`, `Invoke-Expression ...`, `wsl -- ...`.
function innerScript(rawArgv) {
  const argv = unwrap(rawArgv).argv;
  const name = commandName(argv[0]);
  const rest = argv.slice(1);
  if (SHELLS.has(name)) {
    const c = rest.findIndex((w) => /^-[a-z]*c[a-z]*$/i.test(w));
    return c !== -1 && rest[c + 1] !== undefined ? { text: rest[c + 1], dialect: 'bash' } : null;
  }
  if (POWERSHELLS.has(name)) {
    const enc = rest.findIndex((w) => /^-(e|ec|enc|encodedcommand)$/i.test(w));
    if (enc !== -1 && rest[enc + 1]) {
      return { text: Buffer.from(rest[enc + 1], 'base64').toString('utf16le'), dialect: 'powershell' };
    }
    const c = rest.findIndex((w) => /^-(c|command)$/i.test(w));
    return c !== -1 ? { text: rest.slice(c + 1).join(' '), dialect: 'powershell' } : null;
  }
  if (name === 'cmd') {
    const c = rest.findIndex((w) => /^\/[ck]$/i.test(w));
    return c !== -1 ? { text: rest.slice(c + 1).join(' '), dialect: 'cmd' } : null;
  }
  if (name === 'eval') return rest.length ? { text: rest.join(' '), dialect: 'bash' } : null;
  if (name === 'invoke-expression' || name === 'iex') {
    return rest.length ? { text: rest.join(' '), dialect: 'powershell' } : null;
  }
  if (name === 'wsl') {
    const dd = rest.findIndex((w) => w === '--' || w === '-e' || w === '--exec');
    return dd !== -1 && rest.length > dd + 1 ? { text: rest.slice(dd + 1).join(' '), dialect: 'bash' } : null;
  }
  return null;
}

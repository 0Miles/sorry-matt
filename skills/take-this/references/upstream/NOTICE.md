# Vendored upstream notice

- Project: `mattpocock/skills`
- Source: https://github.com/mattpocock/skills
- Pin: Claude plugin distribution `mattpocock-skills@1.3.2` (`main` @ `4ae2317`)
- Vendored files and pinned SHA-256 values:
  - `handoff.md` ← `skills/productivity/handoff/SKILL.md`: `4CBB043950DAD2FFD3662FF1A5A0B51AE676004B5CAE10E3787E8EE7A4EE69D3`

The adjacent source is a verbatim vendored runtime reference and upstream reconciliation baseline. The pinned
SHA-256 is taken over LF-normalized content, so it holds however a working tree checks newlines out
(`scripts/check-vendored.mjs` verifies it). The parent `SKILL.md` directs when to read and execute it.

Adapted, not vendored: the spec and ticket procedure in the parent `SKILL.md` (steps 3 and 4) and the templates in
`TEMPLATES.md` are rewritten from `skills/engineering/to-spec/SKILL.md` and
`skills/engineering/to-tickets/SKILL.md` at the same pin, and sections 1 and 2 of the implementation agent's
definition `../../../../agents/implementer.md` (source `src/agents/implementer.md` in the sorry-matt repository) are
rewritten from `skills/engineering/implement/SKILL.md` and `skills/engineering/tdd/SKILL.md` at the same pin. Their pinned hashes and the reason they are no longer
vendored are recorded in `docs/matt-skills.md` of the sorry-matt repository.

## MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

'use strict';

/**
 * Tokenizes the samples with the TextMate engine VS Code uses and compares the
 * result to test/__snapshots__/. `npm run test:update` rewrites the snapshots.
 * Snapshot lines are "line:col text scope": 1-based position, JSON-quoted text,
 * and the token's scopes below `source.ahdl` (or `source.ahdl` when there are none).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const ROOT = path.join(__dirname, '..');
const GRAMMAR = path.join(ROOT, 'syntaxes', 'ahdl.tmLanguage.json');
const SAMPLES = path.join(ROOT, 'samples');
const SNAPSHOTS = path.join(__dirname, '__snapshots__');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

let grammar;
function loadGrammar() {
  if (!grammar) {
    const wasm = fs.readFileSync(path.join(path.dirname(require.resolve('vscode-oniguruma')), 'onig.wasm'));
    const onigLib = oniguruma.loadWASM(wasm).then(() => ({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s) => new oniguruma.OnigString(s)
    }));
    const registry = new vsctm.Registry({
      onigLib,
      loadGrammar: async (scopeName) =>
        scopeName === 'source.ahdl' ? vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR, 'utf8'), GRAMMAR) : null
    });
    grammar = registry.loadGrammar('source.ahdl');
  }
  return grammar;
}

/** [{ line, col, offset, text, scopes }]: 0-based line/col, offset into the '\n'-joined text. */
async function tokenize(text) {
  const g = await loadGrammar();
  const tokens = [];
  let stack = vsctm.INITIAL;
  let lineOffset = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    const r = g.tokenizeLine(line, stack);
    for (const t of r.tokens) {
      const tokText = line.slice(t.startIndex, t.endIndex);
      if (tokText) tokens.push({ line: i, col: t.startIndex, offset: lineOffset + t.startIndex, text: tokText, scopes: t.scopes.slice(1) });
    }
    stack = r.ruleStack;
    lineOffset += line.length + 1;
  });
  return tokens;
}

function formatToken(t) {
  return `${t.line + 1}:${t.col + 1} ${JSON.stringify(t.text)} ${t.scopes.join(' ') || 'source.ahdl'}`;
}

/** Scopes of the token covering the `nth` occurrence of `needle` in `src` ('\n' line breaks). */
async function scopesOf(src, needle, nth = 0) {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = src.indexOf(needle, at + 1);
  assert.ok(at >= 0, `"${needle}" not found`);
  const tok = (await tokenize(src)).find((t) => t.offset <= at && at < t.offset + t.text.length);
  return tok.scopes;
}

/** Every token overlapping the `needle` span, so a literal split into several tokens is checked whole. */
async function tokensOver(src, needle) {
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `"${needle}" not found`);
  return (await tokenize(src)).filter((t) => t.offset < at + needle.length && at < t.offset + t.text.length);
}

const has = (scopes, name) => scopes.some((s) => s === name);

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

for (const file of fs.readdirSync(SAMPLES).filter((f) => /\.(tdf|inc)$/i.test(f)).sort()) {
  test(`snapshot: samples/${file}`, async () => {
    const actual = (await tokenize(fs.readFileSync(path.join(SAMPLES, file), 'utf8'))).map(formatToken).join('\n') + '\n';
    const snap = path.join(SNAPSHOTS, file + '.snap');
    if (UPDATE) {
      fs.mkdirSync(SNAPSHOTS, { recursive: true });
      fs.writeFileSync(snap, actual);
      return;
    }
    assert.ok(fs.existsSync(snap), `missing ${path.relative(ROOT, snap)}; run npm run test:update`);
    assert.equal(actual, fs.readFileSync(snap, 'utf8').replace(/\r\n/g, '\n'));
  });
}

// ---------------------------------------------------------------------------
// Targeted checks
// ---------------------------------------------------------------------------

test('"-- 100% done" stays a line comment', async () => {
  const src = 'a = b; -- 100% done\nc = d;';
  assert.ok(has(await scopesOf(src, '100%'), 'comment.line.double-dash.ahdl'));
  assert.ok(!(await scopesOf(src, 'c = d')).some((s) => s.startsWith('comment')), '% must not open a block comment');
});

test('% ... % block comments span lines', async () => {
  const src = 'a = b; % first\nsecond %\nc = d;';
  assert.ok(has(await scopesOf(src, 'first'), 'comment.block.percentage.ahdl'));
  assert.ok(has(await scopesOf(src, 'second'), 'comment.block.percentage.ahdl'));
  assert.ok(!(await scopesOf(src, 'c = d')).some((s) => s.startsWith('comment')));
});

test('B"01X0" and H"FF" are radix numbers', async () => {
  const src = 'x[] = B"01X0" # H"FF";';
  for (const literal of ['B"01X0"', 'H"FF"']) {
    const toks = await tokensOver(src, literal);
    assert.equal(toks.map((t) => t.text).join(''), literal);
    for (const t of toks) {
      assert.ok(has(t.scopes, 'constant.numeric.radix.ahdl'), `${t.text} in ${literal}: ${t.scopes}`);
      assert.ok(!t.scopes.some((s) => s.startsWith('string')), `${t.text} in ${literal} is not a string`);
    }
  }
});

test('".." is a range operator, ".q" is a member access', async () => {
  const src = 'q[HI..LO] = ff[7..0].q;';
  assert.deepEqual(await scopesOf(src, '..'), ['keyword.operator.range.ahdl']);
  assert.deepEqual(await scopesOf(src, '..', 1), ['keyword.operator.range.ahdl']);
  assert.ok(!has(await scopesOf(src, 'LO'), 'variable.other.member.port.ahdl'), 'name after ".." is not a member');
  assert.deepEqual(await scopesOf(src, '.q'), ['punctuation.accessor.ahdl']);
  assert.deepEqual(await scopesOf(src, 'q;'), ['variable.other.member.port.ahdl']);
});

test('word operators are "wordlike", which the default themes color; symbols keep the operator scope', async () => {
  const src = 'x = a AND NOT b # c;';
  assert.deepEqual(await scopesOf(src, 'AND'), ['keyword.operator.wordlike.ahdl']);
  assert.deepEqual(await scopesOf(src, 'NOT'), ['keyword.operator.wordlike.ahdl']);
  assert.deepEqual(await scopesOf(src, '#'), ['keyword.operator.logical.ahdl']);
});

test('"IN" of FOR ... IN ... TO is a keyword', async () => {
  assert.deepEqual(await scopesOf('FOR i IN 0 TO 7 GENERATE', 'IN'), ['keyword.control.ahdl']);
});

test('names inside a port group "ff[].(clk, d[7..0])" are members; the right-hand group is not', async () => {
  const src = 'ff[].(clk, d[7..0]) = (clock, data[]);';
  assert.ok(has(await scopesOf(src, 'clk'), 'variable.other.member.port.ahdl'));
  assert.ok(has(await scopesOf(src, 'd[7'), 'variable.other.member.port.ahdl'));
  assert.ok(has(await scopesOf(src, '..'), 'keyword.operator.range.ahdl'));
  assert.deepEqual(await scopesOf(src, '.('), ['meta.port-group.ahdl', 'punctuation.accessor.ahdl']);
  assert.ok(!has(await scopesOf(src, 'clock'), 'variable.other.member.port.ahdl'));
  assert.ok(!has(await scopesOf(src, 'data'), 'variable.other.member.port.ahdl'));
  assert.ok(!(await scopesOf(src, 'clock')).some((s) => s.startsWith('meta.port-group')), 'the group ends at ")"');
});

test('an unclosed port group ends at "=" instead of swallowing the line', async () => {
  const src = 'ff[].(clk, clrn = (clock, reset);';
  assert.ok(!(await scopesOf(src, 'clock')).some((s) => s.startsWith('meta.port-group')));
});

test('keywords match case-insensitively', async () => {
  const src = 'Variable r : dffe;\nbegin\nif a THEN r.d = vcc; End If;\nend;';
  assert.deepEqual(await scopesOf(src, 'Variable'), ['storage.type.ahdl']);
  assert.deepEqual(await scopesOf(src, 'dffe'), ['support.type.primitive.ahdl']);
  assert.deepEqual(await scopesOf(src, 'begin'), ['keyword.control.ahdl']);
  assert.deepEqual(await scopesOf(src, 'if'), ['keyword.control.ahdl']);
  assert.deepEqual(await scopesOf(src, 'THEN'), ['keyword.control.ahdl']);
  assert.deepEqual(await scopesOf(src, 'vcc'), ['constant.language.ahdl']);
  assert.deepEqual(await scopesOf(src, 'End'), ['keyword.control.ahdl']);
  assert.deepEqual(await scopesOf(src, 'end;'), ['keyword.control.ahdl']);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// Resolve require('vscode') to the mock before loading the extension.
const MOCK = path.join(__dirname, 'mocks', 'vscode.js');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? MOCK : resolve.call(this, request, ...rest);
};
const vscode = require('vscode');
const { _test: ext } = require('../src/extension');

const SAMPLES = path.join(__dirname, '..', 'samples');
const TRAFFIC = path.join(SAMPLES, 'traffic.tdf');
const traffic = fs.readFileSync(TRAFFIC, 'utf8');

// extension.js caches parses by uri + version, so every mock document gets a fresh version.
let version = 0;

/** A TextDocument-like object over `text`, stored at `file` (INCLUDEs resolve relative to it). */
function openDocument(file, text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineText = (line) => text.slice(lineStarts[line], (lineStarts[line + 1] ?? text.length + 1) - 1).replace(/\r$/, '');
  const offsetAt = (pos) => lineStarts[pos.line] + pos.character;
  const positionAt = (offset) => {
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= offset) line++;
    return new vscode.Position(line, offset - lineStarts[line]);
  };
  return {
    uri: vscode.Uri.file(file),
    version: ++version,
    getText: (range) => (range ? text.slice(offsetAt(range.start), offsetAt(range.end)) : text),
    offsetAt,
    positionAt,
    lineAt: (line) => ({ text: lineText(line) }),
    getWordRangeAtPosition(pos, re) {
      const line = lineText(pos.line);
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = g.exec(line))) {
        if (m.index <= pos.character && pos.character <= m.index + m[0].length) {
          return new vscode.Range(new vscode.Position(pos.line, m.index), new vscode.Position(pos.line, m.index + m[0].length));
        }
      }
      return undefined;
    }
  };
}

/** `src` (containing a `|` cursor) opened as `file`. */
function withCursor(file, src) {
  const offset = src.indexOf('|');
  const document = openDocument(file, src.slice(0, offset) + src.slice(offset + 1));
  return { document, position: document.positionAt(offset) };
}

/** traffic.tdf with `snippet` (containing a `|` cursor) as a new line before the final END; */
function trafficWith(snippet) {
  const at = traffic.search(/^END;/m);
  return withCursor(TRAFFIC, traffic.slice(0, at) + `\t${snippet}\n` + traffic.slice(at));
}

/** A throwaway Quartus project folder holding proj.qpf plus `files` (relative path → contents). */
function quartusProject(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ahdl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries({ 'proj.qpf': '', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** traffic.tdf as-is, with the cursor `delta` characters into the first match of `needle`. */
function trafficAt(needle, delta) {
  const document = openDocument(TRAFFIC, traffic);
  const at = traffic.indexOf(needle);
  assert.ok(at >= 0, `"${needle}" not found`);
  return { document, position: document.positionAt(at + delta) };
}

test('completions after "tmr." come from timer8.inc', () => {
  const { document, position } = trafficWith('tmr.|');
  const items = ext.provideCompletionItems(document, position);
  assert.deepEqual(items.map((i) => [i.label, i.detail]), [
    ['clock', 'input of timer8'],
    ['load', 'input of timer8'],
    ['data', 'input of timer8'],
    ['done', 'output of timer8'],
    ['count', 'output of timer8']
  ]);
});

test('completions after "sync[0]." are the DFFE ports', () => {
  const { document, position } = trafficWith('sync[0].|');
  const items = ext.provideCompletionItems(document, position);
  assert.deepEqual(items.map((i) => i.label), ['d', 'clk', 'clrn', 'prn', 'ena', 'q']);
  assert.ok(items.every((i) => i.kind === 'Field'));
});

test('hover on "tmr.done" says it is an output of timer8', () => {
  const { document, position } = trafficAt('tmr.done', 'tmr.'.length + 1);
  const hover = ext.provideHover(document, position);
  assert.match(hover.contents.value, /^`tmr\.done` — output of \*\*timer8\*\*/);
});

test('F12 on "timer8" jumps to samples/timer8.inc', () => {
  const { document, position } = trafficAt('timer8;', 2);
  const loc = ext.provideDefinition(document, position);
  assert.equal(loc.uri.fsPath, path.join(SAMPLES, 'timer8.inc'));
  assert.deepEqual({ ...loc.range.start }, { line: 1, character: 'FUNCTION '.length });
});

test('INCLUDE paths resolve from the Quartus project folder', (t) => {
  const proj = quartusProject(t, { 'src/include/regs.inc': 'FUNCTION reg8 (d[7..0], clk) RETURNS (q[7..0]);\n' });
  const file = path.join(proj, 'src', 'core', 'core.tdf');
  const src = 'INCLUDE "src/include/regs.inc";\nSUBDESIGN core (clk : INPUT)\nVARIABLE r : reg8;\nBEGIN\n\t|\nEND;\n';

  const completion = withCursor(file, src.replace('|', 'r.|'));
  assert.deepEqual(ext.provideCompletionItems(completion.document, completion.position).map((i) => i.label), ['d', 'clk', 'q']);

  const { document } = withCursor(file, src);
  const loc = ext.provideDefinition(document, new vscode.Position(0, 'INCLUDE "sr'.length));
  assert.equal(loc.uri.fsPath, path.join(proj, 'src', 'include', 'regs.inc'));
});

test('the Quartus project folder is searched before the document folder', (t) => {
  const proj = quartusProject(t, {
    'lib.inc': 'FUNCTION lib (a) RETURNS (b);\n',
    'src/lib.inc': 'FUNCTION lib (x) RETURNS (y);\n'
  });
  const { document, position } = withCursor(path.join(proj, 'src', 'top.tdf'),
    'INCLUDE "lib.inc";\nSUBDESIGN top (clk : INPUT)\nVARIABLE l : lib;\nBEGIN\n\tl.|\nEND;\n');
  assert.deepEqual(ext.provideCompletionItems(document, position).map((i) => i.label), ['a', 'b']);
});

test('outline root is the SUBDESIGN with ports and variables as children', () => {
  const document = openDocument(TRAFFIC, traffic);
  const symbols = ext.provideDocumentSymbols(document);
  assert.equal(symbols.length, 1);
  const [root] = symbols;
  assert.deepEqual([root.name, root.detail, root.kind], ['traffic', 'SUBDESIGN', 'Module']);
  const childrenOf = (...kinds) => root.children.filter((c) => kinds.includes(c.kind)).map((c) => [c.name, c.detail]);
  assert.deepEqual(childrenOf('Field'), [
    ['clk', 'INPUT'], ['reset', 'INPUT'], ['car_waiting', 'INPUT'],
    ['red', 'OUTPUT'], ['yellow', 'OUTPUT'], ['green', 'OUTPUT'], ['debug[1..0]', 'OUTPUT']
  ]);
  assert.deepEqual(childrenOf('Enum', 'Variable'), [['ss', 'MACHINE'], ['tmr', 'timer8'], ['sync[1..0]', 'DFFE'], ['busy', 'NODE']]);
  assert.deepEqual(root.children.find((c) => c.name === 'ss').children.map((c) => c.name), ['s_red', 's_green', 's_yellow']);

  // Breadcrumbs and Follow Cursor find a symbol by walking down through ranges that contain the cursor.
  const within = (outer, inner) =>
    document.offsetAt(outer.start) <= document.offsetAt(inner.start) && document.offsetAt(inner.end) <= document.offsetAt(outer.end);
  const check = (s) => {
    assert.ok(within(s.range, s.selectionRange), `${s.name}: selectionRange inside range`);
    for (const c of s.children) {
      assert.ok(within(s.range, c.range), `${c.name} inside ${s.name}`);
      check(c);
    }
  };
  check(root);
});

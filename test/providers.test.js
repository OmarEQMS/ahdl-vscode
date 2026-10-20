'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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

/** traffic.tdf with `snippet` (containing a `|` cursor) as a new line before the final END; */
function trafficWith(snippet) {
  const at = traffic.search(/^END;/m);
  const src = traffic.slice(0, at) + `\t${snippet}\n` + traffic.slice(at);
  const offset = src.indexOf('|');
  const document = openDocument(TRAFFIC, src.slice(0, offset) + src.slice(offset + 1));
  return { document, position: document.positionAt(offset) };
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

test('outline root is the SUBDESIGN with ports and variables as children', () => {
  const symbols = ext.provideDocumentSymbols(openDocument(TRAFFIC, traffic));
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
});

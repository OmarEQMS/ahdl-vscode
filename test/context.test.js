'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseDocument } = require('../src/symbols');
const { getCompletionContext } = require('../src/context');

const traffic = fs.readFileSync(path.join(__dirname, '..', 'samples', 'traffic.tdf'), 'utf8');

/** Completion context at the `|` marker in `src`. */
function ctx(src) {
  const offset = src.indexOf('|');
  const text = src.slice(0, offset) + src.slice(offset + 1);
  return getCompletionContext(text, offset, parseDocument(text));
}

/** traffic.tdf with `snippet` inserted at the start of the line that begins with `anchor`. */
function insertBefore(anchor, snippet) {
  const at = traffic.search(new RegExp('^' + anchor, 'm'));
  assert.ok(at >= 0, `anchor ${anchor} not found`);
  return traffic.slice(0, at) + snippet + traffic.slice(at);
}

/** traffic.tdf with `snippet` as a new line just before the final END; */
const inLogic = (snippet) => insertBefore('END;', `\t${snippet}\n`);

test('"ss." offers the machine ports', () => {
  assert.deepEqual(ctx(inLogic('ss.|')), { kind: 'port', instance: 'ss', prefix: '' });
});

test('"sync[1].q" offers ports filtered by "q"', () => {
  assert.deepEqual(ctx(inLogic('sync[1].q|')), { kind: 'port', instance: 'sync', prefix: 'q' });
});

test('"sync[1.." is a range, not a port access', () => {
  assert.deepEqual(ctx(inLogic('sync[1..|')), { kind: 'none' });
});

test('every entry of a port group "sync[].(clk, " offers the ports of sync', () => {
  assert.deepEqual(ctx(inLogic('sync[].(|')), { kind: 'port', instance: 'sync', prefix: '' });
  assert.deepEqual(ctx(inLogic('sync[].(clk, cl|')), { kind: 'port', instance: 'sync', prefix: 'cl' });
  assert.deepEqual(ctx(inLogic('tmr.(data[7..0], |')), { kind: 'port', instance: 'tmr', prefix: '' });
  // The right-hand side is an ordinary group of signals.
  assert.deepEqual(ctx(inLogic('sync[].(clk, clrn) = (clk, |')), { kind: 'general' });
  assert.deepEqual(ctx(inLogic('IF (|')), { kind: 'general' });
});

test('"ss = " and "IF ss == " offer states', () => {
  assert.deepEqual(ctx(inLogic('ss = |')), { kind: 'states', machine: 'ss', prefix: '' });
  assert.deepEqual(ctx(inLogic('IF ss == |')), { kind: 'states', machine: 'ss', prefix: '' });
  assert.deepEqual(ctx(inLogic('ss = s_g|')), { kind: 'states', machine: 'ss', prefix: 's_g' });
});

test('"WHEN " offers states only inside a CASE on a machine', () => {
  assert.deepEqual(ctx(inLogic('CASE ss IS\n\t\tWHEN |')), { kind: 'states', machine: 'ss', prefix: '' });
  assert.deepEqual(ctx(inLogic('CASE debug[] IS\n\t\tWHEN |')), { kind: 'general' });
});

test('nothing inside comments', () => {
  assert.deepEqual(ctx(inLogic('-- ss.|')), { kind: 'none' });
  assert.deepEqual(ctx(inLogic('% ss.| %')), { kind: 'none' });
  assert.deepEqual(ctx(inLogic('% multi\n\tline ss = | %')), { kind: 'none' });
  // A '%' inside a line comment does not open a block comment.
  assert.deepEqual(ctx(inLogic('-- 100% done\n\tss.|')), { kind: 'port', instance: 'ss', prefix: '' });
});

test('"name :" offers directions in the port list and types in VARIABLE', () => {
  assert.deepEqual(ctx(insertBefore('\\tdebug', '\tname :|\n')), { kind: 'direction' });
  assert.deepEqual(ctx(insertBefore('BEGIN', '\tname :|\n')), { kind: 'type' });
  assert.deepEqual(ctx(inLogic('x = name :|')), { kind: 'general' });
});

test('keywords inside strings do not count', () => {
  assert.deepEqual(ctx(inLogic('ASSERT (VCC) REPORT "CASE ss IS" SEVERITY INFO;\n\tWHEN |')), { kind: 'general' });
  assert.deepEqual(ctx(inLogic('ASSERT (VCC) REPORT "VARIABLE" SEVERITY INFO;\n\tname :|')), { kind: 'general' });
});

test('INCLUDE " offers include files', () => {
  assert.deepEqual(ctx('INCLUDE "|\n' + traffic), { kind: 'include', prefix: '' });
  assert.deepEqual(ctx('INCLUDE "tim|\n' + traffic), { kind: 'include', prefix: 'tim' });
});

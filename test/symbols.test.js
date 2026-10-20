'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseDocument, findDeclaration, maskComments } = require('../src/symbols');

const SAMPLES = path.join(__dirname, '..', 'samples');
const traffic = fs.readFileSync(path.join(SAMPLES, 'traffic.tdf'), 'utf8');
const timer8 = fs.readFileSync(path.join(SAMPLES, 'timer8.inc'), 'utf8');

// Shaped like the prototypes Quartus ships in libraries/megafunctions.
const lpmCounter = `-- Copyright (C) Intel Corporation. All rights reserved.
-- FUNCTION fake (a) RETURNS (b);  (commented out: must be ignored)
FUNCTION lpm_counter (data[LPM_WIDTH-1..0], clock, clk_en, cnt_en, updown, cin, aclr, aset, aconst, aload, sclr, sset, sconst, sload)
	WITH (LPM_WIDTH, LPM_DIRECTION, LPM_MODULUS, LPM_AVALUE, LPM_SVALUE, LPM_PORT_UPDOWN, DEVICE_FAMILY, CARRY_CNT_EN, LABWIDE_SCLR)
	RETURNS (q[LPM_WIDTH-1..0], cout, eq[15..0]);
`;

const generate = `SUBDESIGN gen
(
	clk : INPUT;
	q   : OUTPUT;
)
VARIABLE
	IF USE_REG GENERATE
		r : DFF;
	ELSE GENERATE
		r : LCELL;
	END GENERATE;
	n : NODE;
BEGIN
	q = r;
END;
`;

/** Assert that every offset in `doc` points at the symbol's name in `text`. */
function assertOffsets(text, doc) {
  const named = [
    ...doc.ports, ...doc.variables, ...doc.constants, ...doc.defines,
    ...doc.parameters, ...doc.functions, ...(doc.subdesign ? [doc.subdesign] : [])
  ];
  for (const s of named) assert.equal(text.slice(s.offset, s.offset + s.name.length), s.name, `offset of ${s.name}`);
  for (const inc of doc.includes) assert.equal(text.slice(inc.offset, inc.offset + inc.file.length), inc.file);
}

test('maskComments keeps length and line breaks', () => {
  const masked = maskComments(traffic);
  assert.equal(masked.length, traffic.length);
  for (let i = 0; i < traffic.length; i++) if (traffic[i] === '\n') assert.equal(masked[i], '\n', `newline at ${i}`);
  assert.ok(!masked.includes('synchronise'), 'block comment blanked');
  assert.ok(!masked.includes('100%'), 'line comment blanked');
});

test('traffic.tdf: SUBDESIGN ports with directions and defaults', () => {
  const doc = parseDocument(traffic);
  assert.equal(doc.subdesign.name, 'traffic');
  assert.deepEqual(doc.ports.map((p) => [p.display, p.dir, p.default]), [
    ['clk', 'INPUT', ''],
    ['reset', 'INPUT', ''],
    ['car_waiting', 'INPUT', 'GND'],
    ['red', 'OUTPUT', ''],
    ['yellow', 'OUTPUT', ''],
    ['green', 'OUTPUT', ''],
    ['debug[1..0]', 'OUTPUT', '']
  ]);
  assert.equal(doc.ports.find((p) => p.display === 'debug[1..0]').name, 'debug');
});

test('traffic.tdf: VARIABLE declarations and MACHINE states', () => {
  const doc = parseDocument(traffic);
  assert.deepEqual(doc.variables.map((v) => [v.display, v.type, v.states]), [
    ['ss', 'MACHINE', ['s_red', 's_green', 's_yellow']],
    ['tmr', 'timer8', []],
    ['sync[1..0]', 'DFFE', []],
    ['busy', 'NODE', []]
  ]);
});

test('traffic.tdf: CONSTANT, PARAMETERS and INCLUDE', () => {
  const doc = parseDocument(traffic);
  assert.deepEqual(doc.constants.map((c) => [c.name, c.value]), [['YELLOW_TICKS', '3']]);
  assert.deepEqual(doc.parameters.map((p) => [p.name, p.value]), [['GREEN_TICKS', '8']]);
  assert.deepEqual(doc.includes.map((i) => i.file), ['timer8.inc']);
  assert.deepEqual(doc.functions, []);
});

test('findDeclaration is case-insensitive and finds states', () => {
  const doc = parseDocument(traffic);
  assert.equal(findDeclaration(doc, 'CAR_WAITING').kind, 'port');
  assert.equal(findDeclaration(doc, 'Tmr').kind, 'variable');
  assert.deepEqual(findDeclaration(doc, 'S_GREEN'), {
    kind: 'state',
    symbol: { name: 's_green', machine: 'ss', offset: doc.variables[0].offset }
  });
});

test('timer8.inc: FUNCTION prototype with WITH and RETURNS', () => {
  const doc = parseDocument(timer8);
  assert.equal(doc.subdesign, null);
  assert.deepEqual(doc.functions.map((f) => ({ name: f.name, inputs: f.inputs, params: f.params, outputs: f.outputs })), [
    { name: 'timer8', inputs: ['clock', 'load', 'data'], params: ['WIDTH'], outputs: ['done', 'count'] }
  ]);
});

test('Quartus-style lpm_counter prototype with [LPM_WIDTH-1..0] ranges', () => {
  const [fn, ...rest] = parseDocument(lpmCounter).functions;
  assert.equal(rest.length, 0, 'commented-out prototype ignored');
  assert.equal(fn.name, 'lpm_counter');
  assert.deepEqual(fn.inputs, [
    'data', 'clock', 'clk_en', 'cnt_en', 'updown', 'cin', 'aclr', 'aset', 'aconst', 'aload', 'sclr', 'sset', 'sconst', 'sload'
  ]);
  assert.deepEqual(fn.params, [
    'LPM_WIDTH', 'LPM_DIRECTION', 'LPM_MODULUS', 'LPM_AVALUE', 'LPM_SVALUE', 'LPM_PORT_UPDOWN', 'DEVICE_FAMILY', 'CARRY_CNT_EN', 'LABWIDE_SCLR'
  ]);
  assert.deepEqual(fn.outputs, ['q', 'cout', 'eq']);
});

test('IF ... GENERATE wrappers inside VARIABLE are tolerated', () => {
  const doc = parseDocument(generate);
  assert.deepEqual(doc.variables.map((v) => [v.name, v.type]), [['r', 'DFF'], ['r', 'LCELL'], ['n', 'NODE']]);
  assert.deepEqual(doc.ports.map((p) => [p.name, p.dir]), [['clk', 'INPUT'], ['q', 'OUTPUT']]);
});

test('every offset points at the symbol name in the original text', () => {
  for (const text of [traffic, timer8, lpmCounter, generate]) assertOffsets(text, parseDocument(text));
});

'use strict';

/** Static knowledge about AHDL: keywords, primitives and their ports. */

const KEYWORDS = [
  'SUBDESIGN', 'VARIABLE', 'BEGIN', 'END', 'CONSTANT', 'DEFINE', 'FUNCTION', 'RETURNS',
  'PARAMETERS', 'OPTIONS', 'INCLUDE', 'TITLE', 'DESIGN', 'DEVICE',
  'IF', 'THEN', 'ELSE', 'ELSIF', 'CASE', 'IS', 'WHEN', 'OTHERS', 'TABLE', 'DEFAULTS',
  'FOR', 'IN', 'TO', 'GENERATE', 'WITH', 'NODE', 'TRI_STATE_NODE', 'MACHINE', 'OF', 'BITS', 'STATES',
  'ASSERT', 'REPORT', 'SEVERITY', 'ERROR', 'WARNING', 'INFO',
  'INPUT', 'OUTPUT', 'BIDIR', 'VCC', 'GND',
  'AND', 'OR', 'NOT', 'XOR', 'NAND', 'NOR', 'XNOR', 'DIV', 'MOD', 'LOG2', 'CEIL', 'FLOOR', 'USED'
];

const DIRECTIONS = ['INPUT', 'OUTPUT', 'BIDIR'];

/**
 * Built-in primitives. `inputs`/`outputs` are the port names usable as `inst.port`.
 */
const PRIMITIVES = {
  DFF:     { inputs: ['d', 'clk', 'clrn', 'prn'], outputs: ['q'], doc: 'D flip-flop.' },
  DFFE:    { inputs: ['d', 'clk', 'clrn', 'prn', 'ena'], outputs: ['q'], doc: 'D flip-flop with clock enable.' },
  DFFEA:   { inputs: ['d', 'clk', 'clrn', 'prn', 'ena', 'adata', 'aload'], outputs: ['q'], doc: 'D flip-flop with clock enable and asynchronous load.' },
  DFFEAS:  { inputs: ['d', 'clk', 'clrn', 'prn', 'ena', 'asdata', 'aload', 'sclr', 'sload'], outputs: ['q'], doc: 'D flip-flop with clock enable, asynchronous load, synchronous clear and load.' },
  JKFF:    { inputs: ['j', 'k', 'clk', 'clrn', 'prn'], outputs: ['q'], doc: 'JK flip-flop.' },
  JKFFE:   { inputs: ['j', 'k', 'clk', 'clrn', 'prn', 'ena'], outputs: ['q'], doc: 'JK flip-flop with clock enable.' },
  SRFF:    { inputs: ['s', 'r', 'clk', 'clrn', 'prn'], outputs: ['q'], doc: 'SR flip-flop.' },
  SRFFE:   { inputs: ['s', 'r', 'clk', 'clrn', 'prn', 'ena'], outputs: ['q'], doc: 'SR flip-flop with clock enable.' },
  TFF:     { inputs: ['t', 'clk', 'clrn', 'prn'], outputs: ['q'], doc: 'T flip-flop.' },
  TFFE:    { inputs: ['t', 'clk', 'clrn', 'prn', 'ena'], outputs: ['q'], doc: 'T flip-flop with clock enable.' },
  LATCH:   { inputs: ['d', 'ena'], outputs: ['q'], doc: 'Level-sensitive latch.' },
  LCELL:   { inputs: ['in'], outputs: ['out'], doc: 'Logic cell buffer (forces a logic element).' },
  MCELL:   { inputs: ['in'], outputs: ['out'], doc: 'Macrocell buffer.' },
  SOFT:    { inputs: ['in'], outputs: ['out'], doc: 'Soft buffer; the compiler may remove it.' },
  GLOBAL:  { inputs: ['in'], outputs: ['out'], doc: 'Routes a signal on a global line.' },
  CARRY:   { inputs: ['in'], outputs: ['out'], doc: 'Carry-chain buffer.' },
  CARRY_SUM: { inputs: ['sin', 'cin'], outputs: ['sout', 'cout'], doc: 'Carry chain with sum.' },
  CASCADE: { inputs: ['in'], outputs: ['out'], doc: 'Cascade-chain buffer.' },
  EXP:     { inputs: ['in'], outputs: ['out'], doc: 'Expander buffer.' },
  OPENDRN: { inputs: ['in'], outputs: ['out'], doc: 'Open-drain buffer.' },
  TRI:     { inputs: ['in', 'oe'], outputs: ['out'], doc: 'Tri-state buffer.' },
  WIRE:    { inputs: ['in'], outputs: ['out'], doc: 'Wire buffer.' }
};

/** Implicit ports every state machine has. */
const MACHINE_PORTS = { inputs: ['clk', 'reset', 'ena'], outputs: [] };

const PORT_DOCS = {
  d: 'Data input', q: 'Output', clk: 'Clock input', clrn: 'Active-low asynchronous clear',
  prn: 'Active-low asynchronous preset', ena: 'Clock / latch enable', j: 'J input', k: 'K input',
  s: 'Set input', r: 'Reset input', t: 'Toggle input', oe: 'Output enable', in: 'Input', out: 'Output',
  reset: 'Asynchronous reset (returns the machine to its first state)', adata: 'Asynchronous load data',
  aload: 'Asynchronous load', asdata: 'Asynchronous/synchronous load data', sclr: 'Synchronous clear',
  sload: 'Synchronous load', sin: 'Sum input', cin: 'Carry input', sout: 'Sum output', cout: 'Carry output'
};

const MEGAFUNCTIONS = [
  'lpm_abs', 'lpm_add_sub', 'lpm_and', 'lpm_bustri', 'lpm_clshift', 'lpm_compare', 'lpm_constant',
  'lpm_counter', 'lpm_decode', 'lpm_divide', 'lpm_ff', 'lpm_inv', 'lpm_latch', 'lpm_mult', 'lpm_mux',
  'lpm_or', 'lpm_ram_dq', 'lpm_rom', 'lpm_shiftreg', 'lpm_xor',
  'altsyncram', 'altdpram', 'altpll', 'altshift_taps', 'altmult_add', 'scfifo', 'dcfifo'
];

module.exports = { KEYWORDS, DIRECTIONS, PRIMITIVES, MACHINE_PORTS, PORT_DOCS, MEGAFUNCTIONS };

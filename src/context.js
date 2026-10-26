'use strict';

const { stateAt, maskCommentsAndStrings, IDENT } = require('./symbols');

/**
 * A port access ending at the cursor (anchor it with `$`): `inst.`, `inst[].q`, `inst[3..0].d`, or an
 * entry of a port group `inst.(clk, data[7..0], cl`. Group 1 is the instance, group 2 the partial port name.
 */
const PORT_ACCESS =
  `(${IDENT})\\s*(?:\\[[^\\]]*\\])?` + // inst, inst[], inst[3..0]
  `\\.(?:\\(\\s*(?:${IDENT}\\s*(?:\\[[^\\]]*\\])?\\s*,\\s*)*)?` + // "." or ".(" followed by the ports already listed
  `(${IDENT})?`;

function lastIndex(re, text) {
  let idx = -1;
  let m;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = g.exec(text))) idx = m.index;
  return idx;
}

/**
 * Decide what kind of completion fits at `offset`.
 * @param {string} text full document text
 * @param {number} offset cursor offset
 * @param {object} doc result of parseDocument(text)
 * @returns {{kind: string, [k: string]: any}}
 *   kinds: none | include | port | states | direction | type | general
 */
function getCompletionContext(text, offset, doc) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineBefore = text.slice(lineStart, offset);
  const state = stateAt(text, offset);

  if (state === 'string') {
    const inc = /\bINCLUDE\s+"([^"]*)$/i.exec(lineBefore);
    return inc ? { kind: 'include', prefix: inc[1] } : { kind: 'none' };
  }
  if (state !== 'code') return { kind: 'none' };

  // inst.port / inst[].port / inst[3..0].port, and port groups: ff[].(clk, clrn) = (clock, reset);
  const port = new RegExp(`${PORT_ACCESS}$`).exec(lineBefore);
  if (port && lineBefore[port.index - 1] !== '.') {
    return { kind: 'port', instance: port[1], prefix: port[2] || '' };
  }
  // A lone '.' that is part of a range ("[7..") or anything else: nothing useful to offer.
  if (/\.$/.test(lineBefore)) return { kind: 'none' };

  const before = maskCommentsAndStrings(text.slice(0, offset));
  const machines = new Set(
    doc.variables.filter((v) => v.type.toUpperCase() === 'MACHINE').map((v) => v.name.toLowerCase())
  );

  // ss = idle / ss == run / ss != done
  const cmp = new RegExp(`(${IDENT})\\s*(?:==|!=|=)\\s*(${IDENT})?$`).exec(lineBefore);
  if (cmp && machines.has(cmp[1].toLowerCase())) {
    return { kind: 'states', machine: cmp[1], prefix: cmp[2] || '' };
  }

  // WHEN idle =>   inside "CASE ss IS"
  const when = new RegExp(`^\\s*WHEN\\s+(${IDENT})?$`, 'i').exec(lineBefore);
  if (when) {
    const caseRe = new RegExp(`\\bCASE\\s+(${IDENT})\\s*(?:\\[[^\\]]*\\])?\\s+IS\\b`, 'gi');
    const endCaseRe = /\bEND\s+CASE\b/gi;
    let open = null;
    let m;
    const stack = [];
    const events = [];
    while ((m = caseRe.exec(before))) events.push({ at: m.index, sel: m[1] });
    while ((m = endCaseRe.exec(before))) events.push({ at: m.index, end: true });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) { if (e.end) stack.pop(); else stack.push(e.sel); }
    open = stack[stack.length - 1];
    if (open && machines.has(open.toLowerCase())) {
      return { kind: 'states', machine: open, prefix: when[1] || '' };
    }
  }

  // Which section are we in?
  const typeSlot = /:\s*([A-Za-z_][A-Za-z0-9_]*)?$/.test(lineBefore);
  if (typeSlot) {
    const { portListOpen, portListClose } = doc.sections;
    if (portListOpen >= 0 && offset > portListOpen && (portListClose < 0 || offset <= portListClose)) {
      return { kind: 'direction' };
    }
    const lastVar = lastIndex(/\bVARIABLE\b/i, before);
    const lastBegin = lastIndex(/\bBEGIN\b/i, before);
    if (lastVar >= 0 && lastVar > lastBegin) return { kind: 'type' };
  }

  return { kind: 'general' };
}

module.exports = { getCompletionContext, PORT_ACCESS };

'use strict';

/**
 * Lightweight, error-tolerant AHDL symbol extractor.
 * Pure JS (no `vscode` dependency) so it can be unit-tested with plain Node.
 * All offsets refer to the original text: comments and strings are blanked, never removed.
 */

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

/**
 * Scan up to `end` (default: end of text). Returns the state there and two masked copies:
 * `uncommented` (comments blanked) and `code` (string contents blanked too, quotes kept).
 */
function scan(text, end = text.length) {
  let state = 'code';
  let uncommented = '';
  let code = '';
  const emit = (c, inCode = c) => { uncommented += c; code += inCode; };
  for (let i = 0; i < end; i++) {
    const c = text[i];
    switch (state) {
      case 'code':
        if (c === '-' && text[i + 1] === '-') { state = 'line'; emit(' '); }
        else if (c === '%') { state = 'block'; emit(' '); }
        else { if (c === '"') state = 'string'; emit(c); }
        break;
      case 'string':
        // A newline ends an unterminated string: recover at end of line.
        if (c === '"' || c === '\n') { state = 'code'; emit(c); } else emit(c, ' ');
        break;
      case 'line':
        if (c === '\n') { state = 'code'; emit(c); } else emit(' ');
        break;
      case 'block':
        if (c === '%') state = 'code';
        emit(c === '\n' ? '\n' : ' ');
        break;
    }
  }
  return { uncommented, code, state };
}

/** Text with comments replaced by spaces (same length, newlines kept). */
function maskComments(text) {
  return scan(text).uncommented;
}

/** Like maskComments, but string contents are blanked too. Radix literals (H"FF") count as strings. */
function maskCommentsAndStrings(text) {
  return scan(text).code;
}

/** 'code' | 'string' | 'line' | 'block' at the given offset. */
function stateAt(text, offset) {
  return scan(text, offset).state;
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split `text` on `sep` at bracket depth 0. Returns [{ text, start }] with absolute starts. */
function splitTop(text, sep, base = 0) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === sep && depth === 0) {
      parts.push({ text: text.slice(start, i), start: base + start });
      start = i + 1;
    }
  }
  parts.push({ text: text.slice(start), start: base + start });
  return parts;
}

/** Parse "a, b[7..0], c" → [{ name, display, offset }]. */
function parseNameList(text, base) {
  const result = [];
  for (const part of splitTop(text, ',', base)) {
    const m = new RegExp(`^(\\s*)(${IDENT})(\\s*\\[[^\\]]*\\])?\\s*$`).exec(part.text);
    if (!m) continue;
    result.push({
      name: m[2],
      display: m[2] + (m[3] ? m[3].trim() : ''),
      offset: part.start + m[1].length
    });
  }
  return result;
}

/** Port names from a prototype list like "data[W-1..0], clock, , aclr" (base names only). */
function parsePortList(text) {
  const names = [];
  for (const part of splitTop(text, ',')) {
    const m = new RegExp(`^\\s*(${IDENT})`).exec(part.text);
    if (m) names.push(m[1]);
  }
  return names;
}

function parseDocument(text) {
  // Match structure on `src`, where strings are blanked. Read values from `uncommented`,
  // so literals keep their contents (H"FF", "UP"). Both have the same offsets as `text`.
  const { uncommented, code: src } = scan(text);
  /** Trimmed text of group `g` of a match made with the `d` flag, `base` being where the match input starts. */
  const value = (match, g, base = 0) => {
    const span = match.indices[g];
    return span ? uncommented.slice(base + span[0], base + span[1]).trim() : '';
  };
  const doc = {
    subdesign: null,
    ports: [],
    variables: [],
    constants: [],
    defines: [],
    parameters: [],
    functions: [],
    includes: [],
    sections: { portListOpen: -1, portListClose: -1, variable: [], begin: [] }
  };
  let m;

  // INCLUDE "file.inc";
  const incRe = /\bINCLUDE\s+"([^"]*)"/gid;
  while ((m = incRe.exec(src))) {
    doc.includes.push({ file: uncommented.slice(...m.indices[1]), offset: m.indices[1][0] });
  }

  // CONSTANT NAME = value;
  const constRe = new RegExp(`\\bCONSTANT\\s+(${IDENT})\\s*=\\s*([^;]*);?`, 'gid');
  while ((m = constRe.exec(src))) {
    doc.constants.push({ name: m[1], value: value(m, 2), offset: m.index + m[0].indexOf(m[1], 8) });
  }

  // DEFINE name(args) = expr;
  const defRe = new RegExp(`\\bDEFINE\\s+(${IDENT})\\s*(\\([^)]*\\))?\\s*=\\s*([^;]*);?`, 'gid');
  while ((m = defRe.exec(src))) {
    doc.defines.push({ name: m[1], args: (m[2] || '').trim(), value: value(m, 3), offset: m.index + m[0].indexOf(m[1], 6) });
  }

  // PARAMETERS ( A = 1, B );
  const paramRe = /\bPARAMETERS\s*\(/gi;
  while ((m = paramRe.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(src, open);
    const body = src.slice(open + 1, close < 0 ? src.length : close);
    for (const part of splitTop(body, ',', open + 1)) {
      const pm = new RegExp(`^(\\s*)(${IDENT})\\s*(?:=\\s*(.*))?$`, 'sd').exec(part.text);
      if (pm) doc.parameters.push({ name: pm[2], value: value(pm, 3, part.start), offset: part.start + pm[1].length });
    }
  }

  // FUNCTION name (inputs) [WITH (params)] RETURNS (outputs);
  const funcRe = new RegExp(`\\bFUNCTION\\s+(${IDENT})\\s*\\(`, 'gi');
  while ((m = funcRe.exec(src))) {
    const fn = { name: m[1], inputs: [], outputs: [], params: [], offset: m.index + m[0].indexOf(m[1], 8) };
    const inOpen = m.index + m[0].length - 1;
    const inClose = matchParen(src, inOpen);
    if (inClose < 0) { doc.functions.push(fn); continue; }
    fn.inputs = parsePortList(src.slice(inOpen + 1, inClose));
    let rest = inClose + 1;
    const withM = /^\s*WITH\s*\(/i.exec(src.slice(rest));
    if (withM) {
      const wOpen = rest + withM[0].length - 1;
      const wClose = matchParen(src, wOpen);
      if (wClose > 0) { fn.params = parsePortList(src.slice(wOpen + 1, wClose)); rest = wClose + 1; }
    }
    const retM = /^\s*RETURNS\s*\(/i.exec(src.slice(rest));
    if (retM) {
      const rOpen = rest + retM[0].length - 1;
      const rClose = matchParen(src, rOpen);
      if (rClose > 0) fn.outputs = parsePortList(src.slice(rOpen + 1, rClose));
    }
    doc.functions.push(fn);
  }

  // SUBDESIGN name ( port : DIR [= default]; ... )
  const subRe = new RegExp(`\\bSUBDESIGN\\s+(${IDENT})\\s*\\(`, 'i');
  m = subRe.exec(src);
  if (m) {
    doc.subdesign = { name: m[1], offset: m.index + m[0].indexOf(m[1], 9) };
    const open = m.index + m[0].length - 1;
    const close = matchParen(src, open);
    doc.sections.portListOpen = open;
    doc.sections.portListClose = close;
    const body = src.slice(open + 1, close < 0 ? src.length : close);
    for (const decl of splitTop(body, ';', open + 1)) {
      const colon = decl.text.indexOf(':');
      if (colon < 0) continue;
      const dm = /^\s*(INPUT|OUTPUT|BIDIR)\b\s*(?:=\s*(.*))?$/isd.exec(decl.text.slice(colon + 1));
      const dir = dm ? dm[1].toUpperCase() : '';
      const dflt = dm ? value(dm, 2, decl.start + colon + 1) : '';
      for (const n of parseNameList(decl.text.slice(0, colon), decl.start)) {
        doc.ports.push({ ...n, dir, default: dflt });
      }
    }
  }

  // VARIABLE ... BEGIN
  const varRe = /\bVARIABLE\b/gi;
  while ((m = varRe.exec(src))) {
    const start = m.index + m[0].length;
    doc.sections.variable.push(m.index);
    const beginRe = /\bBEGIN\b/gi;
    beginRe.lastIndex = start;
    const bm = beginRe.exec(src);
    const end = bm ? bm.index : src.length;
    for (const decl of splitTop(src.slice(start, end), ';', start)) {
      const colon = decl.text.indexOf(':');
      if (colon < 0) continue;
      // Tolerate "IF ... GENERATE" / "ELSE GENERATE" wrappers around declarations.
      let left = decl.text.slice(0, colon);
      let leftBase = decl.start;
      const wrap = /^[\s\S]*\b(GENERATE|ELSE|THEN)\b/i.exec(left);
      if (wrap) { leftBase += wrap[0].length; left = left.slice(wrap[0].length); }
      const right = decl.text.slice(colon + 1);
      const tm = new RegExp(`^\\s*(${IDENT})`).exec(right);
      if (!tm) continue;
      const type = tm[1];
      let states = [];
      if (type.toUpperCase() === 'MACHINE') {
        const sm = /\bSTATES\s*\(/i.exec(right);
        if (sm) {
          const sOpen = sm.index + sm[0].length - 1;
          const sClose = matchParen(right, sOpen);
          states = parsePortList(right.slice(sOpen + 1, sClose < 0 ? right.length : sClose));
        }
      }
      for (const n of parseNameList(left, leftBase)) {
        doc.variables.push({ ...n, type, states });
      }
    }
  }

  const beginRe = /\bBEGIN\b/gi;
  while ((m = beginRe.exec(src))) doc.sections.begin.push(m.index);

  return doc;
}

/** Case-insensitive lookup of a declared symbol in a parsed document. */
function findDeclaration(doc, name) {
  const key = name.toLowerCase();
  const eq = (s) => s.name.toLowerCase() === key;
  let s;
  if ((s = doc.ports.find(eq))) return { kind: 'port', symbol: s };
  if ((s = doc.variables.find(eq))) return { kind: 'variable', symbol: s };
  if ((s = doc.constants.find(eq))) return { kind: 'constant', symbol: s };
  if ((s = doc.defines.find(eq))) return { kind: 'define', symbol: s };
  if ((s = doc.parameters.find(eq))) return { kind: 'parameter', symbol: s };
  if ((s = doc.functions.find(eq))) return { kind: 'function', symbol: s };
  for (const v of doc.variables) {
    const st = v.states.find((x) => x.toLowerCase() === key);
    if (st) return { kind: 'state', symbol: { name: st, machine: v.name, offset: v.offset } };
  }
  if (doc.subdesign && doc.subdesign.name.toLowerCase() === key) return { kind: 'subdesign', symbol: doc.subdesign };
  return null;
}

module.exports = { maskComments, maskCommentsAndStrings, stateAt, matchParen, splitTop, parseDocument, findDeclaration, IDENT };

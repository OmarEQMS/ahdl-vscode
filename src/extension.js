'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { parseDocument, findDeclaration, IDENT } = require('./symbols');
const { getCompletionContext } = require('./context');
const { KEYWORDS, DIRECTIONS, PRIMITIVES, MACHINE_PORTS, PORT_DOCS, MEGAFUNCTIONS } = require('./language');

const K = vscode.CompletionItemKind;

// ---------------------------------------------------------------------------
// Parsing caches
// ---------------------------------------------------------------------------

/** uri → { version, doc } */
const docCache = new Map();

function parsed(document) {
  const key = document.uri.toString();
  const hit = docCache.get(key);
  if (hit && hit.version === document.version) return hit.doc;
  const doc = parseDocument(document.getText());
  docCache.set(key, { version: document.version, doc });
  return doc;
}

/** file path → { mtimeMs, text, doc } */
const fileCache = new Map();

function parseFile(file) {
  // Prefer an open (possibly unsaved) editor buffer.
  const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
  if (open) return { text: open.getText(), doc: parsed(open) };
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const hit = fileCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit;
  const text = fs.readFileSync(file, 'utf8');
  const entry = { mtimeMs: stat.mtimeMs, text, doc: parseDocument(text) };
  fileCache.set(file, entry);
  return entry;
}

function searchDirs(document) {
  const dirs = [];
  if (document.uri.scheme === 'file') dirs.push(path.dirname(document.uri.fsPath));
  for (const f of vscode.workspace.workspaceFolders || []) dirs.push(f.uri.fsPath);
  const cfg = vscode.workspace.getConfiguration('ahdl', document.uri).get('includePaths') || [];
  for (const p of cfg) {
    const expanded = p.replace(/\$\{workspaceFolder\}/g, (vscode.workspace.workspaceFolders || [])[0]?.uri.fsPath || '');
    dirs.push(path.isAbsolute(expanded) ? expanded : path.resolve(dirs[0] || '.', expanded));
  }
  return [...new Set(dirs)];
}

function resolveInclude(document, name) {
  for (const dir of searchDirs(document)) {
    for (const candidate of [name, name.toLowerCase()]) {
      const full = path.join(dir, candidate);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

/** All FUNCTION prototypes visible from a document: local ones plus INCLUDEd .inc files. */
function visibleFunctions(document) {
  const doc = parsed(document);
  const result = doc.functions.map((fn) => ({ fn, file: document.uri.fsPath, text: null, local: true }));
  for (const inc of doc.includes) {
    const file = resolveInclude(document, inc.file);
    if (!file) continue;
    const entry = parseFile(file);
    if (!entry) continue;
    for (const fn of entry.doc.functions) result.push({ fn, file, text: entry.text, local: false });
  }
  return result;
}

function findFunction(document, name) {
  const key = name.toLowerCase();
  return visibleFunctions(document).find((f) => f.fn.name.toLowerCase() === key) || null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kw(document, word) {
  const c = vscode.workspace.getConfiguration('ahdl', document.uri).get('keywordCase');
  return c === 'lower' ? word.toLowerCase() : word.toUpperCase();
}

function item(label, kind, detail, doc, sortPrefix = '5') {
  const it = new vscode.CompletionItem(label, kind);
  if (detail) it.detail = detail;
  if (doc) it.documentation = new vscode.MarkdownString(doc);
  it.sortText = sortPrefix + label.toLowerCase();
  return it;
}

function primitiveDoc(name) {
  const p = PRIMITIVES[name.toUpperCase()];
  if (!p) return '';
  return `**${name.toUpperCase()}** — ${p.doc}\n\n` +
    `Inputs: ${p.inputs.map((x) => '`.' + x + '`').join(', ')}  \n` +
    `Outputs: ${p.outputs.map((x) => '`.' + x + '`').join(', ')}`;
}

function functionSignature(fn) {
  const withPart = fn.params.length ? ` WITH (${fn.params.join(', ')})` : '';
  return `FUNCTION ${fn.name} (${fn.inputs.join(', ')})${withPart} RETURNS (${fn.outputs.join(', ')});`;
}

/** Ports available on `instance` (a VARIABLE-declared name). */
function portsOf(document, instance) {
  const doc = parsed(document);
  const decl = doc.variables.find((v) => v.name.toLowerCase() === instance.toLowerCase());
  if (!decl) return null;
  const type = decl.type.toUpperCase();
  if (type === 'MACHINE') return { type: 'MACHINE', ...MACHINE_PORTS };
  if (PRIMITIVES[type]) return { type, inputs: PRIMITIVES[type].inputs, outputs: PRIMITIVES[type].outputs };
  const f = findFunction(document, decl.type);
  if (f) return { type: f.fn.name, inputs: f.fn.inputs, outputs: f.fn.outputs };
  return { type: decl.type, inputs: [], outputs: [], unresolved: true };
}

function offsetToPosition(text, offset) {
  let line = 0;
  let last = 0;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) { line++; last = i + 1; }
  return new vscode.Position(line, offset - last);
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

function provideCompletionItems(document, position) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const doc = parsed(document);
  const ctx = getCompletionContext(text, offset, doc);
  const items = [];

  switch (ctx.kind) {
    case 'none':
      return [];

    case 'include': {
      const seen = new Set();
      for (const dir of searchDirs(document)) {
        let entries = [];
        try { entries = fs.readdirSync(dir); } catch { continue; }
        for (const f of entries) {
          if (!/\.inc$/i.test(f) || seen.has(f.toLowerCase())) continue;
          seen.add(f.toLowerCase());
          items.push(item(f, K.File, dir));
        }
      }
      return items;
    }

    case 'port': {
      const ports = portsOf(document, ctx.instance);
      if (!ports) return [];
      for (const p of ports.inputs) {
        items.push(item(p, K.Field, `input of ${ports.type}`, PORT_DOCS[p.toLowerCase()], '1'));
      }
      for (const p of ports.outputs) {
        items.push(item(p, K.Field, `output of ${ports.type}`, PORT_DOCS[p.toLowerCase()], '2'));
      }
      return items;
    }

    case 'states': {
      const m = doc.variables.find((v) => v.name.toLowerCase() === ctx.machine.toLowerCase());
      for (const s of (m && m.states) || []) items.push(item(s, K.EnumMember, `state of ${m.name}`, null, '1'));
      return items;
    }

    case 'direction':
      return DIRECTIONS.map((d) => item(kw(document, d), K.Keyword, 'port direction', null, '1'));

    case 'type': {
      for (const t of ['NODE', 'TRI_STATE_NODE', 'MACHINE']) items.push(item(kw(document, t), K.Keyword, 'variable type', null, '1'));
      for (const p of Object.keys(PRIMITIVES)) items.push(item(kw(document, p), K.Class, 'primitive', primitiveDoc(p), '2'));
      for (const { fn, local } of visibleFunctions(document)) {
        items.push(item(fn.name, K.Module, local ? 'function prototype' : 'from INCLUDE', '```ahdl\n' + functionSignature(fn) + '\n```', '0'));
      }
      for (const mf of MEGAFUNCTIONS) {
        if (findFunction(document, mf)) continue;
        const it = item(mf, K.Function, 'megafunction (needs INCLUDE)', `Add \`INCLUDE "${mf}.inc";\` to get its ports.`, '3');
        items.push(it);
      }
      return items;
    }

    default: {
      for (const p of doc.ports) items.push(item(p.name, K.Variable, `${p.dir || 'port'} ${p.display}`, null, '0'));
      for (const v of doc.variables) {
        items.push(item(v.name, v.type.toUpperCase() === 'MACHINE' ? K.Enum : K.Variable, `${v.display} : ${v.type}`, null, '0'));
        for (const s of v.states) items.push(item(s, K.EnumMember, `state of ${v.name}`, null, '1'));
      }
      for (const c of doc.constants) items.push(item(c.name, K.Constant, `CONSTANT = ${c.value}`, null, '1'));
      for (const d of doc.defines) items.push(item(d.name, K.Function, `DEFINE ${d.name}${d.args}`, null, '1'));
      for (const p of doc.parameters) items.push(item(p.name, K.TypeParameter, 'parameter' + (p.value ? ` = ${p.value}` : ''), null, '1'));
      for (const { fn } of visibleFunctions(document)) {
        items.push(item(fn.name, K.Module, 'function', '```ahdl\n' + functionSignature(fn) + '\n```', '2'));
      }
      for (const p of Object.keys(PRIMITIVES)) items.push(item(kw(document, p), K.Class, 'primitive', primitiveDoc(p), '3'));
      for (const k of KEYWORDS) items.push(item(kw(document, k), K.Keyword, null, null, '4'));
      return items;
    }
  }
}

// ---------------------------------------------------------------------------
// Hover, definition, outline
// ---------------------------------------------------------------------------

function wordAt(document, position) {
  const range = document.getWordRangeAtPosition(position, new RegExp(IDENT));
  return range ? { word: document.getText(range), range } : null;
}

function provideHover(document, position) {
  const w = wordAt(document, position);
  if (!w) return null;
  const doc = parsed(document);

  // Port after '.' → describe it using the instance type.
  const line = document.lineAt(position.line).text.slice(0, w.range.start.character);
  const inst = new RegExp(`(${IDENT})\\s*(?:\\[[^\\]]*\\])?\\.$`).exec(line);
  if (inst) {
    const ports = portsOf(document, inst[1]);
    if (ports) {
      const dir = ports.inputs.some((p) => p.toLowerCase() === w.word.toLowerCase()) ? 'input'
        : ports.outputs.some((p) => p.toLowerCase() === w.word.toLowerCase()) ? 'output' : null;
      if (dir) {
        const note = PORT_DOCS[w.word.toLowerCase()];
        return new vscode.Hover(new vscode.MarkdownString(`\`${inst[1]}.${w.word}\` — ${dir} of **${ports.type}**${note ? '  \n' + note : ''}`), w.range);
      }
    }
  }

  const decl = findDeclaration(doc, w.word);
  if (decl) {
    const s = decl.symbol;
    let md;
    switch (decl.kind) {
      case 'port': md = `\`${s.display} : ${s.dir}${s.default ? ' = ' + s.default : ''}\` — port`; break;
      case 'variable': {
        md = `\`${s.display} : ${s.type}\``;
        if (s.states.length) md += `  \nStates: ${s.states.map((x) => '`' + x + '`').join(', ')}`;
        const pd = primitiveDoc(s.type);
        if (pd) md += '\n\n' + pd;
        else {
          const f = findFunction(document, s.type);
          if (f) md += '\n\n```ahdl\n' + functionSignature(f.fn) + '\n```';
        }
        break;
      }
      case 'constant': md = `\`CONSTANT ${s.name} = ${s.value}\``; break;
      case 'define': md = `\`DEFINE ${s.name}${s.args} = ${s.value}\``; break;
      case 'parameter': md = `\`${s.name}\` — parameter${s.value ? ' (default ' + s.value + ')' : ''}`; break;
      case 'function': md = '```ahdl\n' + functionSignature(s) + '\n```'; break;
      case 'state': md = `\`${s.name}\` — state of machine \`${s.machine}\``; break;
      case 'subdesign': md = `\`SUBDESIGN ${s.name}\``; break;
    }
    return new vscode.Hover(new vscode.MarkdownString(md), w.range);
  }

  const pd = primitiveDoc(w.word);
  if (pd) return new vscode.Hover(new vscode.MarkdownString(pd), w.range);

  const f = findFunction(document, w.word);
  if (f) {
    return new vscode.Hover(new vscode.MarkdownString('```ahdl\n' + functionSignature(f.fn) + '\n```\n\n' + path.basename(f.file)), w.range);
  }
  return null;
}

function provideDefinition(document, position) {
  const w = wordAt(document, position);
  if (!w) return null;
  const decl = findDeclaration(parsed(document), w.word);
  if (decl && decl.kind !== 'function') {
    return new vscode.Location(document.uri, document.positionAt(decl.symbol.offset));
  }
  const f = findFunction(document, w.word);
  if (f) {
    if (f.local) return new vscode.Location(document.uri, document.positionAt(f.fn.offset));
    return new vscode.Location(vscode.Uri.file(f.file), offsetToPosition(f.text, f.fn.offset));
  }
  // INCLUDE "file.inc" → open the file
  const line = document.lineAt(position.line).text;
  const inc = /\bINCLUDE\s+"([^"]+)"/i.exec(line);
  if (inc) {
    const file = resolveInclude(document, inc[1]);
    if (file) return new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0));
  }
  return null;
}

function provideDocumentSymbols(document) {
  const doc = parsed(document);
  const S = vscode.SymbolKind;
  const sym = (name, detail, kind, offset, len) => {
    const start = document.positionAt(offset);
    const end = document.positionAt(offset + len);
    return new vscode.DocumentSymbol(name, detail, kind, new vscode.Range(start, end), new vscode.Range(start, end));
  };
  const children = [];
  for (const p of doc.parameters) children.push(sym(p.name, 'parameter', S.TypeParameter, p.offset, p.name.length));
  for (const c of doc.constants) children.push(sym(c.name, `= ${c.value}`, S.Constant, c.offset, c.name.length));
  for (const p of doc.ports) children.push(sym(p.display, p.dir, S.Field, p.offset, p.name.length));
  for (const v of doc.variables) {
    const s = sym(v.display, v.type, v.type.toUpperCase() === 'MACHINE' ? S.Enum : S.Variable, v.offset, v.name.length);
    s.children = v.states.map((st) => sym(st, 'state', S.EnumMember, v.offset, v.name.length));
    children.push(s);
  }
  const top = doc.functions.map((f) => sym(f.name, 'prototype', S.Function, f.offset, f.name.length));
  if (doc.subdesign) {
    // PARAMETERS and CONSTANT come before SUBDESIGN; start the range at the first of them so it
    // contains every child (breadcrumbs and Follow Cursor walk down through containing ranges).
    const first = Math.min(doc.subdesign.offset, ...doc.parameters.map((p) => p.offset), ...doc.constants.map((c) => c.offset));
    const full = new vscode.Range(document.positionAt(first), document.positionAt(document.getText().length));
    const start = document.positionAt(doc.subdesign.offset);
    const sel = new vscode.Range(start, document.positionAt(doc.subdesign.offset + doc.subdesign.name.length));
    const root = new vscode.DocumentSymbol(doc.subdesign.name, 'SUBDESIGN', S.Module, full, sel);
    root.children = children;
    return [...top, root];
  }
  return [...top, ...children];
}

// ---------------------------------------------------------------------------

function activate(context) {
  const selector = { language: 'ahdl' };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, { provideCompletionItems }, '.', '"'),
    vscode.languages.registerHoverProvider(selector, { provideHover }),
    vscode.languages.registerDefinitionProvider(selector, { provideDefinition }),
    vscode.languages.registerDocumentSymbolProvider(selector, { provideDocumentSymbols }),
    vscode.workspace.onDidCloseTextDocument((d) => docCache.delete(d.uri.toString()))
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  _test: { provideCompletionItems, provideHover, provideDefinition, provideDocumentSymbols }
};

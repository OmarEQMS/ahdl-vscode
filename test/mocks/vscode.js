'use strict';

/**
 * Minimal stand-in for the `vscode` module: only what src/extension.js touches.
 * Enum members resolve to their own names (CompletionItemKind.Field === 'Field').
 */

const names = () => new Proxy({}, { get: (_, key) => key });

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}

class Range {
  constructor(start, end) { this.start = start; this.end = end; }
}

class Uri {
  constructor(fsPath) { this.scheme = 'file'; this.fsPath = fsPath; }
  static file(fsPath) { return new Uri(fsPath); }
  toString() { return 'file:///' + this.fsPath.replace(/\\/g, '/'); }
}

class MarkdownString {
  constructor(value = '') { this.value = value; }
}

class CompletionItem {
  constructor(label, kind) { this.label = label; this.kind = kind; }
}

class Hover {
  constructor(contents, range) { this.contents = contents; this.range = range; }
}

class Location {
  constructor(uri, rangeOrPosition) {
    this.uri = uri;
    this.range = rangeOrPosition instanceof Range ? rangeOrPosition : new Range(rangeOrPosition, rangeOrPosition);
  }
}

class DocumentSymbol {
  constructor(name, detail, kind, range, selectionRange) {
    Object.assign(this, { name, detail, kind, range, selectionRange, children: [] });
  }
}

const workspace = {
  textDocuments: [],
  workspaceFolders: undefined,
  getConfiguration: () => ({ get: () => undefined })
};

module.exports = {
  Position,
  Range,
  Uri,
  MarkdownString,
  CompletionItem,
  Hover,
  Location,
  DocumentSymbol,
  CompletionItemKind: names(),
  SymbolKind: names(),
  workspace
};

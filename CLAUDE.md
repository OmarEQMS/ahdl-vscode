# AHDL for VS Code

VS Code extension for Intel/Altera AHDL (`.tdf`, `.inc`). Plain JavaScript, no build step. Features and settings are in README.md.

## Layout

- `src/extension.js`: entry point. Registers the completion, hover, definition and outline providers, resolves `INCLUDE` files and caches parses. The only file that imports `vscode`; providers are exported as `_test` for the tests.
- `src/symbols.js`: comment-aware, error-tolerant symbol extractor (`parseDocument`, `findDeclaration`, `maskComments`, `stateAt`).
- `src/context.js`: `getCompletionContext` decides what kind of completion fits at the cursor (`port`, `states`, `direction`, `type`, `include`, `general`, `none`).
- `src/language.js`: static data: keywords, port directions, primitives and their ports, megafunction names.
- `syntaxes/ahdl.tmLanguage.json`: TextMate grammar, scope `source.ahdl`.
- `snippets/ahdl.json`: snippets (`subdesign`, `fsm`, `case`, `table`, ...).
- `language-configuration.json`: comment toggling, brackets, indentation rules.
- `samples/`: `traffic.tdf` and `timer8.inc`. Used by the tests and opened by F5.
- `test/`: `node:test` suites. `__snapshots__/` holds the grammar token snapshots; `mocks/vscode.js` stands in for the `vscode` module.
- `scripts/`: helpers behind `test:update` and `install-local`.

## Commands

- `npm test`: run all tests.
- `npm run test:update`: rewrite the grammar snapshots.
- `npm run package`: build `ahdl-<version>.vsix`.
- `npm run install-local`: package, then install the .vsix into VS Code.
- F5 in VS Code: Extension Development Host with `samples/` open.

## Rules

- Run `npm test` after every change. Only run `test:update` when a grammar change is intentional, and review the snapshot diff.
- Keep `src/symbols.js` and `src/context.js` free of the `vscode` import so they stay unit-testable.
- Comment masking must preserve offsets: blank out comments, never remove them.

## AHDL gotchas

- Identifiers and keywords are case-insensitive.
- Comments are `--` to end of line or `% ... %`, which can span lines. A `%` inside a `--` comment does not open a block.
- `..` is a range (`q[7..0]`), not a port access (`.q`).
- One SUBDESIGN per `.tdf`.
- State machines have implicit `.clk`, `.reset` and `.ena` ports.

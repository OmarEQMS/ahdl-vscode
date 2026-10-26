# AHDL for VS Code

Language support for **AHDL** (Altera Hardware Description Language), the Text Design File (`.tdf`) language used by Intel/Altera Quartus.

## Features

- **Syntax highlighting.** Covers keywords, port directions, primitives (`DFF`, `DFFE`, `JKFF`, `LCELL`, `TRI`, and others), LPM/ALT megafunctions, and radix literals (`B"01X0"`, `H"FF"`, `O"17"`). It also highlights `inst.port` accessors, `inst.(a, b)` port groups, word operators (`AND`, `OR`, `NOT`, ...) and both comment styles (`-- line` and `% block %`).
- **Editor behavior.** Comment toggling, bracket matching, and auto-indent after `BEGIN`, `IF … THEN`, `CASE … IS`, `WHEN … =>`, `TABLE`, `DEFAULTS`, and `FOR … GENERATE`.
- **Snippets.** `subdesign`, `if`, `ifelse`, `case`, `table`, `defaults`, `fsm`, `fsmlogic`, `reg`, `forgen`, `include`, `function`, `parameters`, and `constant`.
- **Context-aware completions:**
  - `inst.`, and each entry of a port group `inst.(clk, `, lists the ports of `inst`'s type: primitive ports, state-machine ports (`clk`, `reset`, `ena`), or ports read from the `FUNCTION` prototype of an `INCLUDE`d `.inc` file.
  - `ss = ` / `ss == ` and `WHEN ` inside `CASE ss IS` list the states of machine `ss`.
  - `name :` inside the `SUBDESIGN ( … )` port list offers `INPUT`, `OUTPUT`, and `BIDIR`.
  - `name :` inside `VARIABLE` offers `NODE`, `MACHINE`, primitives, and included functions.
  - `INCLUDE "` lists the `.inc` files found on the search path.
  - Everywhere else you get declared ports, variables, states, constants, parameters, functions, primitives, and keywords.
  - Nothing is suggested inside comments or strings.
- **Hover** shows port direction, variable types, primitive port lists, and function prototypes.
- **Go to Definition (F12)** jumps to ports, variables, states, constants, and prototypes in `.inc` files. It also opens files named in `INCLUDE` lines.
- **Outline / breadcrumbs** list the `SUBDESIGN` with its parameters, constants, ports, and variables, including state-machine states.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `ahdl.includePaths` | `[]` | Extra folders searched for `INCLUDE` files. Add Quartus' `libraries/megafunctions` folder to get real ports for `lpm_counter`, `altsyncram`, etc. `${workspaceFolder}` is supported. |
| `ahdl.keywordCase` | `upper` | Case used when completions insert keywords and primitives. |

`INCLUDE` paths resolve the way Quartus resolves them: from the folder of the nearest `.qpf` above the file first, then the file's own folder, the workspace folders and `ahdl.includePaths`. Relative `ahdl.includePaths` entries are resolved from that project folder, or from the file's folder when there is no `.qpf`.

`.inc` is shared by many languages, so the extension only claims `.tdf` and `.ahdl` automatically. To treat `.inc` files as AHDL in a project, add this to `.vscode/settings.json`:

```json
{
  "files.associations": { "*.inc": "ahdl" },
  "ahdl.includePaths": ["C:/intelFPGA_lite/20.1/quartus/libraries/megafunctions"]
}
```

Word operators (`AND`, `OR`, `NOT`, ...) take the keyword color in the default VS Code themes. Symbolic operators (`&`, `#`, `!`, `$`, `==`) take the theme's operator color, which Dark Modern and Light Modern leave plain. To color them in AHDL files only:

```json
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      { "scope": "source.ahdl keyword.operator", "settings": { "foreground": "#569CD6" } }
    ]
  }
}
```

## Install

```
code --install-extension ahdl-0.1.0.vsix
```

Or open the Extensions view, choose **…** › **Install from VSIX…**, and pick the file.

## Developing

Open this folder in VS Code and press **F5** to launch an Extension Development Host. Then open `samples/traffic.tdf`. There is no build step: the extension is plain JavaScript.

- `src/symbols.js` is a comment-aware, error-tolerant symbol extractor with no `vscode` dependency.
- `src/context.js` decides what kind of completion fits at the cursor.
- `src/extension.js` contains the VS Code providers.
- `syntaxes/ahdl.tmLanguage.json` is the TextMate grammar.

The natural next step is a language server (LSP) backed by a full parser, for example an ANTLR grammar. A full parser would add real diagnostics, cross-file references across a Quartus project, and rename.

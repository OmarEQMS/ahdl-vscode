'use strict';

// `npm run install-local`: install the .vsix that `npm run package` just built.
const { spawnSync } = require('child_process');
const path = require('path');
const { name, version } = require('../package.json');

// `code` is a .cmd shim on Windows, which Node only runs through a shell.
const r = spawnSync(`code --install-extension ${name}-${version}.vsix`, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: true
});
process.exit(r.status ?? 1);

'use strict';

// `npm run test:update`: a cross-platform `UPDATE_SNAPSHOTS=1 node --test "test/**/*.test.js"`.
const { spawnSync } = require('child_process');
const path = require('path');

const r = spawnSync(process.execPath, ['--test', 'test/**/*.test.js'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: { ...process.env, UPDATE_SNAPSHOTS: '1' }
});
process.exit(r.status ?? 1);

#!/usr/bin/env node
/*
 * Lanza Electron con las pruebas de extremo a extremo activadas, usando una
 * carpeta de datos temporal para no tocar la configuracion real del usuario.
 *
 *   npm run test:e2e
 */
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let electronPath;
try {
  electronPath = require('electron');
} catch (err) {
  console.error('Electron no esta instalado. Ejecuta: npm install');
  process.exit(1);
}

const dataDir = path.join(os.tmpdir(), 'python-classroom-e2e-' + process.pid);
fs.mkdirSync(dataDir, { recursive: true });

const child = spawn(electronPath, ['.', '--dev', '--user-data-dir=' + dataDir], {
  cwd: ROOT,
  stdio: 'inherit',
  env: Object.assign({}, process.env, { PC_E2E: '1', ELECTRON_ENABLE_LOGGING: '' })
});

child.on('close', (code) => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (err) { /* ya no existe */ }
  process.exit(code == null ? 1 : code);
});

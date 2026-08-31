#!/usr/bin/env node
/*
 * Empaqueta CodeMirror 6 en un unico modulo ESM: src/js/vendor/cm6.js
 * Uso: node scripts/build-vendor.js [--watch] [--dev]
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const BUNDLES = [
  {
    nombre: 'CodeMirror 6',
    entry: path.join(ROOT, 'build', 'cm6-entry.js'),
    outfile: path.join(ROOT, 'src', 'js', 'vendor', 'cm6.js'),
    banner: '/* Python Classroom - bundle de CodeMirror 6 (generado, no editar) */'
  },
  {
    nombre: 'Firebase',
    entry: path.join(ROOT, 'build', 'firebase-entry.js'),
    outfile: path.join(ROOT, 'src', 'js', 'vendor', 'firebase.js'),
    banner: '/* Python Classroom - bundle de Firebase (generado, no editar) */'
  }
];

const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;

async function main() {
  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (err) {
    console.error('[build-vendor] esbuild no esta instalado. Ejecuta: npm install');
    process.exit(1);
  }

  for (const b of BUNDLES) {
    fs.mkdirSync(path.dirname(b.outfile), { recursive: true });

    const options = {
      entryPoints: [b.entry],
      outfile: b.outfile,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['chrome120'],
      minify: !dev,
      sourcemap: dev ? 'inline' : false,
      legalComments: 'none',
      logLevel: 'warning',
      define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
      banner: { js: b.banner }
    };

    if (watch) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
      console.log('[build-vendor] watch activo sobre', path.relative(ROOT, b.outfile));
    } else {
      const t0 = Date.now();
      await esbuild.build(options);
      const size = fs.statSync(b.outfile).size;
      console.log(
        '[build-vendor] ' + b.nombre + ' -> ' + path.relative(ROOT, b.outfile) +
        ' (' + (size / 1024).toFixed(1) + ' KB en ' + (Date.now() - t0) + ' ms)'
      );
    }
  }
}

main().catch((err) => {
  console.error('[build-vendor] fallo:', err.message);
  process.exit(1);
});

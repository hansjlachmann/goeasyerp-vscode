import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * The licences of the packages bundled into the extension, which must travel with it: every
 * dependency in package-lock.json that is not for development only. (The bundle's inputs would
 * not do: a package can ship its own dependencies inside its files.)
 */
function writeNotices() {
  const { packages } = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const texts = Object.entries(packages)
    .filter(([folder, entry]) => folder && !entry.dev)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, { version, license }]) => {
      const name = folder.split('node_modules/').at(-1);
      const file = readdirSync(folder).find((entry) => /^licen[cs]e/i.test(entry));
      if (!file) {
        throw new Error(`${name} has no licence file`);
      }
      const text = readFileSync(join(folder, file), 'utf8').trim();
      return `${name} ${version} (${license})\n\n${text}\n`;
    });
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/ThirdPartyNotices.txt', texts.join(`\n${'-'.repeat(80)}\n\n`));
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  external: ['vscode'],
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

writeNotices();
if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}

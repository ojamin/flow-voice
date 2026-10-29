import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packages = ['core', 'browser', 'server', 'react'];
export const version = '0.6.0';
export const specifier = (name) => `github:ojamin/flow-voice#v${version}&path:/packages/${name}`;

export function releaseManifest(source) {
  if (source.version !== version) throw new Error(`Unexpected version for ${source.name}`);
  const manifest = structuredClone(source);
  delete manifest.scripts;
  delete manifest.devDependencies;
  manifest.files = ['dist', 'LICENSE', 'NOTICE'];
  for (const conditions of Object.values(manifest.exports)) delete conditions['flow-voice:source'];
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!name.startsWith('@flow-voice/')) continue;
      const sibling = name.slice('@flow-voice/'.length);
      if (!packages.includes(sibling)) throw new Error(`Unknown sibling: ${name}`);
      delete manifest[field][name];
      (manifest.peerDependencies ??= {})[name] = specifier(sibling);
    }
    if (manifest[field] && !Object.keys(manifest[field]).length) delete manifest[field];
  }
  return manifest;
}

export function writeReleaseTree(root, output) {
  if (existsSync(output)) throw new Error('Release output must not exist');
  mkdirSync(output, { recursive: true });
  cpSync(join(root, 'README.md'), join(output, 'README.md'));
  for (const name of ['LICENSE', 'NOTICE']) cpSync(join(root, name), join(output, name));
  writeFileSync(join(output, 'package.json'), `${JSON.stringify({
    name: 'flow-voice-release', private: true, version, type: 'module', license: 'MIT',
  }, null, 2)}\n`);
  for (const name of packages) {
    const source = join(root, 'packages', name);
    const target = join(output, 'packages', name);
    mkdirSync(target, { recursive: true });
    for (const file of ['LICENSE', 'NOTICE']) cpSync(join(root, file), join(target, file));
    const manifest = releaseManifest(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')));
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    cpSync(join(source, 'dist'), join(target, 'dist'), { recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/release.mjs <new-output-directory>');
  const output = resolve(process.argv[2]);
  const path = relative(root, output);
  if (!path.startsWith('../') || existsSync(output)) {
    throw new Error('Use a new output directory outside the source checkout');
  }
  // A clean build prevents stale output from entering the immutable release.
  for (const name of packages) rmSync(join(root, 'packages', name, 'dist'), { recursive: true, force: true });
  execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  writeReleaseTree(root, output);
}

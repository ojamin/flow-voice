import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { packages, releaseManifest, specifier, writeReleaseTree } from './release.mjs';

const root = new URL('../', import.meta.url);
test('release manifests contain only built exports and exact Git sibling peers', () => {
  for (const name of packages) {
    const source = JSON.parse(readFileSync(new URL(`packages/${name}/package.json`, root), 'utf8'));
    const manifest = releaseManifest(source);
    assert.equal(manifest.version, '0.2.0');
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.scripts, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.deepEqual(manifest.files, ['dist', 'LICENSE', 'NOTICE']);
    for (const conditions of Object.values(manifest.exports)) {
      assert.equal(conditions['flow-voice:source'], undefined);
      for (const path of Object.values(conditions)) assert.ok(path.startsWith('./dist/'));
    }
    for (const [dependency, range] of Object.entries(source.dependencies ?? {})) {
      if (dependency.startsWith('@flow-voice/')) {
        assert.equal(manifest.dependencies?.[dependency], undefined);
        assert.equal(manifest.peerDependencies[dependency], specifier(dependency.split('/')[1]));
      } else assert.equal(manifest.dependencies[dependency], range);
    }
    if (name === 'react') assert.equal(manifest.peerDependencies.react, source.peerDependencies.react);
    assert.ok(source.scripts.build, 'does not mutate source manifest');
    assert.deepEqual(releaseManifest(source), manifest, 'deterministic manifest');
  }
});

test('release refuses unexpected versions, unknown siblings, and existing output', () => {
  assert.throws(() => releaseManifest({ name: 'bad', version: '0.3.0' }), /version/);
  assert.throws(() => releaseManifest({
    version: '0.2.0', exports: {}, dependencies: { '@flow-voice/unknown': 'workspace:*' },
  }), /Unknown sibling/);
  const output = mkdtempSync(join(tmpdir(), 'flow-voice-release-test-'));
  try {
    assert.throws(() => writeReleaseTree(root, output), /must not exist/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test('release tree includes dist and worklet, excludes source tooling, and is reproducible', () => {
  const temp = mkdtempSync(join(tmpdir(), 'flow-voice-release-tree-'));
  try {
    const source = join(temp, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'README.md'), 'release fixture\n');
    for (const file of ['LICENSE', 'NOTICE']) cpSync(new URL(file, root), join(source, file));
    for (const name of packages) {
      const target = join(source, 'packages', name);
      mkdirSync(join(target, 'dist/capture'), { recursive: true });
      cpSync(new URL(`packages/${name}/package.json`, root), join(target, 'package.json'));
      const manifest = releaseManifest(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')));
      for (const conditions of Object.values(manifest.exports)) {
        for (const path of Object.values(conditions)) writeFileSync(join(target, path), 'built fixture\n');
      }
      mkdirSync(join(target, 'src'));
      writeFileSync(join(target, 'src/private.ts'), 'not shipped');
    }
    const first = join(temp, 'first');
    const second = join(temp, 'second');
    writeReleaseTree(source, first);
    writeReleaseTree(source, second);
    const files = readdirSync(first, { recursive: true, withFileTypes: true });
    for (const entry of files.filter((entry) => entry.isFile())) {
      const path = join(entry.parentPath, entry.name).slice(first.length + 1);
      assert.deepEqual(readFileSync(join(first, path)), readFileSync(join(second, path)));
    }
    for (const name of packages) {
      assert.equal(existsSync(join(first, 'packages', name, 'src')), false);
      const target = join(first, 'packages', name);
      for (const file of ['LICENSE', 'NOTICE']) {
        assert.deepEqual(readFileSync(join(target, file)), readFileSync(new URL(file, root)));
        assert.deepEqual(readFileSync(join(first, file)), readFileSync(new URL(file, root)));
      }
      const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
      for (const conditions of Object.values(manifest.exports)) {
        for (const path of Object.values(conditions)) assert.ok(existsSync(join(target, path)), path);
      }
    }
    assert.equal(readFileSync(join(first, 'packages/browser/dist/capture/worklet.js'), 'utf8'), 'built fixture\n');
    assert.deepEqual(readdirSync(first).sort(), ['LICENSE', 'NOTICE', 'README.md', 'package.json', 'packages']);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

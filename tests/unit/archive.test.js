import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createArchive, resolveArchivePath } from '../../cli/src/services/archive.js';
import { removeInstalledFiles } from '../../cli/src/services/cleanup.js';
import { createZipArchive } from '../../build/generators/archive.js';

test('archive paths reject traversal and accept simple archive names', () => {
  const cwd = path.join(os.tmpdir(), 'apm-workspace');
  assert.equal(
    resolveArchivePath(cwd, 'session-2026-10-30-001'),
    path.join(cwd, '.apm', 'archives', 'session-2026-10-30-001')
  );
  for (const name of ['../outside', '..\\outside', 'foo/../../outside', 'C:\\outside', '...']) {
    assert.throws(() => resolveArchivePath(cwd, name), /Invalid archive name/);
  }
});

test('duplicate custom archive names cannot overwrite an existing archive or source artifacts', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-archive-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const archive = path.join(cwd, '.apm', 'archives', 'existing');
  await mkdir(archive, { recursive: true });
  await writeFile(path.join(archive, 'sentinel.txt'), 'preserve');
  await writeFile(path.join(cwd, '.apm', 'artifact.md'), 'keep until archive succeeds');

  await assert.rejects(createArchive(cwd, { name: 'existing' }), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(archive, 'sentinel.txt'), 'utf8'), 'preserve');
  assert.equal(await readFile(path.join(cwd, '.apm', 'artifact.md'), 'utf8'), 'keep until archive succeeds');
});

test('cleanup rejects installed paths that escape the workspace before deleting anything', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-cleanup-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'tracked.txt'), 'preserve');

  await assert.rejects(
    removeInstalledFiles(cwd, { assistant: ['tracked.txt', '..\\outside.txt'] }),
    error => error.code === 'PATH_VALIDATION_FAILED'
  );
  assert.equal(await readFile(path.join(cwd, 'tracked.txt'), 'utf8'), 'preserve');
});

test('ZIP creation rejects output stream errors', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-zip-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const source = path.join(cwd, 'source');
  await mkdir(source);
  await writeFile(path.join(source, 'file.txt'), 'content');

  await assert.rejects(createZipArchive(source, path.join(cwd, 'missing', 'archive.zip')));
});

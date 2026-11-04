import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readConfig } from '../../cli/src/core/config.js';
import { readMetadata } from '../../cli/src/core/metadata.js';

test('corrupt config is reported instead of replaced with an empty default', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const configPath = path.join(cwd, 'config.json');
  await writeFile(configPath, '{invalid');

  await assert.rejects(readConfig(configPath), error => error.code === 'CONFIG_READ_FAILED');
});

test('missing config remains a supported default', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-config-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  assert.deepEqual(await readConfig(path.join(cwd, 'missing.json')), { customRepos: [] });
});

test('corrupt metadata is reported, while missing metadata remains uninitialized', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'apm-metadata-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  assert.equal(await readMetadata(cwd), null);
  const apmDir = path.join(cwd, '.apm');
  await mkdir(apmDir);
  await writeFile(path.join(apmDir, 'metadata.json'), '{invalid');
  await assert.rejects(readMetadata(cwd), error => error.code === 'METADATA_READ_FAILED');
});

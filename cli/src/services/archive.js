/**
 * Archive Service Module
 *
 * Core archival logic for session continuation.
 *
 * @module src/services/archive
 */

import fs from 'fs-extra';
import path from 'path';
import { ARCHIVES_DIR } from '../core/constants.js';
import { CLIError, CLIErrorCode } from '../core/errors.js';

/**
 * Resolves a simple archive name inside the workspace archive directory.
 *
 * @param {string} cwd - Working directory.
 * @param {string} name - Archive directory name.
 * @returns {string} Resolved archive directory path.
 */
export function resolveArchivePath(cwd, name) {
  if (
    typeof name !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) ||
    name.includes('..')
  ) {
    throw new CLIError(
      'Invalid archive name. Use 1-100 letters, numbers, dots, underscores, or hyphens; names cannot contain "..".',
      CLIErrorCode.ARCHIVE_FAILED,
      { name }
    );
  }

  const archivesDir = path.resolve(cwd, ARCHIVES_DIR);
  const archivePath = path.resolve(archivesDir, name);
  const relativePath = path.relative(archivesDir, archivePath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
    throw new CLIError('Archive path must remain inside the archives directory.', CLIErrorCode.ARCHIVE_FAILED, { name });
  }
  return archivePath;
}

/**
 * Generates the next archive directory name for today.
 * Format: session-YYYY-MM-DD-NNN (zero-padded daily counter).
 *
 * @param {string} archivesDir - Absolute path to archives directory.
 * @returns {Promise<string>} Archive directory name.
 */
export async function generateArchiveName(archivesDir) {
  const today = new Date().toISOString().slice(0, 10);
  const prefix = `session-${today}-`;

  let maxCounter = 0;
  if (await fs.pathExists(archivesDir)) {
    const entries = await fs.readdir(archivesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(prefix)) {
        const suffix = entry.name.slice(prefix.length);
        const num = parseInt(suffix, 10);
        if (!isNaN(num) && num > maxCounter) {
          maxCounter = num;
        }
      }
    }
  }

  const counter = String(maxCounter + 1).padStart(3, '0');
  return `${prefix}${counter}`;
}

/**
 * Lists archives with their metadata.
 *
 * @param {string} cwd - Working directory.
 * @returns {Promise<Array<{name: string, metadata: Object}>>} Archives with metadata.
 */
export async function listArchivesWithInfo(cwd) {
  const archivesDir = path.join(cwd, ARCHIVES_DIR);

  let entries;
  try {
    entries = await fs.readdir(archivesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const archives = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const metadataPath = path.join(archivesDir, entry.name, 'metadata.json');
      try {
        const metadata = await fs.readJson(metadataPath);
        archives.push({ name: entry.name, metadata });
      } catch (err) {
        if (err.code === 'ENOENT') continue;
        throw CLIError.metadataReadFailed(metadataPath, err.message);
      }
    }
  }

  return archives.sort((a, b) => {
    const dateA = a.metadata.archivedAt || '';
    const dateB = b.metadata.archivedAt || '';
    return dateA.localeCompare(dateB);
  });
}

/**
 * Counts valid archives.
 *
 * @param {string} cwd - Working directory.
 * @returns {Promise<number>} Number of valid archives.
 */
export async function countArchives(cwd) {
  const archives = await listArchivesWithInfo(cwd);
  return archives.length;
}

/**
 * Creates an archive by snapshotting everything in .apm/ except archives/.
 * Copies all contents (template artifacts, runtime files, metadata) into
 * the archive directory, then cleans originals from .apm/.
 *
 * @param {string} cwd - Working directory.
 * @param {Object} [options={}] - Archive options.
 * @param {string} [options.name] - Custom archive name (auto-generated if omitted).
 * @param {string} [options.reason] - Reason for archival (e.g., 'update', 'archive').
 * @returns {Promise<{archivePath: string, runtimeEntries: string[]}>} Archive path and list of runtime entries not in _apm.
 */
export async function createArchive(cwd, options = {}) {
  const apmDir = path.join(cwd, '.apm');
  const archivesDir = path.join(cwd, ARCHIVES_DIR);

  const archiveName = options.name || await generateArchiveName(archivesDir);
  const archivePath = resolveArchivePath(cwd, archiveName);

  // Read metadata to determine which entries are tracked vs runtime-created
  const metadataSrc = path.join(apmDir, 'metadata.json');
  let metadata = {};
  try {
    metadata = await fs.readJson(metadataSrc);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw CLIError.metadataReadFailed(metadataSrc, err.message);
    }
  }

  // Build set of top-level .apm/ entries that came from the template
  const trackedTopLevel = new Set();
  const apmFiles = metadata.installedFiles?._apm || [];
  for (const file of apmFiles) {
    // e.g. ".apm/plan.md" → "plan.md", ".apm/memory/index.md" → "memory"
    const relative = file.replace(/^\.apm\//, '');
    const topLevel = relative.split(/[\\/]/)[0];
    trackedTopLevel.add(topLevel);
  }
  trackedTopLevel.add('metadata.json');

  await fs.ensureDir(archivesDir);
  await fs.mkdir(archivePath);

  // Copy everything in .apm/ except archives/ into the archive snapshot
  const entries = await fs.readdir(apmDir);
  const runtimeEntries = [];
  for (const entry of entries) {
    if (entry === 'archives') continue;
    const src = path.join(apmDir, entry);
    const dest = path.join(archivePath, entry);
    await fs.copy(src, dest);
    if (!trackedTopLevel.has(entry)) {
      runtimeEntries.push(entry);
    }
  }

  // Stamp archival info on the archived metadata copy
  const archivedMetaPath = path.join(archivePath, 'metadata.json');
  try {
    await fs.access(archivedMetaPath);
    metadata.archivedAt = new Date().toISOString();
    if (options.reason) {
      metadata.reason = options.reason;
    }
    await fs.writeJson(archivedMetaPath, metadata, { spaces: 2 });
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Clean originals from .apm/ (keep archives/ and metadata.json)
  for (const entry of entries) {
    if (entry === 'archives' || entry === 'metadata.json') continue;
    await fs.remove(path.join(apmDir, entry));
  }

  return { archivePath, runtimeEntries };
}

/**
 * Removes a single archive by name.
 *
 * @param {string} cwd - Working directory.
 * @param {string} name - Archive directory name.
 * @returns {Promise<boolean>} Whether the archive was found and removed.
 */
export async function removeArchive(cwd, name) {
  const archivePath = resolveArchivePath(cwd, name);
  if (await fs.pathExists(archivePath)) {
    await fs.remove(archivePath);
    return true;
  }
  return false;
}

/**
 * Removes all archives.
 *
 * @param {string} cwd - Working directory.
 * @returns {Promise<number>} Number of archives removed.
 */
export async function clearArchives(cwd) {
  const archivesDir = path.join(cwd, ARCHIVES_DIR);
  let entries;
  try {
    entries = await fs.readdir(archivesDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await fs.remove(path.join(archivesDir, entry.name));
      count++;
    }
  }
  return count;
}

export default {
  generateArchiveName,
  resolveArchivePath,
  listArchivesWithInfo,
  countArchives,
  createArchive,
  removeArchive,
  clearArchives
};

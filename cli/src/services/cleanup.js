/**
 * Cleanup Service Module
 *
 * Removes installed files tracked in metadata.
 *
 * @module src/services/cleanup
 */

import fs from 'fs-extra';
import path from 'path';
import { CLIError, CLIErrorCode } from '../core/errors.js';

function resolveTrackedPath(cwd, file) {
  if (
    typeof file !== 'string' ||
    !file ||
    file.split(/[\\/]/).length < 2 ||
    file.split(/[\\/]/).some(segment => !segment || segment === '.' || segment === '..') ||
    path.isAbsolute(file) ||
    path.win32.isAbsolute(file)
  ) {
    throw new CLIError(
      `Refusing to remove invalid installed path: ${String(file)}`,
      CLIErrorCode.PATH_VALIDATION_FAILED,
      { file }
    );
  }

  const root = path.resolve(cwd);
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CLIError(
      `Refusing to remove a path outside the workspace: ${file}`,
      CLIErrorCode.PATH_VALIDATION_FAILED,
      { file }
    );
  }
  return resolved;
}

/**
 * Removes installed files for specified assistants, then cleans up
 * empty directories that belonged to those files.
 *
 * Safety rules:
 * - Only deletes files explicitly listed in installedFiles.
 * - Only removes directories that are intermediate path segments of
 *   those files (i.e., directories APM created).
 * - Never removes the assistant root directory (e.g. .github/, .claude/).
 * - Stops climbing at any directory that still contains other content
 *   (user files, non-APM subdirectories, etc.).
 *
 * @param {string} cwd - Working directory.
 * @param {Object} installedFiles - Map of assistantId to file paths.
 * @param {string[]} [assistantIds] - Assistant IDs to clean (all if omitted).
 * @returns {Promise<{removed: number, keptDirs: string[]}>} Count of removed files and list of dirs kept due to non-APM content.
 */
export async function removeInstalledFiles(cwd, installedFiles, assistantIds = null) {
  if (!installedFiles || typeof installedFiles !== 'object' || Array.isArray(installedFiles)) {
    throw new CLIError('Installed file metadata must be an object.', CLIErrorCode.PATH_VALIDATION_FAILED);
  }

  // _apm files are handled by the archive service, not by cleanup
  const ids = (assistantIds || Object.keys(installedFiles)).filter(id => id !== '_apm');
  let removed = 0;

  const trackedFiles = [];
  for (const id of ids) {
    const files = installedFiles[id];
    if (!Array.isArray(files)) {
      throw new CLIError(
        `Installed file metadata for "${id}" must be an array.`,
        CLIErrorCode.PATH_VALIDATION_FAILED,
        { id }
      );
    }
    for (const file of files) {
      trackedFiles.push({ file, fullPath: resolveTrackedPath(cwd, file) });
    }
  }

  // Collect every intermediate directory from our installed file paths.
  // For ".github/skills/context-gathering/SKILL.md" this yields:
  //   .github/skills/context-gathering
  //   .github/skills
  // but NOT .github (the root) and NOT cwd.
  const ownedDirs = new Set();

  for (const { file, fullPath } of trackedFiles) {
    try {
      const stats = await fs.lstat(fullPath);
      if (stats.isDirectory()) {
        throw new CLIError(
          `Refusing to remove a directory listed as an installed file: ${file}`,
          CLIErrorCode.PATH_VALIDATION_FAILED,
          { file }
        );
      }
      await fs.remove(fullPath);
      removed++;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Walk path segments to collect intermediate dirs (skip root segment)
    const segments = file.split(/[\\/]/);
    // segments[0] is the assistant root (e.g. ".github") — skip it
    for (let i = segments.length - 1; i > 1; i--) {
      const dir = path.join(cwd, ...segments.slice(0, i));
      ownedDirs.add(dir);
    }
  }

  // Remove owned directories that are now empty, deepest first.
  // Track dirs we skip because they still have non-APM content.
  const sorted = [...ownedDirs].sort((a, b) => b.length - a.length);
  const removedDirs = new Set();
  const keptDirs = [];

  for (const dir of sorted) {
    try {
      const entries = await fs.readdir(dir);
      if (entries.length === 0) {
        await fs.rmdir(dir);
        removedDirs.add(dir);
      } else {
        // Only report if all remaining entries are non-APM content
        // (not a parent dir we already cleaned — that would be noise)
        const hasRealContent = entries.some(e => !removedDirs.has(path.join(dir, e)));
        if (hasRealContent) {
          keptDirs.push(path.relative(cwd, dir));
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
    }
  }

  // Only report leaf-level kept dirs (filter out parents of other kept dirs)
  const leafKeptDirs = keptDirs.filter(d =>
    !keptDirs.some(other => other !== d && other.startsWith(d + path.sep))
  );

  return { removed, keptDirs: leafKeptDirs };
}

export default { removeInstalledFiles };

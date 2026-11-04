/**
 * Build Configuration Module
 *
 * Handles loading, validation, and access to build configuration.
 *
 * @module build/core/config
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { BuildError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Validates the build configuration object.
 *
 * @param {Object} config - Configuration object to validate.
 * @returns {string[]} Array of validation error messages (empty if valid).
 */
export function validateConfig(config) {
  const errors = [];

  if (!config.build) {
    errors.push('Missing "build" section');
  } else {
    if (!config.build.sourceDir) {
      errors.push('Missing "build.sourceDir"');
    }
    if (!config.build.outputDir) {
      errors.push('Missing "build.outputDir"');
    }
  }

  if (!config.targets) {
    errors.push('Missing "targets" array');
  } else if (!Array.isArray(config.targets)) {
    errors.push('"targets" must be an array');
  } else if (config.targets.length === 0) {
    errors.push('"targets" array is empty');
  } else {
    const targetIds = new Set();
    const bundleNames = new Set();
    config.targets.forEach((target, index) => {
      const prefix = `targets[${index}]`;
      if (!target.id) errors.push(`${prefix}: missing "id"`);
      if (!target.name) errors.push(`${prefix}: missing "name"`);
      if (!target.bundleName) errors.push(`${prefix}: missing "bundleName"`);
      if (!target.format) errors.push(`${prefix}: missing "format"`);
      if (target.id && targetIds.has(target.id)) errors.push(`${prefix}: duplicate target id "${target.id}"`);
      if (target.bundleName && bundleNames.has(target.bundleName)) {
        errors.push(`${prefix}: duplicate bundle name "${target.bundleName}"`);
      }
      if (target.id) targetIds.add(target.id);
      if (target.bundleName) bundleNames.add(target.bundleName);
      if (!target.directories) {
        errors.push(`${prefix}: missing "directories"`);
      } else {
        if (!target.directories.commands) errors.push(`${prefix}: missing "directories.commands"`);
        if (!target.directories.skills) errors.push(`${prefix}: missing "directories.skills"`);
        if (!target.directories.guides) errors.push(`${prefix}: missing "directories.guides"`);
      }
    });
  }

  return errors;
}

/**
 * Loads shared build settings and registers assistant platform plugins.
 *
 * @returns {Promise<Object>} Validated configuration object.
 * @throws {BuildError} If config not found or invalid.
 */
export async function loadConfig() {
  const configPath = path.join(__dirname, '..', 'build-config.json');

  if (!await fs.pathExists(configPath)) {
    throw BuildError.configNotFound(configPath);
  }

  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    throw BuildError.configInvalid([`Could not parse build/build-config.json: ${error.message}`]);
  }

  const pluginsDir = path.resolve(__dirname, '..', '..', 'plugins', 'assistant-platforms');
  let pluginFiles;
  try {
    pluginFiles = (await fs.readdir(pluginsDir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw BuildError.configInvalid([`Assistant platform plugin directory not found: ${pluginsDir}`]);
    }
    throw error;
  }

  const targets = [];
  for (const fileName of pluginFiles) {
    const pluginPath = path.join(pluginsDir, fileName);
    try {
      const target = JSON.parse(await fs.readFile(pluginPath, 'utf8'));
      if (fileName !== `${target.id}.json`) {
        throw new Error(`Plugin filename must match its target id (${target.id}.json).`);
      }
      targets.push(target);
    } catch (error) {
      throw BuildError.configInvalid([`Could not load ${pluginPath}: ${error.message}`]);
    }
  }

  config.targets = targets;
  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw BuildError.configInvalid(errors);
  }

  return config;
}

/**
 * Gets the version for the release manifest.
 * Uses VERSION env var if set (for CI), otherwise reads from package.json.
 *
 * @returns {Promise<string>} Version string.
 */
export async function getVersion() {
  // CI passes version via environment variable
  if (process.env.VERSION) {
    return process.env.VERSION.replace(/^v/, ''); // Strip leading 'v' if present
  }

  // Fallback to package.json for local development
  const packagePath = path.join(__dirname, '..', '..', 'package.json');
  const packageContent = await fs.readFile(packagePath, 'utf8');
  const { version } = JSON.parse(packageContent);
  return version;
}


/**
 * Archive Generation Module
 *
 * @module build/generators/archive
 */

import fs from 'fs-extra';
import { ZipArchive } from 'archiver';
import { pipeline } from 'node:stream/promises';

export async function createZipArchive(sourceDir, outputPath) {
  const archive = new ZipArchive({
    zlib: { level: 9 }
  });

  try {
    archive.directory(sourceDir, false);

    const output = fs.createWriteStream(outputPath);

    // Pipeline propagates archive and output stream errors.
    const outputPromise = pipeline(archive, output);

    // Finalize the archive and wait for the file to finish.
    const finalizePromise = archive.finalize();

    await Promise.all([
      finalizePromise,
      outputPromise
    ]);

  } catch (error) {
    archive.abort();
    throw error;
  }
}

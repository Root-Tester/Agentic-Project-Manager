import { exec } from 'child_process';
import { createUiServer } from '../web/server.js';
import logger from '../ui/logger.js';

/**
 * Starts the local HTTP server and launches the Web UI.
 *
 * @param {Object} options - CLI options.
 * @param {number|string} options.port - Port to run the UI on.
 */
export async function uiCommand(options = {}) {
  const port = Number(options.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  const { server } = createUiServer(process.cwd(), port);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  logger.clearAndBanner();
  logger.success('APM Task Manager Web UI is running!');
  logger.info(`Server URL: http://127.0.0.1:${port}`);
  logger.info('Press Ctrl+C to stop the server.');
  logger.blank();

  const url = `http://127.0.0.1:${port}`;
  const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${startCmd} ${url}`, err => {
    if (err) {
      logger.warn(`Could not open browser automatically. Please open: ${url}`);
    }
  });
}

export default uiCommand;

/** Graceful shutdown coordination for Octo CLI */

type ShutdownCallback = () => void | Promise<void>;

const callbacks: ShutdownCallback[] = [];
let shuttingDown = false;

/** Check if shutdown has been requested */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Register a cleanup callback to run on shutdown */
export function onShutdown(callback: ShutdownCallback): void {
  callbacks.push(callback);
}

/** Trigger shutdown — runs all registered callbacks and exits */
export async function triggerShutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // prevent double-trigger
  shuttingDown = true;

  const { logger } = await import('./logger.js');
  logger.warn(`Shutdown requested (${signal}). Cancelling ongoing operations...`);

  for (const cb of callbacks) {
    try {
      await cb();
    } catch {
      // best-effort cleanup
    }
  }

  logger.info('Shutdown complete.');
  process.exit(130);
}

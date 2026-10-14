// -----------------------------------------------------------------------------
// The log level, switchable from the Configuration screen.
//
// The SDK logger re-reads `process.env.LOG_LEVEL` on every line, so writing
// that variable is enough: it takes effect at once, for every logger already
// created, the SDK's own connection logs included. No restart.
//
// An operator who already set `LOG_LEVEL` on the container keeps it: their
// value is the baseline, captured once at startup, put back when the
// "Detailed logs" switch goes off.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'logging' });

/** `LOG_LEVEL` as the container was started with, read once. */
const BASELINE = process.env.LOG_LEVEL;

/**
 * Apply the log level a configuration asks for.
 *
 * @param {object} config normalized configuration (see src/config.js)
 * @returns {string} the level in force afterwards
 */
export function applyLogLevel(config) {
  const wanted = config?.debug_logs ? 'debug' : BASELINE;
  const current = process.env.LOG_LEVEL;
  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }
  if (current !== process.env.LOG_LEVEL) {
    // Said at info, so the line survives in both directions.
    logger.info(
      config?.debug_logs
        ? 'Detailed logs turned on: every SNMP failure is logged'
        : `Detailed logs turned off (level: ${process.env.LOG_LEVEL ?? 'info'})`,
    );
  }
  return process.env.LOG_LEVEL ?? 'info';
}

/** Formatted output for stdout/stderr with prefixes */
export const logger = {
  info(message: string): void {
    process.stdout.write(`[INFO] ${message}\n`);
  },

  error(message: string): void {
    process.stderr.write(`[ERRO] ${message}\n`);
  },

  warn(message: string): void {
    process.stderr.write(`[AVISO] ${message}\n`);
  },
};

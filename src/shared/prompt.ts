import { createInterface } from 'node:readline';

/**
 * Prompts the user with a yes/no question via stdin.
 * Accepts 'y', 'Y', 's', 'S' as affirmative.
 */
export function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 's');
    });
  });
}

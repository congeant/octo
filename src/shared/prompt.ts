import { createInterface } from 'node:readline';

/**
 * Prompts the user with a question and returns their text input.
 *
 * @param message - The prompt message displayed to the user.
 * @returns The trimmed user input string.
 */
export function ask(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts the user with a yes/no question via stdin.
 * Accepts 'y', 'Y', 's', 'S' as affirmative responses.
 *
 * @param message - The yes/no question to display.
 * @returns `true` if the user confirmed, `false` otherwise.
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

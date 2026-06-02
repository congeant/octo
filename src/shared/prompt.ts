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
 * Prompts the user for sensitive input (e.g. tokens, passwords).
 * Input is not echoed to the terminal.
 *
 * @param message - The prompt message displayed to the user.
 * @returns The trimmed secret string.
 */
export function askSecret(message: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(message);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    let input = '';

    const onData = (char: string) => {
      if (char === '\n' || char === '\r') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit(130);
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };

    stdin.on('data', onData);
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

import { closeDatabase } from './database.js';
import { migrate, resetDatabase } from './migrate.js';
import { hashPassword } from '../auth.js';
import { createUser, findUserByEmail } from './repository.js';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function readBootstrapPassword(): Promise<string> {
  const fromEnvironment = process.env.PTM_BOOTSTRAP_PASSWORD;
  if (fromEnvironment) return fromEnvironment;
  const prompt = createInterface({ input, output });
  try {
    return (await prompt.question('Mật khẩu tài khoản mới (tối thiểu 8 ký tự): ')).trim();
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'migrate';
  if (command === 'reset') {
    resetDatabase();
    return;
  }
  if (command === 'migrate') {
    migrate();
    return;
  }
  if (command === 'create-user') {
    const args = process.argv.slice(3).filter((argument) => argument !== '--');
    const email = args[0]?.trim().toLowerCase();
    if (!email || args.length > 1) {
      throw new Error('Usage: create-user <email> rồi nhập mật khẩu khi được hỏi (hoặc đặt PTM_BOOTSTRAP_PASSWORD)');
    }
    const password = await readBootstrapPassword();
    if (password.length < 8) throw new Error('Mật khẩu phải có ít nhất 8 ký tự.');
    migrate();
    if (findUserByEmail(email)) throw new Error('Email này đã tồn tại.');
    const user = createUser(email, await hashPassword(password));
    console.log(`Created user ${user.email} (${user.id})`);
    return;
  }
  throw new Error(`Unknown database command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => closeDatabase());

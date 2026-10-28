import { closeDatabase } from './database.js';
import { migrate, resetDatabase } from './migrate.js';

const command = process.argv[2] ?? 'migrate';

try {
  if (command === 'reset') resetDatabase();
  else if (command === 'migrate') migrate();
  else throw new Error(`Unknown database command: ${command}`);
} finally {
  closeDatabase();
}

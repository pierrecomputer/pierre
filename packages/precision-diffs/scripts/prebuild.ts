import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

const workerDir = join(import.meta.dirname, '../src/worker');
const source = join(workerDir, 'worker.ts');
const dest = join(workerDir, 'worker-portable.ts');

copyFileSync(source, dest);
console.log('Created worker-portable.ts');

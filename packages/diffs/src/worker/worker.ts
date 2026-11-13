import { registerWorkerHandlers } from './workerHandlers';

// The worker entry holds only this call, so no lazily loaded chunk has a
// reason to import it. Vite's dev server loads a worker entry under its own
// URL, and a chunk that imported the entry would run it a second time.
registerWorkerHandlers();

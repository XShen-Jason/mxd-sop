import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 26902);
const host = process.env.HOST ?? '127.0.0.1';

const app = await createApp();
await app.listen({ port, host });
console.log(`game-support-ops backend listening on http://localhost:${port}`);

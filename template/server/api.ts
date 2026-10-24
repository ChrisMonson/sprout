import { Hono } from 'hono';
import { db } from './db';

const app = new Hono().basePath('/api');

app.get('/health', c => {
  db.prepare('SELECT 1').get();
  return c.json({ ok: true });
});

export default app;

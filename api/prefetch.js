import { prefetchChunk } from './handlers.mjs';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const sentences = Array.isArray(body?.sentences) ? body.sentences : [];
    const result = await prefetchChunk(sentences);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Prefetch API error:', err);
    res.status(500).json({ error: 'Внутрішня помилка сервера.' });
  }
}

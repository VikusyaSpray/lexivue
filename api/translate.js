import { translateWord } from './handlers.mjs';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const word = req.query?.word || parsedUrl.searchParams.get('word') || '';
    const sentence = req.query?.sentence || parsedUrl.searchParams.get('sentence') || '';
    const debug = (req.query?.debug || parsedUrl.searchParams.get('debug') || '') === '1';

    const result = await translateWord(word, sentence, { debug });
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Translate API error:', err);
    res.status(500).json({ error: 'Внутрішня помилка сервера. Спробуйте ще раз.' });
  }
}

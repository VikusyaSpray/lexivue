import { getYoutubeTranscript } from './handlers.mjs';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const target =
      req.query?.url ||
      req.query?.videoId ||
      parsedUrl.searchParams.get('url') ||
      parsedUrl.searchParams.get('videoId') ||
      '';

    const result = await getYoutubeTranscript(target);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Transcript API error:', err);
    res.status(500).json({ error: 'Внутрішня помилка сервера. Спробуйте ще раз.' });
  }
}

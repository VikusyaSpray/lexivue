const transcriptCache = new Map();
const translateCache = new Map();

const POS_UK = {
  noun: 'іменник',
  verb: 'дієслово',
  adjective: 'прикметник',
  adverb: 'прислівник',
  pronoun: 'займенник',
  preposition: 'прийменник',
  conjunction: 'сполучник',
  interjection: 'вигук',
  exclamation: 'вигук',
  article: 'артикль',
  determiner: 'детермінатив',
  abbreviation: 'скорочення',
  auxiliary: 'допоміжне дієслово',
};

export function extractVideoId(input = '') {
  const trimmed = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
    const vParam = url.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;

    const match = url.pathname.match(/\/(shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[2];
  } catch {
    const fallback = trimmed.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
    if (fallback) return fallback[1];
  }
  return null;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchPlayerData(videoId) {
  const clients = [
    {
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
    },
    {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      userAgent: 'com.google.ios.youtube/20.10.4 (iPhone14,5; U; CPU iOS 17_4 like Mac OS X)',
    },
  ];

  for (const client of clients) {
    try {
      const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': client.userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: client.clientName,
              clientVersion: client.clientVersion,
              hl: 'en',
              gl: 'US',
            },
          },
          videoId,
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        return {
          title: data?.videoDetails?.title || 'YouTube Video',
          author: data?.videoDetails?.author || '',
          lengthSeconds: Number(data?.videoDetails?.lengthSeconds || 0),
          tracks,
        };
      }
      if (data?.videoDetails?.title) {
        return {
          title: data.videoDetails.title,
          author: data.videoDetails.author || '',
          lengthSeconds: Number(data.videoDetails.lengthSeconds || 0),
          tracks: [],
        };
      }
    } catch {
      // try next client
    }
  }
  return null;
}

const WORD_REGEX = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

function extractWordSpecs(text) {
  const specs = [];
  let match;
  WORD_REGEX.lastIndex = 0;
  while ((match = WORD_REGEX.exec(text)) !== null) {
    const raw = match[0];
    const after = text.slice(match.index + raw.length, match.index + raw.length + 2);
    let pauseWeight = 0;
    if (/^[.!?]/.test(after)) pauseWeight = 3.2;
    else if (/^[,;:]/.test(after)) pauseWeight = 1.6;
    specs.push({
      word: raw,
      norm: raw.replace(/’/g, "'").toLowerCase(),
      weight: Math.max(2, raw.length) + pauseWeight,
    });
  }
  return specs;
}

function buildWeightedTimings(text, startSec, endSec) {
  const specs = extractWordSpecs(text);
  if (specs.length === 0) return [];
  const safeEnd = Math.max(endSec, startSec + 0.35);
  const duration = safeEnd - startSec;
  const totalWeight = specs.reduce((acc, s) => acc + s.weight, 0) || specs.length;

  let cursor = startSec;
  return specs.map((spec, idx) => {
    const share = (spec.weight / totalWeight) * duration;
    const wStart = Number(cursor.toFixed(3));
    const wEnd = idx === specs.length - 1
      ? Number(safeEnd.toFixed(3))
      : Number((cursor + share).toFixed(3));
    cursor += share;
    return { start: wStart, end: wEnd };
  });
}

function extractEventWordTimings(ev, startMs, endMs, cleanedText) {
  const segs = Array.isArray(ev.segs) ? ev.segs : [];
  const hasOffsets = segs.some((s) => typeof s.tOffsetMs === 'number' && s.tOffsetMs > 0);
  const targetSpecs = extractWordSpecs(cleanedText);
  if (targetSpecs.length === 0) return [];

  if (!hasOffsets) {
    return buildWeightedTimings(cleanedText, startMs / 1000, endMs / 1000);
  }

  // Extract raw word starts from json3 segs with tOffsetMs
  const rawWordStarts = [];
  for (const s of segs) {
    const piece = decodeHtmlEntities((s.utf8 || '').replace(/\n+/g, ' '));
    if (!piece) continue;
    const pieceStartMs = startMs + (s.tOffsetMs ?? 0);
    const pieceWords = extractWordSpecs(piece);
    for (let i = 0; i < pieceWords.length; i++) {
      rawWordStarts.push(pieceStartMs + i * 160);
    }
  }

  if (rawWordStarts.length !== targetSpecs.length) {
    return buildWeightedTimings(cleanedText, startMs / 1000, endMs / 1000);
  }

  return rawWordStarts.map((wStartMs, idx) => {
    const nextMs = idx < rawWordStarts.length - 1 ? rawWordStarts[idx + 1] : endMs;
    const clampedEnd = Math.max(wStartMs + 80, Math.min(endMs, nextMs));
    return {
      start: Number((wStartMs / 1000).toFixed(3)),
      end: Number((clampedEnd / 1000).toFixed(3)),
    };
  });
}

function extractAsrWordStream(json) {
  const rawEvents = (json?.events || []).filter(
    (e) => Array.isArray(e.segs) && e.segs.some((s) => s.utf8 && s.utf8.trim())
  );
  const words = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const ev = rawEvents[i];
    const startMs = ev.tStartMs ?? 0;
    const nextStartMs = rawEvents[i + 1]?.tStartMs;
    const durMs = Math.min(ev.dDurationMs ?? 3000, nextStartMs ? Math.max(400, nextStartMs - startMs) : 4000);
    const segs = ev.segs || [];

    for (let j = 0; j < segs.length; j++) {
      const piece = decodeHtmlEntities((segs[j].utf8 || '').replace(/\n+/g, ' '));
      if (!piece) continue;
      const tMs = startMs + (segs[j].tOffsetMs ?? 0);
      const specs = extractWordSpecs(piece);
      for (let k = 0; k < specs.length; k++) {
        words.push({
          norm: specs[k].norm,
          start: (tMs + k * 140) / 1000,
          maxEnd: (startMs + durMs) / 1000,
        });
      }
    }
  }

  for (let i = 0; i < words.length; i++) {
    const nextStart = words[i + 1]?.start;
    const end = nextStart && nextStart > words[i].start
      ? Math.min(nextStart, words[i].start + 1.2)
      : Math.max(words[i].start + 0.25, words[i].maxEnd);
    words[i].end = Number(end.toFixed(3));
    words[i].start = Number(words[i].start.toFixed(3));
  }
  return words;
}

function alignSegmentsWithAsr(segments, asrWords) {
  if (!asrWords || asrWords.length === 0) {
    return segments.map((seg) => ({
      ...seg,
      wordTimings: seg.wordTimings?.length
        ? seg.wordTimings
        : buildWeightedTimings(seg.text, seg.start, seg.end),
    }));
  }

  let asrCursor = 0;

  return segments.map((seg) => {
    const specs = extractWordSpecs(seg.text);
    if (specs.length === 0) return { ...seg, wordTimings: [] };

    const winStart = seg.start - 1.4;
    const winEnd = seg.end + 1.4;

    // Advance cursor to window start (keeping slight lookback)
    while (asrCursor > 0 && asrWords[asrCursor - 1].start >= winStart) {
      asrCursor--;
    }
    while (asrCursor < asrWords.length && asrWords[asrCursor].start < winStart) {
      asrCursor++;
    }

    const matchedStarts = new Array(specs.length).fill(null);
    let localPos = asrCursor;

    for (let i = 0; i < specs.length; i++) {
      const targetNorm = specs[i].norm;
      const searchLimit = Math.min(asrWords.length, localPos + 10);
      for (let j = localPos; j < searchLimit; j++) {
        if (asrWords[j].start > winEnd) break;
        const cand = asrWords[j].norm;
        if (
          cand === targetNorm ||
          (cand.length >= 4 && targetNorm.length >= 4 && (cand.startsWith(targetNorm) || targetNorm.startsWith(cand)))
        ) {
          matchedStarts[i] = asrWords[j].start;
          localPos = j + 1;
          break;
        }
      }
    }

    const matchedCount = matchedStarts.filter((v) => v !== null).length;
    if (matchedCount === 0) {
      return {
        ...seg,
        wordTimings: buildWeightedTimings(seg.text, seg.start, seg.end),
      };
    }

    // Fill unmatched words by weighted interpolation between matched anchors
    const starts = [...matchedStarts];
    const safeEnd = Math.max(seg.end, seg.start + 0.35);

    let i = 0;
    while (i < starts.length) {
      if (starts[i] !== null) {
        i++;
        continue;
      }
      const gapStartIdx = i;
      while (i < starts.length && starts[i] === null) i++;
      const gapEndIdx = i; // exclusive

      const leftTime = gapStartIdx > 0 && starts[gapStartIdx - 1] !== null
        ? starts[gapStartIdx - 1] + 0.14
        : seg.start;
      const rightTime = gapEndIdx < starts.length && starts[gapEndIdx] !== null
        ? starts[gapEndIdx]
        : safeEnd;

      const span = Math.max(0.08 * (gapEndIdx - gapStartIdx), rightTime - leftTime);
      let gapWeight = 0;
      for (let k = gapStartIdx; k < gapEndIdx; k++) gapWeight += specs[k].weight;

      let cur = leftTime;
      for (let k = gapStartIdx; k < gapEndIdx; k++) {
        starts[k] = cur;
        cur += (specs[k].weight / (gapWeight || 1)) * span;
      }
    }

    // Build monotonically non-decreasing [start, end] pairs
    const wordTimings = starts.map((st, idx) => {
      const clampedStart = Number(st.toFixed(3));
      const nextSt = idx < starts.length - 1 ? starts[idx + 1] : Math.max(safeEnd, clampedStart + 0.25);
      const clampedEnd = Number(Math.max(clampedStart + 0.06, nextSt).toFixed(3));
      return { start: clampedStart, end: clampedEnd };
    });

    // Update global cursor smoothly
    asrCursor = Math.max(asrCursor, localPos - 2);

    return {
      ...seg,
      wordTimings,
    };
  });
}

function parseJson3Captions(json) {
  const rawEvents = (json?.events || []).filter(
    (e) => Array.isArray(e.segs) && e.segs.some((s) => s.utf8 && s.utf8.trim())
  );

  const segments = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const ev = rawEvents[i];
    const startMs = ev.tStartMs ?? 0;
    const rawText = ev.segs.map((s) => s.utf8 || '').join('');
    const text = decodeHtmlEntities(rawText.replace(/\n+/g, ' '));
    if (!text) continue;

    // Avoid duplicate consecutive captions
    if (segments.length > 0 && segments[segments.length - 1].text === text) {
      continue;
    }

    const nextStartMs = rawEvents[i + 1]?.tStartMs;
    let durationMs = ev.dDurationMs ?? 3000;
    if (nextStartMs && nextStartMs > startMs && durationMs > nextStartMs - startMs + 500) {
      durationMs = nextStartMs - startMs;
    }
    const endMs = startMs + Math.max(durationMs, 400);
    const wordTimings = extractEventWordTimings(ev, startMs, endMs, text);

    segments.push({
      id: segments.length,
      start: Number((startMs / 1000).toFixed(2)),
      end: Number((endMs / 1000).toFixed(2)),
      text,
      wordTimings,
    });
  }

  // Merge very tiny single-word or 1-2 word ASR fragments into natural readable cues
  const merged = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    const prevWords = prev ? prev.text.split(' ').length : 0;
    const curWords = seg.text.split(' ').length;
    const gap = prev ? seg.start - prev.end : 99;
    const prevEndsSentence = prev ? /[.!?]$/.test(prev.text) : true;

    if (
      prev &&
      !prevEndsSentence &&
      gap < 0.8 &&
      prevWords + curWords <= 14 &&
      seg.end - prev.start <= 6.5 &&
      (prevWords <= 4 || curWords <= 3)
    ) {
      prev.text = `${prev.text} ${seg.text}`;
      prev.end = seg.end;
      prev.wordTimings = [...(prev.wordTimings || []), ...(seg.wordTimings || [])];
    } else {
      merged.push({ ...seg, id: merged.length });
    }
  }

  return merged.map((seg, idx) => ({ ...seg, id: idx }));
}

function parseXmlCaptions(xml) {
  const segments = [];
  // Format 3: <p t="1234" d="567">...</p>
  const pRegex = /<p\s+[^>]*t="(\d+)"(?:[^>]*d="(\d+)")?[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = Number(match[1]);
    const durMs = Number(match[2] || 3000);
    const stripped = match[3].replace(/<[^>]+>/g, '');
    const text = decodeHtmlEntities(stripped);
    if (!text) continue;
    segments.push({
      id: segments.length,
      start: Number((startMs / 1000).toFixed(2)),
      end: Number(((startMs + durMs) / 1000).toFixed(2)),
      text,
    });
  }

  if (segments.length > 0) return segments;

  // Legacy format: <text start="1.2" dur="3.4">...</text>
  const tRegex = /<text\s+[^>]*start="([\d.]+)"(?:[^>]*dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
  while ((match = tRegex.exec(xml)) !== null) {
    const start = Number(match[1]);
    const dur = Number(match[2] || 3);
    const text = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, ''));
    if (!text) continue;
    segments.push({
      id: segments.length,
      start: Number(start.toFixed(2)),
      end: Number((start + dur).toFixed(2)),
      text,
    });
  }
  return segments;
}

export async function getYoutubeTranscript(urlOrId) {
  const videoId = extractVideoId(urlOrId);
  if (!videoId) {
    return { status: 400, body: { error: 'Некоректне посилання на YouTube. Перевірте URL і спробуйте ще раз.' } };
  }

  if (transcriptCache.has(videoId)) {
    return { status: 200, body: transcriptCache.get(videoId) };
  }

  const playerData = await fetchPlayerData(videoId);
  if (!playerData) {
    return {
      status: 404,
      body: { error: 'Не вдалося завантажити дані відео з YouTube. Перевірте посилання або спробуйте інше відео.' },
    };
  }

  const { title, author, lengthSeconds, tracks } = playerData;
  if (!tracks || tracks.length === 0) {
    return {
      status: 404,
      body: {
        error: 'У цього відео немає доступних субтитрів на YouTube. Ви можете обрати інше відео або вставити текст у вкладці «Читати».',
        videoId,
        title,
        author,
      },
    };
  }

  // Pick manual English first, then any English (incl. auto-generated), then first available
  const chosenTrack =
    tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode === 'en') ||
    tracks.find((t) => t.languageCode?.startsWith('en')) ||
    tracks[0];

  // If chosen track is manual, also look for English ASR track for exact word-level speech sync
  const asrTrack =
    chosenTrack.kind !== 'asr'
      ? tracks.find((t) => t.languageCode?.startsWith('en') && t.kind === 'asr')
      : null;

  const captionUrl = new URL(chosenTrack.baseUrl);
  captionUrl.searchParams.set('fmt', 'json3');

  const fetchHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  const asrPromise = asrTrack
    ? (async () => {
        try {
          const asrUrl = new URL(asrTrack.baseUrl);
          asrUrl.searchParams.set('fmt', 'json3');
          const res = await fetchWithTimeout(asrUrl.toString(), 4000);
          if (!res.ok) return null;
          const json = await res.json();
          return extractAsrWordStream(json);
        } catch {
          return null;
        }
      })()
    : Promise.resolve(null);

  const [capRes, asrWordStream] = await Promise.all([
    fetch(captionUrl.toString(), { headers: fetchHeaders }),
    asrPromise,
  ]);

  if (!capRes.ok) {
    return {
      status: 502,
      body: { error: 'Не вдалося завантажити файл субтитрів із YouTube. Спробуйте ще раз.' },
    };
  }

  const rawText = await capRes.text();
  let segments = [];
  try {
    const json = JSON.parse(rawText);
    segments = parseJson3Captions(json);
  } catch {
    segments = parseXmlCaptions(rawText).map((seg) => ({
      ...seg,
      wordTimings: buildWeightedTimings(seg.text, seg.start, seg.end),
    }));
  }

  if (segments.length === 0) {
    return {
      status: 404,
      body: { error: 'Субтитри порожні або не підтримуються. Спробуйте інше відео.' },
    };
  }

  if (asrWordStream && asrWordStream.length > 0) {
    segments = alignSegmentsWithAsr(segments, asrWordStream);
  }

  const payload = {
    videoId,
    title,
    author,
    lengthSeconds,
    language: chosenTrack.languageCode || 'en',
    isAutoGenerated: chosenTrack.kind === 'asr',
    segments,
  };

  transcriptCache.set(videoId, payload);
  return { status: 200, body: payload };
}

async function fetchWithTimeout(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function googleTranslateEnToUk(text, includeDict = false) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: 'uk',
    q: text,
  });
  let url = `https://translate.googleapis.com/translate_a/single?${params.toString()}&dt=t`;
  if (includeDict) url += '&dt=bd';

  const res = await fetchWithTimeout(url, 5000);
  if (!res.ok) throw new Error('Translation API failed');
  return res.json();
}

async function fetchDictionaryMeta(word) {
  try {
    const res = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      2200
    );
    if (!res.ok) return { phonetic: '', audio: '' };
    const data = await res.json();
    const entry = Array.isArray(data) ? data[0] : null;
    if (!entry) return { phonetic: '', audio: '' };

    let phonetic = entry.phonetic || '';
    let audio = '';
    if (Array.isArray(entry.phonetics)) {
      for (const p of entry.phonetics) {
        if (!phonetic && p.text) phonetic = p.text;
        if (!audio && p.audio) audio = p.audio;
      }
    }
    return { phonetic, audio };
  } catch {
    return { phonetic: '', audio: '' };
  }
}

export async function translateWord(rawWord, sentence = '') {
  const cleaned = String(rawWord || '')
    .trim()
    .replace(/^[^a-zA-Z'-]+|[^a-zA-Z'-]+$/g, '');

  if (!cleaned) {
    return { status: 400, body: { error: 'Слово не вказано.' } };
  }

  const lower = cleaned.toLowerCase();
  let baseData = translateCache.get(lower);

  if (!baseData) {
    const [gtData, dictMeta] = await Promise.all([
      googleTranslateEnToUk(cleaned, true),
      fetchDictionaryMeta(lower),
    ]);

    const mainTranslation = Array.isArray(gtData?.[0])
      ? gtData[0].map((part) => part?.[0] || '').join('').trim()
      : '';

    const alternatives = [];
    let partOfSpeech = '';
    let partOfSpeechUk = '';

    if (Array.isArray(gtData?.[1])) {
      for (const group of gtData[1]) {
        const pos = String(group?.[0] || '').toLowerCase();
        if (!partOfSpeech && pos) {
          partOfSpeech = pos;
          partOfSpeechUk = POS_UK[pos] || pos;
        }
        const terms = Array.isArray(group?.[1]) ? group[1] : [];
        for (const term of terms) {
          if (
            typeof term === 'string' &&
            term.toLowerCase() !== mainTranslation.toLowerCase() &&
            !alternatives.includes(term) &&
            alternatives.length < 5
          ) {
            alternatives.push(term);
          }
        }
      }
    }

    baseData = {
      word: cleaned,
      normalized: lower,
      translation: mainTranslation || cleaned,
      alternatives,
      partOfSpeech,
      partOfSpeechUk,
      phonetic: dictMeta.phonetic,
      audio: dictMeta.audio,
    };

    translateCache.set(lower, baseData);
  }

  let sentenceTranslation = '';
  const trimmedSentence = String(sentence || '').trim();
  if (trimmedSentence && trimmedSentence.length <= 400) {
    const sentKey = `sent:${trimmedSentence}`;
    if (translateCache.has(sentKey)) {
      sentenceTranslation = translateCache.get(sentKey);
    } else {
      try {
        const sentData = await googleTranslateEnToUk(trimmedSentence, false);
        sentenceTranslation = Array.isArray(sentData?.[0])
          ? sentData[0].map((part) => part?.[0] || '').join('').trim()
          : '';
        if (sentenceTranslation) {
          translateCache.set(sentKey, sentenceTranslation);
        }
      } catch {
        sentenceTranslation = '';
      }
    }
  }

  return {
    status: 200,
    body: {
      ...baseData,
      word: cleaned,
      sentence: trimmedSentence,
      sentenceTranslation,
    },
  };
}

export async function handleApiRequest(req, res) {
  const parsedUrl = new URL(req.url || '/', 'http://localhost');

  const sendJson = (status, data) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  };

  try {
    if (parsedUrl.pathname === '/api/transcript' && req.method === 'GET') {
      const target = parsedUrl.searchParams.get('url') || parsedUrl.searchParams.get('videoId') || '';
      const result = await getYoutubeTranscript(target);
      return sendJson(result.status, result.body);
    }

    if (parsedUrl.pathname === '/api/translate' && req.method === 'GET') {
      const word = parsedUrl.searchParams.get('word') || '';
      const sentence = parsedUrl.searchParams.get('sentence') || '';
      const result = await translateWord(word, sentence);
      return sendJson(result.status, result.body);
    }

    return false;
  } catch (err) {
    console.error('API Error:', err);
    return sendJson(500, { error: 'Внутрішня помилка сервера. Спробуйте ще раз.' });
  }
}

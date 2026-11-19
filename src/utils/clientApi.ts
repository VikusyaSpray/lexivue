import { SubtitleSegment, VideoTranscript, WordTiming, WordTranslation } from '../types';

const WORD_REGEX = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;

const POS_UK: Record<string, string> = {
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

const clientTranscriptCache = new Map<string, VideoTranscript>();
const clientTranslateCache = new Map<string, WordTranslation>();
const clientSentenceCache = new Map<string, string>();

let invidiousHostsCache: { hosts: string[]; fetchedAt: number } = {
  hosts: ['https://yt.chocolatemoo53.com', 'https://inv.nadeko.net'],
  fetchedAt: 0,
};

export function extractVideoId(input = ''): string | null {
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

function decodeHtmlEntities(text: string): string {
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

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(id);
  }
}

function extractWordSpecs(text: string) {
  const specs: { word: string; norm: string; weight: number }[] = [];
  let match: RegExpExecArray | null;
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

function buildWeightedTimings(text: string, startSec: number, endSec: number): WordTiming[] {
  const specs = extractWordSpecs(text);
  if (specs.length === 0) return [];
  const safeEnd = Math.max(endSec, startSec + 0.35);
  const duration = safeEnd - startSec;
  const totalWeight = specs.reduce((acc, s) => acc + s.weight, 0) || specs.length;

  let cursor = startSec;
  return specs.map((spec, idx) => {
    const share = (spec.weight / totalWeight) * duration;
    const wStart = Number(cursor.toFixed(3));
    const wEnd =
      idx === specs.length - 1
        ? Number(safeEnd.toFixed(3))
        : Number((cursor + share).toFixed(3));
    cursor += share;
    return { start: wStart, end: wEnd };
  });
}

function parseVttTimestamp(raw: string): number {
  const parts = raw.trim().split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return Number(raw) || 0;
}

function extractInlineVttWordTimings(
  line: string,
  cueStart: number,
  cueEnd: number,
  cleanText: string
): WordTiming[] {
  const targetSpecs = extractWordSpecs(cleanText);
  if (targetSpecs.length === 0) return [];

  const tagRegex = /<(\d{2}:\d{2}:\d{2}\.\d{3})>/g;
  const rawWordStarts: number[] = [];
  let lastIdx = 0;
  let currentTime = cueStart;
  let match: RegExpExecArray | null;

  const pushChunk = (chunkText: string, t: number) => {
    const plain = decodeHtmlEntities(chunkText.replace(/<[^>]+>/g, ''));
    if (!plain) return;
    const words = extractWordSpecs(plain);
    for (let i = 0; i < words.length; i++) {
      rawWordStarts.push(t + i * 0.14);
    }
  };

  while ((match = tagRegex.exec(line)) !== null) {
    pushChunk(line.slice(lastIdx, match.index), currentTime);
    currentTime = parseVttTimestamp(match[1]);
    lastIdx = match.index + match[0].length;
  }
  pushChunk(line.slice(lastIdx), currentTime);

  if (rawWordStarts.length !== targetSpecs.length) {
    return buildWeightedTimings(cleanText, cueStart, cueEnd);
  }

  return rawWordStarts.map((wStart, idx) => {
    const nextT = idx < rawWordStarts.length - 1 ? rawWordStarts[idx + 1] : cueEnd;
    const end = Math.max(wStart + 0.07, Math.min(cueEnd, nextT));
    return {
      start: Number(wStart.toFixed(3)),
      end: Number(end.toFixed(3)),
    };
  });
}

function parseVttCaptions(vttText: string): SubtitleSegment[] {
  const blocks = String(vttText || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/);

  const segments: SubtitleSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;

    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;

    const tsMatch = lines[tsIdx].match(
      /(\d{1,2}:\d{2}(?::\d{2})?\.\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?\.\d{3})/
    );
    if (!tsMatch) continue;

    const start = parseVttTimestamp(tsMatch[1]);
    const end = parseVttTimestamp(tsMatch[2]);
    if (end - start <= 0.05) continue;

    const contentLines = lines.slice(tsIdx + 1);
    const inlineTimedLine = contentLines.find((l) => /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(l));

    let text = '';
    let wordTimings: WordTiming[] = [];

    if (inlineTimedLine) {
      text = decodeHtmlEntities(inlineTimedLine.replace(/<[^>]+>/g, ''));
      if (!text) continue;
      wordTimings = extractInlineVttWordTimings(inlineTimedLine, start, end, text);
    } else {
      const cleanedLines = contentLines
        .map((l) => decodeHtmlEntities(l.replace(/<[^>]+>/g, '')))
        .filter(Boolean);
      if (cleanedLines.length === 0) continue;

      const prevText = segments[segments.length - 1]?.text || '';
      const filtered =
        cleanedLines.length > 1 && prevText && cleanedLines[0] === prevText
          ? cleanedLines.slice(1)
          : cleanedLines;

      text = filtered.join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      wordTimings = buildWeightedTimings(text, start, end);
    }

    if (segments.length > 0 && segments[segments.length - 1].text === text) {
      continue;
    }

    segments.push({
      id: segments.length,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      text,
      wordTimings,
    });
  }

  const merged: SubtitleSegment[] = [];
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

async function getInvidiousHosts(): Promise<string[]> {
  const now = Date.now();
  if (now - invidiousHostsCache.fetchedAt < 10 * 60 * 1000) {
    return invidiousHostsCache.hosts;
  }
  const defaults = ['https://yt.chocolatemoo53.com', 'https://inv.nadeko.net'];
  try {
    const res = await fetchWithTimeout('https://api.invidious.io/instances.json', 2500);
    if (res.ok) {
      const list = (await res.json()) as [string, { api?: boolean; type?: string; uri?: string }][];
      const dynamic = list
        .filter(([, info]) => info?.api && info?.type === 'https' && info?.uri)
        .map(([, info]) => String(info.uri).replace(/\/$/, ''));
      const unique = [...new Set([...defaults, ...dynamic])].slice(0, 5);
      invidiousHostsCache = { hosts: unique, fetchedAt: now };
      return unique;
    }
  } catch {
    // keep defaults
  }
  invidiousHostsCache.fetchedAt = now;
  return defaults;
}

async function fetchVideoMetaBrowser(videoId: string): Promise<{ title: string; author: string }> {
  try {
    const res = await fetchWithTimeout(
      `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`,
      3500
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.title) {
        return { title: data.title, author: data.author_name || '' };
      }
    }
  } catch {
    // ignore
  }
  return { title: 'YouTube Video', author: '' };
}

async function fetchTranscriptFromBrowser(videoId: string): Promise<VideoTranscript | null> {
  const [hosts, meta] = await Promise.all([
    getInvidiousHosts(),
    fetchVideoMetaBrowser(videoId),
  ]);

  for (const host of hosts) {
    try {
      const listRes = await fetchWithTimeout(`${host}/api/v1/captions/${videoId}`, 6000);
      if (!listRes.ok) continue;
      const listData = await listRes.json();
      const captions: { label?: string; languageCode?: string; url?: string }[] = Array.isArray(
        listData?.captions
      )
        ? listData.captions
        : [];
      if (captions.length === 0) continue;

      const isAuto = (c: { label?: string }) =>
        String(c.label || '')
          .toLowerCase()
          .includes('auto');

      const candidates = [
        ...captions.filter((c) => c.languageCode === 'en' && !isAuto(c)),
        ...captions.filter(
          (c) => c.languageCode?.startsWith('en') && c.languageCode !== 'en' && !isAuto(c)
        ),
        ...captions.filter((c) => c.languageCode === 'en' && isAuto(c)),
        ...captions.filter(
          (c) => c.languageCode?.startsWith('en') && c.languageCode !== 'en' && isAuto(c)
        ),
        ...captions.slice(0, 1),
      ].filter((c, i, arr) => c?.url && arr.findIndex((x) => x.url === c.url) === i);

      for (const chosen of candidates) {
        try {
          const vttUrl = chosen.url!.startsWith('http')
            ? chosen.url!
            : `${host}${chosen.url}`;
          const vttRes = await fetchWithTimeout(vttUrl, 7000);
          if (!vttRes.ok) continue;
          const vttText = await vttRes.text();
          if (!vttText || vttText.length < 20) continue;

          const segments = parseVttCaptions(vttText);
          if (segments.length === 0) continue;

          return {
            videoId,
            title: meta.title,
            author: meta.author,
            lengthSeconds: 0,
            language: chosen.languageCode || 'en',
            isAutoGenerated: isAuto(chosen),
            segments,
          };
        } catch {
          // try next candidate
        }
      }
    } catch {
      // try next host
    }
  }

  return null;
}

async function fetchTranscriptFromServer(urlOrId: string): Promise<VideoTranscript | null> {
  try {
    const res = await fetchWithTimeout(
      `/api/transcript?url=${encodeURIComponent(urlOrId.trim())}`,
      8000
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data && Array.isArray(data.segments) && data.segments.length > 0) {
      return data as VideoTranscript;
    }
    return null;
  } catch {
    return null;
  }
}

function isLocalhostEnv(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.');
}

export async function fetchTranscriptSmart(urlOrId: string): Promise<VideoTranscript> {
  const videoId = extractVideoId(urlOrId);
  if (!videoId) {
    throw new Error('Некоректне посилання на YouTube. Перевірте URL і спробуйте ще раз.');
  }

  const cached = clientTranscriptCache.get(videoId);
  if (cached) return cached;

  let result: VideoTranscript | null = null;

  if (isLocalhostEnv()) {
    // Locally our server fetches directly from YouTube with full ASR word-level alignment
    result = await fetchTranscriptFromServer(urlOrId);
    if (!result) {
      result = await fetchTranscriptFromBrowser(videoId);
    }
  } else {
    // In production (Vercel), fetch directly from user's residential IP via CORS-enabled Invidious
    // in parallel with our server API so ANY YouTube video works reliably without datacenter IP blocks!
    const browserPromise = fetchTranscriptFromBrowser(videoId);
    const serverPromise = fetchTranscriptFromServer(urlOrId);

    const [browserRes, serverRes] = await Promise.all([browserPromise, serverPromise]);
    result = serverRes || browserRes;
  }

  if (!result) {
    throw new Error(
      'Не вдалося завантажити субтитри для цього відео. Перевірте, чи увімкнені субтитри на YouTube, або спробуйте інше відео.'
    );
  }

  clientTranscriptCache.set(videoId, result);
  return result;
}

async function fetchDictionaryMetaBrowser(word: string): Promise<{ phonetic: string; audio: string }> {
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

async function googleTranslateBrowser(text: string, includeDict: boolean) {
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: 'uk',
    q: text,
  });
  let url = `https://translate.googleapis.com/translate_a/single?${params.toString()}&dt=t`;
  if (includeDict) url += '&dt=bd';
  const res = await fetchWithTimeout(url, 4500);
  if (!res.ok) throw new Error('Google Translate failed');
  return res.json();
}

async function myMemoryTranslateBrowser(text: string): Promise<string> {
  const res = await fetchWithTimeout(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|uk`,
    4500
  );
  if (!res.ok) return '';
  const data = await res.json();
  return String(data?.responseData?.translatedText || '').trim();
}

export async function translateWordSmart(
  rawWord: string,
  sentence = ''
): Promise<WordTranslation> {
  const cleaned = String(rawWord || '')
    .trim()
    .replace(/^[^a-zA-Z'-]+|[^a-zA-Z'-]+$/g, '');

  if (!cleaned) {
    throw new Error('Слово не вказано.');
  }

  const lower = cleaned.toLowerCase();
  let baseData = clientTranslateCache.get(lower);

  if (!baseData) {
    // Try direct browser Google Translate + Free Dictionary (runs on user's residential IP!)
    const [gtResult, dictMeta] = await Promise.all([
      googleTranslateBrowser(cleaned, true).catch(() => null),
      fetchDictionaryMetaBrowser(lower),
    ]);

    let mainTranslation = Array.isArray(gtResult?.[0])
      ? gtResult[0].map((part: [string]) => part?.[0] || '').join('').trim()
      : '';

    const alternatives: string[] = [];
    let partOfSpeech = '';
    let partOfSpeechUk = '';

    if (Array.isArray(gtResult?.[1])) {
      for (const group of gtResult[1]) {
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

    if (!mainTranslation) {
      // Fallback to server API, then MyMemory
      try {
        const params = new URLSearchParams({ word: cleaned, sentence });
        const srvRes = await fetchWithTimeout(`/api/translate?${params.toString()}`, 4500);
        if (srvRes.ok) {
          const srvData = (await srvRes.json()) as WordTranslation;
          clientTranslateCache.set(lower, srvData);
          return srvData;
        }
      } catch {
        // continue to MyMemory
      }
      mainTranslation = await myMemoryTranslateBrowser(cleaned).catch(() => '');
    }

    if (!mainTranslation) {
      throw new Error('Не вдалося отримати переклад. Перевірте підключення.');
    }

    baseData = {
      word: cleaned,
      normalized: lower,
      translation: mainTranslation,
      alternatives,
      partOfSpeech,
      partOfSpeechUk,
      phonetic: dictMeta.phonetic,
      audio: dictMeta.audio,
    };

    clientTranslateCache.set(lower, baseData);
  }

  let sentenceTranslation = '';
  const trimmedSentence = String(sentence || '').trim();
  if (trimmedSentence && trimmedSentence.length <= 400) {
    if (clientSentenceCache.has(trimmedSentence)) {
      sentenceTranslation = clientSentenceCache.get(trimmedSentence)!;
    } else {
      try {
        const sentData = await googleTranslateBrowser(trimmedSentence, false);
        sentenceTranslation = Array.isArray(sentData?.[0])
          ? sentData[0].map((part: [string]) => part?.[0] || '').join('').trim()
          : '';
      } catch {
        sentenceTranslation = await myMemoryTranslateBrowser(trimmedSentence).catch(() => '');
      }
      if (sentenceTranslation) {
        clientSentenceCache.set(trimmedSentence, sentenceTranslation);
      }
    }
  }

  return {
    ...baseData,
    word: cleaned,
    sentence: trimmedSentence,
    sentenceTranslation,
  };
}

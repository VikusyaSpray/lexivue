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

  // Map every decoded character to its exact inline timestamp so contractions/hyphens
  // crossing <c> tags never break word count alignment
  const tagRegex = /<(\d{2}:\d{2}:\d{2}\.\d{3})>|<[^>]+>/g;
  let plain = '';
  const charTimes: number[] = [];
  let currentTime = cueStart;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  const appendPiece = (rawPiece: string, t: number) => {
    if (!rawPiece) return;
    const decoded = rawPiece
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
      .replace(/\u200b/g, '');
    for (let i = 0; i < decoded.length; i++) {
      plain += decoded[i];
      charTimes.push(t);
    }
  };

  while ((match = tagRegex.exec(line)) !== null) {
    appendPiece(line.slice(lastIdx, match.index), currentTime);
    if (match[1]) {
      currentTime = parseVttTimestamp(match[1]);
    }
    lastIdx = match.index + match[0].length;
  }
  appendPiece(line.slice(lastIdx), currentTime);

  const rawWordStarts: number[] = [];
  WORD_REGEX.lastIndex = 0;
  let wm: RegExpExecArray | null;
  while ((wm = WORD_REGEX.exec(plain)) !== null) {
    rawWordStarts.push(charTimes[wm.index] ?? cueStart);
  }

  if (rawWordStarts.length !== targetSpecs.length) {
    return buildWeightedTimings(cleanText, cueStart, cueEnd);
  }

  return rawWordStarts.map((wStart, idx) => {
    const nextT = idx < rawWordStarts.length - 1 ? rawWordStarts[idx + 1] : cueEnd;
    const end = Math.max(wStart + 0.06, Math.min(cueEnd, nextT));
    return {
      start: Number(wStart.toFixed(3)),
      end: Number(end.toFixed(3)),
    };
  });
}

function normalizeForDupCheck(str: string): string {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSoundTagOnly(text: string): boolean {
  return /^(?:\[[^\]]+\]|\([^)]+\)|♪[\s♪]*♪?|\s)+$/.test(String(text || '').trim());
}

const DANGLING_END_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as',
  'into', 'onto', 'about', 'up', 'out', 'off', 'over', 'through', 'under', 'than',
  'and', 'or', 'but', 'that', 'which', 'who', 'whose', 'where', 'when', 'while',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might',
  'not', "don't", "doesn't", "didn't", "won't", "can't", "couldn't", "shouldn't",
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'these', 'those',
  'very', 'so', 'too', 'quite', 'pretty', 'kind', 'sort', 'no', 'matter',
  'take', 'takes', 'took', 'make', 'makes', 'made', 'give', 'gives', 'gave',
  'get', 'gets', 'got', 'put', 'set', 'go', 'goes', 'went', 'come', 'comes', 'came',
  'look', 'looks', 'looked', 'turn', 'turns', 'turned', 'break', 'breaks', 'broke',
  'figure', 'figures', 'figured', 'end', 'ends', 'ended', 'keep', 'keeps', 'kept',
  'bring', 'carry', 'hold', 'pick', 'run', 'work', 'check', 'hang', 'point', 'find',
  'catch', 'show', 'grow', 'wake', 'call', 'cut', 'pay', 'fall', 'deal', 'watch',
]);

function endsWithDanglingWord(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed || /[.!?,;:]$/.test(trimmed)) return false;
  const lastToken = trimmed.split(/\s+/).pop() || '';
  const norm = lastToken
    .replace(/’/g, "'")
    .replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '')
    .toLowerCase();
  return DANGLING_END_WORDS.has(norm);
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

      const prevNorm = normalizeForDupCheck(segments[segments.length - 1]?.text || '');
      const firstNorm = normalizeForDupCheck(cleanedLines[0]);
      const isRepeatedTopLine =
        cleanedLines.length > 1 &&
        prevNorm &&
        firstNorm &&
        (prevNorm === firstNorm || prevNorm.endsWith(firstNorm));

      const filtered = isRepeatedTopLine ? cleanedLines.slice(1) : cleanedLines;

      text = filtered.join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const wordCount = extractWordSpecs(text).length;
      const effectiveEnd =
        wordCount > 0 && wordCount <= 3 && end - start > 3.5
          ? Math.min(end, start + Math.max(1.4, wordCount * 0.7))
          : end;
      wordTimings = buildWeightedTimings(text, start, effectiveEnd);
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

  // Clamp overlapping cue ends so consecutive cues never fight for activeIndex
  for (let i = 0; i < segments.length - 1; i++) {
    const cur = segments[i];
    const next = segments[i + 1];
    if (next.start > cur.start && cur.end > next.start) {
      cur.end = Number(next.start.toFixed(2));
      if (cur.wordTimings && cur.wordTimings.length > 0) {
        cur.wordTimings = cur.wordTimings.map((wt) => ({
          start: Math.min(wt.start, cur.end),
          end: Math.min(wt.end, cur.end),
        }));
      }
    }
  }

  const merged: SubtitleSegment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    const prevWords = prev ? prev.text.split(/\s+/).length : 0;
    const curWords = seg.text.split(/\s+/).length;
    const gap = prev ? seg.start - prev.end : 99;
    const prevEndsSentence = prev ? /[.!?]["'”)\]]*$/.test(prev.text.trim()) : true;
    const danglingSplit = prev ? endsWithDanglingWord(prev.text) : false;
    const soundBoundary = isSoundTagOnly(seg.text) || (prev && isSoundTagOnly(prev.text));

    if (
      prev &&
      !soundBoundary &&
      !prevEndsSentence &&
      gap < 0.75 &&
      prevWords + curWords <= 15 &&
      seg.end - prev.start <= 6.8 &&
      (prevWords <= 4 || curWords <= 3 || danglingSplit)
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

interface AsrWord {
  norm: string;
  start: number;
  end: number;
}

function extractAsrWordStreamFromVtt(vttText: string): AsrWord[] {
  const segs = parseVttCaptions(vttText);
  const words: AsrWord[] = [];
  for (const seg of segs) {
    const specs = extractWordSpecs(seg.text);
    const timings = seg.wordTimings || [];
    for (let i = 0; i < specs.length; i++) {
      const wt = timings[i];
      if (!wt) continue;
      words.push({ norm: specs[i].norm, start: wt.start, end: wt.end });
    }
  }
  return words;
}

function alignSegmentsWithAsr(segments: SubtitleSegment[], asrWords: AsrWord[]): SubtitleSegment[] {
  if (!asrWords || asrWords.length === 0) return segments;
  let asrCursor = 0;

  return segments.map((seg) => {
    const specs = extractWordSpecs(seg.text);
    if (specs.length === 0) return { ...seg, wordTimings: [] };

    const winStart = seg.start - 0.65;
    const winEnd = seg.end + 0.65;

    while (asrCursor > 0 && asrWords[asrCursor - 1].start >= winStart) asrCursor--;
    while (asrCursor < asrWords.length && asrWords[asrCursor].start < winStart) asrCursor++;

    const matchedStarts: (number | null)[] = new Array(specs.length).fill(null);
    let localPos = asrCursor;
    let lastMatchedTime = seg.start;

    for (let i = 0; i < specs.length; i++) {
      const targetNorm = specs[i].norm;
      const lookahead = targetNorm.length <= 2 ? 3 : 6;
      const searchLimit = Math.min(asrWords.length, localPos + lookahead);
      for (let j = localPos; j < searchLimit; j++) {
        if (asrWords[j].start > winEnd) break;
        if (asrWords[j].start - lastMatchedTime > 2.8) break;
        const cand = asrWords[j].norm;
        if (
          cand === targetNorm ||
          (cand.length >= 4 &&
            targetNorm.length >= 4 &&
            (cand.startsWith(targetNorm) || targetNorm.startsWith(cand)))
        ) {
          const clamped = Math.max(seg.start - 0.3, Math.min(seg.end + 0.1, asrWords[j].start));
          matchedStarts[i] = clamped;
          lastMatchedTime = clamped;
          localPos = j + 1;
          break;
        }
      }
    }

    if (matchedStarts.every((v) => v === null)) {
      return {
        ...seg,
        wordTimings: seg.wordTimings?.length
          ? seg.wordTimings
          : buildWeightedTimings(seg.text, seg.start, seg.end),
      };
    }

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
      const gapEndIdx = i;

      const leftTime =
        gapStartIdx > 0 && starts[gapStartIdx - 1] !== null
          ? (starts[gapStartIdx - 1] as number) + 0.12
          : seg.start;
      const rightTime =
        gapEndIdx < starts.length && starts[gapEndIdx] !== null
          ? (starts[gapEndIdx] as number)
          : safeEnd;

      const span = Math.max(0.06 * (gapEndIdx - gapStartIdx), rightTime - leftTime);
      let gapWeight = 0;
      for (let k = gapStartIdx; k < gapEndIdx; k++) gapWeight += specs[k].weight;

      let cur = leftTime;
      for (let k = gapStartIdx; k < gapEndIdx; k++) {
        starts[k] = cur;
        cur += (specs[k].weight / (gapWeight || 1)) * span;
      }
    }

    const wordTimings: WordTiming[] = (starts as number[]).map((st, idx) => {
      const clampedStart = Number(Math.min(st, safeEnd - 0.05).toFixed(3));
      const nextSt =
        idx < starts.length - 1 ? Math.min(starts[idx + 1] as number, safeEnd) : safeEnd;
      const clampedEnd = Number(Math.max(clampedStart + 0.05, nextSt).toFixed(3));
      return { start: clampedStart, end: clampedEnd };
    });

    asrCursor = Math.max(asrCursor, localPos - 2);
    return { ...seg, wordTimings };
  });
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
        /auto|автомат/i.test(String(c.label || ''));

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

      const asrCandidate = captions.find(
        (c) => c.languageCode?.startsWith('en') && isAuto(c) && c.url
      );

      for (const chosen of candidates) {
        try {
          const vttUrl = chosen.url!.startsWith('http')
            ? chosen.url!
            : `${host}${chosen.url}`;
          const chosenIsAuto = isAuto(chosen);

          // When loading manual captions, fetch ASR track in parallel to align exact word timings!
          const asrPromise =
            !chosenIsAuto && asrCandidate && asrCandidate.url !== chosen.url
              ? fetchWithTimeout(
                  asrCandidate.url!.startsWith('http')
                    ? asrCandidate.url!
                    : `${host}${asrCandidate.url}`,
                  5000
                )
                  .then((r) => (r.ok ? r.text() : ''))
                  .then((txt) => (txt && txt.length > 20 ? extractAsrWordStreamFromVtt(txt) : null))
                  .catch(() => null)
              : Promise.resolve(null);

          const [vttRes, asrWords] = await Promise.all([
            fetchWithTimeout(vttUrl, 7000),
            asrPromise,
          ]);
          if (!vttRes.ok) continue;
          const vttText = await vttRes.text();
          if (!vttText || vttText.length < 20) continue;

          let segments = parseVttCaptions(vttText);
          if (segments.length === 0) continue;

          if (asrWords && asrWords.length > 0) {
            segments = alignSegmentsWithAsr(segments, asrWords);
          }

          return {
            videoId,
            title: meta.title,
            author: meta.author,
            lengthSeconds: 0,
            language: chosen.languageCode || 'en',
            isAutoGenerated: chosenIsAuto,
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
    if (serverRes && browserRes) {
      // Always prefer clean manual English captions over auto-generated captions
      const serverManualEn = !serverRes.isAutoGenerated && serverRes.language.startsWith('en');
      const browserManualEn = !browserRes.isAutoGenerated && browserRes.language.startsWith('en');
      result = browserManualEn && !serverManualEn ? browserRes : serverRes;
    } else {
      result = serverRes || browserRes;
    }
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
  if (includeDict) url += '&dt=at&dt=bd';
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
  const translated = String(data?.responseData?.translatedText || '').trim();
  if (!translated || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translated)) return '';
  return translated;
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
  const trimmedSentence = String(sentence || '').replace(/\s+/g, ' ').trim().slice(0, 460);
  const cacheKey = `${lower}::${trimmedSentence}`;

  const cached = clientTranslateCache.get(cacheKey);
  if (cached) {
    return { ...cached, word: cleaned };
  }

  // Primary: call our server /api/translate (uses contextual AI model when configured,
  // or smart POS-aware dictionary + idiom detector).
  try {
    const params = new URLSearchParams({ word: cleaned, sentence: trimmedSentence });
    const srvRes = await fetchWithTimeout(`/api/translate?${params.toString()}`, 7500);
    if (srvRes.ok) {
      const srvData = (await srvRes.json()) as WordTranslation;
      if (srvData && srvData.translation) {
        clientTranslateCache.set(cacheKey, srvData);
        return srvData;
      }
    }
  } catch {
    // fall back to direct browser translation if server is temporarily unreachable
  }

  // Fallback: direct browser lookup using lowercase query + neural dt=at alternatives
  const lookupQuery =
    cleaned.length >= 2 && cleaned === cleaned.toUpperCase() ? cleaned : lower;

  const [gtResult, dictMeta] = await Promise.all([
    googleTranslateBrowser(lookupQuery, true).catch(() => null),
    fetchDictionaryMetaBrowser(lower),
  ]);

  let mainTranslation = Array.isArray(gtResult?.[0])
    ? gtResult[0].map((part: [string]) => part?.[0] || '').join('').trim()
    : '';

  const alternatives: string[] = [];
  const pushAlt = (term: unknown) => {
    if (typeof term !== 'string') return;
    const t = term.trim();
    if (!t || t.toLowerCase() === mainTranslation.toLowerCase()) return;
    if (alternatives.some((a) => a.toLowerCase() === t.toLowerCase())) return;
    if (alternatives.length < 4) alternatives.push(t);
  };

  // Prefer neural-ranked dt=at alternatives over raw alphabetical dt=bd
  const atEntries = gtResult?.[5]?.[0]?.[2];
  if (Array.isArray(atEntries)) {
    for (const entry of atEntries) {
      pushAlt(entry?.[0]);
    }
  }

  let partOfSpeech = '';
  let partOfSpeechUk = '';
  const dictGroups = Array.isArray(gtResult?.[1]) ? gtResult[1] : [];
  if (dictGroups.length > 0) {
    const mainLower = mainTranslation.toLowerCase();
    const matchedGroup =
      dictGroups.find(
        (g: [string, string[]]) =>
          Array.isArray(g?.[1]) &&
          g[1].some((t) => typeof t === 'string' && t.toLowerCase() === mainLower)
      ) || dictGroups[0];

    const pos = String(matchedGroup?.[0] || '').toLowerCase();
    if (pos) {
      partOfSpeech = pos;
      partOfSpeechUk = POS_UK[pos] || pos;
    }
    const terms = Array.isArray(matchedGroup?.[1]) ? matchedGroup[1] : [];
    for (const term of terms) {
      if (alternatives.length >= 3) break;
      pushAlt(term);
    }
  }

  if (!mainTranslation) {
    mainTranslation = await myMemoryTranslateBrowser(lookupQuery).catch(() => '');
  }

  if (!mainTranslation) {
    throw new Error('Не вдалося отримати переклад. Перевірте підключення.');
  }

  let sentenceTranslation = '';
  if (trimmedSentence) {
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

  const result: WordTranslation = {
    word: cleaned,
    normalized: lower,
    translation: mainTranslation,
    alternatives,
    partOfSpeech,
    partOfSpeechUk,
    phonetic: dictMeta.phonetic,
    audio: dictMeta.audio,
    sentence: trimmedSentence,
    sentenceTranslation,
    provider: 'dictionary',
  };

  clientTranslateCache.set(cacheKey, result);
  return result;
}

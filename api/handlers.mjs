import { translateWordEnhanced } from './translator.mjs';

const transcriptCache = new Map();

// Words that strongly indicate a phrase/idiom continues onto the next subtitle cue
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

function endsWithDanglingWord(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || /[.!?,;:]$/.test(trimmed)) return false;
  const lastToken = trimmed.split(/\s+/).pop() || '';
  const norm = lastToken.replace(/’/g, "'").replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '').toLowerCase();
  return DANGLING_END_WORDS.has(norm);
}

function isSoundTagOnly(text) {
  return /^(?:\[[^\]]+\]|\([^)]+\)|♪[\s♪]*♪?|\s)+$/.test(String(text || '').trim());
}

function mergeSubtitleFragments(segments) {
  // First clamp overlapping ends so consecutive cues never fight for activeIndex
  const normalized = segments.map((s) => ({ ...s }));
  for (let i = 0; i < normalized.length - 1; i++) {
    const cur = normalized[i];
    const next = normalized[i + 1];
    if (next.start > cur.start && cur.end > next.start) {
      cur.end = Number(next.start.toFixed(2));
      if (Array.isArray(cur.wordTimings) && cur.wordTimings.length > 0) {
        cur.wordTimings = cur.wordTimings.map((wt) => ({
          start: Math.min(wt.start, cur.end),
          end: Math.min(wt.end, cur.end),
        }));
      }
    }
  }

  const merged = [];
  for (const seg of normalized) {
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

function extractJsonArrayAt(str, keyToken) {
  const idx = str.indexOf(keyToken);
  if (idx === -1) return null;
  const sub = str.slice(idx + keyToken.length);
  if (sub[0] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < sub.length; i++) {
    const ch = sub[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(sub.slice(0, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

async function fetchWatchPagePlayerData(videoId) {
  try {
    const res = await fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}&hl=en`, 4500, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const tracks = extractJsonArrayAt(html, '"captionTracks":');
    if (!tracks || tracks.length === 0) return null;

    const titleMatch = html.match(/"videoDetails":\{.*?"title":"((?:[^"\\]|\\.)*)"/);
    const authorMatch = html.match(/"videoDetails":\{.*?"author":"((?:[^"\\]|\\.)*)"/);
    const lenMatch = html.match(/"videoDetails":\{.*?"lengthSeconds":"(\d+)"/);

    const unescapeJsonStr = (s) => {
      try {
        return JSON.parse(`"${s}"`);
      } catch {
        return s;
      }
    };

    return {
      title: titleMatch ? unescapeJsonStr(titleMatch[1]) : 'YouTube Video',
      author: authorMatch ? unescapeJsonStr(authorMatch[1]) : '',
      lengthSeconds: lenMatch ? Number(lenMatch[1]) : 0,
      tracks,
    };
  } catch {
    return null;
  }
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
      const res = await fetchWithTimeout('https://www.youtube.com/youtubei/v1/player', 3500, {
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
    } catch {
      // try next client
    }
  }

  return fetchWatchPagePlayerData(videoId);
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

    const winStart = seg.start - 0.65;
    const winEnd = seg.end + 0.65;

    // Advance cursor to window start (keeping slight lookback)
    while (asrCursor > 0 && asrWords[asrCursor - 1].start >= winStart) {
      asrCursor--;
    }
    while (asrCursor < asrWords.length && asrWords[asrCursor].start < winStart) {
      asrCursor++;
    }

    const matchedStarts = new Array(specs.length).fill(null);
    let localPos = asrCursor;
    let lastMatchedTime = seg.start;

    for (let i = 0; i < specs.length; i++) {
      const targetNorm = specs[i].norm;
      // Shorter stopwords get tighter lookahead so they don't jump ahead falsely
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

      const leftTime =
        gapStartIdx > 0 && starts[gapStartIdx - 1] !== null
          ? starts[gapStartIdx - 1] + 0.12
          : seg.start;
      const rightTime =
        gapEndIdx < starts.length && starts[gapEndIdx] !== null
          ? starts[gapEndIdx]
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

    // Build monotonically non-decreasing [start, end] pairs strictly bounded by safeEnd
    const wordTimings = starts.map((st, idx) => {
      const clampedStart = Number(Math.min(st, safeEnd - 0.05).toFixed(3));
      const nextSt =
        idx < starts.length - 1 ? Math.min(starts[idx + 1], safeEnd) : safeEnd;
      const clampedEnd = Number(Math.max(clampedStart + 0.05, nextSt).toFixed(3));
      return { start: clampedStart, end: clampedEnd };
    });

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
    if (nextStartMs && nextStartMs > startMs && durationMs > nextStartMs - startMs) {
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

  return mergeSubtitleFragments(segments);
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

function parseVttTimestamp(raw) {
  const parts = raw.trim().split(':');
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  return Number(raw) || 0;
}

function extractInlineVttWordTimings(line, cueStart, cueEnd, cleanText) {
  const targetSpecs = extractWordSpecs(cleanText);
  if (targetSpecs.length === 0) return [];

  // Map every character of the decoded text to its exact inline timestamp so contractions/hyphens
  // crossing <c> tags never break word count alignment!
  const tagRegex = /<(\d{2}:\d{2}:\d{2}\.\d{3})>|<[^>]+>/g;
  let plain = '';
  const charTimes = [];
  let currentTime = cueStart;
  let lastIdx = 0;
  let match;

  const appendPiece = (rawPiece, t) => {
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

  const rawWordStarts = [];
  WORD_REGEX.lastIndex = 0;
  let wm;
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

function normalizeForDupCheck(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseVttCaptions(vttText) {
  const blocks = String(vttText || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/);

  const segments = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;

    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;

    const tsLine = lines[tsIdx];
    const tsMatch = tsLine.match(
      /(\d{1,2}:\d{2}(?::\d{2})?\.\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?\.\d{3})/
    );
    if (!tsMatch) continue;

    const start = parseVttTimestamp(tsMatch[1]);
    const end = parseVttTimestamp(tsMatch[2]);
    // Skip 10ms YouTube rolling transition cues
    if (end - start <= 0.05) continue;

    const contentLines = lines.slice(tsIdx + 1);
    const inlineTimedLine = contentLines.find((l) => /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(l));

    let text = '';
    let wordTimings = [];

    if (inlineTimedLine) {
      text = decodeHtmlEntities(inlineTimedLine.replace(/<[^>]+>/g, ''));
      if (!text) continue;
      wordTimings = extractInlineVttWordTimings(inlineTimedLine, start, end, text);
    } else {
      const cleanedLines = contentLines
        .map((l) => decodeHtmlEntities(l.replace(/<[^>]+>/g, '')))
        .filter(Boolean);
      if (cleanedLines.length === 0) continue;

      // Avoid repeating the previous rolling line (exact or suffix match)
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
      // Avoid stretching a single short word across 8 seconds of silence/applause
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

  return mergeSubtitleFragments(segments);
}

function extractAsrWordStreamFromVtt(vttText) {
  const segs = parseVttCaptions(vttText);
  const words = [];
  for (const seg of segs) {
    const specs = extractWordSpecs(seg.text);
    const timings = seg.wordTimings || [];
    for (let i = 0; i < specs.length; i++) {
      const wt = timings[i];
      if (!wt) continue;
      words.push({
        norm: specs[i].norm,
        start: wt.start,
        end: wt.end,
      });
    }
  }
  return words;
}

async function fetchOembedMeta(videoId) {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      3000
    );
    if (!res.ok) return { title: 'YouTube Video', author: '' };
    const data = await res.json();
    return {
      title: data?.title || 'YouTube Video',
      author: data?.author_name || '',
    };
  } catch {
    return { title: 'YouTube Video', author: '' };
  }
}

let invidiousHostsCache = {
  hosts: ['https://yt.chocolatemoo53.com', 'https://inv.nadeko.net'],
  fetchedAt: 0,
};

async function getInvidiousHosts() {
  const now = Date.now();
  if (now - invidiousHostsCache.fetchedAt < 10 * 60 * 1000) {
    return invidiousHostsCache.hosts;
  }
  const defaults = ['https://yt.chocolatemoo53.com', 'https://inv.nadeko.net'];
  try {
    const res = await fetchWithTimeout('https://api.invidious.io/instances.json', 2500);
    if (res.ok) {
      const list = await res.json();
      const dynamic = list
        .filter(([, info]) => info?.api && info?.type === 'https' && info?.uri)
        .map(([, info]) => String(info.uri).replace(/\/$/, ''));
      const unique = [...new Set([...defaults, ...dynamic])].slice(0, 6);
      invidiousHostsCache = { hosts: unique, fetchedAt: now };
      return unique;
    }
  } catch {
    // keep defaults
  }
  invidiousHostsCache.fetchedAt = now;
  return defaults;
}

async function fetchViaInvidious(videoId) {
  const [hosts, meta] = await Promise.all([getInvidiousHosts(), fetchOembedMeta(videoId)]);

  for (const host of hosts) {
    try {
      const listRes = await fetchWithTimeout(`${host}/api/v1/captions/${videoId}`, 4000);
      if (!listRes.ok) continue;
      const listData = await listRes.json();
      const captions = Array.isArray(listData?.captions) ? listData.captions : [];
      if (captions.length === 0) continue;

      // Only accept English tracks — never silently load a wrong-language auto-generated track (e.g. Vietnamese on an English video!)
      const isAuto = (c) => /auto|автомат/i.test(String(c.label || ''));
      const candidates = [
        ...captions.filter((c) => c.languageCode === 'en' && !isAuto(c)),
        ...captions.filter((c) => c.languageCode?.startsWith('en') && c.languageCode !== 'en' && !isAuto(c)),
        ...captions.filter((c) => c.languageCode === 'en' && isAuto(c)),
        ...captions.filter((c) => c.languageCode?.startsWith('en') && c.languageCode !== 'en' && isAuto(c)),
      ].filter((c, i, arr) => c?.url && arr.findIndex((x) => x.url === c.url) === i);

      if (candidates.length === 0) {
        const availableLabels = captions
          .map((c) => c.label || c.languageCode)
          .filter(Boolean)
          .slice(0, 3);
        return { noEnglishTrack: true, availableLabels };
      }

      const asrCandidate = captions.find(
        (c) => c.languageCode?.startsWith('en') && isAuto(c) && c.url
      );

      for (const chosen of candidates) {
        try {
          const vttUrl = chosen.url.startsWith('http') ? chosen.url : `${host}${chosen.url}`;
          const chosenIsAuto = isAuto(chosen);

          const asrPromise =
            !chosenIsAuto && asrCandidate && asrCandidate.url !== chosen.url
              ? fetchWithTimeout(
                  asrCandidate.url.startsWith('http') ? asrCandidate.url : `${host}${asrCandidate.url}`,
                  4500
                )
                  .then((r) => (r.ok ? r.text() : ''))
                  .then((txt) => (txt && txt.length > 20 ? extractAsrWordStreamFromVtt(txt) : null))
                  .catch(() => null)
              : Promise.resolve(null);

          const [vttRes, asrWords] = await Promise.all([
            fetchWithTimeout(vttUrl, 6000),
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

async function fetchViaSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) return null;

  try {
    const [res, meta] = await Promise.all([
      fetchWithTimeout(
        `https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&lang=en`,
        5000,
        { headers: { 'x-api-key': apiKey } }
      ),
      fetchOembedMeta(videoId),
    ]);
    if (!res.ok) return null;
    const data = await res.json();
    const content = Array.isArray(data?.content) ? data.content : [];
    if (content.length === 0) return null;

    const segments = content
      .map((item, idx) => {
        const start = Number(((item.offset || 0) / 1000).toFixed(2));
        const end = Number((((item.offset || 0) + (item.duration || 2500)) / 1000).toFixed(2));
        const text = decodeHtmlEntities(String(item.text || ''));
        if (!text) return null;
        return {
          id: idx,
          start,
          end,
          text,
          wordTimings: buildWeightedTimings(text, start, end),
        };
      })
      .filter(Boolean);

    if (segments.length === 0) return null;
    return {
      videoId,
      title: meta.title,
      author: meta.author,
      lengthSeconds: 0,
      language: data.lang || 'en',
      isAutoGenerated: false,
      segments,
    };
  } catch {
    return null;
  }
}

async function fetchDirectYoutubeTranscript(videoId) {
  const playerData = await fetchPlayerData(videoId);
  if (!playerData || !playerData.tracks || playerData.tracks.length === 0) {
    return null;
  }

  const { title, author, lengthSeconds, tracks } = playerData;

  // Pick manual English first, then English auto-generated — never silently load a wrong-language track!
  const chosenTrack =
    tracks.find((t) => t.languageCode === 'en' && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
    tracks.find((t) => t.languageCode === 'en') ||
    tracks.find((t) => t.languageCode?.startsWith('en'));

  if (!chosenTrack) {
    const availableLabels = tracks
      .map((t) => t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode)
      .filter(Boolean)
      .slice(0, 3);
    return { noEnglishTrack: true, availableLabels };
  }

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
          const res = await fetchWithTimeout(asrUrl.toString(), 4000, { headers: fetchHeaders });
          if (!res.ok) return null;
          const json = await res.json();
          return extractAsrWordStream(json);
        } catch {
          return null;
        }
      })()
    : Promise.resolve(null);

  const [capRes, asrWordStream] = await Promise.all([
    fetchWithTimeout(captionUrl.toString(), 4500, { headers: fetchHeaders }),
    asrPromise,
  ]);

  if (!capRes.ok) return null;

  const rawText = await capRes.text();
  if (!rawText || rawText.length < 10) return null;

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

  if (segments.length === 0) return null;

  if (asrWordStream && asrWordStream.length > 0) {
    segments = alignSegmentsWithAsr(segments, asrWordStream);
  }

  return {
    videoId,
    title,
    author,
    lengthSeconds,
    language: chosenTrack.languageCode || 'en',
    isAutoGenerated: chosenTrack.kind === 'asr',
    segments,
  };
}

export async function getYoutubeTranscript(urlOrId) {
  const videoId = extractVideoId(urlOrId);
  if (!videoId) {
    return { status: 400, body: { error: 'Некоректне посилання на YouTube. Перевірте URL і спробуйте ще раз.' } };
  }

  if (transcriptCache.has(videoId)) {
    return { status: 200, body: transcriptCache.get(videoId) };
  }

  let payload = null;
  let noEnglishInfo = null;

  const pickValid = (res) => {
    if (!res) return null;
    if (res.noEnglishTrack) {
      if (!noEnglishInfo) noEnglishInfo = res;
      return null;
    }
    return res;
  };

  if (process.env.VERCEL) {
    // On cloud/Vercel IPs, race direct YouTube and Invidious fallback in parallel for fast response
    const [directRaw, invRaw] = await Promise.all([
      fetchDirectYoutubeTranscript(videoId).catch(() => null),
      fetchViaInvidious(videoId).catch(() => null),
    ]);
    const directRes = pickValid(directRaw);
    const invRes = pickValid(invRaw);
    if (directRes && invRes) {
      payload = !invRes.isAutoGenerated && directRes.isAutoGenerated ? invRes : directRes;
    } else {
      payload = directRes || invRes;
    }
  } else {
    payload = pickValid(await fetchDirectYoutubeTranscript(videoId).catch(() => null));
    if (!payload) {
      payload = pickValid(await fetchViaInvidious(videoId).catch(() => null));
    }
  }

  if (!payload && !noEnglishInfo) {
    payload = await fetchViaSupadata(videoId).catch(() => null);
  }

  if (!payload && noEnglishInfo) {
    const labels = (noEnglishInfo.availableLabels || []).join(', ');
    return {
      status: 422,
      body: {
        error: labels
          ? `У цього відео на YouTube немає англійських субтитрів (доступні лише: ${labels}). Сам YouTube неправильно визначив мову відео — спробуйте інше відео з англійськими субтитрами.`
          : 'У цього відео на YouTube немає англійських субтитрів. Спробуйте інше відео з англійськими субтитрами.',
      },
    };
  }

  if (!payload) {
    return {
      status: 404,
      body: {
        error:
          'Не вдалося завантажити субтитри з YouTube для цього відео. Перевірте, чи є в нього англійські субтитри, або спробуйте інше відео.',
      },
    };
  }

  transcriptCache.set(videoId, payload);
  return { status: 200, body: payload };
}

async function fetchWithTimeout(url, timeoutMs = 3000, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

export async function translateWord(rawWord, sentence = '') {
  return translateWordEnhanced(rawWord, sentence);
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

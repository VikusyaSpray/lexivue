import type {
  PrefetchedIdiom,
  PrefetchedWordEntry,
  SubtitleSegment,
  VideoPrefetchChunk,
  WordTranslation,
} from '../types';
import { buildContextSentenceAroundSegment } from './text';

const STORAGE_KEY = 'lexivue_tr_cache_v1';
const MAX_WORD_CACHE = 400;
const MAX_SENTENCE_CACHE = 600;
const MAX_CHUNK_WORDS = 900;
const MAX_IDIOM_VIDEOS = 40;

interface PersistentCacheStore {
  words: Record<string, WordTranslation>;
  sentences: Record<string, string>;
  chunkWords: Record<string, PrefetchedWordEntry>;
  idioms: Record<string, PrefetchedIdiom[]>;
  doneChunks: Record<string, number[]>;
}

let store: PersistentCacheStore | null = null;
let saveTimer: number | null = null;
const inFlightChunks = new Set<string>();

function normalizeSentenceKey(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStore(): PersistentCacheStore {
  if (store) return store;
  const empty: PersistentCacheStore = {
    words: {},
    sentences: {},
    chunkWords: {},
    idioms: {},
    doneChunks: {},
  };
  if (typeof window === 'undefined') {
    store = empty;
    return store;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      store = empty;
      return store;
    }
    const parsed = JSON.parse(raw) as Partial<PersistentCacheStore>;
    store = {
      words: parsed?.words && typeof parsed.words === 'object' ? parsed.words : {},
      sentences: parsed?.sentences && typeof parsed.sentences === 'object' ? parsed.sentences : {},
      chunkWords: parsed?.chunkWords && typeof parsed.chunkWords === 'object' ? parsed.chunkWords : {},
      idioms: parsed?.idioms && typeof parsed.idioms === 'object' ? parsed.idioms : {},
      doneChunks: parsed?.doneChunks && typeof parsed.doneChunks === 'object' ? parsed.doneChunks : {},
    };
  } catch {
    store = empty;
  }
  return store;
}

function trimObjectLru<T>(obj: Record<string, T>, maxKeys: number) {
  const keys = Object.keys(obj);
  if (keys.length <= maxKeys) return;
  const removeCount = keys.length - maxKeys;
  for (let i = 0; i < removeCount; i++) {
    delete obj[keys[i]];
  }
}

function schedulePersist() {
  if (typeof window === 'undefined' || !store) return;
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    if (!store) return;
    try {
      trimObjectLru(store.words, MAX_WORD_CACHE);
      trimObjectLru(store.sentences, MAX_SENTENCE_CACHE);
      trimObjectLru(store.chunkWords, MAX_CHUNK_WORDS);
      trimObjectLru(store.idioms, MAX_IDIOM_VIDEOS);
      trimObjectLru(store.doneChunks, MAX_IDIOM_VIDEOS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // ignore storage quota errors
    }
  }, 400);
}

export function savePersistentWordTranslation(
  lower: string,
  sentence: string,
  data: WordTranslation
) {
  const s = getStore();
  const key = `${lower}::${normalizeSentenceKey(sentence)}`;
  // Re-insert so it stays freshest in key order
  delete s.words[key];
  s.words[key] = data;

  if (sentence && data.sentenceTranslation) {
    const sk = normalizeSentenceKey(sentence);
    if (sk) {
      delete s.sentences[sk];
      s.sentences[sk] = data.sentenceTranslation;
    }
  }
  schedulePersist();
}

export function findSentenceTranslationInCache(sentence: string): string {
  const sk = normalizeSentenceKey(sentence);
  if (!sk) return '';
  const s = getStore();
  if (s.sentences[sk]) return s.sentences[sk];

  // Fallback: match when reconstructed sentence slightly contains or is contained by a prefetched sentence
  if (sk.length >= 24) {
    for (const [k, val] of Object.entries(s.sentences)) {
      if (k.length >= 24 && (k === sk || k.includes(sk) || sk.includes(k))) {
        return val;
      }
    }
  }
  return '';
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findIdiomForWordInVideo(
  videoId: string | undefined,
  sentence: string,
  clickedWord: string
): PrefetchedIdiom | null {
  if (!videoId || !sentence || !clickedWord) return null;
  const s = getStore();
  const list = s.idioms[videoId];
  if (!list || list.length === 0) return null;

  const sentLower = sentence.toLowerCase().replace(/’/g, "'");
  const targetLower = clickedWord.toLowerCase().replace(/’/g, "'");
  const wordRe = new RegExp(`\\b${escapeRegExp(targetLower)}\\b`, 'i');

  for (const idiom of list) {
    const phraseLower = idiom.phrase.toLowerCase().replace(/’/g, "'");
    if (!wordRe.test(phraseLower)) continue;
    if (sentLower.includes(phraseLower)) {
      return idiom;
    }
  }
  return null;
}

export interface InstantLookupHit {
  data: WordTranslation;
  needsDictMeta: boolean;
}

export function lookupInstantTranslation(
  rawWord: string,
  sentence: string,
  videoId?: string
): InstantLookupHit | null {
  const cleaned = String(rawWord || '')
    .trim()
    .replace(/^[^a-zA-Z'-]+|[^a-zA-Z'-]+$/g, '');
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  const trimmedSentence = String(sentence || '').replace(/\s+/g, ' ').trim().slice(0, 460);
  const s = getStore();

  // 1. Exact hit in persistent word cache (0 ms!)
  const exactKey = `${lower}::${normalizeSentenceKey(trimmedSentence)}`;
  const cachedExact = s.words[exactKey];
  if (cachedExact && cachedExact.translation) {
    const idiom = !cachedExact.phrase
      ? findIdiomForWordInVideo(videoId, trimmedSentence, cleaned)
      : null;
    const data: WordTranslation = {
      ...cachedExact,
      word: cleaned,
      sentence: trimmedSentence,
      phrase: cachedExact.phrase || idiom?.phrase || '',
      phraseTranslation: cachedExact.phraseTranslation || idiom?.translation || '',
      phraseNote: cachedExact.phraseNote || idiom?.note || '',
      sentenceTranslation:
        cachedExact.sentenceTranslation || findSentenceTranslationInCache(trimmedSentence),
    };
    return { data, needsDictMeta: !data.phonetic || !data.audio };
  }

  // 2. Hit in prefetched video chunk mini-base (0 ms!)
  if (videoId) {
    const wordEntry = s.chunkWords[`${videoId}::${lower}`];
    if (wordEntry && wordEntry.tr) {
      const sentTr = findSentenceTranslationInCache(trimmedSentence);
      const idiom = findIdiomForWordInVideo(videoId, trimmedSentence, cleaned);

      // Only treat as complete instant hit if we either have no sentence OR already have its translation
      if (!trimmedSentence || sentTr) {
        const data: WordTranslation = {
          word: cleaned,
          normalized: lower,
          translation: wordEntry.tr,
          alternatives: wordEntry.alts || [],
          partOfSpeech: '',
          partOfSpeechUk: wordEntry.pos || '',
          phonetic: '',
          audio: '',
          phrase: idiom?.phrase || '',
          phraseTranslation: idiom?.translation || '',
          phraseNote: idiom?.note || '',
          sentence: trimmedSentence,
          sentenceTranslation: sentTr,
          provider: 'ai',
        };
        return { data, needsDictMeta: true };
      }
    }
  }

  return null;
}

export function getPrefetchedIdiomsForVideo(videoId?: string): string[] {
  if (!videoId) return [];
  const s = getStore();
  const list = s.idioms[videoId] || [];
  return list.map((x) => x.phrase);
}

export function getPrefetchedChunkCount(videoId?: string): number {
  if (!videoId) return 0;
  const s = getStore();
  return (s.doneChunks[videoId] || []).length;
}

/**
 * Splits a video's subtitle segments into lazy ~2.3-minute chunks (max 20 sentences each),
 * reconstructing full sentences across subtitle timecodes so idioms stay intact.
 */
export function buildVideoPrefetchChunks(segments: SubtitleSegment[]): VideoPrefetchChunk[] {
  if (!segments.length) return [];

  const CHUNK_DURATION_SEC = 140;
  const MAX_SENTENCES_PER_CHUNK = 18;

  const chunks: VideoPrefetchChunk[] = [];
  let curSentences: { id: number; text: string }[] = [];
  const seenInChunk = new Set<string>();
  let chunkStartSec = segments[0].start;
  let chunkEndSec = segments[0].end;
  let globalSentenceId = 0;

  const flushChunk = () => {
    if (curSentences.length === 0) return;
    chunks.push({
      chunkIndex: chunks.length,
      startSec: chunkStartSec,
      endSec: chunkEndSec,
      sentences: curSentences,
    });
    curSentences = [];
    seenInChunk.clear();
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const firstWordMatch = seg.text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/);
    if (!firstWordMatch) continue;

    const fullSentence = buildContextSentenceAroundSegment(segments, i, firstWordMatch[0], 0);
    const norm = normalizeSentenceKey(fullSentence);
    if (!norm || norm.split(' ').length < 2) continue;

    if (curSentences.length === 0) {
      chunkStartSec = seg.start;
    }

    if (!seenInChunk.has(norm)) {
      seenInChunk.add(norm);
      curSentences.push({ id: globalSentenceId++, text: fullSentence });
    }
    chunkEndSec = seg.end;

    const reachedDuration = seg.end - chunkStartSec >= CHUNK_DURATION_SEC;
    const reachedCount = curSentences.length >= MAX_SENTENCES_PER_CHUNK;
    if (reachedDuration || reachedCount) {
      flushChunk();
    }
  }

  flushChunk();
  return chunks;
}

export async function prefetchVideoChunkIfNeeded(
  videoId: string,
  chunk: VideoPrefetchChunk,
  onUpdated?: () => void
): Promise<boolean> {
  if (!videoId || !chunk || chunk.sentences.length === 0) return false;

  const s = getStore();
  const doneList = s.doneChunks[videoId] || [];
  if (doneList.includes(chunk.chunkIndex)) {
    return true;
  }

  const flightKey = `${videoId}#${chunk.chunkIndex}`;
  if (inFlightChunks.has(flightKey)) return false;
  inFlightChunks.add(flightKey);

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 11000);
    let res: Response;
    try {
      res = await fetch('/api/prefetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentences: chunk.sentences }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }

    if (!res.ok) return false;
    const data = (await res.json()) as {
      provider?: string;
      sentences?: Record<string, string>;
      idioms?: PrefetchedIdiom[];
      words?: Record<string, PrefetchedWordEntry>;
    };

    let changed = false;

    // Store sentence translations indexed by normalized English sentence
    if (data.sentences && typeof data.sentences === 'object') {
      for (const sent of chunk.sentences) {
        const uk = data.sentences[String(sent.id)];
        if (typeof uk === 'string' && uk.trim()) {
          const sk = normalizeSentenceKey(sent.text);
          if (sk) {
            s.sentences[sk] = uk.trim();
            changed = true;
          }
        }
      }
    }

    // Store detected idioms for this video
    if (Array.isArray(data.idioms) && data.idioms.length > 0) {
      const existing = s.idioms[videoId] || [];
      for (const item of data.idioms) {
        if (
          item?.phrase &&
          item?.translation &&
          !existing.some((x) => x.phrase.toLowerCase() === item.phrase.toLowerCase())
        ) {
          existing.push(item);
          changed = true;
        }
      }
      s.idioms[videoId] = existing;
    }

    // Store prefetched key words for this video
    if (data.words && typeof data.words === 'object') {
      for (const [wordKey, entry] of Object.entries(data.words)) {
        const lower = wordKey.trim().toLowerCase();
        if (!lower || !entry?.tr) continue;
        s.chunkWords[`${videoId}::${lower}`] = {
          tr: entry.tr,
          alts: Array.isArray(entry.alts) ? entry.alts : [],
          pos: entry.pos || '',
        };
        changed = true;
      }
    }

    if (data.provider === 'ai') {
      s.doneChunks[videoId] = [...new Set([...doneList, chunk.chunkIndex])];
      changed = true;
    }

    if (changed) {
      schedulePersist();
      onUpdated?.();
    }
    return data.provider === 'ai';
  } catch {
    return false;
  } finally {
    inFlightChunks.delete(flightKey);
  }
}

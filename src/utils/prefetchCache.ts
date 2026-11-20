import type {
  PrefetchedIdiom,
  PrefetchedWordEntry,
  SubtitleSegment,
  VideoPrefetchChunk,
  WordTranslation,
} from '../types';
import { buildContextSentenceAroundSegment } from './text';

const STORAGE_KEY = 'lexivue_tr_cache_v2';
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

// Instant built-in translations for basic English stopwords/function words that batch AI
// intentionally skips to save tokens — so clicking ANY word in a prefetched chunk is 0 ms!
const INSTANT_BASIC_WORDS: Record<string, PrefetchedWordEntry> = {
  the: { tr: 'цей, той (артикль)', alts: ['означений артикль'], pos: 'артикль' },
  a: { tr: 'один, якийсь (артикль)', alts: ['неозначений артикль'], pos: 'артикль' },
  an: { tr: 'один, якийсь (артикль)', alts: ['неозначений артикль'], pos: 'артикль' },
  is: { tr: 'є', alts: ['знаходиться', 'являється'], pos: 'дієслово' },
  are: { tr: 'є', alts: ['знаходяться'], pos: 'дієслово' },
  was: { tr: 'був, була, було', alts: ['знаходився'], pos: 'дієслово' },
  were: { tr: 'були', alts: ['знаходилися'], pos: 'дієслово' },
  am: { tr: 'є (я є)', alts: ['знаходжуся'], pos: 'дієслово' },
  be: { tr: 'бути', alts: ['існувати', 'знаходитися'], pos: 'дієслово' },
  been: { tr: 'був, бував', alts: ['перебував'], pos: 'дієслово' },
  being: { tr: 'будучи', alts: ['істота', 'буття'], pos: 'дієслово' },
  to: { tr: 'до, в, щоб', alts: ['на', 'для'], pos: 'прийменник' },
  of: { tr: 'з, із, про', alts: ['від', 'серед'], pos: 'прийменник' },
  in: { tr: 'в, у', alts: ['всередині', 'через'], pos: 'прийменник' },
  on: { tr: 'на', alts: ['у', 'по', 'про'], pos: 'прийменник' },
  at: { tr: 'у, в, біля', alts: ['на', 'о (годині)'], pos: 'прийменник' },
  for: { tr: 'для, за', alts: ['протягом', 'на'], pos: 'прийменник' },
  with: { tr: 'з, із', alts: ['разом з', 'за допомогою'], pos: 'прийменник' },
  from: { tr: 'з, від', alts: ['із', 'починаючи з'], pos: 'прийменник' },
  by: { tr: 'біля, через, за', alts: ['до (часу)', 'за допомогою'], pos: 'прийменник' },
  as: { tr: 'як, оскільки', alts: ['коли', 'у ролі'], pos: 'сполучник' },
  into: { tr: 'в, у (всередину)', alts: ['на'], pos: 'прийменник' },
  about: { tr: 'про', alts: ['приблизно', 'навколо'], pos: 'прийменник' },
  and: { tr: 'і, та, й', alts: ['а'], pos: 'сполучник' },
  or: { tr: 'або, чи', alts: ['інакше'], pos: 'сполучник' },
  but: { tr: 'але', alts: ['однак', 'проте', 'крім'], pos: 'сполучник' },
  if: { tr: 'якщо', alts: ['чи', 'коли'], pos: 'сполучник' },
  so: { tr: 'отже, тому', alts: ['так', 'настільки'], pos: 'сполучник' },
  that: { tr: 'що, той', alts: ['який', 'це'], pos: 'сполучник' },
  this: { tr: 'це, цей', alts: ['ця', 'ось це'], pos: 'займенник' },
  these: { tr: 'ці', alts: ['ось ці'], pos: 'займенник' },
  those: { tr: 'ті', alts: ['он ті'], pos: 'займенник' },
  i: { tr: 'я', alts: [], pos: 'займенник' },
  you: { tr: 'ти, ви', alts: ['тебе', 'вас'], pos: 'займенник' },
  he: { tr: 'він', alts: [], pos: 'займенник' },
  she: { tr: 'вона', alts: [], pos: 'займенник' },
  it: { tr: 'воно, це', alts: ['його', 'її'], pos: 'займенник' },
  we: { tr: 'ми', alts: [], pos: 'займенник' },
  they: { tr: 'вони', alts: [], pos: 'займенник' },
  me: { tr: 'мене, мені', alts: ['мною'], pos: 'займенник' },
  him: { tr: 'його, йому', alts: ['ним'], pos: 'займенник' },
  her: { tr: 'її, їй', alts: ['нею'], pos: 'займенник' },
  us: { tr: 'нас, нам', alts: ['нами'], pos: 'займенник' },
  them: { tr: 'їх, їм', alts: ['ними'], pos: 'займенник' },
  my: { tr: 'мій, моя, моє', alts: ['свій'], pos: 'займенник' },
  your: { tr: 'твій, ваш', alts: ['твоя', 'ваша'], pos: 'займенник' },
  his: { tr: 'його', alts: ['свій'], pos: 'займенник' },
  its: { tr: 'його, її', alts: ['свій'], pos: 'займенник' },
  our: { tr: 'наш, наша', alts: ['наше', 'наші'], pos: 'займенник' },
  their: { tr: 'їхній', alts: ['їхня', 'їхнє'], pos: 'займенник' },
  do: { tr: 'робити', alts: ['виконувати', 'допоміжне дієслово'], pos: 'дієслово' },
  does: { tr: 'робить', alts: ['допоміжне дієслово'], pos: 'дієслово' },
  did: { tr: 'робив, зробив', alts: ['допоміжне дієслово'], pos: 'дієслово' },
  have: { tr: 'мати', alts: ['володіти', 'допоміжне дієслово'], pos: 'дієслово' },
  has: { tr: 'має', alts: ['володіє'], pos: 'дієслово' },
  had: { tr: 'мав, мала', alts: ['допоміжне дієслово'], pos: 'дієслово' },
  not: { tr: 'не', alts: ['ні'], pos: 'частка' },
  no: { tr: 'ні, жодного', alts: ['немає'], pos: 'частка' },
  yes: { tr: 'так', alts: ['авжеж'], pos: 'частка' },
  will: { tr: 'буде', alts: ['воля', 'бажання'], pos: 'допоміжне дієслово' },
  would: { tr: 'би (умовний спосіб)', alts: ['було б', 'раніше'], pos: 'модальне дієслово' },
  can: { tr: 'може', alts: ['вміє', 'можна'], pos: 'модальне дієслово' },
  could: { tr: 'міг би', alts: ['міг', 'можна було б'], pos: 'модальне дієслово' },
  should: { tr: 'повинен, слід', alts: ['варто', 'мав би'], pos: 'модальне дієслово' },
  must: { tr: 'повинен, мусить', alts: ['обов’язково', 'напевно'], pos: 'модальне дієслово' },
  may: { tr: 'може, можливо', alts: ['дозвольте', 'травень'], pos: 'модальне дієслово' },
  might: { tr: 'можливо', alts: ['міг би', 'може'], pos: 'модальне дієслово' },
  what: { tr: 'що, який', alts: ['яка', 'яке'], pos: 'займенник' },
  when: { tr: 'коли', alts: ['у той час як'], pos: 'прислівник' },
  where: { tr: 'де, куди', alts: ['звідки'], pos: 'прислівник' },
  which: { tr: 'який, котрий', alts: ['що'], pos: 'займенник' },
  who: { tr: 'хто', alts: ['який', 'котрий'], pos: 'займенник' },
  why: { tr: 'чому', alts: ['навіщо'], pos: 'прислівник' },
  how: { tr: 'як', alts: ['наскільки'], pos: 'прислівник' },
  there: { tr: 'там, туди', alts: ['ось'], pos: 'прислівник' },
  here: { tr: 'тут, сюди', alts: ['ось'], pos: 'прислівник' },
  then: { tr: 'тоді, потім', alts: ['далі', 'отже'], pos: 'прислівник' },
  than: { tr: 'ніж', alts: ['аніж'], pos: 'сполучник' },
  just: { tr: 'просто', alts: ['щойно', 'лише', 'саме'], pos: 'прислівник' },
  very: { tr: 'дуже', alts: ['надзвичайно', 'самий'], pos: 'прислівник' },
  also: { tr: 'також', alts: ['теж', 'крім того'], pos: 'прислівник' },
  only: { tr: 'тільки, лише', alts: ['єдиний'], pos: 'прислівник' },
  some: { tr: 'деякі, трохи', alts: ['кілька', 'якийсь'], pos: 'займенник' },
  any: { tr: 'будь-який', alts: ['якийсь', 'жоден'], pos: 'займенник' },
  all: { tr: 'все, всі', alts: ['весь', 'цілком'], pos: 'займенник' },
  both: { tr: 'обидва, обидві', alts: ['як ... так і'], pos: 'займенник' },
  each: { tr: 'кожен', alts: ['кожна', 'кожне'], pos: 'займенник' },
  more: { tr: 'більше', alts: ['ще', 'більш'], pos: 'прислівник' },
  most: { tr: 'найбільше, більшість', alts: ['найбільш'], pos: 'прислівник' },
  much: { tr: 'багато', alts: ['значно', 'дуже'], pos: 'прислівник' },
  many: { tr: 'багато', alts: ['численні', 'чимало'], pos: 'займенник' },
  such: { tr: 'такий', alts: ['подібний'], pos: 'займенник' },
  too: { tr: 'теж, надто', alts: ['також', 'занадто'], pos: 'прислівник' },
  now: { tr: 'зараз, тепер', alts: ['нині'], pos: 'прислівник' },
  up: { tr: 'вгору', alts: ['нагорі', 'догори'], pos: 'прислівник' },
  out: { tr: 'назовні', alts: ['поза', 'з', 'геть'], pos: 'прислівник' },
  off: { tr: 'геть, вимкнено', alts: ['з', 'від'], pos: 'прислівник' },
  over: { tr: 'над, через', alts: ['понад', 'закінчено'], pos: 'прийменник' },
  down: { tr: 'вниз', alts: ['унизу', 'донизу'], pos: 'прислівник' },
  back: { tr: 'назад', alts: ['спина', 'повернутися'], pos: 'прислівник' },
  because: { tr: 'тому що', alts: ['оскільки', 'бо'], pos: 'сполучник' },
  before: { tr: 'до, перед', alts: ['раніше', 'перш ніж'], pos: 'прийменник' },
  after: { tr: 'після', alts: ['потім', 'за'], pos: 'прийменник' },
  while: { tr: 'поки, тоді як', alts: ['під час', 'деякий час'], pos: 'сполучник' },
  "i'm": { tr: 'я є (I am)', alts: ['я'], pos: 'скорочення' },
  "you're": { tr: 'ти є, ви є (you are)', alts: [], pos: 'скорочення' },
  "it's": { tr: 'це є (it is)', alts: ['воно є'], pos: 'скорочення' },
  "that's": { tr: 'ось це, це є (that is)', alts: [], pos: 'скорочення' },
  "there's": { tr: 'там є (there is)', alts: [], pos: 'скорочення' },
  "don't": { tr: 'не (do not)', alts: [], pos: 'скорочення' },
  "doesn't": { tr: 'не (does not)', alts: [], pos: 'скорочення' },
  "didn't": { tr: 'не (did not)', alts: [], pos: 'скорочення' },
  "won't": { tr: 'не буде (will not)', alts: [], pos: 'скорочення' },
  "can't": { tr: 'не може (cannot)', alts: ['не можна'], pos: 'скорочення' },
  "i've": { tr: 'я маю / зробив (I have)', alts: [], pos: 'скорочення' },
  "we're": { tr: 'ми є (we are)', alts: [], pos: 'скорочення' },
  "they're": { tr: 'вони є (they are)', alts: [], pos: 'скорочення' },
};

export function findSentenceTranslationInCache(sentence: string): string {
  const sk = normalizeSentenceKey(sentence);
  if (!sk) return '';
  const s = getStore();
  if (s.sentences[sk]) return s.sentences[sk];

  // Fallback 1: substring match (handles slight punctuation/boundary differences)
  if (sk.length >= 16) {
    for (const [k, val] of Object.entries(s.sentences)) {
      if (k.length >= 16 && (k === sk || k.includes(sk) || sk.includes(k))) {
        return val;
      }
    }
  }

  // Fallback 2: word-overlap match for unpunctuated auto-captions where the 24-word window shifts!
  const skWords = sk.split(' ').filter((w) => w.length >= 3);
  if (skWords.length >= 5) {
    const skSet = new Set(skWords);
    let bestScore = 0;
    let bestVal = '';
    for (const [k, val] of Object.entries(s.sentences)) {
      const kWords = k.split(' ').filter((w) => w.length >= 3);
      if (kWords.length < 4) continue;
      let shared = 0;
      for (const w of kWords) {
        if (skSet.has(w)) shared++;
      }
      const denom = Math.min(skSet.size, new Set(kWords).size);
      const score = denom > 0 ? shared / denom : 0;
      if (score >= 0.58 && score > bestScore) {
        bestScore = score;
        bestVal = val;
      }
    }
    if (bestVal) return bestVal;
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
    const sentTr = findSentenceTranslationInCache(trimmedSentence);
    const idiom = findIdiomForWordInVideo(videoId, trimmedSentence, cleaned);
    const wordEntry =
      s.chunkWords[`${videoId}::${lower}`] ||
      (sentTr ? INSTANT_BASIC_WORDS[lower] : undefined);

    if (wordEntry && wordEntry.tr) {
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

  const CHUNK_DURATION_SEC = 90;
  const MAX_SENTENCES_PER_CHUNK = 10;

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
    const wordMatches = [...seg.text.matchAll(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g)];
    if (wordMatches.length === 0) continue;

    // Sample first word AND last word of each segment so multi-sentence segments
    // (e.g. "That's it. No big deal.") get EVERY sentence included in the prefetch chunk!
    const sampleIndices = wordMatches.length > 3 ? [0, wordMatches.length - 1] : [0];

    for (const wIdx of sampleIndices) {
      const fullSentence = buildContextSentenceAroundSegment(
        segments,
        i,
        wordMatches[wIdx][0],
        wIdx
      );
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
    const timer = window.setTimeout(() => controller.abort(), 18000);
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

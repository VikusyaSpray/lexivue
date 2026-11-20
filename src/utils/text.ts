import type { SubtitleSegment } from '../types';

export interface TextToken {
  text: string;
  isWord: boolean;
  normalized: string;
}

export function tokenizeText(text: string): TextToken[] {
  const parts = text.split(/([A-Za-z]+(?:['’-][A-Za-z]+)*)/g);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      const isWord = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(part);
      return {
        text: part,
        isWord,
        normalized: isWord ? part.replace(/’/g, "'").toLowerCase() : '',
      };
    });
}

export function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const READING_NOISE_TAG_RE = /\[[^\]]*\]|\((?:laughter|applause|music|cheering|sighs|inaudible|crosstalk)\)|♪+/gi;

const NO_BREAK_AFTER_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as',
  'into', 'onto', 'about', 'through', 'under', 'over', 'between', 'among', 'than',
  'before', 'after', 'during', 'without', 'within', 'against', 'toward', 'towards',
  'and', 'or', 'but', 'nor', 'if', 'when', 'while', 'where', 'that', 'which', 'who',
  'whose', 'whom', 'because', 'since', 'unless', 'until', 'although', 'though',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'these', 'those', 'i',
  'very', 'so', 'too', 'quite', 'really', 'just', 'not', "don't", "doesn't", "didn't",
  "won't", "can't", "couldn't", "wouldn't", "shouldn't", "isn't", "aren't", "wasn't", "weren't",
  'no', 'some', 'any', 'every', 'each', 'all', 'both', 'many', 'much', 'more', 'most',
  'uh', 'um', 'er', 'ah', 'thank', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'first', 'second', 'third', 'next', 'last', 'another', 'other',
]);

// Words that almost never start a brand-new standalone sentence after a mid-clause pause
const NO_SENTENCE_START_WORDS = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as', 'into', 'onto', 'about',
  'out', 'up', 'off', 'down', 'away', 'back', 'over', 'through', 'than',
  'who', 'whom', 'whose', 'which', 'that', 'and', 'or', 'but', 'nor',
]);

// Particles / prepositions that should never have a comma inserted immediately before them
const NO_COMMA_BEFORE_WORDS = new Set([
  'out', 'up', 'off', 'down', 'in', 'on', 'at', 'to', 'of', 'for', 'from', 'by', 'with',
  'into', 'onto', 'over', 'away', 'back', 'about', 'than', 'is', 'are', 'was', 'were',
  'you', 'me', 'him', 'her', 'us', 'them', 'it',
]);

const CONJUNCTION_COMMA_BEFORE = new Set([
  'but', 'however', 'although', 'though', 'whereas', 'which',
]);

const CONTINUATION_CONJUNCTIONS = new Set([
  'and', 'but', 'or', 'so', 'because', 'although', 'though', 'which', 'while', 'whereas', 'unless', 'until',
]);

const SENTENCE_STARTERS = new Set([
  'i', "i'm", "i've", "i'll", "i'd", 'you', "you're", "you've", "you'll", 'we', "we're", "we've",
  'they', "they're", 'he', "he's", 'she', "she's", 'it', "it's", 'this', 'that', "that's",
  'there', "there's", 'here', "here's", 'now', 'then', 'so', 'well', 'today', 'yesterday',
  'tomorrow', 'actually', 'basically', 'honestly', 'however', 'therefore', 'meanwhile',
  'first', 'second', 'third', 'finally', 'next', 'please', 'thank', 'thanks', 'welcome',
  'what', "what's", 'why', 'how', 'where', 'when', 'who', 'do', 'did', 'does', 'can', 'could',
  'would', 'will', 'have', 'has', 'are', 'is', 'let', "let's", 'imagine', 'think', 'remember',
  'look', 'listen', 'wait', 'okay', 'yes', 'no', 'never', 'always', 'sometimes', 'everyone',
]);

const INTRO_SINGLE_COMMA = new Set([
  'actually', 'basically', 'honestly', 'frankly', 'obviously', 'apparently', 'fortunately',
  'unfortunately', 'personally', 'generally', 'typically', 'normally', 'usually', 'interestingly',
  'surprisingly', 'importantly', 'meanwhile', 'however', 'therefore', 'furthermore', 'moreover',
  'instead', 'otherwise', 'finally', 'eventually', 'suddenly', 'first', 'second', 'third',
  'well', 'okay', 'anyway', 'anyways', 'wait', 'listen',
]);

const PROPER_NOUN_MAP: Record<string, string> = {
  i: 'I',
  "i'm": "I'm",
  "i've": "I've",
  "i'll": "I'll",
  "i'd": "I'd",
  english: 'English',
  ukrainian: 'Ukrainian',
  american: 'American',
  british: 'British',
  youtube: 'YouTube',
  google: 'Google',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  netflix: 'Netflix',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
  january: 'January',
  february: 'February',
  april: 'April',
  june: 'June',
  july: 'July',
  august: 'August',
  september: 'September',
  october: 'October',
  november: 'November',
  december: 'December',
};

function cleanReadingSegmentText(text: string): string {
  return text
    .replace(READING_NOISE_TAG_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function transcriptNeedsPunctuation(segments: SubtitleSegment[]): boolean {
  if (!segments.length) return false;
  let totalWords = 0;
  let punctCount = 0;
  for (const seg of segments) {
    const cleaned = cleanReadingSegmentText(seg.text);
    if (!cleaned) continue;
    totalWords += cleaned.split(/\s+/).length;
    const matches = cleaned.match(/[.!?,;:]/g);
    if (matches) punctCount += matches.length;
  }
  if (totalWords < 12) return false;
  // Auto-generated YouTube captions typically have ~0 punctuation marks across hundreds of words
  return punctCount / totalWords < 0.025;
}

function capitalizeToken(word: string): string {
  if (!word) return word;
  return word.replace(/^([^A-Za-z]*)([a-z])/, (_, prefix, ch) => prefix + ch.toUpperCase());
}

function fixTokenCapitalization(word: string): string {
  const norm = word.replace(/’/g, "'").toLowerCase();
  if (PROPER_NOUN_MAP[norm]) return PROPER_NOUN_MAP[norm];
  return word;
}

function isLikelyQuestion(sentenceWords: string[]): boolean {
  if (sentenceWords.length < 3 || sentenceWords.length > 26) return false;
  const w0 = sentenceWords[0].replace(/’/g, "'").toLowerCase().replace(/[^a-z']/g, '');
  const w1 = (sentenceWords[1] || '').replace(/’/g, "'").toLowerCase().replace(/[^a-z']/g, '');
  const last = sentenceWords[sentenceWords.length - 1]
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/[^a-z']/g, '');

  if (last === 'right' && sentenceWords.length >= 4) return true;

  const auxVerbs = new Set([
    'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'will',
    'should', 'have', 'has', 'had', "don't", "doesn't", "didn't", "isn't", "aren't", "won't", "can't",
  ]);
  const whStarters = new Set(['what', "what's", 'why', 'how', 'where', 'when', 'who', "who's", 'which']);
  const subjPronouns = new Set(['you', 'we', 'they', 'he', 'she', 'it', 'i', 'this', 'that', 'there']);

  if (whStarters.has(w0) && (auxVerbs.has(w1) || w0.endsWith("'s") || (w0 === 'how' && ['many', 'much', 'long', 'far', 'often', 'come', 'about'].includes(w1)))) {
    return true;
  }
  if (auxVerbs.has(w0) && subjPronouns.has(w1)) {
    return true;
  }
  return false;
}

function applyPostPunctuationPolish(paragraph: string): string {
  let out = paragraph;

  // Multi-word discourse expressions at start of sentence -> add comma after them
  out = out.replace(
    /(^|[.!?]\s+)(By the way|In fact|For example|For instance|Of course|On the other hand|At the end of the day|First of all|After all|To be honest|As a result|Truth be told|Believe it or not|In other words|You know|I mean)(?!,)\s+(?=[A-Za-z])/g,
    '$1$2, '
  );

  // Single-word sentence-initial discourse adverbs -> add comma if followed by subject/clause
  out = out.replace(
    /(^|[.!?]\s+)([A-Z][a-z]+)\s+(?=(?:I|I'm|I've|I'll|I'd|you|we|they|he|she|it|this|that|there|here|the|a|an|my|our|your|in|if|when)\b)/g,
    (match, prefix, word) => {
      if (INTRO_SINGLE_COMMA.has(word.toLowerCase())) {
        return `${prefix}${word}, `;
      }
      return match;
    }
  );

  // Clean up any accidental double punctuation or stray spaces before punctuation
  out = out
    .replace(/\s+([.!?,;:])/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/([.!?]){2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  // Ensure every sentence starts with a capital letter
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, p, ch) => p + ch.toUpperCase());

  // Ensure paragraph ends with terminal punctuation
  if (out && !/[.!?]["'”)\]]*$/.test(out)) {
    out += '.';
  }

  return out;
}

interface TimedReadingWord {
  text: string;
  norm: string;
  start: number;
  end: number;
}

function buildPunctuatedParagraphsFromAsr(segments: SubtitleSegment[]): string[] {
  // Flatten all spoken words with their real timestamps from segments + wordTimings
  const stream: TimedReadingWord[] = [];

  for (const seg of segments) {
    const cleaned = cleanReadingSegmentText(seg.text);
    if (!cleaned) continue;

    const rawTokens = cleaned.split(/\s+/).filter(Boolean);
    const wordTimings = seg.wordTimings || [];
    let wtIdx = 0;

    for (let i = 0; i < rawTokens.length; i++) {
      const tok = rawTokens[i];
      const hasAlpha = /[A-Za-z]/.test(tok);
      const fracStart = seg.start + (i / rawTokens.length) * Math.max(0.2, seg.end - seg.start);
      const fracEnd = seg.start + ((i + 1) / rawTokens.length) * Math.max(0.2, seg.end - seg.start);

      let wStart = fracStart;
      let wEnd = fracEnd;
      if (hasAlpha && wtIdx < wordTimings.length) {
        wStart = wordTimings[wtIdx].start;
        wEnd = wordTimings[wtIdx].end;
        // Advance wtIdx by how many WORD_REGEX tokens this whitespace token contains (e.g. "stanford.edu" has 2)
        const subCount = (tok.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
        wtIdx += Math.max(1, subCount);
      }

      const fixed = fixTokenCapitalization(tok);
      stream.push({
        text: fixed,
        norm: fixed.replace(/’/g, "'").replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, '').toLowerCase(),
        start: wStart,
        end: wEnd,
      });
    }
  }

  if (stream.length === 0) return [];

  const paragraphs: string[] = [];
  let curParagraphTokens: string[] = [];
  let curSentenceWords: string[] = [];
  let paragraphWordCount = 0;
  let wordsSinceComma = 0;

  const finalizeSentence = (mark?: '.' | '?') => {
    if (curSentenceWords.length === 0) return;
    const endMark = mark || (isLikelyQuestion(curSentenceWords) ? '?' : '.');
    const lastIdx = curSentenceWords.length - 1;
    curSentenceWords[0] = capitalizeToken(curSentenceWords[0]);
    if (!/[.!?]$/.test(curSentenceWords[lastIdx])) {
      curSentenceWords[lastIdx] = curSentenceWords[lastIdx].replace(/[,;:]+$/, '') + endMark;
    }
    curParagraphTokens.push(...curSentenceWords);
    curSentenceWords = [];
    wordsSinceComma = 0;
  };

  const flushParagraph = () => {
    finalizeSentence();
    if (curParagraphTokens.length > 0) {
      paragraphs.push(applyPostPunctuationPolish(curParagraphTokens.join(' ')));
      curParagraphTokens = [];
      paragraphWordCount = 0;
    }
  };

  for (let i = 0; i < stream.length; i++) {
    const cur = stream[i];
    const next = i + 1 < stream.length ? stream[i + 1] : null;

    // Add comma BEFORE contrastive conjunctions like "but", "however", "although", "which"
    if (
      curSentenceWords.length >= 5 &&
      wordsSinceComma >= 4 &&
      CONJUNCTION_COMMA_BEFORE.has(cur.norm) &&
      !NO_BREAK_AFTER_WORDS.has(
        curSentenceWords[curSentenceWords.length - 1]
          .replace(/’/g, "'")
          .replace(/[^a-z']/gi, '')
          .toLowerCase()
      ) &&
      !/[,;:.!?]$/.test(curSentenceWords[curSentenceWords.length - 1])
    ) {
      curSentenceWords[curSentenceWords.length - 1] += ',';
      wordsSinceComma = 0;
    }

    curSentenceWords.push(cur.text);
    paragraphWordCount++;
    wordsSinceComma++;

    if (!next) break;

    // Estimate true acoustic silence after `cur` (inter-onset interval minus estimated spoken duration)
    const interOnsetGap = Math.max(0, next.start - cur.start);
    const spokenEst = Math.min(0.62, 0.13 + cur.norm.length * 0.046);
    const silenceAfter = Math.max(0, interOnsetGap - spokenEst);

    const canBreakAfterCur =
      cur.norm.length > 0 &&
      !NO_BREAK_AFTER_WORDS.has(cur.norm) &&
      !/[.!?,;:]$/.test(cur.text);

    const nextIsConj = CONTINUATION_CONJUNCTIONS.has(next.norm);
    const nextIsStarter = SENTENCE_STARTERS.has(next.norm);
    const nextBlocksSentenceStart = NO_SENTENCE_START_WORDS.has(next.norm);
    const nextBlocksComma = NO_COMMA_BEFORE_WORDS.has(next.norm);
    const sentLen = curSentenceWords.length;

    // 1. Long silence (>= 1.8s) -> sentence end + paragraph break only if next word can start a sentence
    if (canBreakAfterCur && !nextBlocksSentenceStart && silenceAfter >= 1.8 && sentLen >= 2) {
      if (paragraphWordCount >= 18) {
        flushParagraph();
      } else {
        finalizeSentence();
      }
      continue;
    }

    // 2. Medium-strong pause (>= 0.45s)
    if (canBreakAfterCur && silenceAfter >= 0.45) {
      if ((nextIsConj || next.norm === 'who' || next.norm === 'which') && sentLen >= 4) {
        // Pause before "and / but / so / because / who / which" -> natural comma!
        curSentenceWords[curSentenceWords.length - 1] += ',';
        wordsSinceComma = 0;
      } else if (
        !nextBlocksSentenceStart &&
        ((sentLen >= 5 && (nextIsStarter || silenceAfter >= 0.6)) ||
          (sentLen >= 2 && silenceAfter >= 0.65 && nextIsStarter))
      ) {
        finalizeSentence();
        if (paragraphWordCount >= 52) {
          flushParagraph();
        }
      } else if (
        !nextBlocksComma &&
        sentLen >= 1 &&
        sentLen <= 4 &&
        silenceAfter >= 0.5 &&
        nextIsStarter
      ) {
        // Short intro phrase followed by a noticeable pause (e.g. "Truth be told,", "Today,")
        curSentenceWords[curSentenceWords.length - 1] += ',';
        wordsSinceComma = 0;
      }
      continue;
    }

    // 3. Moderate breath pause (>= 0.28s) + strong sentence starter after decent sentence length
    if (
      canBreakAfterCur &&
      !nextBlocksSentenceStart &&
      silenceAfter >= 0.28 &&
      sentLen >= 8 &&
      nextIsStarter &&
      !nextIsConj
    ) {
      finalizeSentence();
      if (paragraphWordCount >= 52) {
        flushParagraph();
      }
      continue;
    }

    // 4. Prevent overly long run-on sentences when speaker talks non-stop without long pauses
    if (
      canBreakAfterCur &&
      !nextBlocksSentenceStart &&
      sentLen >= 17 &&
      nextIsStarter &&
      !nextIsConj
    ) {
      finalizeSentence();
      if (paragraphWordCount >= 55) {
        flushParagraph();
      }
      continue;
    }

    if (canBreakAfterCur && !nextBlocksSentenceStart && sentLen >= 26) {
      finalizeSentence();
      if (paragraphWordCount >= 55) {
        flushParagraph();
      }
    }
  }

  flushParagraph();
  return paragraphs;
}

export function groupSegmentsIntoParagraphs(segments: SubtitleSegment[]): string[] {
  if (!segments.length) return [];

  // Auto-generated captions lack punctuation & capitalization -> restore them cleanly using
  // real speech pauses and English grammar rules so Reading Mode is pleasant to read!
  if (transcriptNeedsPunctuation(segments)) {
    return buildPunctuatedParagraphsFromAsr(segments);
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const cleaned = cleanReadingSegmentText(seg.text);
    if (!cleaned) continue;

    const prev = i > 0 ? segments[i - 1] : null;
    const pauseGap = prev ? seg.start - prev.end : 0;

    current.push(cleaned);
    wordCount += cleaned.split(/\s+/).length;

    const endsWithPunctuation = /[.!?]["'”)\]]*$/.test(cleaned);
    const shouldBreak =
      (wordCount >= 45 && endsWithPunctuation) ||
      wordCount >= 75 ||
      (pauseGap >= 2.8 && wordCount >= 18 && endsWithPunctuation);

    if (shouldBreak) {
      paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
      current = [];
      wordCount = 0;
    }
  }

  if (current.length > 0) {
    paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
  }

  return paragraphs;
}

export function speakEnglish(word: string, audioUrl?: string) {
  if (audioUrl) {
    try {
      const audio = new Audio(audioUrl);
      audio.play().catch(() => fallbackSpeech(word));
      return;
    } catch {
      // fall through
    }
  }
  fallbackSpeech(word);
}

function fallbackSpeech(word: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.92;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang === 'en-US' && v.name.includes('Google')) ||
      voices.find((v) => v.lang.startsWith('en-US')) ||
      voices.find((v) => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
    window.speechSynthesis.speak(utterance);
  } catch {
    // ignore speech errors
  }
}

const WORD_TOKEN_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const ABBREV_END_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|U\.S|U\.K)\.$/i;

function findWordSpan(
  text: string,
  clickedWord: string,
  wordIndex?: number
): { start: number; end: number } {
  const targetNorm = clickedWord.replace(/’/g, "'").toLowerCase();
  const spans: { start: number; end: number; norm: string }[] = [];
  WORD_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_TOKEN_RE.exec(text)) !== null) {
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      norm: match[0].replace(/’/g, "'").toLowerCase(),
    });
  }

  if (typeof wordIndex === 'number' && wordIndex >= 0 && wordIndex < spans.length) {
    return { start: spans[wordIndex].start, end: spans[wordIndex].end };
  }

  const exact = spans.find((s) => s.norm === targetNorm);
  if (exact) return { start: exact.start, end: exact.end };

  const fallbackIdx = text.toLowerCase().indexOf(targetNorm);
  if (fallbackIdx >= 0) {
    return { start: fallbackIdx, end: fallbackIdx + targetNorm.length };
  }
  return { start: 0, end: Math.min(text.length, 1) };
}

function isSentenceBoundaryAt(text: string, punctIdx: number): boolean {
  const ch = text[punctIdx];
  if (ch !== '.' && ch !== '!' && ch !== '?') return false;
  if (ch === '.') {
    // Avoid splitting on decimals (3.5) or common abbreviations (Mr., Dr., e.g.)
    const prev = text[punctIdx - 1] || '';
    const next = text[punctIdx + 1] || '';
    if (/\d/.test(prev) && /\d/.test(next)) return false;
    const prefix = text.slice(Math.max(0, punctIdx - 12), punctIdx + 1);
    if (ABBREV_END_RE.test(prefix)) return false;
  }
  // Must be followed by optional closing quote/bracket and whitespace or end of string
  const after = text.slice(punctIdx + 1);
  return /^["'”)\]]*(?:\s+|$)/.test(after);
}

function extractBalancedWindow(
  text: string,
  focusStart: number,
  focusEnd: number,
  maxWordsEachSide = 12,
  maxChars = 320
): string {
  const wordSpans: { start: number; end: number }[] = [];
  WORD_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_TOKEN_RE.exec(text)) !== null) {
    wordSpans.push({ start: m.index, end: m.index + m[0].length });
  }
  if (wordSpans.length === 0) return text.trim().slice(0, maxChars);

  let focusWordIdx = wordSpans.findIndex((w) => w.start <= focusStart && w.end >= focusStart);
  if (focusWordIdx === -1) {
    focusWordIdx = wordSpans.findIndex((w) => w.end >= focusEnd);
  }
  if (focusWordIdx === -1) focusWordIdx = 0;

  let leftIdx = Math.max(0, focusWordIdx - maxWordsEachSide);
  let rightIdx = Math.min(wordSpans.length - 1, focusWordIdx + maxWordsEachSide);

  // Shrink slightly from the farther side if string exceeds maxChars
  while (
    rightIdx > leftIdx &&
    wordSpans[rightIdx].end - wordSpans[leftIdx].start > maxChars
  ) {
    const leftDist = focusWordIdx - leftIdx;
    const rightDist = rightIdx - focusWordIdx;
    if (rightDist >= leftDist && rightIdx > focusWordIdx) {
      rightIdx--;
    } else if (leftIdx < focusWordIdx) {
      leftIdx++;
    } else {
      break;
    }
  }

  let sliceStart = wordSpans[leftIdx].start;
  let sliceEnd = wordSpans[rightIdx].end;

  // Include trailing punctuation immediately after the last word (e.g., '.', '!', '?', ',')
  while (sliceEnd < text.length && /[.!?,;:"'”)\]]/.test(text[sliceEnd])) {
    sliceEnd++;
  }

  return text
    .slice(sliceStart, sliceEnd)
    .replace(/^[,;:\-–—\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSentenceAroundSpan(
  fullText: string,
  focusStart: number,
  focusEnd: number,
  maxChars = 340
): string {
  const text = fullText.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // Find nearest sentence boundary strictly before focusStart
  let sentStart = 0;
  for (let i = Math.min(focusStart - 1, text.length - 1); i >= 0; i--) {
    if (isSentenceBoundaryAt(text, i)) {
      let after = i + 1;
      while (after < text.length && /["'”)\]\s]/.test(text[after])) after++;
      sentStart = after;
      break;
    }
  }

  // Find nearest sentence boundary at or after focusEnd
  let sentEnd = text.length;
  for (let i = Math.max(0, focusEnd - 1); i < text.length; i++) {
    if (isSentenceBoundaryAt(text, i)) {
      let after = i + 1;
      while (after < text.length && /["'”)\]]/.test(text[after])) after++;
      sentEnd = after;
      break;
    }
  }

  const candidate = text.slice(sentStart, sentEnd).trim();
  const wordCount = (candidate.match(WORD_TOKEN_RE) || []).length;

  // If the sentence is reasonably bounded (punctuated captions), return it complete!
  if (candidate.length <= maxChars && wordCount <= 42) {
    return candidate;
  }

  // For unpunctuated auto-captions or very long run-on sentences, center a clean window
  // around the clicked word so idioms straddling subtitle boundaries stay completely intact.
  return extractBalancedWindow(
    candidate,
    Math.max(0, focusStart - sentStart),
    Math.max(0, focusEnd - sentStart),
    12,
    maxChars
  );
}

/**
 * Reconstructs the complete sentence (or natural speech window) across neighboring
 * YouTube subtitle segments so idioms & set expressions split across timecodes
 * are never chopped in half before translation.
 */
export function buildContextSentenceAroundSegment(
  segments: SubtitleSegment[],
  segmentIndex: number,
  clickedWord: string,
  wordIndexInSegment?: number
): string {
  if (!segments.length || segmentIndex < 0 || segmentIndex >= segments.length) {
    return '';
  }

  const PAUSE_BREAK_SEC = 2.2;
  const MAX_NEIGHBORS_BACK = 4;
  const MAX_NEIGHBORS_FWD = 4;

  // Walk backward across contiguous segments until a sentence end or speech pause
  let startSeg = segmentIndex;
  for (let i = segmentIndex - 1; i >= Math.max(0, segmentIndex - MAX_NEIGHBORS_BACK); i--) {
    const prev = segments[i];
    const next = segments[i + 1];
    const gap = next.start - prev.end;
    if (gap >= PAUSE_BREAK_SEC) break;

    const prevText = prev.text.trim();
    // If previous segment cleanly ends a sentence, we don't need to pull it in
    if (/[.!?]["'”)\]]*$/.test(prevText) && !ABBREV_END_RE.test(prevText)) {
      break;
    }
    startSeg = i;
  }

  // Walk forward across contiguous segments until a sentence end or speech pause
  let endSeg = segmentIndex;
  const curTextTrimmed = segments[segmentIndex].text.trim();
  const curEndsSentence =
    /[.!?]["'”)\]]*$/.test(curTextTrimmed) && !ABBREV_END_RE.test(curTextTrimmed);

  if (!curEndsSentence) {
    for (
      let i = segmentIndex + 1;
      i <= Math.min(segments.length - 1, segmentIndex + MAX_NEIGHBORS_FWD);
      i++
    ) {
      const prev = segments[i - 1];
      const curr = segments[i];
      const gap = curr.start - prev.end;
      if (gap >= PAUSE_BREAK_SEC) break;

      endSeg = i;
      const t = curr.text.trim();
      if (/[.!?]["'”)\]]*$/.test(t) && !ABBREV_END_RE.test(t)) {
        break;
      }
    }
  }

  // Stitch the segments and track the exact character offset of the clicked word
  let combined = '';
  let focusStart = 0;
  let focusEnd = 0;

  for (let i = startSeg; i <= endSeg; i++) {
    const piece = segments[i].text.replace(/\s+/g, ' ').trim();
    if (!piece) continue;
    if (combined.length > 0) combined += ' ';
    const segOffset = combined.length;
    combined += piece;

    if (i === segmentIndex) {
      const span = findWordSpan(piece, clickedWord, wordIndexInSegment);
      focusStart = segOffset + span.start;
      focusEnd = segOffset + span.end;
    }
  }

  return extractSentenceAroundSpan(combined, focusStart, focusEnd, 340);
}

export function extractSentenceAroundWord(
  text: string,
  clickedWord: string,
  wordIndexInText?: number
): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const span = findWordSpan(cleaned, clickedWord, wordIndexInText);
  return extractSentenceAroundSpan(cleaned, span.start, span.end, 340);
}

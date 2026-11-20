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

export function groupSegmentsIntoParagraphs(segments: SubtitleSegment[]): string[] {
  if (!segments.length) return [];

  const paragraphs: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const prev = i > 0 ? segments[i - 1] : null;
    const pauseGap = prev ? seg.start - prev.end : 0;

    current.push(seg.text.trim());
    wordCount += seg.text.trim().split(/\s+/).length;

    const endsWithPunctuation = /[.!?]["']?$/.test(seg.text.trim());
    const shouldBreak =
      (wordCount >= 45 && endsWithPunctuation) ||
      wordCount >= 75 ||
      (pauseGap >= 2.8 && wordCount >= 18);

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

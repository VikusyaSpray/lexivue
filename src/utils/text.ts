import { SubtitleSegment } from '../types';

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

export function extractSentenceAroundWord(text: string, clickedWord: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const target = clickedWord.toLowerCase();
  const found = sentences.find((s) => s.toLowerCase().includes(target));
  return (found || text).trim().slice(0, 260);
}

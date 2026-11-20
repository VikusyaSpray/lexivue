import React, { useMemo } from 'react';
import { tokenizeText } from '../utils/text';

interface InteractiveTextProps {
  text: string;
  savedWords: Set<string>;
  selectedWord?: string | null;
  activeWordIndex?: number | null;
  highlightedPhrases?: string[];
  onWordClick: (word: string, contextText: string, wordIndex?: number) => void;
}

function findIdiomWordIndices(text: string, phrases?: string[]): Set<number> {
  const result = new Set<number>();
  if (!phrases || phrases.length === 0) return result;

  const lowerText = text.toLowerCase().replace(/’/g, "'");
  const wordRe = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  const wordSpans: { start: number; end: number; idx: number }[] = [];
  let m: RegExpExecArray | null;
  let wIdx = 0;
  while ((m = wordRe.exec(text)) !== null) {
    wordSpans.push({ start: m.index, end: m.index + m[0].length, idx: wIdx++ });
  }
  if (wordSpans.length === 0) return result;

  for (const phrase of phrases) {
    const p = phrase.trim().toLowerCase().replace(/’/g, "'");
    if (!p || !lowerText.includes(p)) continue;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    let pm: RegExpExecArray | null;
    while ((pm = re.exec(lowerText)) !== null) {
      const pStart = pm.index;
      const pEnd = pm.index + pm[0].length;
      for (const ws of wordSpans) {
        if (ws.start >= pStart && ws.end <= pEnd) {
          result.add(ws.idx);
        }
      }
    }
  }
  return result;
}

export const InteractiveText: React.FC<InteractiveTextProps> = React.memo(
  ({
    text,
    savedWords,
    selectedWord,
    activeWordIndex = null,
    highlightedPhrases,
    onWordClick,
  }) => {
    const tokens = useMemo(() => tokenizeText(text), [text]);
    const idiomIndices = useMemo(
      () => findIdiomWordIndices(text, highlightedPhrases),
      [text, highlightedPhrases]
    );
    const selectedNorm = selectedWord?.toLowerCase() || '';
    let wordCounter = -1;

    return (
      <>
        {tokens.map((token, idx) => {
          if (!token.isWord) {
            return <React.Fragment key={idx}>{token.text}</React.Fragment>;
          }

          wordCounter += 1;
          const currentWordIdx = wordCounter;
          const isSaved = savedWords.has(token.normalized);
          const isSelected = selectedNorm === token.normalized;
          const isSpoken = activeWordIndex !== null && currentWordIdx === activeWordIndex;
          const isIdiom = idiomIndices.has(currentWordIdx);

          return (
            <button
              key={idx}
              type="button"
              className={`word-token${isSaved ? ' word-token--saved' : ''}${
                isIdiom && !isSaved ? ' word-token--idiom' : ''
              }${isSpoken ? ' word-token--spoken' : ''}${
                isSelected ? ' word-token--selected' : ''
              }`}
              title={isIdiom ? 'Сталий вираз — натисніть для перекладу' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onWordClick(token.text, text, currentWordIdx);
              }}
            >
              {token.text}
            </button>
          );
        })}
      </>
    );
  }
);

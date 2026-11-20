import React, { useMemo } from 'react';
import { tokenizeText } from '../utils/text';

interface InteractiveTextProps {
  text: string;
  savedWords: Set<string>;
  selectedWord?: string | null;
  activeWordIndex?: number | null;
  onWordClick: (word: string, contextText: string, wordIndex?: number) => void;
}

export const InteractiveText: React.FC<InteractiveTextProps> = React.memo(
  ({ text, savedWords, selectedWord, activeWordIndex = null, onWordClick }) => {
    const tokens = useMemo(() => tokenizeText(text), [text]);
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

          return (
            <button
              key={idx}
              type="button"
              className={`word-token${isSaved ? ' word-token--saved' : ''}${
                isSpoken ? ' word-token--spoken' : ''
              }${isSelected ? ' word-token--selected' : ''}`}
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

import React, { useEffect, useRef } from 'react';
import { Volume2, Plus, Check, X, Loader2, Sparkles } from 'lucide-react';
import { WordTranslation } from '../types';
import { speakEnglish } from '../utils/text';

interface TranslationSheetProps {
  open: boolean;
  word: string;
  loading: boolean;
  error: string | null;
  data: WordTranslation | null;
  isSaved: boolean;
  isPhraseSaved?: boolean;
  onAddCard: (data: WordTranslation) => void;
  onRemoveCard: (normalizedWord: string) => void;
  onClose: () => void;
}

function renderHighlightedSentence(sentence: string, highlightTarget: string) {
  const target = highlightTarget.trim();
  if (!target) return sentence;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'i');
  const parts = sentence.split(re);
  if (parts.length < 3) return sentence;
  return parts.map((part, i) =>
    i === 1 ? (
      <mark key={i} className="sheet-context-mark">
        {part}
      </mark>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

export const TranslationSheet: React.FC<TranslationSheetProps> = ({
  open,
  word,
  loading,
  error,
  data,
  isSaved,
  isPhraseSaved = false,
  onAddCard,
  onRemoveCard,
  onClose,
}) => {
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const displayWord = data?.word || word;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (deltaY > 65) {
      onClose();
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="sheet-panel"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="sheet-handle-wrap">
          <span className="sheet-handle" />
        </div>

        <div className="sheet-header">
          <div className="sheet-word-group">
            <div className="sheet-word-row">
              <h3 className="sheet-word">{displayWord}</h3>
              <button
                type="button"
                className="icon-pill-btn"
                onClick={() => speakEnglish(displayWord, data?.audio)}
                aria-label="Прослухати вимову"
                title="Прослухати вимову"
              >
                <Volume2 size={18} />
              </button>
            </div>
            <div className="sheet-meta-row">
              {data?.phonetic && <span className="sheet-phonetic">{data.phonetic}</span>}
              {data?.partOfSpeechUk && (
                <span className="badge badge--yellow">{data.partOfSpeechUk}</span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="sheet-close-btn"
            onClick={onClose}
            aria-label="Закрити"
          >
            <X size={20} />
          </button>
        </div>

        <div className="sheet-body">
          {loading ? (
            <div className="sheet-loading">
              <Loader2 size={20} className="spin" />
              <span>Перекладаємо українською…</span>
            </div>
          ) : error ? (
            <div className="sheet-error">{error}</div>
          ) : data ? (
            <>
              <div className="sheet-translation-box">
                <div className="sheet-translation-label">Переклад</div>
                <div className="sheet-translation-main">{data.translation}</div>

                {data.alternatives.length > 0 && (
                  <div className="sheet-alts">
                    {data.alternatives.map((alt) => (
                      <span key={alt} className="sheet-alt-chip">
                        {alt}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {data.phrase && data.phraseTranslation && (
                <div className="sheet-phrase-box">
                  <div className="sheet-phrase-top">
                    <span className="sheet-phrase-label">
                      <Sparkles size={12} />
                      <span>{data.phraseNote || 'Сталий вираз'}</span>
                    </span>
                    <button
                      type="button"
                      className={`sheet-phrase-save${
                        isPhraseSaved ? ' sheet-phrase-save--saved' : ''
                      }`}
                      onClick={() => {
                        const normPhrase = data.phrase!.trim().toLowerCase();
                        if (isPhraseSaved) {
                          onRemoveCard(normPhrase);
                        } else {
                          onAddCard({
                            word: data.phrase!,
                            normalized: normPhrase,
                            translation: data.phraseTranslation!,
                            alternatives: [],
                            partOfSpeech: 'phrase',
                            partOfSpeechUk: data.phraseNote || 'сталий вираз',
                            phonetic: '',
                            audio: '',
                            sentence: data.sentence,
                            sentenceTranslation: data.sentenceTranslation,
                          });
                        }
                      }}
                    >
                      {isPhraseSaved ? <Check size={13} /> : <Plus size={13} />}
                      <span>{isPhraseSaved ? 'У карточках' : 'Зберегти вираз'}</span>
                    </button>
                  </div>
                  <div className="sheet-phrase-en-row">
                    <span className="sheet-phrase-en">{data.phrase}</span>
                    <button
                      type="button"
                      className="sheet-phrase-speak"
                      onClick={() => speakEnglish(data.phrase!)}
                      aria-label="Прослухати вираз"
                      title="Прослухати вираз"
                    >
                      <Volume2 size={14} />
                    </button>
                  </div>
                  <div className="sheet-phrase-uk">{data.phraseTranslation}</div>
                </div>
              )}

              {data.sentence && (
                <div className="sheet-context">
                  <div className="sheet-context-en">
                    «{renderHighlightedSentence(data.sentence, data.phrase || data.word)}»
                  </div>
                  {data.sentenceTranslation && (
                    <div className="sheet-context-uk">{data.sentenceTranslation}</div>
                  )}
                </div>
              )}

              <div className="sheet-actions">
                {isSaved ? (
                  <button
                    type="button"
                    className="btn btn--saved btn--full"
                    onClick={() => onRemoveCard(data.normalized)}
                  >
                    <Check size={18} />
                    <span>Додано в карточки (натисніть, щоб прибрати)</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--coral btn--full"
                    onClick={() => onAddCard(data)}
                  >
                    <Plus size={18} />
                    <span>Додати слово в карточки</span>
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

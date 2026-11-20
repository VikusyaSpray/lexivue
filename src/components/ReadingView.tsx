import React, { useMemo, useState } from 'react';
import { FileText, Video, Minus, Plus, Edit3, Check } from 'lucide-react';
import { VideoTranscript } from '../types';
import { SAMPLE_READING_TEXT } from '../data/presets';
import {
  groupSegmentsIntoParagraphs,
  extractSentenceAroundWord,
  transcriptNeedsPunctuation,
} from '../utils/text';
import { InteractiveText } from './InteractiveText';

interface ReadingViewProps {
  transcript: VideoTranscript | null;
  savedWords: Set<string>;
  selectedWord: string | null;
  highlightedPhrases?: string[];
  onWordClick: (word: string, contextText: string) => void;
  onGoToVideo: () => void;
}

type ReadingSource = 'video' | 'custom';

export const ReadingView: React.FC<ReadingViewProps> = ({
  transcript,
  savedWords,
  selectedWord,
  highlightedPhrases = [],
  onWordClick,
  onGoToVideo,
}) => {
  const [source, setSource] = useState<ReadingSource>(transcript ? 'video' : 'custom');
  const [customText, setCustomText] = useState(SAMPLE_READING_TEXT);
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [fontSize, setFontSize] = useState(18);

  const videoParagraphs = useMemo(
    () => (transcript ? groupSegmentsIntoParagraphs(transcript.segments) : []),
    [transcript]
  );

  const isAutoPunctuated = useMemo(
    () => (transcript ? transcriptNeedsPunctuation(transcript.segments) : false),
    [transcript]
  );

  const customParagraphs = useMemo(
    () =>
      customText
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    [customText]
  );

  const handleParagraphWordClick = (word: string, paragraph: string, wordIdx?: number) => {
    const sentence = extractSentenceAroundWord(paragraph, word, wordIdx);
    onWordClick(word, sentence);
  };

  return (
    <section className="page-section reading-page">
      <div className="reading-toolbar">
        <div className="segmented-control">
          <button
            type="button"
            className={`segmented-btn${source === 'video' ? ' segmented-btn--active' : ''}`}
            onClick={() => setSource('video')}
          >
            <Video size={15} />
            <span>Текст із відео</span>
          </button>
          <button
            type="button"
            className={`segmented-btn${source === 'custom' ? ' segmented-btn--active' : ''}`}
            onClick={() => setSource('custom')}
          >
            <FileText size={15} />
            <span>Свій текст</span>
          </button>
        </div>

        <div className="font-controls" aria-label="Розмір тексту">
          <button
            type="button"
            className="icon-square-btn"
            onClick={() => setFontSize((s) => Math.max(15, s - 2))}
            aria-label="Зменшити шрифт"
          >
            <Minus size={15} />
          </button>
          <span className="font-size-label">Aa</span>
          <button
            type="button"
            className="icon-square-btn"
            onClick={() => setFontSize((s) => Math.min(26, s + 2))}
            aria-label="Збільшити шрифт"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      {source === 'video' ? (
        transcript ? (
          <article className="reading-card">
            <div className="reading-card__header">
              <div>
                <div className="reading-badges">
                  <span className="badge badge--yellow">Субтитри для читання</span>
                  {isAutoPunctuated && (
                    <span className="badge badge--neutral">авто-пунктуація</span>
                  )}
                </div>
                <h1 className="reading-title">{transcript.title}</h1>
                <p className="reading-hint">
                  Натисніть на будь-яке слово у тексті, щоб перекласти його українською.
                </p>
              </div>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={onGoToVideo}
              >
                <Video size={15} />
                <span>До відео</span>
              </button>
            </div>

            <div className="reading-body" style={{ fontSize: `${fontSize}px` }}>
              {videoParagraphs.map((para, idx) => (
                <p key={idx} className="reading-paragraph">
                  <InteractiveText
                    text={para}
                    savedWords={savedWords}
                    selectedWord={selectedWord}
                    highlightedPhrases={highlightedPhrases}
                    onWordClick={handleParagraphWordClick}
                  />
                </p>
              ))}
            </div>
          </article>
        ) : (
          <div className="empty-card">
            <div className="empty-icon">
              <Video size={26} />
            </div>
            <h2>Відео ще не завантажено</h2>
            <p>
              Відкрийте YouTube-відео у вкладці «Відео», щоб почитати його повний текст тут, або
              перемкніться на «Свій текст».
            </p>
            <div className="empty-actions">
              <button type="button" className="btn btn--black" onClick={onGoToVideo}>
                Обрати відео
              </button>
              <button
                type="button"
                className="btn btn--outline"
                onClick={() => setSource('custom')}
              >
                Читати свій текст
              </button>
            </div>
          </div>
        )
      ) : (
        <article className="reading-card">
          <div className="reading-card__header">
            <div>
              <span className="badge badge--coral">Режим читання</span>
              <h1 className="reading-title">Англійський текст</h1>
              <p className="reading-hint">
                Вставте статтю, уривок книги чи текст пісні — кожне слово можна перекласти дотиком.
              </p>
            </div>
            <button
              type="button"
              className={`btn btn--sm ${isEditingCustom ? 'btn--coral' : 'btn--outline'}`}
              onClick={() => setIsEditingCustom((v) => !v)}
            >
              {isEditingCustom ? (
                <>
                  <Check size={15} />
                  <span>Готово</span>
                </>
              ) : (
                <>
                  <Edit3 size={15} />
                  <span>Вставити текст</span>
                </>
              )}
            </button>
          </div>

          {isEditingCustom ? (
            <div className="custom-editor">
              <textarea
                className="custom-textarea"
                rows={10}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Вставте сюди будь-який текст англійською…"
              />
              <div className="custom-editor__footer">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setCustomText('')}
                >
                  Очистити
                </button>
                <button
                  type="button"
                  className="btn btn--black btn--sm"
                  onClick={() => setIsEditingCustom(false)}
                >
                  Читати та перекладати
                </button>
              </div>
            </div>
          ) : (
            <div className="reading-body" style={{ fontSize: `${fontSize}px` }}>
              {customParagraphs.length > 0 ? (
                customParagraphs.map((para, idx) => (
                  <p key={idx} className="reading-paragraph">
                    <InteractiveText
                      text={para}
                      savedWords={savedWords}
                      selectedWord={selectedWord}
                      onWordClick={handleParagraphWordClick}
                    />
                  </p>
                ))
              ) : (
                <p className="reading-placeholder">
                  Текст порожній. Натисніть «Вставити текст», щоб додати уривок англійською.
                </p>
              )}
            </div>
          )}
        </article>
      )}
    </section>
  );
};

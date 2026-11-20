import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2,
  ChevronLeft,
  ChevronRight,
  Shuffle,
  CheckCircle2,
  Trash2,
  RotateCw,
  Layers,
  List,
  Plus,
  Sparkles,
} from 'lucide-react';
import { Flashcard } from '../types';
import { speakEnglish } from '../utils/text';

interface FlashcardsViewProps {
  cards: Flashcard[];
  onToggleLearned: (id: string) => void;
  onRemoveCard: (id: string) => void;
  onAddManualCard: (word: string, translation: string, context?: string) => void;
  onAddStarterPack: () => void;
  onGoToVideo: () => void;
}

type CardsSubTab = 'study' | 'list';
type FilterMode = 'all' | 'learning' | 'learned';

export const FlashcardsView: React.FC<FlashcardsViewProps> = ({
  cards,
  onToggleLearned,
  onRemoveCard,
  onAddManualCard,
  onAddStarterPack,
  onGoToVideo,
}) => {
  const [subTab, setSubTab] = useState<CardsSubTab>('study');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // Manual add form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [newAlternatives, setNewAlternatives] = useState('');

  // Touch swipe tracking for iPhone 13
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const filteredCards = useMemo(() => {
    const base = cards.filter((c) => {
      if (filter === 'learning') return !c.learned;
      if (filter === 'learned') return c.learned;
      return true;
    });

    if (orderIds.length === 0) return base;
    const rank = new Map(orderIds.map((id, i) => [id, i]));
    return [...base].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : -1;
      const rb = rank.has(b.id) ? rank.get(b.id)! : -1;
      return ra - rb;
    });
  }, [cards, filter, orderIds]);

  const safeIndex =
    filteredCards.length === 0 ? 0 : Math.min(currentIndex, filteredCards.length - 1);
  const activeCard = filteredCards[safeIndex] || null;

  useEffect(() => {
    setFlipped(false);
    setCurrentIndex(0);
  }, [filter]);

  const goPrev = () => {
    if (filteredCards.length <= 1) return;
    setFlipped(false);
    setCurrentIndex((prev) => (prev <= 0 ? filteredCards.length - 1 : prev - 1));
  };

  const goNext = () => {
    if (filteredCards.length <= 1) return;
    setFlipped(false);
    setCurrentIndex((prev) => (prev >= filteredCards.length - 1 ? 0 : prev + 1));
  };

  const handleShuffle = () => {
    const ids = filteredCards.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setOrderIds(ids);
    setCurrentIndex(0);
    setFlipped(false);
  };

  // Keyboard shortcuts on desktop
  useEffect(() => {
    if (subTab !== 'study' || !activeCard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'ArrowRight') {
        goNext();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [subTab, activeCard, filteredCards.length]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      if (dx < 0) goNext();
      else goPrev();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !newTranslation.trim()) return;
    onAddManualCard(newWord, newTranslation, newAlternatives);
    setNewWord('');
    setNewTranslation('');
    setNewAlternatives('');
    setShowAddForm(false);
  };

  const learnedCount = cards.filter((c) => c.learned).length;

  return (
    <section className="page-section cards-page">
      <div className="cards-topbar">
        <div className="segmented-control">
          <button
            type="button"
            className={`segmented-btn${subTab === 'study' ? ' segmented-btn--active' : ''}`}
            onClick={() => setSubTab('study')}
          >
            <Layers size={15} />
            <span>Карточки</span>
          </button>
          <button
            type="button"
            className={`segmented-btn${subTab === 'list' ? ' segmented-btn--active' : ''}`}
            onClick={() => setSubTab('list')}
          >
            <List size={15} />
            <span>Усі слова ({cards.length})</span>
          </button>
        </div>

        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => {
            setSubTab('list');
            setShowAddForm((v) => !v);
          }}
        >
          <Plus size={15} />
          <span>Додати слово</span>
        </button>
      </div>

      {cards.length === 0 && !showAddForm ? (
        <div className="empty-card">
          <div className="empty-icon empty-icon--coral">
            <Layers size={26} />
          </div>
          <h2>Ваші карточки поки порожні</h2>
          <p>
            Під час перегляду YouTube або читання тексту натисніть на будь-яке слово й оберіть
            «Додати слово в карточки». Вони зʼявляться тут для зручного повторення!
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn--black" onClick={onGoToVideo}>
              Перейти до відео
            </button>
            <button type="button" className="btn btn--coral" onClick={onAddStarterPack}>
              <Sparkles size={16} />
              <span>Спробувати 3 приклади</span>
            </button>
          </div>
        </div>
      ) : subTab === 'study' ? (
        <div className="study-stage">
          {/* Filter + Shuffle strip */}
          <div className="study-filters">
            <div className="filter-pills">
              <button
                type="button"
                className={`filter-pill${filter === 'all' ? ' filter-pill--active' : ''}`}
                onClick={() => setFilter('all')}
              >
                Усі ({cards.length})
              </button>
              <button
                type="button"
                className={`filter-pill${filter === 'learning' ? ' filter-pill--active' : ''}`}
                onClick={() => setFilter('learning')}
              >
                Вчу ({cards.length - learnedCount})
              </button>
              <button
                type="button"
                className={`filter-pill${filter === 'learned' ? ' filter-pill--active' : ''}`}
                onClick={() => setFilter('learned')}
              >
                Вивчені ({learnedCount})
              </button>
            </div>

            {filteredCards.length > 1 && (
              <button
                type="button"
                className="icon-square-btn"
                onClick={handleShuffle}
                title="Перемішати карточки"
                aria-label="Перемішати карточки"
              >
                <Shuffle size={16} />
              </button>
            )}
          </div>

          {!activeCard ? (
            <div className="empty-card empty-card--compact">
              <h3>У цій категорії немає слів</h3>
              <p>Перемкніться на вкладку «Усі», щоб переглянути збережені слова.</p>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => setFilter('all')}
              >
                Показати всі
              </button>
            </div>
          ) : (
            <>
              {/* Progress bar */}
              <div className="deck-progress">
                <div className="deck-progress__meta">
                  <span>
                    Карточка <strong>{safeIndex + 1}</strong> з {filteredCards.length}
                  </span>
                  {activeCard.learned && <span className="badge badge--yellow">Вивчено</span>}
                </div>
                <div className="deck-progress__track">
                  <div
                    className="deck-progress__fill"
                    style={{
                      width: `${((safeIndex + 1) / filteredCards.length) * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* 3D Flip Card */}
              <div
                className="flashcard-scene"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div
                  className={`flashcard${flipped ? ' flashcard--flipped' : ''}`}
                  onClick={() => setFlipped((f) => !f)}
                  role="button"
                  tabIndex={0}
                  aria-label="Перевернути карточку"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setFlipped((f) => !f);
                  }}
                >
                  {/* FRONT: English */}
                  <div className="flashcard__face flashcard__face--front">
                    <div className="flashcard__top">
                      <span className="flashcard__lang">ENGLISH</span>
                      <button
                        type="button"
                        className="icon-pill-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          speakEnglish(activeCard.word, activeCard.audio);
                        }}
                        aria-label="Прослухати слово"
                      >
                        <Volume2 size={18} />
                      </button>
                    </div>

                    <div className="flashcard__center">
                      <div className="flashcard__word">{activeCard.word}</div>
                      {activeCard.phonetic && (
                        <div className="flashcard__phonetic">{activeCard.phonetic}</div>
                      )}
                      {activeCard.partOfSpeechUk && (
                        <span className="badge badge--yellow">{activeCard.partOfSpeechUk}</span>
                      )}
                    </div>

                    <div className="flashcard__bottom">
                      <RotateCw size={14} />
                      <span>Натисніть, щоб перевернути</span>
                    </div>
                  </div>

                  {/* BACK: Ukrainian translation */}
                  <div className="flashcard__face flashcard__face--back">
                    <div className="flashcard__top">
                      <span className="flashcard__lang flashcard__lang--uk">УКРАЇНСЬКА</span>
                      <button
                        type="button"
                        className="icon-pill-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          speakEnglish(activeCard.word, activeCard.audio);
                        }}
                        aria-label="Прослухати вимову"
                      >
                        <Volume2 size={18} />
                      </button>
                    </div>

                    <div className="flashcard__center">
                      <div className="flashcard__translation">{activeCard.translation}</div>
                      {activeCard.alternatives.length > 0 && (
                        <div className="flashcard__alts-block">
                          <div className="flashcard__alts-label">Інші можливі переклади</div>
                          <div className="flashcard__alts-chips">
                            {activeCard.alternatives.slice(0, 6).map((alt) => (
                              <span key={alt} className="flashcard__alt-chip">
                                {alt}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flashcard__bottom">
                      <span>{activeCard.word}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deck navigation controls */}
              <div className="deck-controls">
                <button
                  type="button"
                  className="deck-nav-btn"
                  onClick={goPrev}
                  disabled={filteredCards.length <= 1}
                  aria-label="Попередня карточка"
                >
                  <ChevronLeft size={22} />
                  <span>Назад</span>
                </button>

                <button
                  type="button"
                  className={`btn btn--sm ${
                    activeCard.learned ? 'btn--yellow' : 'btn--outline'
                  }`}
                  onClick={() => onToggleLearned(activeCard.id)}
                >
                  <CheckCircle2 size={16} />
                  <span>{activeCard.learned ? 'Вивчено' : 'Знаю'}</span>
                </button>

                <button
                  type="button"
                  className="deck-nav-btn deck-nav-btn--primary"
                  onClick={goNext}
                  disabled={filteredCards.length <= 1}
                  aria-label="Наступна карточка"
                >
                  <span>Далі</span>
                  <ChevronRight size={22} />
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* WORD LIST VIEW */
        <div className="wordlist-stage">
          {showAddForm && (
            <form className="manual-add-card" onSubmit={handleManualSubmit}>
              <div className="manual-add-card__title">Нове слово в карточки</div>
              <div className="manual-add-grid">
                <input
                  type="text"
                  className="text-input"
                  placeholder="Англійське слово (напр. resilient)"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  required
                />
                <input
                  type="text"
                  className="text-input"
                  placeholder="Переклад українською (напр. стійкий)"
                  value={newTranslation}
                  onChange={(e) => setNewTranslation(e.target.value)}
                  required
                />
              </div>
              <input
                type="text"
                className="text-input"
                placeholder="Інші переклади через кому (необовʼязково)"
                value={newAlternatives}
                onChange={(e) => setNewAlternatives(e.target.value)}
              />
              <div className="manual-add-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setShowAddForm(false)}
                >
                  Скасувати
                </button>
                <button type="submit" className="btn btn--coral btn--sm">
                  Зберегти
                </button>
              </div>
            </form>
          )}

          <div className="wordlist">
            {cards.map((card) => (
              <div key={card.id} className="wordlist-item">
                <div className="wordlist-item__main">
                  <div className="wordlist-item__top">
                    <span className="wordlist-item__word">{card.word}</span>
                    {card.phonetic && (
                      <span className="wordlist-item__phonetic">{card.phonetic}</span>
                    )}
                    {card.learned && <span className="badge badge--yellow">Вивчено</span>}
                  </div>
                  <div className="wordlist-item__tr">{card.translation}</div>
                  {card.alternatives.length > 0 && (
                    <div className="wordlist-item__ctx">
                      {card.alternatives.slice(0, 5).join(' · ')}
                    </div>
                  )}
                </div>

                <div className="wordlist-item__actions">
                  <button
                    type="button"
                    className="icon-square-btn"
                    onClick={() => speakEnglish(card.word, card.audio)}
                    aria-label="Озвучити"
                  >
                    <Volume2 size={16} />
                  </button>
                  <button
                    type="button"
                    className={`icon-square-btn${
                      card.learned ? ' icon-square-btn--yellow' : ''
                    }`}
                    onClick={() => onToggleLearned(card.id)}
                    aria-label="Позначити вивченим"
                    title="Позначити вивченим"
                  >
                    <CheckCircle2 size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-square-btn icon-square-btn--danger"
                    onClick={() => onRemoveCard(card.id)}
                    aria-label="Видалити слово"
                    title="Видалити слово"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlaySquare, BookOpen, Layers, Check, Sun, Moon } from 'lucide-react';
import { ActiveTab, VideoTranscript, WordTranslation } from './types';
import { useFlashcards } from './hooks/useFlashcards';
import { YouTubePlayerHandle } from './components/YouTubePlayer';
import { VideoStudyView } from './components/VideoStudyView';
import { ReadingView } from './components/ReadingView';
import { FlashcardsView } from './components/FlashcardsView';
import { TranslationSheet } from './components/TranslationSheet';
import {
  fetchDictionaryMetaBrowser,
  fetchTranscriptSmart,
  translateWordSmart,
} from './utils/clientApi';
import {
  buildVideoPrefetchChunks,
  getPrefetchedChunkCount,
  getPrefetchedIdiomsForVideo,
  lookupInstantTranslation,
  prefetchVideoChunkIfNeeded,
  savePersistentWordTranslation,
} from './utils/prefetchCache';

type ThemeMode = 'light' | 'dark';

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  try {
    const saved = localStorage.getItem('lexivue_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // ignore storage errors
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [activeTab, setActiveTab] = useState<ActiveTab>('video');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('lexivue_theme', theme);
    } catch {
      // ignore storage errors
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#18181D' : '#FFFFFF');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  // Video & transcript state
  const [urlInput, setUrlInput] = useState('');
  const [transcript, setTranscript] = useState<VideoTranscript | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [pauseOnWordClick, setPauseOnWordClick] = useState(true);

  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const wasPlayingBeforeSheetRef = useRef(false);

  // Translation bottom sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationData, setTranslationData] = useState<WordTranslation | null>(null);
  const translateReqIdRef = useRef(0);

  // Toast feedback
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Lazy chunk prefetching for instant 0ms translations & idiom highlights
  const [prefetchRevision, setPrefetchRevision] = useState(0);
  const prefetchChunks = useMemo(
    () => (transcript ? buildVideoPrefetchChunks(transcript.segments) : []),
    [transcript]
  );

  const handlePrefetchChunk = useCallback(
    (chunkIndex: number) => {
      if (!transcript) return;
      const chunk = prefetchChunks[chunkIndex];
      if (!chunk) return;
      void prefetchVideoChunkIfNeeded(transcript.videoId, chunk, () => {
        setPrefetchRevision((r) => r + 1);
      });
    },
    [transcript, prefetchChunks]
  );

  // Start prefetching Chunk 0 in background as soon as a video loads
  useEffect(() => {
    if (!transcript || prefetchChunks.length === 0) return;
    handlePrefetchChunk(0);
  }, [transcript, prefetchChunks, handlePrefetchChunk]);

  const highlightedPhrases = useMemo(() => {
    void prefetchRevision;
    return getPrefetchedIdiomsForVideo(transcript?.videoId);
  }, [transcript?.videoId, prefetchRevision]);

  const prefetchedChunkCount = useMemo(() => {
    void prefetchRevision;
    return getPrefetchedChunkCount(transcript?.videoId);
  }, [transcript?.videoId, prefetchRevision]);

  const {
    cards,
    savedNormalizedSet,
    hasWord,
    addCard,
    addManualCard,
    removeCardById,
    removeCardByWord,
    toggleLearned,
    addStarterPack,
  } = useFlashcards();

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2200);
  }, []);

  const handleLoadVideo = useCallback(async (urlOrId: string) => {
    setVideoLoading(true);
    setVideoError(null);

    try {
      const data = await fetchTranscriptSmart(urlOrId);
      setTranscript(data);
      setVideoError(null);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Не вдалося завантажити субтитри для цього відео.';
      setVideoError(msg);
      setTranscript(null);
    } finally {
      setVideoLoading(false);
    }
  }, []);

  const handleWordClick = useCallback(
    async (word: string, contextText: string) => {
      const cleanWord = word.replace(/’/g, "'").trim();
      if (!cleanWord) return;

      if (activeTab === 'video' && pauseOnWordClick && playerRef.current) {
        const playing = playerRef.current.isPlaying();
        wasPlayingBeforeSheetRef.current = playing;
        if (playing) {
          playerRef.current.pause();
        }
      } else {
        wasPlayingBeforeSheetRef.current = false;
      }

      const reqId = ++translateReqIdRef.current;
      setSelectedWord(cleanWord);
      setSheetOpen(true);
      setTranslationError(null);

      // Instant 0ms lookup from persistent browser cache or prefetched video chunk!
      const instantHit = lookupInstantTranslation(cleanWord, contextText, transcript?.videoId);
      if (instantHit) {
        setTranslationLoading(false);
        setTranslationData(instantHit.data);

        if (instantHit.needsDictMeta) {
          void fetchDictionaryMetaBrowser(instantHit.data.normalized).then((meta) => {
            if (!meta.phonetic && !meta.audio && !meta.partOfSpeechUk) return;
            const enriched: WordTranslation = {
              ...instantHit.data,
              phonetic: instantHit.data.phonetic || meta.phonetic,
              audio: instantHit.data.audio || meta.audio,
              partOfSpeech: instantHit.data.partOfSpeech || meta.partOfSpeech,
              partOfSpeechUk: instantHit.data.partOfSpeechUk || meta.partOfSpeechUk,
            };
            savePersistentWordTranslation(
              enriched.normalized,
              enriched.sentence || contextText,
              enriched
            );
            if (reqId === translateReqIdRef.current) {
              setTranslationData(enriched);
            }
          });
        }
        return;
      }

      setTranslationLoading(true);
      setTranslationData(null);

      try {
        const data = await translateWordSmart(cleanWord, contextText, transcript?.videoId);
        if (reqId !== translateReqIdRef.current) return;
        setTranslationData(data);
      } catch (err) {
        if (reqId !== translateReqIdRef.current) return;
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Не вдалося отримати переклад. Перевірте підключення.';
        setTranslationError(msg);
      } finally {
        if (reqId === translateReqIdRef.current) {
          setTranslationLoading(false);
        }
      }
    },
    [activeTab, pauseOnWordClick, transcript?.videoId]
  );

  const handleCloseSheet = useCallback(() => {
    setSheetOpen(false);
    setSelectedWord(null);
    if (wasPlayingBeforeSheetRef.current && playerRef.current) {
      playerRef.current.play();
      wasPlayingBeforeSheetRef.current = false;
    }
  }, []);

  const handleAddCardFromSheet = useCallback(
    (data: WordTranslation) => {
      addCard(data, transcript?.title);
      showToast(`«${data.word}» додано в карточки`);
    },
    [addCard, transcript?.title, showToast]
  );

  const handleRemoveCardFromSheet = useCallback(
    (normalizedWord: string) => {
      removeCardByWord(normalizedWord);
      showToast('Слово прибрано з карточок');
    },
    [removeCardByWord, showToast]
  );

  return (
    <div className="app-shell">
      {/* Top Header */}
      <header className="top-header">
        <div className="top-header__inner">
          <button
            type="button"
            className="brand"
            onClick={() => setActiveTab('video')}
            aria-label="Lexivue на головну"
          >
            <img src="/logo.png" alt="" className="brand__logo" aria-hidden="true" />
            <span className="brand__name">Lexivue</span>
          </button>

          {/* Desktop Navigation */}
          <nav className="desktop-nav" aria-label="Основна навігація">
            <button
              type="button"
              className={`nav-pill${activeTab === 'video' ? ' nav-pill--active' : ''}`}
              onClick={() => setActiveTab('video')}
            >
              <PlaySquare size={16} />
              <span>Відео</span>
            </button>
            <button
              type="button"
              className={`nav-pill${activeTab === 'reading' ? ' nav-pill--active' : ''}`}
              onClick={() => setActiveTab('reading')}
            >
              <BookOpen size={16} />
              <span>Читати</span>
            </button>
            <button
              type="button"
              className={`nav-pill${activeTab === 'cards' ? ' nav-pill--active' : ''}`}
              onClick={() => setActiveTab('cards')}
            >
              <Layers size={16} />
              <span>Карточки</span>
              {cards.length > 0 && <span className="nav-count">{cards.length}</span>}
            </button>
          </nav>

          {/* Right Header Controls: Theme toggle + Mobile cards chip */}
          <div className="header-actions">
            <button
              type="button"
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему'}
              title={theme === 'dark' ? 'Світла тема' : 'Темна тема'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            <button
              type="button"
              className="mobile-cards-chip"
              onClick={() => setActiveTab('cards')}
              aria-label="Перейти до карточок"
            >
              <Layers size={15} />
              <span>{cards.length}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'video' && (
          <VideoStudyView
            urlInput={urlInput}
            onUrlInputChange={setUrlInput}
            transcript={transcript}
            loading={videoLoading}
            error={videoError}
            savedWords={savedNormalizedSet}
            selectedWord={selectedWord}
            highlightedPhrases={highlightedPhrases}
            prefetchChunks={prefetchChunks}
            prefetchedChunkCount={prefetchedChunkCount}
            onPrefetchChunk={handlePrefetchChunk}
            pauseOnWordClick={pauseOnWordClick}
            onTogglePauseOnWordClick={() => setPauseOnWordClick((v) => !v)}
            playerRef={playerRef}
            onLoadVideo={handleLoadVideo}
            onWordClick={handleWordClick}
            onOpenReadingMode={() => setActiveTab('reading')}
          />
        )}

        {activeTab === 'reading' && (
          <ReadingView
            transcript={transcript}
            savedWords={savedNormalizedSet}
            selectedWord={selectedWord}
            highlightedPhrases={highlightedPhrases}
            onWordClick={handleWordClick}
            onGoToVideo={() => setActiveTab('video')}
          />
        )}

        {activeTab === 'cards' && (
          <FlashcardsView
            cards={cards}
            onToggleLearned={toggleLearned}
            onRemoveCard={removeCardById}
            onAddManualCard={(w, t, c) => {
              addManualCard(w, t, c);
              showToast(`«${w.trim()}» додано в карточки`);
            }}
            onAddStarterPack={() => {
              addStarterPack();
              showToast('Додано 3 приклади для знайомства');
            }}
            onGoToVideo={() => setActiveTab('video')}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar (iPhone 13 optimized) */}
      <nav className="mobile-tabbar" aria-label="Мобільна навігація">
        <button
          type="button"
          className={`tabbar-item${activeTab === 'video' ? ' tabbar-item--active' : ''}`}
          onClick={() => setActiveTab('video')}
        >
          <PlaySquare size={20} />
          <span>Відео</span>
        </button>
        <button
          type="button"
          className={`tabbar-item${activeTab === 'reading' ? ' tabbar-item--active' : ''}`}
          onClick={() => setActiveTab('reading')}
        >
          <BookOpen size={20} />
          <span>Читати</span>
        </button>
        <button
          type="button"
          className={`tabbar-item${activeTab === 'cards' ? ' tabbar-item--active' : ''}`}
          onClick={() => setActiveTab('cards')}
        >
          <span className="tabbar-icon-wrap">
            <Layers size={20} />
            {cards.length > 0 && <span className="tabbar-badge">{cards.length}</span>}
          </span>
          <span>Карточки</span>
        </button>
      </nav>

      {/* Bottom Sheet Word Translator */}
      <TranslationSheet
        open={sheetOpen}
        word={selectedWord || ''}
        loading={translationLoading}
        error={translationError}
        data={translationData}
        isSaved={Boolean(
          translationData
            ? hasWord(translationData.normalized)
            : selectedWord && hasWord(selectedWord)
        )}
        isPhraseSaved={Boolean(
          translationData?.phrase && hasWord(translationData.phrase.trim().toLowerCase())
        )}
        onAddCard={handleAddCardFromSheet}
        onRemoveCard={handleRemoveCardFromSheet}
        onClose={handleCloseSheet}
      />

      {/* Minimal Toast */}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast__dot">
            <Check size={13} strokeWidth={3} />
          </span>
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default App;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Link2,
  Loader2,
  Play,
  BookOpen,
  Sparkles,
  ArrowDownToLine,
  AlertCircle,
  PauseCircle,
} from 'lucide-react';
import { VideoPrefetchChunk, VideoTranscript } from '../types';
import { PRESET_VIDEOS } from '../data/presets';
import { formatTime, buildContextSentenceAroundSegment } from '../utils/text';
import { YouTubePlayer, YouTubePlayerHandle } from './YouTubePlayer';
import { InteractiveText } from './InteractiveText';

interface VideoStudyViewProps {
  urlInput: string;
  onUrlInputChange: (val: string) => void;
  transcript: VideoTranscript | null;
  loading: boolean;
  error: string | null;
  savedWords: Set<string>;
  selectedWord: string | null;
  highlightedPhrases: string[];
  prefetchChunks: VideoPrefetchChunk[];
  prefetchedChunkCount: number;
  onPrefetchChunk: (chunkIndex: number) => void;
  pauseOnWordClick: boolean;
  onTogglePauseOnWordClick: () => void;
  playerRef: React.RefObject<YouTubePlayerHandle | null>;
  onLoadVideo: (urlOrId: string) => void;
  onWordClick: (word: string, contextText: string) => void;
  onOpenReadingMode: () => void;
}

export const VideoStudyView: React.FC<VideoStudyViewProps> = ({
  urlInput,
  onUrlInputChange,
  transcript,
  loading,
  error,
  savedWords,
  selectedWord,
  highlightedPhrases,
  prefetchChunks,
  prefetchedChunkCount,
  onPrefetchChunk,
  pauseOnWordClick,
  onTogglePauseOnWordClick,
  playerRef,
  onLoadVideo,
  onWordClick,
  onOpenReadingMode,
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCurrentTime(0);
  }, [transcript?.videoId]);

  // Lazy prefetch: prefetch current chunk + lookahead next chunk once 55% through current chunk
  const currentChunkIdx = useMemo(() => {
    if (!prefetchChunks.length) return -1;
    for (let i = 0; i < prefetchChunks.length; i++) {
      if (currentTime <= prefetchChunks[i].endSec + 1) return i;
    }
    return prefetchChunks.length - 1;
  }, [prefetchChunks, currentTime]);

  useEffect(() => {
    if (!transcript || currentChunkIdx < 0 || !prefetchChunks[currentChunkIdx]) return;
    const chunk = prefetchChunks[currentChunkIdx];
    onPrefetchChunk(chunk.chunkIndex);

    const span = Math.max(10, chunk.endSec - chunk.startSec);
    const progress = (currentTime - chunk.startSec) / span;
    if (progress >= 0.55 && currentChunkIdx + 1 < prefetchChunks.length) {
      onPrefetchChunk(prefetchChunks[currentChunkIdx + 1].chunkIndex);
    }
  }, [transcript, currentChunkIdx, prefetchChunks, currentTime, onPrefetchChunk]);

  const activeIndex = useMemo(() => {
    if (!transcript || transcript.segments.length === 0) return -1;
    const segs = transcript.segments;
    // Prefer the LATEST segment that has already started and hasn't ended yet
    // so consecutive cues switch instantaneously without lingering on the previous phrase
    let active = -1;
    for (let i = 0; i < segs.length; i++) {
      if (currentTime + 0.06 >= segs[i].start && currentTime < segs[i].end + 0.12) {
        active = i;
      } else if (segs[i].start > currentTime + 0.06) {
        break;
      }
    }
    if (active !== -1) return active;

    // Fall back to the most recently started subtitle within 3 seconds
    let latest = -1;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].start <= currentTime + 0.06) {
        latest = i;
      } else {
        break;
      }
    }
    if (latest !== -1 && currentTime - segs[latest].end <= 3) {
      return latest;
    }
    return -1;
  }, [transcript, currentTime]);

  useEffect(() => {
    if (!autoScroll || activeIndex < 0 || !activeItemRef.current || !listRef.current) return;
    const container = listRef.current;
    const el = activeItemRef.current;
    const elTop = el.offsetTop - container.offsetTop;
    const targetTop = elTop - container.clientHeight * 0.32;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, [activeIndex, autoScroll]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || loading) return;
    onLoadVideo(urlInput.trim());
  };

  const activeSegment =
    transcript && activeIndex >= 0 ? transcript.segments[activeIndex] : null;

  const activeWordIndex = useMemo(() => {
    if (!activeSegment) return null;
    const timings = activeSegment.wordTimings;
    if (!timings || timings.length === 0) return null;

    // Only highlight while inside the active segment's time range
    if (currentTime < activeSegment.start - 0.25 || currentTime > activeSegment.end + 0.35) {
      return null;
    }

    // Small 60ms anticipation offsets human visual reaction so highlight feels spot-on
    const t = currentTime + 0.06;

    for (let i = 0; i < timings.length; i++) {
      if (t >= timings[i].start && t < timings[i].end) {
        return i;
      }
    }

    // Fall back to the most recently started word in this cue
    let latest = 0;
    for (let i = 0; i < timings.length; i++) {
      if (timings[i].start <= t) {
        latest = i;
      } else {
        break;
      }
    }
    return latest;
  }, [activeSegment, currentTime]);

  const handleSegmentWordClick = (
    segIndex: number,
    word: string,
    fallbackText: string,
    wordIdx?: number
  ) => {
    if (transcript && segIndex >= 0 && prefetchChunks.length > 0) {
      const segTime = transcript.segments[segIndex]?.start ?? 0;
      const targetChunk = prefetchChunks.find((c) => segTime <= c.endSec + 1);
      if (targetChunk) {
        onPrefetchChunk(targetChunk.chunkIndex);
      }
    }
    const context =
      transcript && segIndex >= 0
        ? buildContextSentenceAroundSegment(transcript.segments, segIndex, word, wordIdx)
        : fallbackText;
    onWordClick(word, context || fallbackText);
  };

  return (
    <section className="page-section">
      {/* YouTube URL bar */}
      <form className="url-bar" onSubmit={handleSubmit}>
        <div className="url-input-wrap">
          <Link2 size={18} className="url-input-icon" />
          <input
            type="text"
            className="url-input"
            placeholder="Вставте посилання з YouTube…"
            value={urlInput}
            onChange={(e) => onUrlInputChange(e.target.value)}
            aria-label="Посилання на YouTube відео"
          />
          {urlInput && (
            <button
              type="button"
              className="url-clear-btn"
              onClick={() => onUrlInputChange('')}
              aria-label="Очистити поле"
            >
              ×
            </button>
          )}
        </div>
        <button
          type="submit"
          className="btn btn--black url-submit-btn"
          disabled={loading || !urlInput.trim()}
        >
          {loading ? <Loader2 size={17} className="spin" /> : 'Відкрити'}
        </button>
      </form>

      {error && (
        <div className="alert-box">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {!transcript && !loading && (
        <div className="welcome-card">
          <div className="welcome-badge">
            <Sparkles size={14} />
            <span>Навчання через YouTube</span>
          </div>
          <h1 className="welcome-title">
            Дивіться відео англійською та перекладайте слова одним дотиком
          </h1>
          <p className="welcome-desc">
            Вставте будь-яке посилання з YouTube зверху — субтитри зʼявляться в реальному часі.
            Натисніть на незнайоме слово, щоб побачити переклад українською й додати його в
            карточки.
          </p>

          <div className="presets-block">
            <div className="presets-label">Або спробуйте одразу на одному з цих відео:</div>
            <div className="presets-grid">
              {PRESET_VIDEOS.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  className="preset-card"
                  onClick={() => {
                    const url = `https://www.youtube.com/watch?v=${video.id}`;
                    onUrlInputChange(url);
                    onLoadVideo(url);
                  }}
                >
                  <div className="preset-card__top">
                    <span className="badge badge--yellow">{video.level}</span>
                    <span className="preset-card__dur">{video.duration}</span>
                  </div>
                  <div className="preset-card__title">{video.title}</div>
                  <div className="preset-card__footer">
                    <span className="preset-card__channel">{video.channel}</span>
                    <span className="preset-card__play">
                      <Play size={13} fill="currentColor" />
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="loading-state">
          <Loader2 size={28} className="spin" />
          <p>Завантажуємо відео та створюємо субтитри…</p>
        </div>
      )}

      {transcript && !loading && (
        <div className="video-workspace">
          {/* Left column (sticky on mobile!) */}
          <div className="video-column">
            <div className="video-sticky-wrap">
              <YouTubePlayer
                ref={playerRef}
                videoId={transcript.videoId}
                onTimeUpdate={setCurrentTime}
              />

              {/* Live current subtitle bar right under the player */}
              <div className="live-caption-bar">
                <div className="live-caption-bar__header">
                  <span className="live-dot" />
                  <span>Зараз у відео</span>
                  <span className="live-caption-hint">Натисніть на слово для перекладу</span>
                </div>
                <div className="live-caption-bar__text">
                  {activeSegment ? (
                    <InteractiveText
                      text={activeSegment.text}
                      savedWords={savedWords}
                      selectedWord={selectedWord}
                      activeWordIndex={activeWordIndex}
                      highlightedPhrases={highlightedPhrases}
                      onWordClick={(word, segText, wordIdx) =>
                        handleSegmentWordClick(activeIndex, word, segText, wordIdx)
                      }
                    />
                  ) : (
                    <span className="live-caption-placeholder">
                      Увімкніть відео — тут у прямому часі зʼявлятимуться субтитри
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Video metadata & quick action */}
            <div className="video-info-card">
              <div className="video-info-main">
                <h2 className="video-title">{transcript.title}</h2>
                <div className="video-meta">
                  {transcript.author && <span>{transcript.author}</span>}
                  <span>·</span>
                  <span>{transcript.segments.length} фраз</span>
                  {transcript.isAutoGenerated ? (
                    <span
                      className="badge badge--neutral"
                      title="YouTube згенерував ці субтитри автоматично — на швидкій мові чи музиці можливі неточності"
                    >
                      авто-субтитри YouTube
                    </span>
                  ) : (
                    <span className="badge badge--yellow">ручні субтитри</span>
                  )}
                  {prefetchedChunkCount > 0 && (
                    <span
                      className="badge badge--neutral"
                      title="Переклади речень, ідіом та ключових слів для цього уривку вже готові в памʼяті"
                    >
                      <Sparkles size={11} />
                      <span>
                        {highlightedPhrases.length > 0
                          ? `швидкий переклад · ${highlightedPhrases.length} ідіом`
                          : 'швидкий переклад'}
                      </span>
                    </span>
                  )}
                  {transcript.language && !transcript.language.toLowerCase().startsWith('en') && (
                    <span className="badge badge--coral">
                      мова субтитрів: {transcript.language}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={onOpenReadingMode}
              >
                <BookOpen size={15} />
                <span>Читати текст</span>
              </button>
            </div>
          </div>

          {/* Right column: synced full subtitle stream */}
          <div className="subtitles-panel">
            <div className="subtitles-panel__header">
              <div className="subtitles-panel__title">Субтитри</div>
              <div className="subtitles-panel__controls">
                <button
                  type="button"
                  className={`chip-toggle${pauseOnWordClick ? ' chip-toggle--active' : ''}`}
                  onClick={onTogglePauseOnWordClick}
                  title="Автоматично ставити відео на паузу при натисканні на слово"
                >
                  <PauseCircle size={14} />
                  <span>Пауза на слові</span>
                </button>
                <button
                  type="button"
                  className={`chip-toggle${autoScroll ? ' chip-toggle--active' : ''}`}
                  onClick={() => setAutoScroll((v) => !v)}
                  title="Автоматично прокручувати до активної фрази"
                >
                  <ArrowDownToLine size={14} />
                  <span>Автопрокрутка</span>
                </button>
              </div>
            </div>

            <div className="subtitles-list" ref={listRef}>
              {transcript.segments.map((seg, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <div
                    key={seg.id}
                    ref={isActive ? activeItemRef : undefined}
                    className={`subtitle-row${isActive ? ' subtitle-row--active' : ''}`}
                  >
                    <button
                      type="button"
                      className="subtitle-time"
                      onClick={() => playerRef.current?.seekTo(seg.start, true)}
                      title="Перейти до цього моменту"
                    >
                      {formatTime(seg.start)}
                    </button>
                    <div className="subtitle-text">
                      <InteractiveText
                        text={seg.text}
                        savedWords={savedWords}
                        selectedWord={selectedWord}
                        activeWordIndex={isActive ? activeWordIndex : null}
                        highlightedPhrases={highlightedPhrases}
                        onWordClick={(word, segText, wordIdx) =>
                          handleSegmentWordClick(idx, word, segText, wordIdx)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

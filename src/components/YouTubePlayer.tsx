import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        opts: Record<string, unknown>
      ) => YTPlayerInstance;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
        BUFFERING: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  loadVideoById: (videoId: string) => void;
  cueVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

export interface YouTubePlayerHandle {
  seekTo: (seconds: number, autoPlay?: boolean) => void;
  pause: () => void;
  play: () => void;
  isPlaying: () => boolean;
}

interface YouTubePlayerProps {
  videoId: string;
  onTimeUpdate: (currentTime: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeAPI(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();

  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevCallback?.();
        resolve();
      };
      const existing = document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]'
      );
      if (!existing) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
      }
    });
  }

  return ytApiPromise;
}

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  ({ videoId, onTimeUpdate, onPlayingChange }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const readyRef = useRef(false);
    const currentVideoIdRef = useRef(videoId);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onPlayingChangeRef = useRef(onPlayingChange);

    onTimeUpdateRef.current = onTimeUpdate;
    onPlayingChangeRef.current = onPlayingChange;

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number, autoPlay = true) {
        if (!playerRef.current || !readyRef.current) return;
        playerRef.current.seekTo(seconds, true);
        onTimeUpdateRef.current(seconds);
        if (autoPlay) {
          playerRef.current.playVideo();
        }
      },
      pause() {
        if (!playerRef.current || !readyRef.current) return;
        playerRef.current.pauseVideo();
      },
      play() {
        if (!playerRef.current || !readyRef.current) return;
        playerRef.current.playVideo();
      },
      isPlaying() {
        if (!playerRef.current || !readyRef.current || !window.YT) return false;
        return playerRef.current.getPlayerState() === window.YT.PlayerState.PLAYING;
      },
    }));

    useEffect(() => {
      let mounted = true;
      let timer: number | null = null;

      loadYouTubeIframeAPI().then(() => {
        if (!mounted || !containerRef.current || !window.YT) return;

        // Fresh inner mount node so YouTube iframe replacement doesn't break React DOM
        containerRef.current.innerHTML = '';
        const mountNode = document.createElement('div');
        containerRef.current.appendChild(mountNode);

        const player = new window.YT.Player(mountNode, {
          videoId: currentVideoIdRef.current,
          width: '100%',
          height: '100%',
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            cc_load_policy: 0,
          },
          events: {
            onReady: () => {
              if (!mounted) return;
              readyRef.current = true;
              timer = window.setInterval(() => {
                if (!playerRef.current || !readyRef.current) return;
                try {
                  const t = playerRef.current.getCurrentTime();
                  if (typeof t === 'number' && !Number.isNaN(t)) {
                    onTimeUpdateRef.current(t);
                  }
                } catch {
                  // ignore while destroyed
                }
              }, 50);
            },
            onStateChange: (event: { data: number }) => {
              if (!mounted || !window.YT) return;
              const isNowPlaying = event.data === window.YT.PlayerState.PLAYING;
              onPlayingChangeRef.current?.(isNowPlaying);
              if (playerRef.current) {
                try {
                  onTimeUpdateRef.current(playerRef.current.getCurrentTime() || 0);
                } catch {
                  // ignore
                }
              }
            },
          },
        });

        playerRef.current = player;
      });

      return () => {
        mounted = false;
        readyRef.current = false;
        if (timer !== null) window.clearInterval(timer);
        if (playerRef.current) {
          try {
            playerRef.current.destroy();
          } catch {
            // ignore
          }
          playerRef.current = null;
        }
      };
    }, []);

    useEffect(() => {
      if (currentVideoIdRef.current === videoId) return;
      currentVideoIdRef.current = videoId;
      if (playerRef.current && readyRef.current) {
        playerRef.current.cueVideoById(videoId);
        onTimeUpdateRef.current(0);
      }
    }, [videoId]);

    return (
      <div className="video-frame">
        <div ref={containerRef} className="video-frame__mount" />
      </div>
    );
  }
);

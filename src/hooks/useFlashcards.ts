import { useState, useEffect, useCallback, useMemo } from 'react';
import { Flashcard, WordTranslation } from '../types';
import { STARTER_CARDS } from '../data/presets';

const STORAGE_KEY = 'lexivue_flashcards_v1';
const LEGACY_STORAGE_KEY = 'lexview_flashcards_v1';

function loadInitialCards(): Flashcard[] {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useFlashcards() {
  const [cards, setCards] = useState<Flashcard[]>(loadInitialCards);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    } catch {
      // ignore quota errors
    }
  }, [cards]);

  const savedNormalizedSet = useMemo(
    () => new Set(cards.map((c) => c.normalized)),
    [cards]
  );

  const hasWord = useCallback(
    (word: string) => savedNormalizedSet.has(word.trim().toLowerCase()),
    [savedNormalizedSet]
  );

  const addCard = useCallback(
    (data: WordTranslation, sourceTitle?: string) => {
      const normalized = data.normalized || data.word.trim().toLowerCase();
      setCards((prev) => {
        if (prev.some((c) => c.normalized === normalized)) return prev;
        const newCard: Flashcard = {
          id: `${normalized}-${Date.now()}`,
          word: data.word,
          normalized,
          translation: data.translation,
          alternatives: data.alternatives || [],
          partOfSpeechUk: data.partOfSpeechUk,
          phonetic: data.phonetic,
          audio: data.audio,
          context: data.sentence,
          contextTranslation: data.sentenceTranslation,
          sourceTitle,
          learned: false,
          createdAt: Date.now(),
        };
        return [newCard, ...prev];
      });
    },
    []
  );

  const addManualCard = useCallback(
    (word: string, translation: string, alternativesText?: string) => {
      const cleanWord = word.trim();
      const cleanTranslation = translation.trim();
      if (!cleanWord || !cleanTranslation) return;
      const normalized = cleanWord.toLowerCase();
      const alternatives = (alternativesText || '')
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(
          (s, idx, arr) =>
            s &&
            s.toLowerCase() !== cleanTranslation.toLowerCase() &&
            arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === idx
        )
        .slice(0, 6);
      setCards((prev) => {
        if (prev.some((c) => c.normalized === normalized)) return prev;
        const newCard: Flashcard = {
          id: `${normalized}-${Date.now()}`,
          word: cleanWord,
          normalized,
          translation: cleanTranslation,
          alternatives,
          sourceTitle: 'Додано вручну',
          learned: false,
          createdAt: Date.now(),
        };
        return [newCard, ...prev];
      });
    },
    []
  );

  const removeCardById = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const removeCardByWord = useCallback((normalizedWord: string) => {
    const target = normalizedWord.trim().toLowerCase();
    setCards((prev) => prev.filter((c) => c.normalized !== target));
  }, []);

  const toggleLearned = useCallback((id: string) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, learned: !c.learned } : c))
    );
  }, []);

  const addStarterPack = useCallback(() => {
    setCards((prev) => {
      const existing = new Set(prev.map((c) => c.normalized));
      const toAdd: Flashcard[] = STARTER_CARDS.filter((s) => !existing.has(s.normalized)).map(
        (s, idx) => ({
          ...s,
          id: `starter-${s.normalized}-${Date.now()}-${idx}`,
          learned: false,
          createdAt: Date.now() - idx * 1000,
        })
      );
      return [...toAdd, ...prev];
    });
  }, []);

  return {
    cards,
    savedNormalizedSet,
    hasWord,
    addCard,
    addManualCard,
    removeCardById,
    removeCardByWord,
    toggleLearned,
    addStarterPack,
  };
}

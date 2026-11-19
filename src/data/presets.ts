export interface PresetVideo {
  id: string;
  title: string;
  channel: string;
  level: string;
  duration: string;
}

export const PRESET_VIDEOS: PresetVideo[] = [
  {
    id: 'arj7oStGLkU',
    title: 'Inside the Mind of a Master Procrastinator',
    channel: 'TED · Tim Urban',
    level: 'B1–B2',
    duration: '14:04',
  },
  {
    id: 'UF8uR6Z6KLc',
    title: "Steve Jobs' 2005 Stanford Commencement Address",
    channel: 'Stanford',
    level: 'B1–B2',
    duration: '15:04',
  },
  {
    id: 'eIho2S0ZahI',
    title: 'How to speak so that people want to listen',
    channel: 'TED · Julian Treasure',
    level: 'B1',
    duration: '09:58',
  },
];

export const SAMPLE_READING_TEXT = `Learning a new language rarely happens in one dramatic moment. Instead, it grows quietly through small daily habits. When you listen to real conversations, notice unfamiliar expressions, and revisit them a few times, your brain begins to recognize patterns effortlessly.

Watching short videos with synchronized subtitles is one of the most natural ways to train both your ear and your vocabulary. Whenever a curious word catches your attention, tap it to see its meaning in context, save it to your flashcards, and keep enjoying the story without breaking your flow.`;

export const STARTER_CARDS = [
  {
    word: 'effortlessly',
    normalized: 'effortlessly',
    translation: 'без зусиль',
    alternatives: ['легко', 'невимушено'],
    partOfSpeechUk: 'прислівник',
    phonetic: '/ˈef.ət.ləs.li/',
    context: 'Your brain begins to recognize patterns effortlessly.',
    contextTranslation: 'Ваш мозок починає розпізнавати закономірності без зусиль.',
    sourceTitle: 'Приклад для старту',
  },
  {
    word: 'curious',
    normalized: 'curious',
    translation: 'цікавий',
    alternatives: ['допитливий', 'незвичайний'],
    partOfSpeechUk: 'прикметник',
    phonetic: '/ˈkjʊə.ri.əs/',
    context: 'Whenever a curious word catches your attention, tap it.',
    contextTranslation: 'Щоразу, коли цікаве слово привертає вашу увагу, натисніть на нього.',
    sourceTitle: 'Приклад для старту',
  },
  {
    word: 'procrastinate',
    normalized: 'procrastinate',
    translation: 'відкладати на потім',
    alternatives: ['зволікати', 'прокрастинувати'],
    partOfSpeechUk: 'дієслово',
    phonetic: '/prəˈkræs.tɪ.neɪt/',
    context: 'We all procrastinate on big projects sometimes.',
    contextTranslation: 'Ми всі іноді відкладаємо великі проєкти на потім.',
    sourceTitle: 'Приклад для старту',
  },
];

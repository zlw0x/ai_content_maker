export type AppCategory = "Изображения" | "Видео" | "Бизнес" | "Аудио" | "Инструменты";
export type InputMode = "prompt" | "image-prompt" | "image-only" | "voice" | "product-card" | "scene";

export type AiApp = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: AppCategory;
  symbol: string;
  visualClass: string;
  mode: InputMode;
  demoStartingPrice: number | null;
  featured?: boolean;
  examples: string[];
};

export const categories = ["Все", "Изображения", "Видео", "Бизнес", "Аудио", "Инструменты"] as const;

export const apps: AiApp[] = [
  {
    slug: "product-card",
    title: "Карточка товара",
    subtitle: "Готовый макет из фото и названия",
    description: "Добавь фото, название и, по желанию, одно преимущество товара. Выбери оформление и скачай вертикальную карточку в PNG.",
    category: "Бизнес", symbol: "▣", visualClass: "tile-orange", mode: "product-card",
    demoStartingPrice: null, featured: true,
    examples: ["Термокружка · 450 мл · минимализм", "Подарочный набор · ручная работа · яркий акцент"],
  },
  {
    slug: "ai-b-roll",
    title: "AI B-roll",
    subtitle: "Пятисекундный клип из одной фразы",
    description: "Коротко опиши, что происходит в кадре, и выбери настроение. Настройки света, движения камеры и композиции добавятся автоматически.",
    category: "Видео", symbol: "▹", visualClass: "tile-violet", mode: "scene",
    demoStartingPrice: null, featured: true,
    examples: ["Пар поднимается над чашкой кофе", "Огни ночного города отражаются в лужах"],
  },
  {
    slug: "text-to-image",
    title: "Генератор изображений",
    subtitle: "Текст превращается в визуал",
    description: "Опиши идею своими словами и получи изображение. Выбирай стиль и формат — без технических параметров моделей.",
    category: "Изображения", symbol: "✺", visualClass: "tile-orchid", mode: "prompt",
    demoStartingPrice: 9, featured: true,
    examples: ["Футуристический мегаполис на закате", "Минималистичная иллюстрация для статьи"],
  },
  {
    slug: "premium-image",
    title: "AI Фото Pro",
    subtitle: "Больше деталей и реализма",
    description: "Визуальные концепции и фотореалистичные изображения по текстовому описанию.",
    category: "Изображения", symbol: "✦", visualClass: "tile-cyan", mode: "prompt",
    demoStartingPrice: 29, featured: true,
    examples: ["Предметная съёмка часов", "Пейзаж в стиле киноплёнки"],
  },
  {
    slug: "photo-editor",
    title: "Умный редактор",
    subtitle: "Измени фотографию текстом",
    description: "Загрузи свою фотографию и опиши, что нужно изменить — фон, цветовую атмосферу или детали.",
    category: "Изображения", symbol: "◫", visualClass: "tile-coral", mode: "image-prompt",
    demoStartingPrice: 29,
    examples: ["Сделай освещение студийным", "Замени фон на городской парк"],
  },
  {
    slug: "background-swap",
    title: "Замена фона",
    subtitle: "Новый фон за несколько шагов",
    description: "Планируемый инструмент для замены окружения объекта или человека.",
    category: "Изображения", symbol: "◇", visualClass: "tile-green", mode: "image-prompt",
    demoStartingPrice: 29,
    examples: ["Светлая фотостудия", "Современный интерьер"],
  },
  {
    slug: "ai-portrait",
    title: "AI Фотосессия",
    subtitle: "Новые стили для портрета",
    description: "Экспериментируй с визуальным стилем портретов на основе загруженной фотографии.",
    category: "Изображения", symbol: "◎", visualClass: "tile-gold", mode: "image-prompt",
    demoStartingPrice: 39,
    examples: ["Редакционная fashion-съёмка", "Портрет с мягким естественным светом"],
  },
  {
    slug: "photo-to-video",
    title: "Оживить фото",
    subtitle: "Преврати изображение в видео",
    description: "Добавь движение статичной фотографии: движение камеры, окружения и элементов кадра.",
    category: "Видео", symbol: "▶", visualClass: "tile-violet", mode: "image-prompt",
    demoStartingPrice: 59, featured: true,
    examples: ["Плавный наезд камеры", "Ветер качает деревья на фоне"],
  },
  {
    slug: "text-to-video",
    title: "Текст в видео",
    subtitle: "Видео по одной идее",
    description: "Опиши сцену, движение и настроение. Сервис подготовит короткий ролик.",
    category: "Видео", symbol: "▹", visualClass: "tile-blue", mode: "prompt",
    demoStartingPrice: 59, featured: true,
    examples: ["Ночной город под дождём", "Макросъёмка капель воды"],
  },
  {
    slug: "product-shot",
    title: "Фото товара",
    subtitle: "Контент для карточки и рекламы",
    description: "Размести товар на красивом фоне и создай маркетинговое изображение.",
    category: "Бизнес", symbol: "▣", visualClass: "tile-orange", mode: "image-prompt",
    demoStartingPrice: 39,
    examples: ["Флакон парфюма на камне", "Косметика на белом фоне"],
  },
  {
    slug: "ai-voiceover",
    title: "AI Озвучка",
    subtitle: "Текст в естественную речь",
    description: "Концепт озвучивания сценариев, коротких роликов и презентаций.",
    category: "Аудио", symbol: "♫", visualClass: "tile-mint", mode: "voice",
    demoStartingPrice: null,
    examples: ["Короткий текст для презентации", "Озвучка видеоролика"],
  },
  {
    slug: "upscale",
    title: "Улучшить качество",
    subtitle: "Больше чёткости и деталей",
    description: "Концепт инструмента улучшения разрешения и детализации существующих изображений.",
    category: "Инструменты", symbol: "↗", visualClass: "tile-slate", mode: "image-only",
    demoStartingPrice: null,
    examples: ["Увеличение разрешения", "Улучшение деталей фотографии"],
  },
];

export function getAppBySlug(slug: string): AiApp | undefined {
  return apps.find((app) => app.slug === slug);
}

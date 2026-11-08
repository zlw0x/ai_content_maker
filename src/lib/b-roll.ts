export const bRollMoods = ["cinematic", "realistic", "soft"] as const;
export type BRollMood = typeof bRollMoods[number];

export const bRollMoodLabels: Record<BRollMood, string> = {
  cinematic: "Кинематографично",
  realistic: "Реалистичная съёмка",
  soft: "Мягкий, атмосферный стиль",
};

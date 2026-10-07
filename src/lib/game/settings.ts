import { z } from "zod";

export const playerColors = [
  { id: "cherry", name: "Cherry", hex: "#c8443e" },
  { id: "tangerine", name: "Tangerine", hex: "#dc792d" },
  { id: "lemon", name: "Lemon", hex: "#d9b735" },
  { id: "fern", name: "Fern", hex: "#729c43" },
  { id: "teal", name: "Teal", hex: "#398f83" },
  { id: "sky", name: "Sky", hex: "#55a2c3" },
  { id: "cobalt", name: "Cobalt", hex: "#4d65bd" },
  { id: "violet", name: "Violet", hex: "#8460a8" },
  { id: "orchid", name: "Orchid", hex: "#b873b0" },
  { id: "rose", name: "Rose", hex: "#d77e90" },
  { id: "copper", name: "Copper", hex: "#9c6846" },
  { id: "slate", name: "Slate", hex: "#758a96" },
] as const;
export const playerColorSchema = z.enum(playerColors.map((c) => c.id));
export type PlayerColor = z.infer<typeof playerColorSchema>;
export const colorHex = (color: PlayerColor | null) =>
  playerColors.find((c) => c.id === color)?.hex ?? "#9b9484";
export const rulesSchema = z.object({
  stackDrawTwo: z.boolean(),
  drawUntilPlayable: z.boolean(),
  mustPlayDrawn: z.boolean(),
  unoPenalty: z.boolean(),
});
export type HouseRules = z.infer<typeof rulesSchema>;
export const classicRules: HouseRules = {
  stackDrawTwo: false,
  drawUntilPlayable: false,
  mustPlayDrawn: false,
  unoPenalty: true,
};
export const ruleOptions: {
  key: keyof HouseRules;
  title: string;
  description: string;
}[] = [
  {
    key: "stackDrawTwo",
    title: "Stack Draw Two",
    description:
      "Answer +2 with another +2 of any color. The first player who draws takes the whole stack and misses a turn. +4 never stacks.",
  },
  {
    key: "drawUntilPlayable",
    title: "Draw until playable",
    description:
      "Keep drawing until you find a playable card or the available deck runs out.",
  },
  {
    key: "mustPlayDrawn",
    title: "Play what you draw",
    description:
      "If your drawn card can be played, you must play it. Choose a color yourself for wild cards.",
  },
  {
    key: "unoPenalty",
    title: "Catch a missed UNO",
    description: "A player caught at one card without calling UNO draws two.",
  },
];
export const goalSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("points"),
    target: z.number().int().min(50).max(5000),
  }),
  z.object({
    mode: z.literal("rounds"),
    target: z.number().int().min(1).max(20),
  }),
]);
export type MatchGoal = z.infer<typeof goalSchema>;
export const goalLabel = (goal: MatchGoal) =>
  `First to ${goal.target} ${goal.mode === "points" ? "points" : goal.target === 1 ? "round win" : "round wins"}`;
export const isClassic = (rules: HouseRules) =>
  Object.keys(classicRules).every(
    (key) =>
      rules[key as keyof HouseRules] === classicRules[key as keyof HouseRules],
  );

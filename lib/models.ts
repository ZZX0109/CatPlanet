import type { CreatorDesign } from "./cat-creator-design";
export const models = [
  {
    id: "toon",
    name: "小橘",
    description: "修长身形 · 橘白毛色",
    url: "/models/toon_cat_free.glb",
    author: "Omabuarts Studio",
    license: "CC BY 4.0",
    source:
      "https://sketchfab.com/3d-models/toon-cat-free-b2bd1ee7858444bda366110a2d960386",
    walk: "Scene",
    sleep: "Scene",
    proceduralSleep: true,
    facing: 0,
    size: 1.5,
  },
  {
    id: "vuena",
    name: "团团",
    description: "圆润身形 · 银灰虎斑",
    url: "/models/vuena_cat.glb",
    author: "Vuena / Popyca",
    license: "CC0 1.0",
    source: "https://vuena.itch.io/blocky-pets-free",
    walk: "walk",
    sleep: "sleep",
    proceduralSleep: false,
    facing: 0,
    size: 1.5,
  },
] as const;
export type ModelId = (typeof models)[number]["id"];
export type Memory = { id: string; text: string };
export type Pet = {
  name: string;
  model: ModelId;
  personality: string;
  memories: Memory[];
  photoId: string | null;
  version: number;
  appearance?: CreatorDesign | null;
  appearanceAsset?: string | null;
};
export const emptyPet = (): Pet => ({
  name: "",
  model: "toon",
  personality: "",
  memories: [],
  photoId: null,
  version: 0,
});

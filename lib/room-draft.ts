import { currentRoomAsset, roomModelAsset } from "./room-model-assets";
import { parseCreatorDesign } from "./cat-creator-design";
import { models, type Pet } from "./models";

export type RoomDraft = {
  format: 1;
  pet: Pet;
  memory: string;
  editing: string | null;
  page: "create" | "room";
  photo: Blob | null;
  photoName: string;
  updatedAt: number;
};
const maxAge = 7 * 24 * 60 * 60 * 1000;
// Serialize writes and deletes so a late write cannot resurrect a discarded draft.
let queue: Promise<unknown> = Promise.resolve();
function operation<T>(scope: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const task = queue.catch(() => {}).then(() => new Promise<T>((resolve, reject) => {
    const open = indexedDB.open("miaoxing-room-drafts", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("drafts");
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("草稿存储正被其他页面占用"));
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction("drafts", mode);
      const request = action(transaction.objectStore("drafts"));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error ?? request.error); };
    };
  }));
  queue = task;
  return task;
}
export async function readRoomDraft(scope: string): Promise<RoomDraft | null> {
  const draft = await operation<RoomDraft | undefined>(scope, "readonly", store => store.get(scope));
  if (!draft) return null;
  if (draft.format !== 1 || !Number.isFinite(draft.updatedAt) || Date.now() - draft.updatedAt > maxAge) {
    await deleteRoomDraft(scope); return null;
  }
  const pet = draft.pet;
  if (!pet || typeof pet.name !== "string" || pet.name.length > 40 ||
      !models.some(m => m.id === pet.model) || typeof pet.personality !== "string" || pet.personality.length > 1000 ||
      !Array.isArray(pet.memories) || pet.memories.length > 50 ||
      pet.memories.some(m => typeof m.id !== "string" || typeof m.text !== "string" || m.text.length > 3000) ||
      !Number.isInteger(pet.version) || pet.version < 0 ||
      (pet.photoId !== null && typeof pet.photoId !== "string") ||
      typeof draft.memory !== "string" || draft.memory.length > 3000 ||
      (draft.editing !== null && !pet.memories.some(m => m.id === draft.editing)) ||
      !["create", "room"].includes(draft.page) ||
      (draft.photo !== null && (!(draft.photo instanceof Blob) || draft.photo.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(draft.photo.type)))) {
    throw new Error("草稿无法识别，请放弃草稿后继续。云端资料未改变。");
  }
  const appearance = pet.appearance ? parseCreatorDesign(pet.appearance) : null;
  const appearanceAsset = appearance ? pet.appearanceAsset ?? currentRoomAsset(appearance) : null;
  if (appearance && appearanceAsset) roomModelAsset(appearanceAsset, appearance);
  return { ...draft, pet: { ...pet, appearance, appearanceAsset } };
}
export function writeRoomDraft(scope: string, draft: RoomDraft) {
  return operation(scope, "readwrite", store => store.put(draft, scope));
}
export function deleteRoomDraft(scope: string) {
  return operation(scope, "readwrite", store => store.delete(scope));
}

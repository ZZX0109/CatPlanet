"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  creatorControls,
  creatorPresets,
  defaultCreatorDesign,
  parseCreatorDesign,
  serializeCreatorDesign,
  type CreatorDesign,
  type CreatorGroup,
  type CreatorKey,
  type CreatorPresetId,
  type CreatorCoatType,
} from "@/lib/cat-creator-design";
import { getCatCoatProfile } from "@/lib/cat-coat-profiles";

export const CREATOR_STORAGE_KEY = "miaoxing.cat-creator.foundation.v1";
export const PREVIOUS_CREATOR_STORAGE_KEY = "miaoxing.cat-creator.norwegian.v1";
const HISTORY_LIMIT = 40;
type State = {
  design: CreatorDesign;
  past: CreatorDesign[];
  future: CreatorDesign[];
  pending: CreatorDesign | null;
  saved: string | null;
  comparison: CreatorDesign;
  hydrated: boolean;
  message: string;
  error: string;
};
type Action =
  | { type: "load"; design?: CreatorDesign; error?: string }
  | {
      type: "change";
      values: Partial<CreatorDesign["shape"]>;
      coupleBlend: boolean;
    }
  | { type: "commit" }
  | { type: "coat-mode"; mode: CreatorDesign["coatMode"] }
  | { type: "replace"; design: CreatorDesign; message: string }
  | { type: "undo" | "redo" | "capture-comparison" }
  | { type: "saved"; signature: string }
  | { type: "error"; message: string };

const same = (a: CreatorDesign, b: CreatorDesign) =>
  serializeCreatorDesign(a) === serializeCreatorDesign(b);
const copy = (design: CreatorDesign): CreatorDesign => ({
  ...design,
  shape: { ...design.shape },
});

function commit(state: State): State {
  if (!state.pending) return state;
  return {
    ...state,
    pending: null,
    past: same(state.pending, state.design)
      ? state.past
      : [...state.past, state.pending].slice(-HISTORY_LIMIT),
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "load": {
      // Fast Refresh can retain an unsaved v3/v4 design in memory. Migrate
      // that exact design as well, preserving its face and fur values.
      const design = action.design ?? parseCreatorDesign(state.design);
      return {
        ...state,
        design,
        comparison: copy(design),
        saved: action.design ? serializeCreatorDesign(action.design) : null,
        hydrated: true,
        message: action.design
          ? "已恢复这台设备保存的猫咪外观。"
          : "选择头型，或点选部位开始调整。",
        error: action.error ?? "",
      };
    }
    case "change": {
      if (!state.hydrated) return state;
      if (
        Object.keys(action.values).some(
          (key) => !creatorControls.some((control) => control.key === key),
        ) ||
        Object.values(action.values).some(
          (value) =>
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 100,
        )
      ) {
        return {
          ...state,
          error: "调整未应用：猫咪参数应在 0–100 之间。当前外观已保留。",
        };
      }
      const shape = { ...state.design.shape };
      let changed = false;
      for (const { key } of creatorControls) {
        const value = action.values[key];
        if (value === undefined || value === shape[key]) continue;
        shape[key] = value;
        changed = true;
      }
      if (action.coupleBlend) {
        if (action.values.headRound !== undefined)
          shape.headWedge = Math.min(shape.headWedge, 100 - shape.headRound);
        else if (action.values.headWedge !== undefined)
          shape.headRound = Math.min(shape.headRound, 100 - shape.headWedge);
      }
      if (shape.headRound + shape.headWedge > 100) {
        return {
          ...state,
          error:
            "调整未应用：圆润与楔形的混合比例之和不能超过 100。当前外观已保留。",
        };
      }
      if (!changed) return state;
      return {
        ...state,
        design: { ...state.design, shape },
        pending: state.pending ?? state.design,
        future: [],
        message: "猫咪已调整，记得保存。",
        error: "",
      };
    }
    case "commit":
      return commit(state);
    case "coat-mode": {
      if (
        !state.hydrated ||
        (action.mode !== "source" && action.mode !== "groom")
      )
        return state;
      const base = commit(state);
      if (base.design.coatMode === action.mode) return base;
      return {
        ...base,
        design: { ...base.design, coatMode: action.mode },
        past: [...base.past, base.design].slice(-HISTORY_LIMIT),
        future: [],
        message:
          action.mode === "source"
            ? "仅显示原模型，完整被毛的毛量和毛长已保留。"
            : "已开启完整被毛，可调整各部位的毛量和毛长。",
        error: "",
      };
    }
    case "replace": {
      if (!state.hydrated) return state;
      const base = commit(state);
      if (same(base.design, action.design))
        return { ...base, message: action.message, error: "" };
      return {
        ...base,
        design: copy(action.design),
        past: [...base.past, base.design].slice(-HISTORY_LIMIT),
        future: [],
        message: action.message,
        error: "",
      };
    }
    case "undo": {
      const base = commit(state);
      if (!base.past.length) return base;
      return {
        ...base,
        design: base.past[base.past.length - 1],
        past: base.past.slice(0, -1),
        future: [base.design, ...base.future].slice(0, HISTORY_LIMIT),
        message: "已撤销上一次调整。",
        error: "",
      };
    }
    case "redo": {
      const base = commit(state);
      if (!base.future.length) return base;
      return {
        ...base,
        design: base.future[0],
        past: [...base.past, base.design].slice(-HISTORY_LIMIT),
        future: base.future.slice(1),
        message: "已重做调整。",
        error: "",
      };
    }
    case "capture-comparison":
      return {
        ...commit(state),
        comparison: copy(state.design),
        message: "已将当前外观设为对照。之后可随时查看调整前后的差别。",
      };
    case "saved":
      return {
        ...commit(state),
        saved: action.signature,
        message: "猫咪外观已保存在这台设备的浏览器中。",
        error: "",
      };
    case "error":
      return { ...state, error: action.message };
  }
}

export function useCatCreatorDesign() {
  const [state, dispatch] = useReducer(reducer, {
    design: copy(defaultCreatorDesign),
    past: [],
    future: [],
    pending: null,
    saved: null,
    comparison: copy(defaultCreatorDesign),
    hydrated: false,
    message: "正在恢复猫咪外观…",
    error: "",
  });
  const importSerial = useRef(0);
  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(CREATOR_STORAGE_KEY) ??
        localStorage.getItem(PREVIOUS_CREATOR_STORAGE_KEY);
      dispatch({
        type: "load",
        design: raw ? parseCreatorDesign(JSON.parse(raw)) : undefined,
      });
    } catch {
      dispatch({
        type: "load",
        error:
          "未能恢复本机记录。原记录仍保留，你可以导入备份，或重新调整后保存。",
      });
    }
    return () => {
      importSerial.current++;
    };
  }, []);

  return {
    ...state,
    canUndo:
      state.past.length > 0 ||
      (!!state.pending && !same(state.pending, state.design)),
    canRedo: state.future.length > 0,
    isSaved: state.saved === serializeCreatorDesign(state.design),
    change(key: CreatorKey, value: number) {
      dispatch({ type: "change", values: { [key]: value }, coupleBlend: true });
    },
    changeMany(values: Partial<CreatorDesign["shape"]>) {
      dispatch({ type: "change", values, coupleBlend: false });
    },
    commit() {
      dispatch({ type: "commit" });
    },
    undo() {
      dispatch({ type: "undo" });
    },
    redo() {
      dispatch({ type: "redo" });
    },
    reset(group?: CreatorGroup) {
      const shape = { ...state.design.shape };
      for (const { key, group: controlGroup } of creatorControls) {
        if (!group || group === controlGroup)
          shape[key] = defaultCreatorDesign.shape[key];
      }
      if (!group || group === "fur")
        Object.assign(shape, getCatCoatProfile(state.design.coatType).defaults);
      dispatch({
        type: "replace",
        design: { ...state.design, shape },
        message: group
          ? "已重置当前部位，可以撤销。"
          : "已恢复基础猫咪，可以撤销。",
      });
    },
    preset(id: CreatorPresetId) {
      const preset = creatorPresets.find((item) => item.id === id);
      if (!preset) return;
      const design = copy(preset.design);
      design.coatType = state.design.coatType;
      design.coatMode = state.design.coatMode;
      for (const { key, group } of creatorControls)
        if (group === "fur") design.shape[key] = state.design.shape[key];
      dispatch({
        type: "replace",
        design,
        message: `已应用${preset.label}，可以继续精细调整。`,
      });
    },
    coat(coatType: CreatorCoatType) {
      if (!state.hydrated || coatType === state.design.coatType) return;
      const profile = getCatCoatProfile(coatType);
      dispatch({
        type: "replace",
        design: {
          ...state.design,
          coatType,
          shape: { ...state.design.shape, ...profile.defaults },
        },
        message: `已切换为${profile.label}，脸型调整已保留。`,
      });
    },
    coatMode(mode: CreatorDesign["coatMode"]) {
      dispatch({ type: "coat-mode", mode });
    },
    captureComparison() {
      dispatch({ type: "capture-comparison" });
    },
    save() {
      if (!state.hydrated) return;
      try {
        const signature = serializeCreatorDesign(state.design);
        localStorage.setItem(CREATOR_STORAGE_KEY, signature);
        dispatch({ type: "saved", signature });
      } catch {
        dispatch({
          type: "error",
          message: "浏览器未能保存。当前调整仍在，请导出外观 JSON 作为备份。",
        });
      }
    },
    async importFile(file: File) {
      const serial = ++importSerial.current;
      try {
        if (file.size > 64 * 1024) throw new Error("File too large");
        const design = parseCreatorDesign(JSON.parse(await file.text()));
        if (serial !== importSerial.current) return;
        dispatch({
          type: "replace",
          design,
          message: "猫咪外观已导入。点击保存可保留在这台设备上。",
        });
      } catch {
        if (serial !== importSerial.current) return;
        dispatch({
          type: "error",
          message:
            "导入失败：请选择猫咪模板外观 JSON，类型应为无毛、短毛或长毛，参数应在 0–100 之间。当前调整和本机保存已保留。",
        });
      }
    },
  };
}

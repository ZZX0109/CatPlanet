"use client";

import { useEffect, useReducer } from "react";
import {
  defaultFaceDesign,
  parseFaceDesign,
  type FaceDesign,
  type FaceKey,
} from "@/lib/tabby-face";

const STORAGE_KEY = "miaoxing.tabby-face.v1";
const signature = (design: FaceDesign) => JSON.stringify(design);
type State = {
  design: FaceDesign;
  past: FaceDesign[];
  future: FaceDesign[];
  pending: FaceDesign | null;
  saved: string | null;
  hydrated: boolean;
  message: string;
  error: string;
};
type Action =
  | { type: "load"; design?: FaceDesign; error?: string }
  | { type: "change"; key: FaceKey; value: number }
  | { type: "commit" }
  | { type: "replace"; design: FaceDesign; message: string }
  | { type: "undo" | "redo" }
  | { type: "saved" }
  | { type: "error"; message: string };

function commit(state: State): State {
  if (!state.pending) return state;
  return {
    ...state,
    pending: null,
    past:
      signature(state.pending) === signature(state.design)
        ? state.past
        : [...state.past, state.pending].slice(-40),
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "load":
      return {
        ...state,
        design: action.design ?? state.design,
        saved: action.design ? signature(action.design) : null,
        hydrated: true,
        message: action.design
          ? "已恢复这台设备上保存的外观。"
          : "调整滑块，看看它的变化。",
        error: action.error ?? "",
      };
    case "change":
      if (state.design.shape[action.key] === action.value) return state;
      return {
        ...state,
        pending: state.pending ?? state.design,
        design: {
          ...state.design,
          shape: { ...state.design.shape, [action.key]: action.value },
        },
        future: [],
        error: "",
        message: "外观已调整，记得保存。",
      };
    case "commit":
      return commit(state);
    case "replace": {
      const base = commit(state);
      if (signature(base.design) === signature(action.design))
        return { ...base, error: "", message: action.message };
      return {
        ...base,
        design: action.design,
        past: [...base.past, base.design].slice(-40),
        future: [],
        error: "",
        message: action.message,
      };
    }
    case "undo": {
      const base = commit(state);
      if (!base.past.length) return base;
      return {
        ...base,
        design: base.past[base.past.length - 1],
        past: base.past.slice(0, -1),
        future: [base.design, ...base.future].slice(0, 40),
        error: "",
        message: "已撤销上一次调整。",
      };
    }
    case "redo": {
      const base = commit(state);
      if (!base.future.length) return base;
      return {
        ...base,
        design: base.future[0],
        past: [...base.past, base.design].slice(-40),
        future: base.future.slice(1),
        error: "",
        message: "已重做调整。",
      };
    }
    case "saved":
      return {
        ...commit(state),
        saved: signature(state.design),
        error: "",
        message: "外观已保存在这台设备的浏览器中。",
      };
    case "error":
      return { ...state, error: action.message };
  }
}

export function useFaceDesign() {
  const [state, dispatch] = useReducer(reducer, {
    design: defaultFaceDesign,
    past: [],
    future: [],
    pending: null,
    saved: null,
    hydrated: false,
    message: "正在恢复外观…",
    error: "",
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      dispatch({
        type: "load",
        design: raw ? parseFaceDesign(JSON.parse(raw)) : undefined,
      });
    } catch {
      dispatch({
        type: "load",
        error:
          "未能恢复已保存的外观。原记录仍保留，你可以重新导入备份或调整后保存。",
      });
    }
  }, []);
  return {
    ...state,
    canUndo: state.past.length > 0 || !!state.pending,
    canRedo: state.future.length > 0,
    isSaved: state.saved === signature(state.design),
    change(key: FaceKey, value: number) {
      if (Number.isFinite(value) && value >= 0 && value <= 100)
        dispatch({ type: "change", key, value });
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
    reset() {
      dispatch({
        type: "replace",
        design: defaultFaceDesign,
        message: "已恢复基础脸型，可以撤销。",
      });
    },
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, signature(state.design));
        dispatch({ type: "saved" });
      } catch {
        dispatch({
          type: "error",
          message: "浏览器未能保存。当前调整仍在，请导出外观 JSON 作为备份。",
        });
      }
    },
    async importFile(file: File) {
      try {
        if (file.size > 64 * 1024) throw new Error("File too large");
        const design = parseFaceDesign(JSON.parse(await file.text()));
        dispatch({
          type: "replace",
          design,
          message: "外观已导入。点击保存可保留在这台设备上。",
        });
      } catch {
        dispatch({
          type: "error",
          message:
            "导入失败：请选择此版本导出的外观 JSON，所有参数应在 0–100 之间。当前调整已保留。",
        });
      }
    },
  };
}

"use client";
import { useEffect, useRef, useState } from "react";
import { deleteRoomDraft, readRoomDraft, writeRoomDraft, type RoomDraft } from "@/lib/room-draft";

export function useRoomDraft(scope: string | null, draft: RoomDraft, active: boolean, busy: boolean) {
  const [hydrated, setHydrated] = useState<string | null>(null);
  const [pending, setPending] = useState<RoomDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const revision = useRef(0);
  // An error reading existing data must not allow new edits to overwrite it.
  const [readFailed, setReadFailed] = useState(false);
  const [disabled, setDisabled] = useState(false);
  useEffect(() => {
    if (!scope) return;
    let current = true;
    setPending(null); setStatus("idle"); setError(""); setReadFailed(false); setDisabled(false);
    readRoomDraft(scope).then(value => {
      if (current) { setPending(value); setHydrated(scope); }
    }).catch(() => {
      if (current) {
        setReadFailed(true); setHydrated(scope); setStatus("error");
        setError("无法读取本机草稿。可放弃本机草稿后继续；当前页面和云端资料仍保留。");
      }
    });
    return () => { current = false; revision.current++; };
  }, [scope]);
  // Values are supplied as a serialized signature plus photo identity by the caller.
  useEffect(() => {
    if (!scope || hydrated !== scope || pending || readFailed || disabled || busy || !active) return;
    const serial = ++revision.current;
    setStatus("saving");
    writeRoomDraft(scope, draft).then(() => {
      if (serial === revision.current) { setStatus("saved"); setError(""); }
    }).catch(() => {
      if (serial === revision.current) {
        setStatus("error"); setError("本机草稿保存失败，当前输入仍在。请登录保存后再关闭页面。");
      }
    });
  }, [scope, hydrated, pending, readFailed, disabled, busy, active, draft]);
  return {
    pending, status, error, readFailed,
    ready: !!scope && hydrated === scope,
    continueWithoutStorage() {
      revision.current++; setPending(null); setReadFailed(false); setDisabled(true);
      setStatus("error"); setError("当前仅保留页面内存，请登录保存后再关闭。未读取的旧草稿仍留在本机。");
    },
    accept() { setPending(null); setReadFailed(false); },
    async clear() {
      if (!scope) return;
      revision.current++;
      await deleteRoomDraft(scope);
      setPending(null); setReadFailed(false); setStatus("idle"); setError("");
    },
  };
}

"use client";
import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { currentRoomAsset } from "@/lib/room-model-assets";
import dynamic from "next/dynamic";
import { useRoomDraft } from "./useRoomDraft";
import type { RoomDraft } from "@/lib/room-draft";
import PetLifePanel from "./PetLifePanel";
import BrandMark from "./BrandMark";
import RoomAppearanceControls from "./RoomAppearanceControls";
import { emptyPet, models, type Pet } from "@/lib/models";
const Scene = dynamic(() => import("./CatRoomCanvas"), {
  ssr: false,
  loading: () => <div className="scene-fallback">正在准备房间…</div>,
});
type Account = { id: string; email: string };
class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api(path: string, method = "GET", body?: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`/api/${path}`, {
      method,
      signal: controller.signal,
      headers:
        body instanceof File
          ? { "Content-Type": body.type }
          : body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
      body:
        body instanceof File
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new RequestError(
        data.error || "操作失败，请重试。",
        response.status,
      );
    return data;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw new Error("连接中断或超时，请重试。当前输入仍然保留。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button aria-label="关闭弹窗" onClick={close}>
          关闭
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function MemorialRoom() {
  const [page, setPage] = useState<"home" | "create" | "room">("home");
  const [pet, setPet] = useState<Pet>(emptyPet);
  const [demo, setDemo] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<"sleep" | "walk">("sleep");
  const [reacting, setReacting] = useState(false);
  const reaction = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panel, setPanel] = useState<"about" | "memories" | "diary">("about");
  const [expanded, setExpanded] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loginSave, setLoginSave] = useState(false);
  const [conflict, setConflict] = useState<Pet | null>(null);
  const [confirmation, setConfirmation] = useState<
    "pet" | "photo" | "logout" | null
  >(null);
  const [privacy, setPrivacy] = useState(false);
  const [memory, setMemory] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const uploadRef = useRef<string | null>(null);
  const draftSnapshot = useMemo<RoomDraft>(() => ({
    format: 1, pet, memory, editing, page: page === "create" ? "create" : "room",
    photo, photoName: photo?.name ?? "photo", updatedAt: Date.now(),
  }), [pet, memory, editing, page, photo]);
  const localDraft = useRoomDraft(checking ? null : account ? `account:${account.id}` : "guest",
    draftSnapshot, !demo && page !== "home" && (dirty || !!memory || !!photo), busy);
  const draftDecision = !!localDraft.pending || localDraft.readFailed;

  useEffect(() => {
    let active = true;
    api("session")
      .then((data) => {
        if (!active) return;
        setAccount(data.user);
        if (data.pet) {
          setPet(data.pet);
          setPage("room");
        }
      })
      .catch(() => {
        if (active) setMessage("暂未连接保存服务，可以先体验房间。");
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty || memory) event.preventDefault();
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, memory]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (reaction.current) clearTimeout(reaction.current);
    reaction.current = null;
    setReacting(false);
    return () => {
      if (reaction.current) clearTimeout(reaction.current);
    };
  }, [pet.model]);
  const touch = useCallback(() => {
    if (reaction.current) return;
    setReacting(true);
    reaction.current = setTimeout(() => {
      setReacting(false);
      reaction.current = null;
    }, 1600);
  }, []);
  const change = (patch: Partial<Pet>) => {
    setPet((p) => ({ ...p, ...patch }));
    setDirty(true);
    setMessage("");
  };
  const clearNotices = () => {
    setError("");
    setMessage("");
  };
  const photoUrl =
    preview || (pet.photoId ? `/api/photos/${pet.photoId}` : null);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    clearNotices();
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
      if (e instanceof RequestError && e.status === 401) {
        setAccount(null);
        setLoginSave(true);
        setLogin(true);
      }
    } finally {
      setBusy(false);
    }
  }
  async function save(draft = pet) {
    if (!draft.name.trim()) throw new Error("请先给它起一个名字。");
    if (memory.trim())
      throw new Error("请先点击“加入回忆”或“完成编辑”，再保存房间。");
    let photoId = draft.photoId;
    if (photo) {
      photoId = uploadRef.current || (await api("photos", "POST", photo)).id;
      uploadRef.current = photoId;
    }
    const result = await api("pet", "PUT", { ...draft, photoId });
    setPet({ ...draft, photoId, version: result.version, appearanceAsset: result.appearanceAsset });
    setPhoto(null);
    uploadRef.current = null;
    setDirty(false);
    setDemo(false);
    try {
      await localDraft.clear();
      setMessage("已经保存，下次登录还可以继续探望。");
    } catch {
      setMessage("已保存到账号，但本机旧草稿未能清除。下次可选择放弃旧草稿。");
    }
  }
  function requestSave() {
    if (demo) {
      setPage("create");
      setPet(emptyPet());
      setDemo(false);
      return;
    }
    if (!account) {
      setLoginSave(true);
      setLogin(true);
      clearNotices();
    } else void run(() => save());
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const data = await api("auth/verify", "POST", { email, code });
      setAccount(data.user);
      setLogin(false);
      setCode("");
      uploadRef.current = null;
      if (data.pet && (loginSave || dirty)) {
        setConflict(data.pet);
        return;
      }
      if (data.pet) {
        setPet(data.pet);
        setPhoto(null);
        setDirty(false);
        setDemo(false);
        setPage("room");
      } else if (loginSave) await save({ ...pet, version: 0 });
      else setMessage("已登录，可以创建你的纪念宠物。");
    });
  }
  function choosePhoto(file?: File) {
    if (!file) return;
    if (
      file.size > 5 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
      setError("请选择 5 MB 以内的 JPG、PNG 或 WebP 照片。");
      return;
    }
    uploadRef.current = null;
    setPhoto(file);
    setDirty(true);
    setError("");
  }
  const modelPicker = (
    <fieldset className="model-picker" disabled={busy || !localDraft.ready || draftDecision}>
      <legend>选择基础猫</legend>
      {models.map((model) => (
        <label
          className={
            pet.model === model.id ? "model-option chosen" : "model-option"
          }
          key={model.id}
        >
          <input
            type="radio"
            name="model"
            value={model.id}
            checked={pet.model === model.id}
            onChange={() => change({ model: model.id, appearance: null, appearanceAsset: null })}
          />
          <span>
            <strong>{model.name}</strong>
            <small>{model.description}</small>
          </span>
        </label>
      ))}
      <RoomAppearanceControls appearance={pet.appearance} onChange={(appearance) => change({ appearance, appearanceAsset: appearance ? currentRoomAsset(appearance) : null })} />
      <p className="help">基础外形不代表你的宠物真实外观，可随时更换。</p>
    </fieldset>
  );
  const photoInput = (
    <div className="photo-editor">
      {photoUrl && (
        <img
          className="portrait"
          src={photoUrl}
          alt={`${pet.name || "宠物"}的照片`}
        />
      )}
      <label className="file-label">
        {photoUrl ? "更换照片" : "选择照片（选填）"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || !localDraft.ready || draftDecision}
          onChange={(e) => {
            choosePhoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      <small>仅用于头像与相框，不会自动还原 3D 外观。最大 5 MB。</small>
      {photoUrl && (
        <button
          type="button"
          className="text-button danger"
          onClick={() => setConfirmation("photo")}
        >
          删除照片
        </button>
      )}
    </div>
  );
  return (
    <main className="page-shell memorial">
      <header className="topbar">
        <a href="#top" className="brand">
          <BrandMark />
          <span>
            喵星<small>MIAOXING</small>
          </span>
        </a>
        <div className="account-actions">
          <a href="/studio/base">捏一只猫</a>
          {account ? (
            <>
              <span className="account-email">{account.email}</span>
              <button disabled={busy} onClick={() => setConfirmation("logout")}>
                退出登录
              </button>
            </>
          ) : (
            <button
              disabled={checking || busy}
              onClick={() => {
                setLoginSave(false);
                setLogin(true);
                clearNotices();
              }}
            >
              邮箱登录
            </button>
          )}
        </div>
      </header>
      <div className="notices" aria-live="polite">
        {message && <p className="notice">{message}</p>}
        {error && !login && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {(localDraft.pending || localDraft.readFailed) && (
        <section className="draft-recovery" aria-label="本机未保存草稿">
          <p>{localDraft.pending ? `发现本机未保存的草稿：${localDraft.pending.pet.name || "尚未命名"}。恢复后仍需点击保存房间。` : localDraft.error}</p>
          {localDraft.pending && <button disabled={busy} onClick={() => {
            const draft = localDraft.pending!;
            setPet(draft.pet);
            setPhoto(draft.photo ? new File([draft.photo], draft.photoName, { type: draft.photo.type }) : null);
            setMemory(draft.memory); setEditing(draft.editing);
            setPanel(draft.memory || draft.editing ? "memories" : "about");
            setExpanded(true); setPage(draft.page); setDemo(false); setDirty(true);
            uploadRef.current = null; localDraft.accept();
            setMessage("已恢复本机草稿。保存房间后才能在其他设备恢复。");
          }}>恢复本机草稿</button>}
          <button disabled={busy} onClick={() => void run(() => localDraft.clear())}>放弃本机草稿</button>
          {localDraft.readFailed && <button disabled={busy} onClick={localDraft.continueWithoutStorage}>暂不使用本机草稿，继续编辑</button>}
        </section>
      )}
      {page === "home" && (
        <section className="welcome" id="top">
          <div className="eyebrow">留给想念的一小片地方</div>
          <h1>
            为它留一间
            <br />
            温柔的小房间。
          </h1>
          <p>
            看它休息，陪它走走。
            <br />
            也把你们的回忆，一点一点留下来。
          </p>
          <div className="entry-actions">
            <button
              className="primary"
              disabled={checking || !localDraft.ready || draftDecision}
              onClick={() => {
                setPet({ ...emptyPet(), name: "小橘" });
                setDemo(true);
                setPage("room");
              }}
            >
              先体验房间
            </button>
            <button
              disabled={checking || !localDraft.ready || draftDecision}
              onClick={() => {
                setPet(emptyPet());
                setPage("create");
                setDemo(false);
              }}
            >
              创建我的纪念宠物
            </button>
          </div>
          <small>不必先注册，按自己的节奏慢慢来。</small>
          <div className="welcome-art" aria-hidden="true">
            <BrandMark />
            <span>一盏灯，一处可以探望的地方</span>
          </div>
        </section>
      )}
      {page === "create" && (
        <section className="create-layout" id="top">
          <div className="create-copy">
            <div className="eyebrow">给想念一个名字</div>
            <h1>它叫什么名字？</h1>
            <p>先选一只基础猫。照片和回忆，可以以后再补。</p>
            <div className="create-preview">
              <Scene
                mode="sleep"
                model={pet.model}
                appearance={pet.appearance}
                appearanceAsset={pet.appearanceAsset}
                reacting={reacting}
                onTouch={touch}
              />
            </div>
          </div>
          <form
            className="editor-card"
            onSubmit={(event) => {
              event.preventDefault();
              setPage("room");
              setDirty(true);
            }}
          >
            <label>
              它的名字
              <input
                autoFocus
                disabled={busy || !localDraft.ready || draftDecision}
                required
                maxLength={40}
                value={pet.name}
                onChange={(event) => change({ name: event.target.value })}
                placeholder="你熟悉的那个名字"
              />
            </label>
            {modelPicker}
            {photoInput}
            <button
              className="primary"
              type="submit"
              disabled={!pet.name.trim() || !localDraft.ready || draftDecision}
            >
              进入它的小房间
            </button>
            <p className="help">未保存内容会暂存在这台设备，保留 7 天。登录保存后可换设备探望。</p>
            <p role="status">{localDraft.status === "saving" ? "正在暂存本机草稿…" : localDraft.status === "saved" ? "本机草稿已暂存" : ""}</p>
            {localDraft.error && !localDraft.readFailed && <p role="alert">{localDraft.error}</p>}
          </form>
        </section>
      )}
      {page === "room" && (
        <>
          <div className="room-heading" id="top">
            <div>
              <span className="eyebrow">
                {demo ? "样板房间 · 自在体验" : "留给它的小小空间"}
              </span>
              <h1>{pet.name || "它"}的小房间</h1>
            </div>
            <button className="primary" disabled={busy || !localDraft.ready || draftDecision} onClick={requestSave}>
              {busy
                ? "正在处理…"
                : demo
                  ? "创建我的纪念宠物"
                  : dirty || !pet.version
                    ? "保存纪念房间"
                    : "已保存 · 再次保存"}
            </button>
          </div>
          <div className="room-layout">
            <section className="room-card" aria-label="3D 猫咪房间">
              <div className="room-topline">
                <div className="room-title">
                  <span className="room-avatar">
                    {photoUrl ? (
                      <img src={photoUrl} alt="宠物头像" />
                    ) : (
                      <BrandMark />
                    )}
                  </span>
                  <div>
                    <strong>{pet.name}</strong>
                    <span>
                      {demo ? "这是一只示范猫咪" : "随时可以来坐一会儿"}
                    </span>
                  </div>
                </div>
                <span className="day-pill">温柔的午后</span>
              </div>
              <div className="scene-wrap">
                <div className="canvas-frame">
                  <Scene
                    mode={mode}
                    model={pet.model}
                    appearance={pet.appearance}
                    appearanceAsset={pet.appearanceAsset}
                    reacting={reacting}
                    onTouch={touch}
                  />
                </div>
                <div className="scene-caption" aria-live="polite">
                  {pet.appearance ? (reacting ? "转过身，回应你的轻触" : "安静陪伴中") : reacting
                    ? mode === "sleep"
                      ? "轻轻回应，继续休息"
                      : "转过身，回应你的轻触"
                    : mode === "sleep"
                      ? "安静休息中"
                      : "慢慢走一走"}
                </div>
                {photoUrl && (
                  <figure className="room-photo">
                    <img src={photoUrl} alt="房间中的纪念照片" />
                    <figcaption>主人记录</figcaption>
                  </figure>
                )}
              </div>
              <div className="room-controls">
                <div
                  className="mode-controls"
                  role="group"
                  aria-label="陪伴猫咪"
                >
                  <button
                    className="mode-button touch-button"
                    onClick={touch}
                    aria-disabled={reacting}
                  >
                    摸摸它
                  </button>
                  <button
                    className={`mode-button ${!pet.appearance && mode === "walk" ? "selected" : ""}`}
                    aria-pressed={!pet.appearance && mode === "walk"}
                    disabled={!!pet.appearance}
                    onClick={() => setMode("walk")}
                  >
                    走路
                  </button>
                  <button
                    className={`mode-button ${!pet.appearance && mode === "sleep" ? "selected" : ""}`}
                    aria-pressed={!pet.appearance && mode === "sleep"}
                    disabled={!!pet.appearance}
                    onClick={() => setMode("sleep")}
                  >
                    休息
                  </button>
                </div>
                <small>也可以直接轻触猫咪</small>
              </div>
            </section>
            <aside className={`details-panel ${expanded ? "expanded" : ""}`}>
              <button
                className="mobile-panel-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起纪念资料" : "展开纪念资料"}
              </button>
              <div className="details-content">
                <div className="panel-tabs" role="group" aria-label="纪念资料">
                  <button
                    aria-pressed={panel === "about"}
                    onClick={() => setPanel("about")}
                  >
                    关于它
                  </button>
                  <button
                    aria-pressed={panel === "memories"}
                    onClick={() => setPanel("memories")}
                  >
                    回忆 · {pet.memories.length}
                  </button>
                  <button aria-pressed={panel === "diary"} onClick={() => setPanel("diary")}>
                    生活日记
                  </button>
                </div>
                {panel === "diary" ? <PetLifePanel key={account?.id ?? "guest"} accountId={account?.id ?? null} savedVersion={demo ? 0 : pet.version} onSave={requestSave} /> : demo ? (
                  <div className="demo-copy">
                    <h2>先在这里待一会儿</h2>
                    <p>
                      试着摸摸它，或者陪它走一走。准备好了，再为你想念的它创建房间。
                    </p>
                    {modelPicker}
                  </div>
                ) : (
                  <fieldset className="editor-fields" disabled={busy || !localDraft.ready || draftDecision}>
                    {panel === "about" ? (
                      <>
                        <span className="record-tag">主人记录</span>
                        <label>
                          名字
                          <input
                            maxLength={40}
                            value={pet.name}
                            onChange={(e) => change({ name: e.target.value })}
                          />
                        </label>
                        {modelPicker}
                        {photoInput}
                        <label>
                          <span id="pet-personality-label">它的性格</span>
                          <textarea aria-labelledby="pet-personality-label"
                            maxLength={1000}
                            rows={4}
                            value={pet.personality}
                            onChange={(e) =>
                              change({ personality: e.target.value })
                            }
                            placeholder="它喜欢什么？有什么小习惯？"
                          />
                        </label>
                        <small>{pet.personality.length}/1000</small>
                      </>
                    ) : (
                      <>
                        <span className="record-tag">
                          主人记录 · 只留下你写下的真实回忆
                        </span>
                        <label>
                          <span id="memory-editor-label">{editing ? "编辑这段回忆" : "记下一段回忆"}</span>
                          <textarea aria-labelledby="memory-editor-label"
                            value={memory}
                            maxLength={3000}
                            rows={5}
                            onChange={(e) => setMemory(e.target.value)}
                            placeholder="某个一起度过的午后……"
                          />
                        </label>
                        <button
                          disabled={
                            !memory.trim() ||
                            (!editing && pet.memories.length >= 50)
                          }
                          onClick={() => {
                            change({
                              memories: editing
                                ? pet.memories.map((m) =>
                                    m.id === editing
                                      ? { ...m, text: memory.trim() }
                                      : m,
                                  )
                                : [
                                    ...pet.memories,
                                    {
                                      id: crypto.randomUUID(),
                                      text: memory.trim(),
                                    },
                                  ],
                            });
                            setMemory("");
                            setEditing(null);
                          }}
                        >
                          {editing ? "完成编辑" : "加入回忆"}
                        </button>
                        {editing && (
                          <button
                            onClick={() => {
                              setEditing(null);
                              setMemory("");
                            }}
                          >
                            取消编辑
                          </button>
                        )}
                        <small>
                          最多 50 段，每段 3000 字。修改后请保存房间。
                        </small>
                        {pet.memories.length === 0 && (
                          <p className="empty-copy">
                            还没有记录。想写的时候再写。
                          </p>
                        )}
                        {pet.memories.map((m) => (
                          <article className="memory-card" key={m.id}>
                            <span className="record-tag">主人记录</span>
                            <p>{m.text}</p>
                            <div>
                              <button
                                onClick={() => {
                                  setEditing(m.id);
                                  setMemory(m.text);
                                }}
                              >
                                编辑
                              </button>
                              <button
                                className="danger"
                                onClick={() => {
                                  change({
                                    memories: pet.memories.filter(
                                      (item) => item.id !== m.id,
                                    ),
                                  });
                                  if (editing === m.id) {
                                    setEditing(null);
                                    setMemory("");
                                  }
                                }}
                              >
                                删除
                              </button>
                            </div>
                          </article>
                        ))}
                      </>
                    )}
                  </fieldset>
                )}
                {!demo && (
                  <div className="save-note">
                    <p>
                      {busy ? "正在处理，请稍候…" : (dirty || memory)
                        ? localDraft.status === "saved" ? "草稿已暂存本机 · 尚未保存到账号" : localDraft.status === "saving" ? "正在暂存本机草稿…" : "有尚未保存的修改"
                        : pet.version
                          ? "已保存到账号"
                          : "尚未保存到账号"}
                    </p>
                    {localDraft.error && !localDraft.readFailed && <p role="alert">{localDraft.error}</p>}
                    {account && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const data = await api("pet");
                            if (data.pet) setConflict(data.pet);
                            else setMessage("云端暂无纪念宠物。");
                          })
                        }
                      >
                        读取云端版本
                      </button>
                    )}
                    {pet.version > 0 && (
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => setConfirmation("pet")}
                      >
                        删除纪念宠物
                      </button>
                    )}
                  </div>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
      <footer className="page-footer">
        <span>慢慢来，按照自己的节奏。</span>
        <button className="text-button" onClick={() => setPrivacy(true)}>
          隐私与素材说明
        </button>
      </footer>
      {login && (
        <Dialog
          title={loginSave ? "登录，保存这份想念" : "邮箱登录"}
          close={() => {
            if (!busy) setLogin(false);
          }}
        >
          <p>每个账号保存一只纪念宠物。验证失败不会清空当前输入。</p>
          <form onSubmit={verify}>
            <label>
              邮箱
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                disabled={busy}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setSent(false);
                }}
              />
            </label>
            <button
              type="button"
              disabled={busy || cooldown > 0 || !email.includes("@")}
              onClick={() =>
                void run(async () => {
                  await api("auth/code", "POST", { email });
                  setSent(true);
                  setCooldown(60);
                  setMessage("验证码已发出，10 分钟内有效。");
                })
              }
            >
              {cooldown ? `${cooldown} 秒后可重发` : "发送验证码"}
            </button>
            <label>
              6 位验证码
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            {sent && <p className="help">请查看收件箱，也可以检查垃圾邮件。</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy || code.length !== 6}>
              {busy ? "正在验证…" : loginSave ? "验证并保存" : "登录并探望"}
            </button>
          </form>
          <p className="help">
            照片与回忆仅对登录的主人开放。可随时在房间中删除。
          </p>
        </Dialog>
      )}
      {conflict && (
        <Dialog title="云端已经有一间房间" close={() => setConflict(null)}>
          <p>
            云端保存着「{conflict.name}
            」的资料。请选择要保留的版本；关闭此窗口可继续编辑当前内容。
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            disabled={busy}
            onClick={() => void run(async () => {
              await localDraft.clear();
              setPet(conflict);
              setPhoto(null);
              uploadRef.current = null;
              setConflict(null);
              setDirty(false);
              setDemo(false);
              setMemory("");
              setEditing(null);
              setPage("room");
            })}
          >
            使用云端资料（放弃当前修改）
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await save({ ...pet, version: conflict.version });
                setConflict(null);
              })
            }
          >
            用当前完整资料替换云端
          </button>
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          title={
            confirmation === "logout"
              ? "退出这个账号？"
              : confirmation === "photo"
                ? "删除这张照片？"
                : "删除纪念宠物？"
          }
          close={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <p>
            {confirmation === "logout"
              ? "退出后会清除当前页面资料，未保存的修改会丢失。云端资料仍然保留。"
              : confirmation === "photo"
                ? "已保存的照片也会从私人存储中删除。这个操作无法撤销。"
                : "会删除这个账号的宠物资料、照片和所有回忆，无法撤销。"}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (confirmation === "logout") {
                  await api("auth/logout", "POST");
                  try { await localDraft.clear(); }
                  catch { setMessage("已退出登录，但本机草稿未能清除。共用设备请清除浏览器站点数据。"); }
                  setAccount(null);
                  setPet(emptyPet());
                  setPhoto(null);
                  setPage("home");
                  setDirty(false);
                  setMemory("");
                  uploadRef.current = null;
                } else if (confirmation === "pet") {
                  await localDraft.clear();
                  await api("pet", "DELETE");
                  setPet(emptyPet());
                  setPhoto(null);
                  setPage("home");
                  setDirty(false);
                  setMemory("");
                  uploadRef.current = null;
                  setMessage("纪念宠物及关联资料已删除。");
                } else {
                  if (pet.photoId) {
                    const data = await api(`photos/${pet.photoId}`, "DELETE", {
                      version: pet.version,
                    });
                    setPet((p) => ({
                      ...p,
                      photoId: null,
                      version: data.pet?.version || p.version,
                    }));
                  }
                  if (uploadRef.current)
                    await api(`photos/${uploadRef.current}`, "DELETE", {
                      version: pet.version,
                    });
                  setPhoto(null);
                  uploadRef.current = null;
                  setDirty(true);
                }
                setConfirmation(null);
              })
            }
          >
            {busy ? "正在处理…" : "确认"}
          </button>
          <button disabled={busy} onClick={() => setConfirmation(null)}>
            再想想
          </button>
        </Dialog>
      )}
      {privacy && (
        <Dialog title="隐私与素材说明" close={() => setPrivacy(false)}>
          <p>
            未保存的资料、照片和正在编辑的回忆会暂存在这台设备的浏览器中，草稿有效期为 7 天，恢复时会清理过期记录。共用设备请在离开前放弃草稿或退出登录。清除浏览器数据会删除草稿。照片在你选择登录保存前不会上传。
          </p>
          <p>
            保存后，邮箱用于登录，照片与回忆保存在私人存储中，仅登录的主人可以访问。照片会压缩并移除元数据。退出登录清除页面资料；删除照片、回忆或整只宠物后，会清理相应的在线数据。备份按部署方公示的保留周期到期清除。
          </p>
          <p>主人填写的纪念内容标为“主人记录”。生活日记中的活动标为“喵星虚拟故事”，由固定规则产生，不会写入真实回忆。本版尚未接入 AI 对话。</p>
          <h3>猫咪素材</h3>
          {models.map((m) => (
            <p key={m.id}>
              <a href={m.source} target="_blank" rel="noreferrer">
                {m.name} · {m.author}
              </a>{" "}
              ·{" "}
              <a
                href={
                  m.id === "toon"
                    ? "https://creativecommons.org/licenses/by/4.0/"
                    : "https://creativecommons.org/publicdomain/zero/1.0/"
                }
              >
                {m.license}
              </a>
              。
              {m.proceduralSleep
                ? "行走为原始动作，侧卧休息与轻触回应由程序实现。"
                : "使用作者提供的行走、睡眠动作，添加轻触回应。"}
            </p>
          ))}
        </Dialog>
      )}
    </main>
  );
}

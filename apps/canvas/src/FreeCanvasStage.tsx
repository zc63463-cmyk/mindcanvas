/**
 * FreeCanvasStage —— 自由画布子模式 Stage（C+1 · FC-E；SAVE-LIFECYCLE 抽文档 hook）。
 *
 * 与导图 `MindmapStage` 平行：独立文档宿主（CanvasDocHost，独立 localStorage key）、
 * 独立状态；由 App 模式态分 Stage 挂载/卸载（切换不串导图 doc 状态，D6）。
 * 事实源 `*.mc.canvas.json`；视图 = @mindcanvas/react 的 FreeCanvasView。
 *
 * 文档状态与保存已抽至 `hooks/useFreeCanvasDocument`（会话令牌 + 内容归属校验）：
 * 保存完成只在「写出的快照仍是当前模型」时清脏；文档替换（新建/打开/最近/演示）
 * 先推进会话令牌。模式切换的离开保护属包 2（App 层）。
 */
import {
  createEmptyDocument,
  parseCanvasDocument,
  type McCanvasDocument,
} from '@mindcanvas/free-canvas';
import { CHROME, FreeCanvasView, installBeforeUnload, isEmbeddedFrame } from '@mindcanvas/react';
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { LocalCanvasDocHost } from './canvasDocHost.js';
import { flushActiveDraft, hasPendingDraft } from './draftFlush.js';
import type { DocumentLeavePort, RequestLeave } from './documentLifecycle.js';
import { useLeavePortRegistration } from './hooks/useDocumentLeaveRegistration.js';
import { useFreeCanvasDocument } from './hooks/useFreeCanvasDocument.js';
import demoSource from './demo/demo-free.mc.canvas.json?raw';

export interface FreeCanvasStageProps {
  /** 返回导图模式（App 模式态；App 传入的已是经离开决策的回调） */
  onExit: () => void;
  /** 文档变更观察（测试/集成用；不参与产品逻辑） */
  onDocChange?: (doc: McCanvasDocument) => void;
  /** MODE-GUARD：App 注入的离开决策器（新建/打开/最近/演示与返回导图共用） */
  requestLeave?: RequestLeave;
  /** MODE-GUARD：把本 Stage 的 leave port 登记到 App */
  registerLeavePort?: (port: DocumentLeavePort | null) => () => void;
}

const EMPTY_NAME = '未命名.mc.canvas.json';

const barStyle: CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 12,
  zIndex: 200,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 5,
  background: CHROME.panelBg,
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  backdropFilter: 'blur(14px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
  boxShadow: CHROME.shadow,
};

const btnStyle: CSSProperties = {
  padding: '4px 10px',
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSizeSmall,
  color: CHROME.text,
  background: 'transparent',
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall - 2,
  cursor: 'pointer',
};

const recentPanelStyle: CSSProperties = {
  position: 'absolute',
  right: 12,
  top: 52,
  zIndex: 210,
  minWidth: 240,
  maxHeight: 320,
  overflowY: 'auto',
  background: CHROME.panelBg,
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radius,
  boxShadow: CHROME.shadow,
  backdropFilter: 'blur(14px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(14px) saturate(1.3)',
  padding: 4,
};

const noticeStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 12,
  zIndex: 200,
  padding: '6px 12px',
  background: CHROME.panelBgStrong,
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  color: CHROME.textMuted,
  fontSize: CHROME.fontSizeSmall,
  backdropFilter: 'blur(14px)',
};

export function FreeCanvasStage({
  onExit,
  onDocChange,
  requestLeave,
  registerLeavePort,
}: FreeCanvasStageProps) {
  const hostRef = useRef<LocalCanvasDocHost | null>(null);
  if (hostRef.current === null) hostRef.current = new LocalCanvasDocHost();
  const host = hostRef.current;

  const { name, model, dirty, notice, setNotice, applyModel, updateModel, save, isDirty, isSaving, waitForIdle } =
    useFreeCanvasDocument({ host, initialName: EMPTY_NAME, onDocChange });

  const [recentOpen, setRecentOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // MODE-GUARD：登记离开端口（方法读实时状态；本模式无自动保存 → 无 suppressPendingAuto）
  useLeavePortRegistration(registerLeavePort, () => ({
    flushEdits: flushActiveDraft,
    isDirty,
    isSaving,
    waitForIdle,
    save,
  }));

  // beforeunload：dirty / 未提交草稿 / 写入进行中 时拦截（原生能力，不在 unload 里弹自定义模态）
  useEffect(
    () => installBeforeUnload(() => isDirty() || isSaving() || hasPendingDraft()),
    [isDirty, isSaving],
  );

  /** 离开保护：有决策器时先判定（保存/放弃/取消）；缺省直接执行（独立用法/旧测试） */
  const leaveOr = (perform: () => void): void => {
    if (requestLeave === undefined) {
      perform();
      return;
    }
    void requestLeave(perform);
  };

  const onNew = () => {
    leaveOr(() => {
      applyModel(createEmptyDocument('未命名画布'), EMPTY_NAME);
      setNotice(null);
      setRecentOpen(false);
    });
  };

  const onSave = () => {
    void save();
  };

  const onOpen = async () => {
    setRecentOpen(false);
    // FS Access 不可用 / 嵌入 frame → 隐藏 file input 兜底（同 MindmapStage 打开链路）
    if (isEmbeddedFrame() || typeof window.showOpenFilePicker !== 'function') {
      fileInputRef.current?.click();
      return;
    }
    try {
      const opened = await host.open();
      if (opened === null) return; // 用户取消 → 当前模型不变（也不进入离开决策）
      // 先解析（失败不破坏当前模型），再走离开决策
      const next = parseCanvasDocument(opened.source);
      leaveOr(() => {
        applyModel(next, opened.name, opened.handle);
        host.remember(opened);
        setNotice(null);
      });
    } catch {
      setNotice('打开失败：文件不是有效的 .mc.canvas.json');
    }
  };

  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    try {
      const source = await file.text();
      const next = parseCanvasDocument(source); // 先解析：非法文件不影响当前文档
      leaveOr(() => {
        applyModel(next, file.name);
        host.remember({ id: file.name, name: file.name, source, saved: true, ts: Date.now() });
        setNotice(null);
      });
    } catch {
      setNotice('打开失败：文件不是有效的 .mc.canvas.json');
    }
  };

  const onDemo = () => {
    leaveOr(() => {
      applyModel(parseCanvasDocument(demoSource), 'demo-free.mc.canvas.json');
      host.remember({
        id: 'demo-free.mc.canvas.json',
        name: 'demo-free.mc.canvas.json',
        source: demoSource,
        saved: true,
        ts: Date.now(),
      });
      setRecentOpen(false);
      setNotice('演示画布：便签可翻面、两卡已连线');
    });
  };

  const onOpenRecent = (d: { id: string; name: string; source: string }) => {
    try {
      const next = parseCanvasDocument(d.source); // 先解析：损坏记录不影响当前文档
      leaveOr(() => {
        applyModel(next, d.name);
        setNotice('已从最近载入（保存时需重新选择文件关联）');
      });
    } catch {
      setNotice('最近记录的画布已损坏');
    }
    setRecentOpen(false);
  };

  const recents = host.recent();

  return (
    <div
      data-fc-stage
      style={{
        position: 'absolute',
        inset: 0,
        background: CHROME.bg,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
      }}
    >
      <FreeCanvasView doc={model} onChange={updateModel} style={{ position: 'absolute', inset: 0 }} />

      <div data-fc-stage-bar style={barStyle}>
        <button type="button" data-fc-exit onClick={onExit} style={btnStyle}>
          ← 导图
        </button>
        <span
          data-fc-title
          style={{
            fontSize: CHROME.fontSizeSmall,
            color: CHROME.textMuted,
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
          {dirty ? ' ●' : ''}
        </span>
        <button type="button" data-fc-new onClick={onNew} style={btnStyle}>
          新建
        </button>
        <button type="button" data-fc-open onClick={onOpen} style={btnStyle}>
          打开
        </button>
        <button type="button" data-fc-save onClick={onSave} style={btnStyle}>
          保存
        </button>
        <button
          type="button"
          data-fc-recent-toggle
          aria-pressed={recentOpen}
          onClick={() => setRecentOpen((v) => !v)}
          style={btnStyle}
        >
          最近
        </button>
        <button type="button" data-fc-demo onClick={onDemo} style={btnStyle}>
          看演示
        </button>
      </div>

      {recentOpen && (
        <div data-fc-recent style={recentPanelStyle}>
          {recents.length === 0 ? (
            <div style={{ padding: '8px 10px', color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
              暂无最近画布
            </div>
          ) : (
            recents.map((d) => (
              <button
                key={d.id}
                type="button"
                data-fc-recent-item
                onClick={() => onOpenRecent(d)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: CHROME.text,
                  fontFamily: CHROME.fontFamily,
                }}
              >
                <div style={{ fontSize: CHROME.fontSize }}>{d.name}</div>
                <div style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted }}>
                  {new Date(d.ts).toLocaleString('zh-CN')}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {notice !== null && <div data-fc-notice style={noticeStyle}>{notice}</div>}

      <input
        ref={fileInputRef}
        data-fc-file
        type="file"
        accept=".json,application/json"
        onChange={onFilePicked}
        style={{ display: 'none' }}
      />
    </div>
  );
}

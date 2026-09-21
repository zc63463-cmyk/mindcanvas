/**
 * FreeCanvasStage —— 自由画布子模式 Stage（C+1 · FC-E）。
 *
 * 与导图 `MindmapStage` 平行：独立文档宿主（CanvasDocHost，独立 localStorage key）、
 * 独立状态；由 App 模式态分 Stage 挂载/卸载（切换不串导图 doc 状态，D6）。
 * 事实源 `*.mc.canvas.json`；视图 = @mindcanvas/react 的 FreeCanvasView。
 */
import {
  createEmptyDocument,
  parseCanvasDocument,
  serializeCanvasDocument,
  type McCanvasDocument,
} from '@mindcanvas/free-canvas';
import { CHROME, FreeCanvasView, isEmbeddedFrame, type FsFileHandle } from '@mindcanvas/react';
import { useRef, useState, type CSSProperties, type ChangeEvent } from 'react';
import { LocalCanvasDocHost, type CanvasDoc } from './canvasDocHost.js';
import demoSource from './demo/demo-free.mc.canvas.json?raw';

export interface FreeCanvasStageProps {
  /** 返回导图模式（App 模式态） */
  onExit: () => void;
  /** 文档变更观察（测试/集成用；不参与产品逻辑） */
  onDocChange?: (doc: McCanvasDocument) => void;
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

export function FreeCanvasStage({ onExit, onDocChange }: FreeCanvasStageProps) {
  const hostRef = useRef<LocalCanvasDocHost | null>(null);
  if (hostRef.current === null) hostRef.current = new LocalCanvasDocHost();
  const host = hostRef.current;

  const [name, setName] = useState(EMPTY_NAME);
  const [model, setModel] = useState<McCanvasDocument>(() => createEmptyDocument('未命名画布'));
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const handleRef = useRef<FsFileHandle | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyModel = (m: McCanvasDocument, nextName: string, handle?: FsFileHandle) => {
    setModel(m);
    onDocChange?.(m);
    setName(nextName);
    handleRef.current = handle;
    setDirty(false);
  };

  const onChange = (m: McCanvasDocument) => {
    setModel(m);
    onDocChange?.(m);
    setDirty(true);
  };

  const onNew = () => {
    applyModel(createEmptyDocument('未命名画布'), EMPTY_NAME);
    setNotice(null);
    setRecentOpen(false);
  };

  const onSave = async () => {
    const doc: CanvasDoc = {
      id: name,
      name,
      source: serializeCanvasDocument(model),
      handle: handleRef.current,
      saved: true,
      ts: Date.now(),
    };
    try {
      const out = await host.save(doc);
      if (out.handle !== undefined) handleRef.current = out.handle;
      host.remember(doc);
      setDirty(false);
      setNotice(out.result === 'fs' ? '已保存' : '已下载 JSON（当前环境不支持直接写回文件）');
    } catch {
      setNotice('保存失败');
    }
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
      if (opened === null) return; // 用户取消
      applyModel(parseCanvasDocument(opened.source), opened.name, opened.handle);
      host.remember(opened);
      setNotice(null);
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
      applyModel(parseCanvasDocument(source), file.name);
      host.remember({ id: file.name, name: file.name, source, saved: true, ts: Date.now() });
      setNotice(null);
    } catch {
      setNotice('打开失败：文件不是有效的 .mc.canvas.json');
    }
  };

  const onDemo = () => {
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
  };

  const onOpenRecent = (d: CanvasDoc) => {
    try {
      applyModel(parseCanvasDocument(d.source), d.name);
      setNotice('已从最近载入（保存时需重新选择文件关联）');
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
      <FreeCanvasView doc={model} onChange={onChange} style={{ position: 'absolute', inset: 0 }} />

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

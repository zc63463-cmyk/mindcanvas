/**
 * CanvasDocHost —— 自由画布文档宿主（平行 `DocumentHost`，事实源 `*.mc.canvas.json`）。
 *
 * 与导图宿主的分工（C+1 · D1/D6）：
 * - 独立 localStorage key `mindcanvas.canvas.recent.v1`（不读写 DocLibrary / mindcanvas.library.*）
 * - 打开：FS Access（.json 宽松过滤）→ null 表示「取消 / 不支持」（调用方 file input 兜底）
 * - 保存：句柄写回（`writeToHandle`）→ 下载 JSON 兜底（同 LocalDocHost 模式）
 * - 最近：上限 8 条、新在前、含 source（句柄不可序列化，主动丢弃）
 */
import { type FsFileHandle, isEmbeddedFrame, writeToHandle } from '@mindcanvas/react';

/** 自由画布文档模型（与 MindDoc 平行） */
export interface CanvasDoc {
  /** 稳定 id（文件名；新建未保存 = new-<ts>） */
  id: string;
  /** 文件名（显示用） */
  name: string;
  /** JSON 源文（*.mc.canvas.json 内容） */
  source: string;
  /** FS 句柄（打开/另存后复用写回） */
  handle?: FsFileHandle;
  saved: boolean;
  ts: number;
}

/** 最近画布的独立存储 key（与导图链路完全隔离） */
export const CANVAS_RECENT_KEY = 'mindcanvas.canvas.recent.v1';
const RECENT_MAX = 8;

/** 文件类型描述：`.mc.canvas.json` 是双段扩展名，打开侧只列单段 `.json`（同 MM_OPEN_TYPES 的理由） */
export const CANVAS_FILE_TYPES = [
  { description: 'mindcanvas 自由画布', accept: { 'application/json': ['.json'] } },
];

/** AbortError（用户取消对话框）：静默返回 null，不视为失败 */
function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** 下载 JSON 兜底（FS Access 不可用 / 嵌入 frame / 句柄失效） */
function downloadJson(text: string, name: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export class LocalCanvasDocHost {
  async open(): Promise<CanvasDoc | null> {
    // 嵌入 frame：FS 对话框被权限策略禁用甚至挂起 → 抛错让调用方走 file input 兜底
    if (isEmbeddedFrame()) throw new Error('embedded-frame: fs-access-unavailable');
    if (typeof window.showOpenFilePicker !== 'function') return null;
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: CANVAS_FILE_TYPES });
      if (!handle) return null;
      const file = (await handle.getFile?.()) ?? new File([], handle.name ?? 'untitled.mc.canvas.json');
      const source = await file.text();
      return { id: file.name, name: file.name, source, handle, saved: true, ts: Date.now() };
    } catch (e) {
      if (isAbortError(e)) return null; // 用户取消
      throw e; // 其他错误 → 调用方兜底
    }
  }

  async save(doc: CanvasDoc): Promise<{ result: 'fs' | 'download'; handle?: FsFileHandle }> {
    if (doc.handle) {
      const ok = await writeToHandle(doc.handle, doc.source);
      if (ok) return { result: 'fs', handle: doc.handle };
      // 句柄失效（文件被移走 / 权限撤销）→ 下载兜底
    }
    downloadJson(doc.source, doc.name);
    return { result: 'download' };
  }

  create(name: string, source: string): CanvasDoc {
    return { id: `new-${Date.now()}`, name, source, saved: false, ts: Date.now() };
  }

  /** 最近列表（新在前；损坏记录逐条丢弃） */
  recent(): CanvasDoc[] {
    try {
      const raw = localStorage.getItem(CANVAS_RECENT_KEY);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .flatMap((d) => {
          const holder = Object(d);
          const id = Reflect.get(holder, 'id');
          const name = Reflect.get(holder, 'name');
          const source = Reflect.get(holder, 'source');
          const ts = Reflect.get(holder, 'ts');
          if (typeof id !== 'string' || typeof source !== 'string') return [];
          const hit: CanvasDoc = {
            id,
            name: typeof name === 'string' ? name : id,
            source,
            saved: true,
            ts: typeof ts === 'number' ? ts : 0,
          };
          return [hit];
        })
        .slice(0, RECENT_MAX);
    } catch {
      return [];
    }
  }

  /** 记入最近列表（同 id 去重后置顶） */
  remember(doc: CanvasDoc): void {
    const next = [
      { id: doc.id, name: doc.name, source: doc.source, ts: Date.now() },
      ...this.recent()
        .filter((d) => d.id !== doc.id)
        .map((d) => ({ id: d.id, name: d.name, source: d.source, ts: d.ts })),
    ].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(CANVAS_RECENT_KEY, JSON.stringify(next));
    } catch {
      // 配额满：静默（不阻断编辑主流程）
    }
  }
}

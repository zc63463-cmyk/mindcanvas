/**
 * 保存与离开守卫（T2 · local-first，不接 Forgejo）。
 * - saveMarkdown：File System Access API 优先（支持则「保存到文件」），不支持/失败 → 下载 .mm.md
 * - installBeforeUnload：有未保存变更时拦截页面离开
 */
import { isAbortError } from './fsError.js';

export type SaveResult = 'fs' | 'download' | 'cancelled';

/**
 * 保存结果（FA1-T1）：在 `SaveResult` 之外**回传文件句柄**。
 *
 * 为什么必须回传：此前 `saveMarkdown` 拿到 `showSaveFilePicker()` 的 handle 后直接丢弃，
 * 文档的 `doc.handle` 永远是 undefined → 每次 Ctrl+S 都重新唤起系统另存为窗口，
 * 触发系统级「是否覆盖」确认（记事本式体验）。把 handle 带回调用方并写回 doc
 * 之后，后续保存走 `handle.createWritable()` 静默写回，零弹窗。
 */
export interface SaveOutcome {
  result: SaveResult;
  /** 实际写入的句柄（仅 fs 结果有值；download/cancelled 无意义） */
  handle?: FsFileHandle;
}

/** FS 文件句柄（保存复用；B1 文档宿主导出供打开/写回） */
export interface FsWritable {
  /**
   * 写入。真实 `FileSystemWritableFileStream.write()` 同时接受文本与二进制，
   * FA2-T4 落盘图片资产需要传 Blob —— 故联合类型。
   * 方法语法（非属性）在 strict 下参数双变，既有只接受 string 的调用点不受影响。
   */
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}
export interface FsFileHandle {
  name?: string;
  createWritable(): Promise<FsWritable>;
  getFile?(): Promise<File>;
}
export interface FsFileSystemWindow {
  showSaveFilePicker?(options: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }): Promise<FsFileHandle>;
  showOpenFilePicker?(options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }): Promise<FsFileHandle[]>;
}

/**
 * 把 FS Access API 直接挂到全局 Window 上。
 *
 * 此前调用方一律写 `window as unknown as FsFileSystemWindow` —— 双重断言既
 * 绕过类型检查（写错方法名也不报错），又会在债务预算里记 2 个 asCast。
 * 声明到全局后，`window.showOpenFilePicker` 直接可查、可补全，零断言。
 */
declare global {
  interface Window {
    showSaveFilePicker?: (options: {
      suggestedName?: string;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FsFileHandle>;
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FsFileHandle[]>;
  }
}

/** .mm 文件类型描述（保存用：保留 `.mm.md` 命名提示） */
export const MM_FILE_TYPES = [
  { description: 'mindcanvas 画布', accept: { 'text/markdown': ['.mm.md', '.md'] } },
];

/**
 * 打开对话框的文件类型：**宽松过滤**。
 *
 * 为什么不用 MM_FILE_TYPES：`.mm.md` 是**双段扩展名**——部分浏览器/平台在 accept 里
 * 无法正确匹配（文件在选择器中灰显、不可选，表现为「打不开某个 .mm.md」）。
 * `.md` 已覆盖 `.mm.md`（后缀匹配），故打开侧只列单段扩展名。
 */
export const MM_OPEN_TYPES = [
  { description: 'Markdown / mindcanvas 画布', accept: { 'text/markdown': ['.md', '.markdown'] } },
];

/**
 * 是否运行在**嵌入 frame**（iframe / IDE 预览 webview）里。
 *
 * 为什么需要：FS Access 的打开/保存对话框在跨源子 frame 中被权限策略禁用
 * （SecurityError），在部分 webview 中甚至**不抛错也不返回**（Promise 永不 settle）——
 * 两种表现都是「点打开/保存毫无反应」。嵌入场景一律跳过 FS API 走兜底：
 * 打开 → 隐藏 file input；保存 → 下载。
 */
export function isEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // 访问 window.top 被安全策略拒绝 → 保守视为嵌入
  }
}

/**
 * 保存 .mm.md 文本：
 * - 浏览器支持 FS Access API → 弹出保存对话框写入文件（用户可指定路径）
 * - 不支持 / 非 fs / **嵌入 frame** → 触发下载兜底
 * - 用户在 FS 对话框取消 → 返回 'cancelled'（不视为错误）
 * - FA1-T1：成功写入后**回传 handle**，供调用方写回 doc（后续保存静默写回，不再弹框）
 *
 * @param opts.embedded 覆盖嵌入判定（测试注入；缺省 `isEmbeddedFrame()`）
 */
export async function saveMarkdown(
  text: string,
  defaultName: string,
  opts?: { embedded?: boolean },
): Promise<SaveOutcome> {
  // 嵌入 frame：FS 对话框被禁/挂起 → 直接下载兜底（见 isEmbeddedFrame 注释）
  const embedded = opts?.embedded ?? isEmbeddedFrame();
  if (!embedded && typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultName,
        types: MM_FILE_TYPES,
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { result: 'fs', handle };
    } catch (e) {
      // AbortError = 用户取消对话框 → 静默；其他错误 → 兜底下载
      if (isAbortError(e)) return { result: 'cancelled' };
    }
  }
  // 下载兜底（FS Access 不可用/失败）
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return { result: 'download' };
}

/**
 * 句柄写回（FA1-T1）：已有句柄时静默覆盖写入，绝不唤起系统对话框。
 *
 * 与 `saveMarkdown` 的分工：后者负责「第一次选路径」，本函数负责「之后每次」。
 * 返回 false = 句柄失效（文件被移走/权限撤销），调用方据此回落选择器。
 */
export async function writeToHandle(handle: FsFileHandle, text: string): Promise<boolean> {
  try {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * beforeunload 守卫：dirty() 为真 → 拦截离开（浏览器弹确认框）。
 * 返回卸载函数（组件清理用）。
 */
export function installBeforeUnload(dirty: () => boolean): () => void {
  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = ''; // 现代浏览器据此显示「离开将丢失未保存更改」确认框
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}

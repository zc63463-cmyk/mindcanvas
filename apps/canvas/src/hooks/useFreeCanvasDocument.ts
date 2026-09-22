/**
 * 自由画布文档状态与保存（SAVE-LIFECYCLE：从 `FreeCanvasStage` 抽出，可独立单测）。
 *
 * 是什么：
 * - 单一事实源：`*.mc.canvas.json` 模型 + 文件名 + 脏标记 + 句柄 + 通知；
 * - 文档替换（新建/打开/最近/演示）经 `applyModel` —— **推进保存会话令牌**后再换模型，
 *   旧会话的迟到写入不会把新文档标成已保存；
 * - `save()` 经 `DocumentSaveSession`：写入串行；完成时按内容身份判定 —— 写入期间继续编辑
 *   则保持 dirty（返回 `{ kind:'saved', current:false }`），只有写出的快照仍是当前内容才清脏。
 *
 * 不是什么：不含自动保存（本包不为自由画布新增自动保存）、不含最近列表面板与模式切换
 * 守卫（后者属包 2 的 App 层离开保护）。
 */
import { useCallback, useRef, useState } from 'react';
import { createEmptyDocument, serializeCanvasDocument, type McCanvasDocument } from '@mindcanvas/free-canvas';
import type { FsFileHandle } from '@mindcanvas/react';
import type { LocalCanvasDocHost } from '../canvasDocHost.js';
import {
  SAVE_METADATA_WARNING,
  SAVE_METADATA_WARNING_DOWNLOAD,
  type SaveCompletion,
} from '../documentLifecycle.js';
import { useDocumentSaveSession } from './useDocumentSaveSession.js';

export interface FreeCanvasDocumentOptions {
  host: LocalCanvasDocHost;
  /** 新建/初始文件名（显示用） */
  initialName: string;
  /** 文档变更观察（测试/集成用；不参与产品逻辑） */
  onDocChange?: (doc: McCanvasDocument) => void;
}

export interface FreeCanvasDocumentState {
  name: string;
  model: McCanvasDocument;
  dirty: boolean;
  /** 当前会话是否有写入在跑（「保存中」指示 / 包 2 的 isSaving 端口） */
  saving: boolean;
  notice: string | null;
  setNotice: (notice: string | null) => void;
  /** 替换文档（新建/打开/最近/演示）：新会话令牌 + 新目的地 + dirty 复位 */
  applyModel: (model: McCanvasDocument, name: string, handle?: FsFileHandle) => void;
  /** 编辑：更新模型 + 置脏（不推进会话令牌） */
  updateModel: (model: McCanvasDocument) => void;
  /** 手动保存；结果可判别（downloaded ≠ saved；current=false 时保持 dirty） */
  save: () => Promise<SaveCompletion>;
  /**
   * 能否离开的**实时**判据（包 2 的 `DocumentLeavePort.isDirty`）：模型是否有未保存改动。
   * 实时读取，不能缓存渲染期的 `dirty` 布尔。
   */
  isDirty: () => boolean;
  /**
   * 能否离开的**实时**判据（包 2 的 `DocumentLeavePort.isSaving`）：当前会话是否有
   * 进行中/在队写入。实时读取，不能缓存渲染期的 `saving` 布尔。
   */
  isSaving: () => boolean;
  /**
   * 等**当前会话**已开始 I/O 完成；不自动开始新的文件选择器。
   *
   * 语义边界：被替换会话（新建/打开/最近/演示）已发出的物理 I/O 无法撤回，不在等待范围内，
   * 且其完成不会回填任何状态。若要「磁盘上无未结束写入」，本方法不足（包 2 如需另议）。
   */
  waitForIdle: () => Promise<void>;
}

export function useFreeCanvasDocument({
  host,
  initialName,
  onDocChange,
}: FreeCanvasDocumentOptions): FreeCanvasDocumentState {
  const [name, setName] = useState(initialName);
  const [model, setModel] = useState<McCanvasDocument>(() => createEmptyDocument('未命名画布'));
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;
  // 内容身份：模型对象引用（自由画布模型不可变更新）——保存完成时读最新值
  const modelRef = useRef(model);
  modelRef.current = model;
  // 脏标记的实时事实源（离开判定读它，不能读渲染闭包）。**在状态变更处同步更新**：
  // React 的 setState 要到下一次渲染才反映，而离开决策会在保存返回后立刻复核 isDirty()。
  const dirtyRef = useRef(false);
  const setDirtyFlag = useCallback((next: boolean): void => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);
  // 保存目的地（句柄）由会话持有：同步推进，排队请求读它而不是闭包里的旧句柄（复核 R1）
  const { session, saving } = useDocumentSaveSession({ readContent: () => modelRef.current });

  const applyModel = useCallback(
    (next: McCanvasDocument, nextName: string, handle?: FsFileHandle): void => {
      // 显式文档替换：推进会话令牌 + 同步换目的地（旧会话未开始的写入按 stale 结束、
      // 已发出的不回填）
      session.beginDocument(handle);
      modelRef.current = next;
      nameRef.current = nextName;
      setModel(next);
      setName(nextName);
      setDirtyFlag(false);
      onDocChange?.(next);
    },
    [session, onDocChange, setDirtyFlag],
  );

  const updateModel = useCallback(
    (next: McCanvasDocument): void => {
      modelRef.current = next;
      setModel(next);
      setDirtyFlag(true);
      onDocChange?.(next);
    },
    [onDocChange, setDirtyFlag],
  );

  const save = useCallback((): Promise<SaveCompletion> => {
    return session
      .submit({
        intent: 'manual',
        capture: () => {
          const current = modelRef.current;
          return { source: serializeCanvasDocument(current), content: current };
        },
        write: (snapshot) =>
          host.save({
            id: nameRef.current,
            name: nameRef.current,
            source: snapshot.source,
            handle: session.getDestination(),
            saved: true,
            ts: Date.now(),
          }),
        commit: (snapshot, outcome, current) => {
          const nextHandle = outcome.handle ?? session.getDestination();
          session.setDestination(nextHandle);
          // 附属记录（最近画布）失败不影响写盘事实：结果仍是 saved，dirty 照常处理，
          // 仅把提示换成准确的附属警告（复核 R4-B）
          let metadataFailed = false;
          try {
            host.remember({
              id: nameRef.current,
              name: nameRef.current,
              source: snapshot.source,
              handle: nextHandle,
              saved: true,
              ts: Date.now(),
            });
          } catch {
            metadataFailed = true;
          }
          // 写入期间继续编辑 → 磁盘上是旧快照，保持 dirty（下次保存再写最新内容）
          if (current) setDirtyFlag(false);
          if (metadataFailed) {
            // 下载分支不得声称「已写入文件」（第三轮复核口径）
            setNotice(
              outcome.result === 'fs' ? SAVE_METADATA_WARNING : SAVE_METADATA_WARNING_DOWNLOAD,
            );
            return;
          }
          setNotice(
            outcome.result === 'fs' ? '已保存' : '已下载 JSON（当前环境不支持直接写回文件）',
          );
        },
      })
      .then((completion) => {
        // 只有**当前会话**的失败才提示；取消/过期静默（复核 R2）
        if (completion.kind === 'failed') setNotice('保存失败');
        return completion;
      });
  }, [session, host]);

  const isDirty = useCallback((): boolean => dirtyRef.current, []);
  const isSaving = useCallback((): boolean => session.isSaving(), [session]);
  const waitForIdle = useCallback((): Promise<void> => session.waitForIdle(), [session]);

  return {
    name,
    model,
    dirty,
    saving,
    notice,
    setNotice,
    applyModel,
    updateModel,
    save,
    isDirty,
    isSaving,
    waitForIdle,
  };
}

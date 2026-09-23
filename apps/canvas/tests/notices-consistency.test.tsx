// @vitest-environment jsdom
/**
 * P0-C ①：文案**唯一事实源**的一致性契约（acceptance §5.2）。
 *
 * 要证明的三件事，逐条对应本题的验收点：
 *
 *  ① **同一错误码 → 同一文案**（跨域不分叉）。
 *     同一个 `E-PERMISSION` 无论从 FileManager 侧（文件树动作）还是资产侧
 *     （上传失败）走到用户眼前，都必须是**同一串字节**。实测两条消费路径：
 *       - 文件侧：`useFileOpController.ts:213` 走 `FILE_OP_FAIL_NOTICE`
 *         （`hooks/useFileOpOrchestration.ts:79`）；
 *       - 资产侧：`uploadFailureNotice()` 走 `FILE_OP_FAIL_COPY`。
 *     两者此前是**两张分别维护的表**，`E-NOT-FOUND` 一条就已经分叉出
 *     「文件已不在磁盘上。」（`useFileOpController.ts:213` 的兜底串）与
 *     「文件已不在磁盘上（可能被外部改名或删除），列表已刷新。」两种说法。
 *     这里把「同一张表」钉成断言：任一侧再写第二套说法，用例即红。
 *
 *  ② **穷尽性**：映射表覆盖两个域的**全部**错误码，漏码必须失败。
 *     类型层的 `Record<FileOpErrorCode, string>` 只能保证「生产表编译得过」；
 *     测试若用手抄的码表去遍历，漏检会**静默通过**。因此本文件用
 *     `assetNotices.ts` 再导出的 `FileOpErrorCode`（键域的唯一来源）
 *     做 `Record<FileOpErrorCode, true>` 反查 —— 少一个键就是**编译错误**，
 *     而不是运行期「碰巧没测到」。
 *
 *  ③ **正向扫全表**：确认没有 `assetStoreCopy.ts` 的 `isForbiddenAssetCopy`
 *     禁止表述（「换电脑也能用」「单文件即可携带」…，§1.7）。
 *     用**既有守卫函数**扫，不另写一套正则 —— 两套正则必然再次分叉。
 */
import { describe, expect, it } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach } from 'vitest';
import type { FileOpOutcome, FsFileHandle, WorkspaceDir, WorkspaceFile, WorkspaceNode } from '@mindcanvas/react';
import { PartialSuccessPanel } from '../src/FileOpPanels';
import { DocumentSaveSession } from '../src/hooks/useDocumentSaveSession';
import { type SafeWorkspaceHost, useFileOpOrchestration } from '../src/hooks/useFileOpOrchestration';
import { type OpWorkspaceHost, useFileOpController } from '../src/useFileOpController';
import {
  ASSET_INSERT_REFUSAL_COPY,
  ASSET_SESSION_REASON_COPY,
  ASSET_CORE_COPY,
  DELETE_FLOW_COPY,
  FILE_OP_ERROR_CODES_EXHAUSTIVE,
  FILE_OP_FAIL_COPY,
  FILE_OP_REFUSAL_COPY,
  UNCONFIRMED_WRITE_NOTICE,
  assetBadgeOf,
  assetDuplicateCopyNotice,
  insertRefusalNotice,
  uploadFailureNotice,
  type AssetInsertRefusalReason,
  type DeleteFlowReason,
  type FileOpErrorCode,
  type FileOpRefusalReason,
} from '../src/assetNotices';
import { FILE_OP_FAIL_NOTICE } from '../src/hooks/useFileOpOrchestration';
import { isForbiddenAssetCopy } from '@mindcanvas/react';

/** 部分成功面板 / 删除流实际拷进 `refId` 的形状（`MindmapStage.tsx:3002` 同形） */
const SAMPLE_REF_ID = 'assets/logo-3f9a.png';

/**
 * 全表聚合：**每一串用户可见文案**都要经过同一组纪律检查。
 *
 * 聚合的是「表」而不是「散落的字面量」——新增一张表时如果忘了加进这里，
 * 下面「表清单完整」那条会提醒（见 `ALL_TABLE_NAMES`）。
 */
const ALL_TABLES: Record<string, Record<string, string>> = {
  FILE_OP_FAIL_COPY,
  FILE_OP_REFUSAL_COPY: FILE_OP_REFUSAL_COPY,
  DELETE_FLOW_COPY: DELETE_FLOW_COPY,
  ASSET_INSERT_REFUSAL_COPY: ASSET_INSERT_REFUSAL_COPY,
  ASSET_SESSION_REASON_COPY: ASSET_SESSION_REASON_COPY,
  'ASSET_CORE_COPY.badge': ASSET_CORE_COPY.badge,
  'ASSET_CORE_COPY.portability': ASSET_CORE_COPY.portability,
};

/** 表清单（防「新增了一张文案表却漏检」——与 `ALL_TABLES` 必须同步） */
const ALL_TABLE_NAMES = [
  'FILE_OP_FAIL_COPY',
  'FILE_OP_REFUSAL_COPY',
  'DELETE_FLOW_COPY',
  'ASSET_INSERT_REFUSAL_COPY',
  'ASSET_SESSION_REASON_COPY',
  'ASSET_CORE_COPY.badge',
  'ASSET_CORE_COPY.portability',
] as const;

/** 扁平化：`表名 → 键 → 文案`（含需要插值的两处单独处理，见各自用例） */
function flatEntries(): Array<{ table: string; key: string; text: string }> {
  const out: Array<{ table: string; key: string; text: string }> = [];
  for (const [table, map] of Object.entries(ALL_TABLES)) {
    for (const [key, text] of Object.entries(map)) out.push({ table, key, text });
  }
  // 单值文案（不在表里，但同属「用户可见串」）
  out.push({ table: '(单值)', key: 'UNCONFIRMED_WRITE_NOTICE', text: UNCONFIRMED_WRITE_NOTICE });
  // 需要插值的两条：用样例参数求值后一并扫（插值不得引入禁止表述）
  for (const store of ['workspace-assets', 'browser-idb', 'builtin', null] as const) {
    out.push({ table: 'writeNotice', key: String(store), text: ASSET_CORE_COPY.writeNotice(store, '项目') });
    out.push({ table: 'storeDetail', key: String(store), text: ASSET_CORE_COPY.storeDetail(store, '项目') });
    out.push({ table: 'assetBadgeOf', key: String(store), text: assetBadgeOf(store) });
  }
  out.push({ table: '(单值)', key: 'assetDuplicateCopyNotice', text: assetDuplicateCopyNotice(SAMPLE_REF_ID) });
  return out;
}

describe('① 同一错误码 → 同一文案（跨域不分叉）', () => {
  it('文件侧表与资产侧入口对每个码给同一串字节', () => {
    for (const code of FILE_OP_ERROR_CODES_EXHAUSTIVE) {
      // 资产侧：E-ABORT = 用户取消 = 静默（空串）；其余应等于文件侧表
      const assetSide = uploadFailureNotice(code);
      if (code === 'E-ABORT') {
        expect(assetSide, 'E-ABORT（用户取消）必须静默：空串').toBe('');
        continue;
      }
      expect(assetSide, `${code} 在资产侧与 FILE_OP_FAIL_COPY 不一致`).toBe(FILE_OP_FAIL_COPY[code]);
    }
  });

  it('P0-A 既有表 FILE_OP_FAIL_NOTICE 与唯一事实源逐码相等（收敛不靠人眼）', () => {
    for (const code of FILE_OP_ERROR_CODES_EXHAUSTIVE) {
      expect(
        FILE_OP_FAIL_NOTICE[code],
        `${code}：P0-A 遗留表与 assetNotices 分叉了（这正是 §5.2 要消灭的「两套说法」）`,
      ).toBe(FILE_OP_FAIL_COPY[code]);
    }
  });

  it('删除流的 busyLease / busyPhysical 与文件操作拒绝表**逐字**相同（同一租约，不许两种说法）', () => {
    // 迁移前是两处逐字复制（useCurrentDocDeleteFlow.ts:114-115 与
    // useFileOpOrchestration.ts:66-67），复制即分叉。现在由求值得到。
    expect(DELETE_FLOW_COPY.busyLease).toBe(FILE_OP_REFUSAL_COPY['busy-lease']);
    expect(DELETE_FLOW_COPY.busyPhysical).toBe(FILE_OP_REFUSAL_COPY['busy-physical']);
    // 且不得退化成空串（空串会被面板当作「静默」，用户看不到「请稍候」）
    expect(DELETE_FLOW_COPY.busyLease.length).toBeGreaterThan(0);
    expect(DELETE_FLOW_COPY.busyPhysical.length).toBeGreaterThan(0);
  });

  it('静默语义（空串）只落在明确的两处：拒绝表的 same-name 与删除流的 cancelled', () => {
    /**
     * 注意 `E-ABORT` **不在此列**：`FILE_OP_FAIL_COPY['E-ABORT']` 是
     * 「操作已取消。」而非空串（`fileOps.ts:41` 只把它定性为「不是故障」）。
     * 真正静默的是**需要静默的调用点**：上传流走 `uploadFailureNotice`，
     * 由它把 `E-ABORT` 判成空串；`useUnsavedTransition` 侧另有自己的判据。
     * 本用例钉的是**表里的空串键**，与调用点的判据分开断言（别把两者混成一条）。
     */
    const silent = new Set(['same-name', 'cancelled']);
    const actual: string[] = [];
    for (const [code, text] of Object.entries(FILE_OP_FAIL_COPY)) if (text === '') actual.push(code);
    for (const [reason, text] of Object.entries(FILE_OP_REFUSAL_COPY)) if (text === '') actual.push(reason);
    for (const [reason, text] of Object.entries(DELETE_FLOW_COPY)) if (text === '') actual.push(reason);
    expect(new Set(actual)).toEqual(silent);
    // 调用点判据：见空串必须不渲染（`FileOpNotice` 已实现，见 file-op-panels.test.tsx）
    expect(uploadFailureNotice('E-ABORT')).toBe('');
    expect(FILE_OP_REFUSAL_COPY['same-name']).toBe('');
    expect(DELETE_FLOW_COPY.cancelled).toBe('');
  });
});

describe('② 穷尽性：两个域的全部错误码都有文案', () => {
  /**
   * 类型级反查（**漏键即编译错误**）：
   *
   * `FILE_OP_ERROR_CODES_EXHAUSTIVE` 是 `satisfies readonly FileOpErrorCode[]`
   * 的普通数组（**不是** `as const` 元组），`satisfies` 不会把它收窄成字面量类型；
   * 因此这里的 `Record<FileOpErrorCode, true>` 要求 `FileOpErrorCode` 的**每一个**
   * 成员都在对象里 —— 上游 `fileOps.ts` 加第 9 个码时，本文件与
   * `FILE_OP_FAIL_COPY` **同时**编译失败。
   */
  const _fileOpExhaustive: Record<FileOpErrorCode, true> = Object.fromEntries(
    FILE_OP_ERROR_CODES_EXHAUSTIVE.map((c) => [c, true]),
  ) as Record<FileOpErrorCode, true>;

  /** 拒绝理由：同样由类型钉死（漏一个键 → 编译错误） */
  const _refusalExhaustive: Record<FileOpRefusalReason, true> = Object.fromEntries(
    Object.keys(FILE_OP_REFUSAL_COPY).map((k) => [k, true]),
  ) as Record<FileOpRefusalReason, true>;

  /**
   * 资产插入被拒：4 键 = 上游 3 键（`assetInsert.ts:45`）+ 应用层兜底 1 键。
   *
   * `AssetInsertRefusalReason`（上游域）只钉那 3 个；`ASSET_INSERT_REFUSAL_COPY`
   * 多出的 `'inline-impossible'` 是 **P0-C ② 归位**带来的：它此前是
   * `SidePanels.tsx:34-35` 的 `REFUSED_NO_WORKSPACE` 私有文案（已成形字节，
   * 经 `onInsertRefused` 直塞提示位）。那类拒绝发生在 `inlineRefIdOf` 的自包含兜底里，
   * **不可能**是上游三键之一，所以不能用上游类型去约束整张表。
   * 两侧的穷尽性因此分开钉：上游 3 键用 `Record<AssetInsertRefusalReason, …>`
   * （见 `_insertExhaustive`），应用层 4 键用下面的键集合等值。
   */
  const _insertExhaustive: Record<AssetInsertRefusalReason, true> = Object.fromEntries(
    Object.keys(ASSET_INSERT_REFUSAL_COPY).map((k) => [k, true]),
  ) as Record<AssetInsertRefusalReason, true>;

  /** 删除流：5 键（`useCurrentDocDeleteFlow.ts:111-117`） */
  const _deleteExhaustive: Record<DeleteFlowReason, true> = Object.fromEntries(
    Object.keys(DELETE_FLOW_COPY).map((k) => [k, true]),
  ) as Record<DeleteFlowReason, true>;

  it('八个失败码一个不缺，且都能取到非 undefined 文案', () => {
    expect(FILE_OP_ERROR_CODES_EXHAUSTIVE).toHaveLength(8);
    expect(_fileOpExhaustive['E-ABORT']).toBe(true);
    for (const code of FILE_OP_ERROR_CODES_EXHAUSTIVE) {
      expect(typeof FILE_OP_FAIL_COPY[code], `${code} 无文案`).toBe('string');
    }
  });

  it('八个拒绝理由一个不缺（含空串的 same-name）', () => {
    expect(Object.keys(FILE_OP_REFUSAL_COPY)).toHaveLength(8);
    expect(_refusalExhaustive['same-name']).toBe(true);
  });

  it('资产插入三键（上游）+ 应用层兜底一键 / 会话四条 / 删除流五条，键集合精确相等', () => {
    // 上游三键：必须**全部**在表里（`_insertExhaustive` 是类型级反查，缺一即编译错误）
    for (const r of ['no-workspace', 'unsupported-format', 'write-failed'] as const) {
      expect(_insertExhaustive[r], `上游拒绝理由 ${r} 在表里缺失`).toBe(true);
      expect(typeof ASSET_INSERT_REFUSAL_COPY[r], `${r} 无文案`).toBe('string');
    }
    // 应用层兜底键：`inline-impossible` 只此一处，不得再多（多即是新造的未登记文案）
    expect(Object.keys(ASSET_INSERT_REFUSAL_COPY).sort()).toEqual(
      ['inline-impossible', 'no-workspace', 'unsupported-format', 'write-failed'].sort(),
    );
    // 归位必须一字未改：与迁移前 `SidePanels.REFUSED_NO_WORKSPACE` 的字节完全相同
    expect(ASSET_INSERT_REFUSAL_COPY['inline-impossible']).toBe(
      '这张图片需要先打开一个文件夹作为工作区，才能插入到文档里。',
    );
    expect(Object.keys(ASSET_SESSION_REASON_COPY).sort()).toEqual(
      ['declined', 'fs-unavailable', 'idb-failed', 'no-workspace'].sort(),
    );
    expect(Object.keys(DELETE_FLOW_COPY).sort()).toEqual(
      ['busyLease', 'busyPhysical', 'cancelled', 'composing', 'draftFailed'].sort(),
    );
    expect(_deleteExhaustive.cancelled).toBe(true);
  });

  it('资产的每个用户可见串都在本文件可见的表里（表清单完整，漏表即红）', () => {
    expect(Object.keys(ALL_TABLES).sort()).toEqual([...ALL_TABLE_NAMES].sort());
    // 资产侧没有「同名冲突」以外的裸串：此处只用「表被聚合」证明；
    // 真正的空洞保护是下面的全表扫描 —— 任何表漏登记，其文案就不受纪律检查。
    expect(flatEntries().length).toBeGreaterThan(30);
  });

  it('插入被拒的三条**不得**退化成同一句（恢复路径不同：§4.9 / I-10）', () => {
    const texts = Object.values(ASSET_INSERT_REFUSAL_COPY);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('会话级四条**都**必须说「没有写入持久存储」（§4.3 纪律：不许把能用说成已保存）', () => {
    for (const [reason, text] of Object.entries(ASSET_SESSION_REASON_COPY)) {
      expect(text, `${reason} 未声明「没有写入持久存储」`).toContain('没有写入持久存储');
    }
  });
});

describe('③ 正向扫全表：不得出现 assetStoreCopy 的禁止表述', () => {
  it('每一串文案都过既有守卫 isForbiddenAssetCopy（不另写正则）', () => {
    const forbidden = flatEntries().filter((e) => isForbiddenAssetCopy(e.text));
    expect(
      forbidden.map((e) => `${e.table}[${e.key}] = ${e.text}`),
      '出现 §1.7 禁止表述（「换电脑也能用」「单文件即可携带」类）',
    ).toEqual([]);
  });

  it('守卫本身有效（负控：喂它一句禁止表述必须为 true）', () => {
    // 负控：若守卫失灵（恒 false），上一条的「全表通过」就是假绿
    expect(isForbiddenAssetCopy('已保存，换电脑也能用')).toBe(true);
    expect(isForbiddenAssetCopy('📁 本工作区')).toBe(false);
  });

  it('两域文案都不得把「写入成功」说成「可携带」（I-12 的关键分界）', () => {
    // 正向锚点：工作区落点的成功提示必须**同时**给出失效条件
    const wsNotice = ASSET_CORE_COPY.writeNotice('workspace-assets', '项目');
    expect(wsNotice).toContain('已保存');
    expect(wsNotice, 'workspace-assets 的「已保存」必须带失效条件').toMatch(/只拷文档/);
    // 浏览器落点的成功提示必须点明「这台机器、这个浏览器」
    const idbNotice = ASSET_CORE_COPY.writeNotice('browser-idb', '项目');
    expect(idbNotice).toContain('已保存');
    expect(idbNotice).toMatch(/浏览器/);
    // 会话级（null）**不得**出现「已保存」——它没有写入持久存储
    expect(ASSET_CORE_COPY.writeNotice(null, '项目')).not.toContain('已保存');
    expect(ASSET_CORE_COPY.writeNotice(null, '项目')).toContain('没有写入持久存储');
  });

  it('未确认写入 / 同名副本两条插值文案也在扫描面内', () => {
    for (const text of [UNCONFIRMED_WRITE_NOTICE, assetDuplicateCopyNotice(SAMPLE_REF_ID)]) {
      expect(text.length).toBeGreaterThan(0);
      expect(isForbiddenAssetCopy(text)).toBe(false);
    }
    // 插值必须真的带上 refId（否则用户对不上「哪一份是新的」）
    expect(assetDuplicateCopyNotice(SAMPLE_REF_ID)).toContain(SAMPLE_REF_ID);
  });
});

// ─────────────────────────────────────── 在途窗口的可控假主机（只服务 ④）

/**
 * 一个「第二次 scan 会挂起」的假工作区。
 *
 * 为什么要挂起：`busy` 只在**动作执行期间**为真，而真实实现里那段时间是
 * `await host.scan()` + `statFile` + `removeFileSafe`。要观察它，必须让其中
 * 一步停下来 —— 用假定时器做不到（它挂在真实 Promise 上），
 * 明确 `releaseScan()` 放行才有确定性，不引入 sleep / 竞态。
 */
function makeDeferredHost() {
  const files = new Map<string, string>([['架构.mm.md', '# 架构原文']]);
  let pending: (() => void) | null = null;

  const fileOf = (path: string): WorkspaceFile => ({
    kind: 'file',
    name: path,
    path,
    handle: { name: path } as FsFileHandle,
    ts: 1,
    size: (files.get(path) ?? '').length,
  });

  const host = {
    mounted: true,
    name: 'MyNotes',
    scopeId: 'ws:test',
    calls: { scan: 0, remove: 0 },
    /** 暴露底下的文件表，供用例断言「源真的被删了」 */
    files,
    fileAt: fileOf,
    /** 放行被挡住的那次 scan */
    releaseScan(): void {
      const r = pending;
      pending = null;
      r?.();
    },
    async scan(): Promise<WorkspaceNode[]> {
      host.calls.scan += 1;
      // 第 2 次 scan 是「重试删除源」的第一跳 → 挡在这里制造在途窗口
      if (host.calls.scan === 2) {
        await new Promise<void>((res) => {
          pending = res;
        });
      }
      const dirs = new Map<string, WorkspaceDir>();
      const out: WorkspaceNode[] = [];
      for (const path of files.keys()) {
        if (!path.includes('/')) {
          out.push(fileOf(path));
          continue;
        }
        const dirPath = path.slice(0, path.indexOf('/'));
        let dir = dirs.get(dirPath);
        if (dir === undefined) {
          dir = { kind: 'dir', name: dirPath, path: dirPath, children: [], handle: {} as WorkspaceDir['handle'] };
          dirs.set(dirPath, dir);
          out.push(dir);
        }
        dir.children.push(fileOf(path));
      }
      return out;
    },
    async statFile(file: WorkspaceFile) {
      if (!files.has(file.path)) return null;
      return { size: (files.get(file.path) ?? '').length, lastModified: 1 };
    },
    async resolveCopyName(_dirPath: string, name: string) {
      return name;
    },
    async renameFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<WorkspaceFile>> {
      return { kind: 'ok', value: file };
    },
    /** 移动制造「部分成功」：目标已建、删源失败（与 F3 同形） */
    async moveFileSafe(file: WorkspaceFile, targetDir: string): Promise<FileOpOutcome<WorkspaceFile>> {
      const text = files.get(file.path) ?? '';
      const next = `${targetDir}/${file.name}`;
      files.set(next, text);
      host.calls.remove += 1;
      return {
        kind: 'partial',
        created: fileOf(next),
        sourceRetained: true,
        error: { code: 'E-PERMISSION', retryable: true },
      };
    },
    async removeFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<null>> {
      host.calls.remove += 1;
      files.delete(file.path);
      return { kind: 'ok', value: null };
    },
    async removeDirSafe(): Promise<FileOpOutcome<null>> {
      return { kind: 'ok', value: null };
    },
    async duplicateFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<WorkspaceFile>> {
      return { kind: 'ok', value: file };
    },
  };
  return host;
}

/** 挂起控制器（形状照抄 `file-op-partial.test.tsx` 的 `mountController`） */
function mountPartialController(host: SafeWorkspaceHost & OpWorkspaceHost) {
  const session = new DocumentSaveSession({ readContent: () => null });
  const state = { currentPath: null as string | null };
  const view = renderHook(() => {
    const [, setTick] = useState(0);
    void setTick;
    const orchestration = useFileOpOrchestration({
      session,
      host,
      readDoc: () => ({ durable: true, current: true, dirty: false }),
      onRebound: (file) => {
        state.currentPath = file.path;
      },
    });
    return useFileOpController({
      host,
      orchestration,
      isDirty: () => false,
      currentPath: () => state.currentPath,
      saveNow: async () => true,
      suppressPendingAuto: () => {},
      reload: async () => {},
    });
  });
  return { view };
}

afterEach(cleanup);

// ══════════════════════════════════════════════════════════════════════
// ④ 重复点击禁用一致化（P0-C：散落的禁用判据收敛为一致实现）
// ══════════════════════════════════════════════════════════════════════
//
// 实测的禁用站点只有两类，**语义不同、不得合并**：
//  - **在途**（in-flight）禁用：动作正在执行 → 挡住第二次点击。
//    `App.tsx:68 disabled={!ready}`、`App.tsx:125 busy={prompt?.busy ?? false}`
//    （真值由 `useUnsavedTransition` 自己在 hook 内判定，九处 `setPrompt`）、
//    `FileOpPanels.tsx:146,164,174 disabled={busy}`（真值由本组用例盯着）。
//  - **能力**（capability）禁用：`MindmapStage.tsx:2124,2133`
//    `disabled={!controller.canUndo / !controller.canRedo}` —— 「现在能不能做」，
//    与「有没有在跑」是两回事，本文件**不碰**它（碰了就是把两套判定合并）。
//
// 本轮实测到的缺口不是「不一致」而是**空缺**：`PartialSuccessPanel` 的 `busy`
// 有 `= false` 默认值，而全仓**无一处传它**（`grep -rn "busy=" apps/canvas/src`
// 只命中 `App.tsx:125` 与 `UnsavedPrompt` 内部使用，没有任何 `PartialSuccessPanel`
// 调用点传 busy），于是 `disabled={busy}` 恒等于 `disabled={false}` —— 守卫在，判据不在。
// 下面把两侧都钉成真值：
//  ① 呈现侧：`busy` 真的落到三个写入类按钮的 `disabled` 上；
//  ② 执行侧：真值真的来自状态机 —— 在途为 true、动作结束后回到 false。

describe('④ 重复点击禁用一致化：busy 判据真的接到了 disable 上', () => {
  it('busy=true 禁用两个**会改磁盘**的动作，但两条「退出通道」不得被锁（保留两份 / 稍后处理）', () => {
    /**
     * 禁用面的**边界**是这条用例的重点，不是「三个按钮都禁用」：
     * `FileOpPanels.tsx:146,164,174` 只给「重试删除原文件」与
     * 「撤销新副本 / 放弃这些改动并删除副本」加了 `disabled={busy}`；
     * 「保留两份」(:152) 与「稍后处理」(:181) **没有** `disabled`。
     * 这是对的 —— 前两个会发起 `removeFileSafe`（并发点击会真的造成两次删除），
     * 后两个只是就地收场、不碰磁盘，在途时仍应让用户能脱离面板。
     * 若哪天有人给它们也加上 `disabled={busy}`，这条会转红：那会成为
     * 「在途时把用户锁死在面板上」的 UX 退化。
     */
    const { container } = render(
      <PartialSuccessPanel
        createdPath="归档/架构.mm.md"
        sourcePath="架构.mm.md"
        reason={FILE_OP_FAIL_COPY['E-PERMISSION']}
        copyHasNewChanges
        busy
        onChoose={() => {}}
      />,
    );
    for (const sel of ['[data-fm-partial-retry]', '[data-fm-partial-discard-copy]']) {
      const el = container.querySelector(sel);
      if (el === null) throw new Error(`找不到 ${sel}`);
      expect((el as HTMLButtonElement).disabled, `${sel} 未被 busy 禁用 → 连点会并发删磁盘`).toBe(true);
    }
    // 退出通道：在途也不得禁用，否则用户被锁死在面板上
    for (const sel of ['[data-fm-partial-keep]', '[data-fm-partial-later]']) {
      const el = container.querySelector(sel);
      if (el === null) throw new Error(`找不到 ${sel}`);
      expect((el as HTMLButtonElement).disabled, `${sel} 被误禁用（用户无法脱离）`).toBe(false);
    }
  });

  it('busy 缺省（不传）= 不禁用 —— 这正是此前全仓的形态，故调用方必须显式传入', () => {
    const { container } = render(
      <PartialSuccessPanel
        createdPath="a"
        sourcePath="b"
        reason="r"
        copyHasNewChanges={false}
        onChoose={() => {}}
      />,
    );
    const retry = container.querySelector('[data-fm-partial-retry]');
    if (retry === null) throw new Error('找不到重试按钮');
    // 钉住「默认值存在」这个事实本身：它正是「漏传即静默失效」的成因
    expect((retry as HTMLButtonElement).disabled).toBe(false);
  });

  it('busy 的真值来自状态机：在途为 true，动作结束后回到 false（不留在 true 上）', async () => {
    const host = makeDeferredHost();
    const h = mountPartialController(host);
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    // 面板已开，且此刻没有动作在途
    expect(h.view.result.current.ui.partial).not.toBeNull();
    expect(h.view.result.current.ui.partial?.busy, '面板打开时不应是 busy').toBe(false);

    // 启动「重试删除源」：它会卡在 host.scan 上 → 观察在途窗口。
    // 注意 `setPanelBusy(true)` 引发的重渲染是**异步**的：必须多冲几次微任务，
    // 否则读到的是动作开始前的那一帧（busy 仍是 false）——那就是假红。
    await act(async () => {
      h.view.result.current.ui.partial?.apply('retry-delete');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // 在途：busy 必须为 true（这就是 disabled 的真值来源）
    expect(h.view.result.current.ui.partial?.busy, '动作执行期间 busy 必须为 true').toBe(true);

    // 在途期间的第二次点击必须被**执行侧**闸门挡掉：不允许并发的第二次删源
    const removesBefore = host.calls.remove;
    await act(async () => {
      // 直接调 apply（绕过 DOM 的 disabled），证明「呈现一致」之外还有「行为安全」
      h.view.result.current.ui.partial?.apply('retry-delete');
      await Promise.resolve();
    });
    expect(host.calls.remove, '在途期间的第二次点击不得发起第二次删源').toBe(removesBefore);

    // 放行 → 动作收尾 → 面板关闭（busy 随之复位；漏 finally 会让面板永久钉死）
    await act(async () => {
      host.releaseScan();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.view.result.current.ui.partial, '源删除成功后面板应关闭').toBeNull();
    expect(host.files.has('架构.mm.md'), '源应已被删除').toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════
// ⑤ 迁移守卫：P0-C ② 从 MindmapStage / SidePanels / 旧两表迁走的文案
// ══════════════════════════════════════════════════════════════════════
//
// 迁移的**唯一目的**是「同一句话不再有第二份字面量」。用「每句仍能找到 ≥1 份」
// 这种断言是不够的 —— 它无法阻止迁完又在原处写回一份。这里改为**定位式**断言：
// 用 Vite 的 `?raw` glob 把整个 `apps/canvas/src` 与 `packages/react/src` 的源码
// 读成文本，逐句统计**活字面量**出现次数，要求恰好为 1 且落在 `assetNotices.ts`。
//
// 注释里的引用（如本文件上方那些「迁移前是 …」的说明）不算活字面量：
// 统计前先剥掉块注释与行注释 —— 否则「记录历史」本身会把守卫逼成红。

const APP_SRC: Record<string, string> = import.meta.glob('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** 剥掉块注释与行注释（只做文本级处理，足够用于「活字面量」计数） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 某句在仓库里的活出现位置 */
function liveOccurrences(sentence: string): string[] {
  const hits: string[] = [];
  for (const [key, raw] of Object.entries(APP_SRC)) {
    const rel = key.replace(/^\.\.\/src\//, '');
    for (const line of stripComments(raw as string).split('\n')) {
      if (line.includes(sentence)) hits.push(rel);
    }
  }
  return hits;
}

describe('⑤ 迁移守卫：迁走的文案在原处不得再出现', () => {
  /**
   * 逐句：**恰好 1 处**活字面量，且必须在 `assetNotices.ts`。
   *
   * 若有人在 `MindmapStage.tsx` 里又手写回一句（哪怕一模一样），
   * 这里会变成 2 处 → 红。这正是「唯一事实源」在代码里的可查形态。
   */
  const MIGRATED = [
    // UNCONFIRMED_WRITE_NOTICE（原 MindmapStage.tsx:169-170）
    '图片已写入原文件夹的 assets/，但工作区已切换；切回后可在素材库看到。',
    // refusedNoticeOf 三条（原 MindmapStage.tsx:186-194）
    '先打开一个文件夹作为工作区，才能把这张图片插入文档。',
    '这张图片不能内联进文档；先打开一个文件夹作为工作区再插入。',
    '图片没能写入工作区，插入已取消（文档未改动）。',
    // REFUSED_NO_WORKSPACE（原 SidePanels.tsx:34-35）
    '这张图片需要先打开一个文件夹作为工作区，才能插入到文档里。',
    // assets/ 副本提示（原 MindmapStage.tsx:3002，模板串的前半）
    '已在工作区 assets/ 保存了一份副本',
    // FILE_OP_REFUSAL_COPY 的两条 busy（原 useCurrentDocDeleteFlow.ts:114-115）
    '正在处理上一步操作，请稍候再试（本次未做任何改动）。',
    '上一份写入还没有结束，请稍后重试（本次未做任何改动）。',
    // FILE_OP_FAIL_COPY['E-UNKNOWN']（原 failNoticeOf 的兜底串）
    '操作失败，请重试。',
    // useFileOpController.ts:213 的第二套说法
    '文件已不在磁盘上（可能被外部改名或删除），列表已刷新。',
    // 上传失败：旧的一句话说法已删除，新文案来自 FILE_OP_FAIL_COPY
    '没有写入权限：请重新授权后重试。',
    '磁盘空间不足，无法完成这次操作。',
    '当前浏览器或这份目录句柄不支持这个操作。',
    '读写磁盘失败，请重试。',
    '目标位置已有同名文件。',
    '操作已取消。',
  ] as const;

  it('每句迁移文案在 src 里恰好 1 处活字面量，且落在 assetNotices.ts', () => {
    const problems: string[] = [];
    for (const sentence of MIGRATED) {
      const hits = liveOccurrences(sentence);
      if (hits.length !== 1) {
        problems.push(`「${sentence}」活出现 ${hits.length} 处：${hits.join(', ')}（期望恰好 1 处）`);
        continue;
      }
      if (hits[0] !== 'assetNotices.ts') {
        problems.push(`「${sentence}」的唯一定义在 ${hits[0]}，应迁到 assetNotices.ts`);
      }
    }
    expect(problems, `文案未收敛到唯一事实源：\n${problems.join('\n')}`).toEqual([]);
  });

  it('旧的「上传失败，请重试。」只剩注释里的历史记录，没有任何活字面量', () => {
    // 这句被移除是因为它把 E-PERMISSION / E-QUOTA / E-ABORT 说成同一句（I-10 要求分开）
    expect(liveOccurrences('上传失败，请重试。')).toEqual([]);
  });

  it('旧的「文件已不在磁盘上。」（同码第二套说法）已无活字面量', () => {
    expect(liveOccurrences('文件已不在磁盘上。')).toEqual([]);
  });

  it('上传失败入口：E-ABORT 静默、其余按 FILE_OP_FAIL_COPY 逐码（迁移动机）', () => {
    // 迁移的**行为**承诺：这四条不再共用一句话
    const texts = (['E-PERMISSION', 'E-QUOTA', 'E-UNAVAILABLE', 'E-IO'] as const).map((c) =>
      uploadFailureNotice(c),
    );
    expect(new Set(texts).size, '四种失败被说成同一句（I-10 禁止）').toBe(texts.length);
    // 取消静默：调用方见空串不渲染
    expect(uploadFailureNotice('E-ABORT')).toBe('');
    // 逐码等于同一张表（这就是「两域一张表」）
    expect(uploadFailureNotice('E-PERMISSION')).toBe(FILE_OP_FAIL_COPY['E-PERMISSION']);
  });

  it('插入被拒入口：三条给出三句不同的话，且兜底不退化成空气泡', () => {
    const three = (['no-workspace', 'unsupported-format', 'write-failed'] as const).map((r) =>
      insertRefusalNotice(r),
    );
    expect(new Set(three).size).toBe(3);
    for (const t of three) expect(t.length).toBeGreaterThan(0);
    // 未知键 → 兜到 no-workspace（与迁移前 inlineRefIdOf 的默认拒绝同语义）
    expect(insertRefusalNotice('something-else')).toBe(ASSET_INSERT_REFUSAL_COPY['no-workspace']);
    // 面板回传的键（原 REFUSED_NO_WORKSPACE 的位置）
    expect(insertRefusalNotice('inline-impossible')).toBe(
      ASSET_INSERT_REFUSAL_COPY['inline-impossible'],
    );
  });
});

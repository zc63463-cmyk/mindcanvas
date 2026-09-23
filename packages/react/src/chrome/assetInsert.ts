/**
 * 插入归一化（P0-B ⑤，契约 §1.5.1 / asset-library §4.9，不变量 I-10）。
 *
 * **问题**：文档里只写得下 `assets/a.png`。当浏览器素材库与当前工作区各有一张
 * `assets/a.png` 时，「在面板卡片上加 scope 徽章」并不能保证插入与重开解析到同一张图 ——
 * 仅靠内存中的 `AssetKey` 会在重开后失效（这是初版被打回的根因，见 N1 负控）。
 *
 * **规则**（I-10 的优先级）：
 *  1. **工作区归一**（已挂载）：把所选资产写入 `<workspace>/assets/`，文档引用该文件。
 *     跨存储（浏览器素材库 → 磁盘）先复制字节再引用；**同名走同名策略**（默认保留两份，
 *     `shared-contracts.md` §4.5.2 —— 已存在同名但无法证明字节相同 → 分配不冲突的新名）。
 *  2. **自包含**（未挂载，且是可净化的小 SVG）→ 内联 `data:`。
 *  3. **拒绝**（未挂载且不满足 2）→ 不插入。**不得**写入任何新形态引用
 *     （如 `browser:<id>`）—— 那会扩展文档语法且重开必失效。
 *
 * **内置图标的 child 缺口（CE-05）**：内置图标三种语义都走内联。child 分支若直接写
 * `{kind, id}` 会序列化成 `@draw:builtin:<id>`，而 `resolveAsset` 未命中缓存时回落
 * `baseUrl + id` → 站点根下不存在的路径 → 断图。本模块的 `builtin` 分支把源码
 * 净化后内联，因此 child 与 icon/media 同口径。
 *
 * **零副作用纪律**：`refused` 时调用方不得改文档（归一化失败 → 不插入）。
 */
import { svgToDataUrl, sanitizeInlineSvg, isInlineableSvgText } from '../render/svgTint.js';
import type { AssetItem } from './assetTypes.js';
import type { AssetHostV2 } from './assetHost.js';
import type { WorkspaceWriter } from './workspaceAssetHost.js';

/** 归一化结果（契约 asset-library §4.9 的 `NormalizeResult`） */
export type NormalizeResult =
  | {
      kind: 'normalized';
      /** 写进文档的引用 id（`assets/<rel>` 或 `data:` 或 `builtin:<id>` 的 data 形态） */
      refId: string;
      /** 实际落点：工作区磁盘 / 自包含（无磁盘写入） */
      store: 'workspace-assets' | 'builtin';
      /** 是否内联（`data:` 形态）。内联项脱离工作区仍可显示 */
      inline: boolean;
      /** 工作区落盘时的相对路径（内联时为 null） */
      relPath: string | null;
      /** 是否因为同名而分配了不冲突的新名（UI 需提示「已在工作区保存了一份副本」） */
      renamed: boolean;
    }
  | {
      kind: 'refused';
      reason: 'no-workspace' | 'unsupported-format' | 'write-failed';
      /** 面向开发者的原始信息（UI 不得直接展示；文案由调用方按 reason 选） */
      detail?: string;
    };

/** 归一化所需的最小环境面（结构化类型：`DirectoryWorkspaceHost` 天然满足 `writer`） */
export interface NormalizeEnv {
  /** 当前工作区写入器（未挂载 → null） */
  workspace: WorkspaceWriter | null;
  /** 同名冲突选择（缺省「保留两份」） */
  conflict?: 'keep-both' | 'replace' | 'cancel';
}

/** 资产是否是可内联的自包含小 SVG（I-10 的规则 2 判据） */
export function isInlineableAsset(item: AssetItem): boolean {
  if (item.kind !== 'draw') return false;
  if (typeof item.svg !== 'string') return false;
  return isInlineableSvgText(item.svg);
}

/**
 * 内联形态的引用 id：净化 → data URL。
 * 净化失败（非 SVG / 解析错 / 非 DOM 环境）→ null（调用方按格式不支持处置）。
 */
export function inlineRefOf(svg: string): string | null {
  const clean = sanitizeInlineSvg(svg);
  if (clean === null) return null;
  return svgToDataUrl(clean);
}

/**
 * 内置图标 → 内联引用（child 路径与 icon/media 共用）。
 *
 * 内置图标的 `svg` 来自打包的 `BUILTIN_ICONS`（应用自带、可信），但仍过同一净化路径 ——
 * 不为「可信来源」开一条绕过净化的旁路（那条旁路迟早被上传资产复用）。
 */
export function builtinInlineRef(item: AssetItem): string | null {
  if (item.source !== 'builtin' || typeof item.svg !== 'string') return null;
  return inlineRefOf(item.svg);
}

/**
 * 资产 → 文件名（归一化落盘时用）。`assets/<rel>` 取末段；其余取 `name`。
 */
export function fileNameOfAsset(item: AssetItem): string {
  const id = item.id;
  if (id.startsWith('assets/')) {
    const seg = id.split('/');
    const last = seg[seg.length - 1];
    if (last !== undefined && last !== '') return last;
  }
  return item.name;
}

/**
 * 归一化（I-10）。**这是插入前唯一允许决定「文档里写什么引用」的地方。**
 *
 * 判据顺序即 I-10 的优先级：工作区归一 → 自包含内联 → 拒绝。
 */
export async function normalizeForInsert(
  item: AssetItem,
  env: NormalizeEnv,
  host?: AssetHostV2,
): Promise<NormalizeResult> {
  // ── 内置图标：三种插入语义都内联（CE-05）
  const builtinRef = builtinInlineRef(item);
  if (builtinRef !== null) {
    return {
      kind: 'normalized',
      refId: builtinRef,
      store: 'builtin',
      inline: true,
      relPath: null,
      renamed: false,
    };
  }

  const w = env.workspace;
  // ── 已挂载：一律归一化到工作区（含「资产本来就在磁盘上」的复用情形）
  if (w?.mounted === true) {
    return normalizeToWorkspace(item, env, w, host);
  }

  // ── 未挂载：只有可净化的小 SVG 能内联，其余拒绝（不写任何新形态引用）
  if (isInlineableAsset(item) && typeof item.svg === 'string') {
    const refId = inlineRefOf(item.svg);
    if (refId === null) return { kind: 'refused', reason: 'unsupported-format' };
    return {
      kind: 'normalized',
      refId,
      store: 'builtin',
      inline: true,
      relPath: null,
      renamed: false,
    };
  }
  return { kind: 'refused', reason: 'no-workspace' };
}

/** 工作区归一：字节落 `<workspace>/assets/`，引用相对工作区根的路径 */
async function normalizeToWorkspace(
  item: AssetItem,
  env: NormalizeEnv,
  w: WorkspaceWriter,
  host?: AssetHostV2,
): Promise<NormalizeResult> {
  const fileName = fileNameOfAsset(item);
  const target = `assets/${fileName}`;
  const conflict = env.conflict ?? 'keep-both';

  // 已在磁盘上的同一路径：**不重复写**（引用它就是归一化的结果）。
  // 是否「同内容」不在此判定 —— 文件已在目标路径即等价于「已归一化到工作区」。
  const alreadyThere = await safeHasAsset(w, target);

  if (!alreadyThere) {
    const data = await bytesOf(item, host);
    if (data === null) return { kind: 'refused', reason: 'unsupported-format' };

    if (conflict === 'cancel') {
      return { kind: 'refused', reason: 'write-failed', detail: '用户取消同名冲突' };
    }
    // 同名但无法证明字节相同 → 分配不冲突的新名（默认「保留两份」，§4.5.2 / I-10）
    let name = fileName;
    let renamed = false;
    if (await safeHasAsset(w, target)) {
      if (conflict === 'replace') {
        name = fileName;
      } else {
        name = await uniqueName(w, fileName);
        renamed = true;
      }
    }
    try {
      await w.writeAsset(name, data, mimeOfAsset(fileName));
    } catch (e) {
      return { kind: 'refused', reason: 'write-failed', detail: detailOf(e) };
    }
    return {
      kind: 'normalized',
      refId: `assets/${name}`,
      store: 'workspace-assets',
      inline: false,
      relPath: `assets/${name}`,
      renamed,
    };
  }

  return {
    kind: 'normalized',
    refId: target,
    store: 'workspace-assets',
    inline: false,
    relPath: target,
    renamed: false,
  };
}

/** 取资产字节：内联源码优先（浏览器素材库），否则回读宿主/磁盘 */
async function bytesOf(item: AssetItem, host?: AssetHostV2): Promise<ArrayBuffer | string | null> {
  if (typeof item.svg === 'string' && item.kind === 'draw') return item.svg;
  const file = await readAssetFile(item, host);
  if (file === null) return null;
  return file.arrayBuffer();
}

/** 读源文件：磁盘项经工作区读，其余经宿主解析的 URL 取回 */
async function readAssetFile(item: AssetItem, host?: AssetHostV2): Promise<File | null> {
  const state = host?.resolveAssetState?.(item);
  const url = state?.kind === 'resolved' ? state.url : host?.resolveAsset(item);
  if (typeof url !== 'string' || typeof fetch !== 'function') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], item.name, { type: blob.type });
  } catch {
    return null;
  }
}

async function uniqueName(w: WorkspaceWriter, fileName: string): Promise<string> {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}${ext}`;
    if (!(await safeHasAsset(w, `assets/${candidate}`))) return candidate;
  }
  return `${base} 1000${ext}`;
}

async function safeHasAsset(w: WorkspaceWriter, relPath: string): Promise<boolean> {
  try {
    return await w.hasAsset(relPath);
  } catch {
    return false;
  }
}

function mimeOfAsset(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'avif') return 'image/avif';
  return 'application/octet-stream';
}

function detailOf(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

/**
 * 本地目录工作区宿主（FA2-T1）：Obsidian 式的「打开一个文件夹当工作区」。
 *
 * 为什么需要它：`DocLibrary` 是基于 localStorage 的**元数据索引**，受 5MB 配额限制
 * 只能给最近 8 篇（`SOURCE_KEEP`）保留源码快照，更早的文档打开时退化成「重新选文件」；
 * 目录层级也是拼出来的假字符串（`工作/项目A`），移动文件靠手敲路径。
 *
 * 有了目录句柄之后：
 *  - 源码就在磁盘上，读多少篇都不占 localStorage，8 篇魔咒自然消失；
 *  - 目录树来自真实磁盘结构，新建/重命名/删除/移动都是真操作；
 *  - 资产可以写进 `./assets/`，导出的 .mm.md 用相对路径引用 → 拷到任何机器都能离线浏览（T4）。
 *
 * 降级：不支持 `showDirectoryPicker`（Safari/Firefox）或用户拒绝授权时，
 * 宿主保持 `null` 状态，调用方回落既有的 `LocalDocHost`（单文件句柄闭环）。
 */
import { isAbortError } from './fsError.js';
import { iterateDir, listAssetFilesOp, readAssetFileOp, hasAssetOp, writeAssetOp, type AssetHostEnv } from './directoryHostAssets.js';
import { ASSETS_DIR, SCAN_SKIP_DIRS } from './directoryHostConstants.js';
import type { FileOpOutcome, FileStatSnapshot } from './fileOps.js';
import {
  type SafeHostEnv,
  duplicateFileSafeOp,
  moveFileSafeOp,
  removeDirSafeOp,
  removeFileSafeOp,
  renameFileSafeOp,
  resolveCopyNameOp,
  statFileOf,
} from './directoryHostOps.js';
import { getDirectoryHandle, verifyPermission, writeWorkspaceRegistry } from './handleStore.js';
import { BROWSER_SCOPE, applyIdentity, markDormant } from './scopeIdentity.js';
import type { ScopeId, ScopeState } from './workspaceScope.js';
import {
  isDirEntry,
  isFileEntry,
  isWorkspaceDocName,
  type FsDirectoryHandle,
  type FsEntryHandle,
  type WorkspaceDir,
  type WorkspaceFile,
  type WorkspaceNode,
} from './directoryTypes.js';

export { ASSETS_DIR, SCAN_SKIP_DIRS };

export interface ScanOptions {
  /** 递归深度上限（防符号链接环 / 超深目录把浏览器拖死） */
  maxDepth?: number;
  /** 收录文件数上限 */
  maxFiles?: number;
  /** 额外跳过的目录名 */
  skipDirs?: readonly string[];
  /**
   * P1-A ⑤：是否同时收集**不支持打开**的文件（非 `.mm.md`/`.md`、`.` 开头的隐藏文件）。
   *
   * 为什么是扫描选项而不是第二遍扫描：这些项必须来自**同一次**目录遍历
   * （第二遍扫描会与主树的上限、跳过目录、错误处理全部脱钩，两份结果迟早不一致）。
   * 缺省 `false` → 既有调用方与既有语义**零变化**。
   */
  includeOtherFiles?: boolean;
}

const DEFAULT_SCAN: Required<ScanOptions> = {
  maxDepth: 8,
  maxFiles: 2000,
  skipDirs: SCAN_SKIP_DIRS,
  includeOtherFiles: false,
};

/** 浏览器是否支持目录选择器 */
export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// 目录遍历已抽到 `directoryHostAssets.ts`（`iterateDir`）—— 扫描与资产列出共用同一实现。

/**
 * 拆文件名与扩展名，`.mm.md` 视为**一个整体扩展名**。
 *
 * 用 `lastIndexOf('.')` 会把 `架构.mm.md` 拆成 base=`架构.mm` / ext=`.md`，
 * 重名时生成 `架构.mm 2.md` —— 既丢了 `.mm.md` 语义（应用认不出这是导图），
 * 又长得莫名其妙。故先判复合后缀。
 */
function splitExt(name: string): { base: string; ext: string } {
  for (const ext of ['.mm.md', '.md']) {
    if (name.toLowerCase().endsWith(ext)) {
      const base = name.slice(0, name.length - ext.length);
      if (base.length > 0) return { base, ext: name.slice(base.length) };
    }
  }
  const dot = name.lastIndexOf('.');
  if (dot > 0) return { base: name.slice(0, dot), ext: name.slice(dot) };
  return { base: name, ext: '' };
}

/** 路径拼接：根目录下 path 为 ''，不再产生前导斜杠 */
function joinPath(parent: string, name: string): string {
  return parent === '' ? name : `${parent}/${name}`;
}

/** 取所在目录路径（根目录直属文件 → ''） */
function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/** 取文件的 mtime/size；读不到（权限/实现差异）不抛，回落 0 */
async function statOf(handle: WorkspaceFile['handle']): Promise<{ ts: number; size: number }> {
  try {
    const file = await handle.getFile?.();
    if (!file) return { ts: 0, size: 0 };
    return { ts: file.lastModified, size: file.size };
  } catch {
    return { ts: 0, size: 0 };
  }
}

/** 按路径取目录句柄（逐级 getDirectoryHandle） */
async function dirAt(
  root: FsDirectoryHandle,
  path: string,
  create = false,
): Promise<FsDirectoryHandle> {
  let cur = root;
  for (const seg of path.split('/').filter((s) => s.length > 0)) {
    if (typeof cur.getDirectoryHandle !== 'function') throw new Error('目录句柄不可遍历');
    cur = await cur.getDirectoryHandle(seg, { create });
  }
  return cur;
}

export class DirectoryWorkspaceHost {
  private root: FsDirectoryHandle | null = null;
  private tree: WorkspaceNode[] | null = null;
  /** 上一次扫描是否含「其他文件」（P1-A ⑤）：缓存键的一部分，见 `scan()` */
  private treeIncludeOtherFiles = false;
  /** 工作区身份（browser / disk / disk-session）；epoch：挂载、断开、scopeId 变化时 +1 */
  private scope: ScopeState = { ...BROWSER_SCOPE };

  /** 是否已挂载工作区 */
  get mounted(): boolean {
    return this.root !== null;
  }

  /** 工作区名（目录名）；未挂载为 null */
  get name(): string | null {
    return this.root?.name ?? null;
  }

  // ---------------------------------------------------------------- P0-0：身份访问器

  /** 运行期身份形态（shared-contracts §1.2.5） */
  get scopeState(): ScopeState {
    return this.scope;
  }

  /** 当前 scopeId；未挂载或 browser → null */
  get scopeId(): ScopeId | null {
    return this.scope.kind === 'browser' ? null : this.scope.scopeId;
  }

  /** 会话代：挂载、断开、scopeId 变化时 +1；已挂载的 `requestPermission` 不变 */
  get scopeEpoch(): number {
    return this.scope.epoch;
  }

  /** 浏览器能力 + 权限是否已就绪 */
  static isSupported(): boolean {
    return isDirectoryPickerSupported();
  }

  /**
   * 弹出目录选择器并挂载为工作区。成功后经**单一路径**解析身份并写 IndexedDB，刷新可恢复。
   * 用户取消 / 不支持 → null（调用方回落单文件模式）。
   */
  async pick(): Promise<FsDirectoryHandle | null> {
    if (!isDirectoryPickerSupported()) return null;
    try {
      const handle = await window.showDirectoryPicker?.({ mode: 'readwrite' });
      if (!handle) return null;
      const state = await applyIdentity(handle);
      this.root = handle;
      this.tree = null;
      this.mountScope(state);
      return handle;
    } catch (e) {
      // AbortError = 用户取消；其他错误也一律降级，不打断主流程
      if (!isAbortError(e)) this.root = null;
      return null;
    }
  }

  /**
   * 从 IndexedDB 恢复上次的工作区。
   * 只认已授权（`granted`）的句柄：`prompt` 状态下不主动弹权限框
   * （需要用户手势，页面加载时请求必然被拒）。
   */
  async restore(): Promise<boolean> {
    if (this.root !== null) return true;
    const handle = await getDirectoryHandle();
    if (!handle) return false;
    if (!(await verifyPermission(handle, true))) return false;
    const state = await applyIdentity(handle);
    this.root = handle;
    this.tree = null;
    this.mountScope(state);
    return true;
  }

  /** 有用户手势时补一次权限请求（点「连接工作区」按钮时调用） */
  async requestPermission(): Promise<boolean> {
    const wasMounted = this.root !== null;
    const handle = this.root ?? (await getDirectoryHandle());
    if (!handle) return false;
    const ok = await verifyPermission(handle, true, true);
    if (!ok) return false;
    if (!wasMounted) {
      // 本次挂载改变了 root：必须经同一条身份解析路径（I-23）；已挂载时不重解析、不改 scopeId/epoch
      const state = await applyIdentity(handle);
      this.mountScope(state);
    }
    this.root = handle;
    this.tree = null;
    return true;
  }

  /** 断开工作区（注册表转 dormant + 删裸键，**同一事务**；内存态回 browser） */
  async detach(): Promise<void> {
    this.root = null;
    this.tree = null;
    // R1：不再单独调用 deleteDirectoryHandle()（避免两键分叉）；corrupt / unavailable 时不写键
    await writeWorkspaceRegistry(markDormant, { kind: 'delete' });
    this.scope = { ...BROWSER_SCOPE, epoch: this.scope.epoch + 1 };
  }

  // ---------------------------------------------------------------- P0-0：身份解析（单一路径 + 两阶段）

  /** 挂载成功：写 scope 并 `epoch+1`（挂载、断开、scopeId 变化时 +1） */
  private mountScope(state: ScopeState): void {
    this.scope = { ...state, epoch: this.scope.epoch + 1 };
  }

  private requireRoot(): FsDirectoryHandle {
    if (this.root === null) throw new Error('工作区未挂载');
    return this.root;
  }

  /**
   * 扫描真实目录树（结果缓存；force=true 重新扫盘）。
   *
   * `options.includeOtherFiles`（P1-A ⑤）参与**缓存键**：开/关是两次不同的扫描结果，
   * 若共用一个缓存槽，用户切换「显示其他文件」后会拿到上一次口径的树
   * （要么看不到无关文件，要么在主树上凭空多出灰项）。
   */
  async scan(force = false, options?: ScanOptions): Promise<WorkspaceNode[]> {
    const root = this.requireRoot();
    const includeOtherFiles = options?.includeOtherFiles === true;
    if (this.tree !== null && !force && this.treeIncludeOtherFiles === includeOtherFiles) {
      return this.tree;
    }
    this.tree = await this.scanDir(root, '', 0, {
      ...DEFAULT_SCAN,
      includeOtherFiles,
      count: { n: 0 },
    });
    this.treeIncludeOtherFiles = includeOtherFiles;
    return this.tree;
  }

  private async scanDir(
    dir: FsDirectoryHandle,
    path: string,
    depth: number,
    st: Required<ScanOptions> & { count: { n: number } },
  ): Promise<WorkspaceNode[]> {
    if (depth > st.maxDepth || st.count.n >= st.maxFiles) return [];
    const out: WorkspaceNode[] = [];
    for await (const entry of iterateDir(dir)) {
      if (st.count.n >= st.maxFiles) break;
      const rawName = Reflect.get(entry, 'name');
      if (typeof rawName !== 'string') continue;

      if (isDirEntry(entry)) {
        if (st.skipDirs.includes(rawName)) continue;
        const childPath = joinPath(path, rawName);
        const children = await this.scanDir(entry, childPath, depth + 1, st);
        // 空目录也保留：用户要能在空目录里「新建导图」
        out.push({ kind: 'dir', name: rawName, path: childPath, handle: entry, children });
        continue;
      }
      if (isFileEntry(entry) && isWorkspaceDocName(rawName)) {
        st.count.n += 1;
        const { ts, size } = await statOf(entry);
        out.push({
          kind: 'file',
          name: rawName,
          path: joinPath(path, rawName),
          handle: entry,
          ts,
          size,
        });
        continue;
      }
      /**
       * P1-A ⑤：不支持打开的文件也回传（带 `unopenable` 标记），供「显示其他文件」
       * 分组使用。**默认不收集**（`includeOtherFiles` 缺省 false）→ 既有调用方
       * 拿到的树与改动前逐项一致。
       *
       * 计数**不进** `st.count.n`：上限（2000）是「导图收纳量」的预算，
       * 让无关文件挤掉导图会改变既有语义（用户会突然看不到自己的文档）。
       */
      if (st.includeOtherFiles && isFileEntry(entry)) {
        const { ts, size } = await statOf(entry);
        out.push({
          kind: 'file',
          name: rawName,
          path: joinPath(path, rawName),
          handle: entry,
          ts,
          size,
          unopenable: true,
        });
      }
    }
    // 目录在前、文件在后；同级按名称排序（中文用 localeCompare）
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return out;
  }

  /** 读取文件内容 */
  async readFile(file: WorkspaceFile): Promise<string> {
    const f = await file.handle.getFile?.();
    if (!f) return '';
    return f.text();
  }

  /** 写回文件（走句柄，不弹任何系统对话框） */
  async writeFile(file: WorkspaceFile, text: string): Promise<void> {
    const writable = await file.handle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  /** 在指定目录下新建导图文件（同名自动加序号，不覆盖既有文件） */
  async createFile(dirPath: string, name: string, text: string): Promise<WorkspaceFile> {
    const dir = await dirAt(this.requireRoot(), dirPath);
    if (typeof dir.getFileHandle !== 'function') throw new Error('目录句柄不可写');
    const finalName = await this.uniqueName(dir, name);
    const handle = await dir.getFileHandle(finalName, { create: true });
    const file: WorkspaceFile = {
      kind: 'file',
      name: finalName,
      path: joinPath(dirPath, finalName),
      handle,
      ts: Date.now(),
      size: text.length,
    };
    await this.writeFile(file, text);
    this.tree = null;
    return file;
  }

  /** 新建文件夹 */
  async createDir(parentPath: string, name: string): Promise<WorkspaceDir> {
    const parent = await dirAt(this.requireRoot(), parentPath);
    if (typeof parent.getDirectoryHandle !== 'function') throw new Error('目录句柄不可写');
    const handle = await parent.getDirectoryHandle(name, { create: true });
    this.tree = null;
    return {
      kind: 'dir',
      name,
      path: joinPath(parentPath, name),
      handle,
      children: [],
    };
  }

  /**
   * 重命名（FS Access API 没有 rename：读旧内容 → 写新文件 → 删旧）。
   * 返回值带新句柄与新路径，调用方据此刷新选中项。
   */
  async renameFile(file: WorkspaceFile, newName: string): Promise<WorkspaceFile> {
    if (newName === file.name) return file;
    const text = await this.readFile(file);
    const parentPath = file.path.includes('/')
      ? file.path.slice(0, file.path.lastIndexOf('/'))
      : '';
    const created = await this.createFile(parentPath, newName, text);
    await this.removeFile(file);
    this.tree = null;
    return created;
  }

  /** 删除文件 */
  async removeFile(file: WorkspaceFile): Promise<void> {
    const parentPath = file.path.includes('/')
      ? file.path.slice(0, file.path.lastIndexOf('/'))
      : '';
    const dir = await dirAt(this.requireRoot(), parentPath);
    await dir.removeEntry?.(file.name);
    this.tree = null;
  }

  /** 递归删除目录 */
  async removeDir(dir: WorkspaceDir): Promise<void> {
    const parentPath = dir.path.includes('/') ? dir.path.slice(0, dir.path.lastIndexOf('/')) : '';
    const parent = await dirAt(this.requireRoot(), parentPath);
    await parent.removeEntry?.(dir.name, { recursive: true });
    this.tree = null;
  }

  /**
   * 移动文件到目标目录（拖拽归位的落点）。
   * 与 rename 同法：复制到目标 → 删源。跨目录移动不是原子操作，
   * 但先写后删保证**不会同时丢失两份**（最坏情况是留下副本，可再删）。
   */
  async moveFile(file: WorkspaceFile, targetDirPath: string): Promise<WorkspaceFile> {
    const text = await this.readFile(file);
    const created = await this.createFile(targetDirPath, file.name, text);
    await this.removeFile(file);
    this.tree = null;
    return created;
  }

  /** 目录内唯一文件名：`架构.mm.md` → `架构 2.mm.md` */
  private async uniqueName(dir: FsDirectoryHandle, name: string): Promise<string> {
    if (typeof dir.getFileHandle !== 'function') return name;
    const { base, ext } = splitExt(name);
    let candidate = name;
    for (let i = 2; i < 1000; i++) {
      try {
        await dir.getFileHandle(candidate);
        candidate = `${base} ${i}${ext}`;
      } catch {
        return candidate; // 取不到 = 不存在，可用
      }
    }
    return candidate;
  }

  // ---------------------------------------------------------------- P0-A：*Safe 变体
  //
  // 实现已抽到 `directoryHostOps.ts`（`bigFiles` 预算）；这里只做一行转发，
  // 保持既有调用面（`host.renameFileSafe(...)` 等）不变。
  // 既有 `renameFile` / `moveFile` / `removeFile` / `removeDir` 签名与抛错行为**不变**。

  /** 宿主内部能力（供 `*Safe` 实现模块使用） */
  private safeEnv(): SafeHostEnv {
    return {
      requireRoot: () => this.requireRoot(),
      dirAt,
      readFile: (file) => this.readFile(file),
      writeFile: (file, text) => this.writeFile(file, text),
      statOf,
      uniqueName: (dir, name) => this.uniqueName(dir, name),
      invalidateTree: () => {
        this.tree = null;
      },
    };
  }

  /** 取文件尺寸/时间戳快照（外部修改复查用） */
  async statFile(file: WorkspaceFile): Promise<FileStatSnapshot | null> {
    return statFileOf(this.safeEnv(), file);
  }

  /** 改名（安全变体） */
  async renameFileSafe(
    file: WorkspaceFile,
    newName: string,
    overwrite = false,
  ): Promise<FileOpOutcome<WorkspaceFile>> {
    return renameFileSafeOp(this.safeEnv(), file, newName, overwrite);
  }

  /** 移动（安全变体） */
  async moveFileSafe(
    file: WorkspaceFile,
    targetDirPath: string,
    overwrite = false,
  ): Promise<FileOpOutcome<WorkspaceFile>> {
    return moveFileSafeOp(this.safeEnv(), file, targetDirPath, overwrite);
  }

  /** 删除文件（安全变体） */
  async removeFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<null>> {
    return removeFileSafeOp(this.safeEnv(), file);
  }

  /** 递归删除目录（安全变体） */
  async removeDirSafe(dir: WorkspaceDir): Promise<FileOpOutcome<null>> {
    return removeDirSafeOp(this.safeEnv(), dir);
  }

  /** 创建副本（§3.5） */
  async duplicateFileSafe(file: WorkspaceFile): Promise<FileOpOutcome<WorkspaceFile>> {
    return duplicateFileSafeOp(this.safeEnv(), file);
  }

  /** 带序号的目标名（冲突三选之「保留两份」） */
  async resolveCopyName(dirPath: string, name: string): Promise<string> {
    return resolveCopyNameOp(this.safeEnv(), dirPath, name);
  }

  // ---------------------------------------------------------------- T4 资产落盘
  //
  // 实现已抽到 `directoryHostAssets.ts`（`bigFiles` 预算）；这里只做一行转发。

  /** 宿主内部能力（供资产实现模块使用） */
  private assetEnv(): AssetHostEnv {
    return {
      requireRoot: () => this.requireRoot(),
      dirAt,
      statOf,
    };
  }

  /** 资产写进工作区的 `./assets/`，返回相对路径 */
  async writeAsset(name: string, data: ArrayBuffer | string, mime: string): Promise<string> {
    return writeAssetOp(this.assetEnv(), name, data, mime);
  }

  /** 读取 `./assets/` 下的资产（刷新后重建 objectURL 缓存用） */
  async readAssetFile(relPath: string): Promise<File | null> {
    return readAssetFileOp(this.assetEnv(), relPath);
  }

  /** 列出 `./assets/` 下的全部资产 */
  async listAssetFiles(): Promise<WorkspaceFile[]> {
    return listAssetFilesOp(this.assetEnv());
  }

  /** 资产是否已存在于磁盘 */
  async hasAsset(relPath: string): Promise<boolean> {
    return hasAssetOp(this.assetEnv(), relPath);
  }
}

/** 扁平化文件树（搜索/统计用） */
export function flattenFiles(nodes: readonly WorkspaceNode[]): WorkspaceFile[] {
  const out: WorkspaceFile[] = [];
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n);
    else out.push(...flattenFiles(n.children));
  }
  return out;
}

/** 扁平化目录树（下拉选择目标目录用） */
export function flattenDirs(nodes: readonly WorkspaceNode[]): WorkspaceDir[] {
  const out: WorkspaceDir[] = [];
  for (const n of nodes) {
    if (n.kind !== 'dir') continue;
    out.push(n);
    out.push(...flattenDirs(n.children));
  }
  return out;
}

/**
 * 按关键字过滤文件树（保留命中文件的**祖先目录链**）。
 *
 * 为什么不能直接 filter 文件：丢了父目录，树就渲染不出来，
 * 用户看到一堆无层级的文件名，等于把刚建好的目录结构又拍平了。
 */
export function filterTree(nodes: readonly WorkspaceNode[], query: string): WorkspaceNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...nodes];
  const walk = (list: readonly WorkspaceNode[]): WorkspaceNode[] => {
    const out: WorkspaceNode[] = [];
    for (const n of list) {
      if (n.kind === 'file') {
        if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) out.push(n);
        continue;
      }
      const children = walk(n.children);
      // 目录自身命中 → 保留整棵子树；否则只保留有命中后代的部分
      if (n.name.toLowerCase().includes(q)) out.push({ ...n, children: n.children });
      else if (children.length > 0) out.push({ ...n, children });
    }
    return out;
  };
  return walk(nodes);
}

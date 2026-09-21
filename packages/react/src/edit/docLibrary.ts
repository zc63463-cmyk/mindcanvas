/**
 * 文档库（文件管理的数据层）—— 历史文件清单 + 分类（标签）管理。
 *
 * 与 `DocumentHost.recent()` 的分工：
 * - `recent()`：最近 8 条、含 source，服务于「启动页继续上次」的快速恢复
 * - `DocLibrary`：**全量**文档条目 + 分类，服务于文件管理器（列表/筛选/重命名/删除）
 *
 * 存储取舍（重要）：
 * localStorage 限额约 5MB，若全量存 source 会在文档一多时撑爆。
 * 故**只为最近 SOURCE_KEEP 条保留源码快照**，更早的条目只存元数据
 * （id/名称/时间/标签）。元数据条目打开时需重新关联文件——
 * 这与现有 `recent()` 恢复后 handle 失效的行为一致，不引入新概念。
 *
 * 不是什么：不做文件内容同步、不做云端。纯本地元数据索引。
 */

const LIB_KEY = 'mindcanvas.library.v1';
const FOLDERS_KEY = 'mindcanvas.folders.v1';
/** 默认预置分类目录（开箱自带，空库初始化用） */
export const DEFAULT_PRESET_FOLDERS: readonly string[] = ['示例导图', '工作项目', '个人笔记', '灵感草稿'];
/**
 * 保留源码快照的条目数（其余只存元数据）。
 * 导出：UI 需要把这个上限**显式告诉用户**（否则条目上突然出现 ↻ 会不知所措）。
 */
export const SOURCE_KEEP = 8;

/** 文档库条目 */
export interface DocEntry {
  /** 稳定 id（与 MindDoc.id 一致） */
  id: string;
  name: string;
  /** 最近访问时间 */
  ts: number;
  /**
   * 所属目录路径，`/` 分隔层级（如 `工作/PomodoroXII`）。
   * 空字符串 = 根目录（未归档）。旧数据缺此字段 → 读取时兜底为 ''（见 normalize）。
   */
  folder: string;
  /** 附加标签（可选；目录为主、标签为辅） */
  tags: string[];
  /** 源码快照（仅最近若干条有） */
  source?: string;
}

/** 标签排序：中文按拼音、英文按字典序（默认 sort 按码点排，中文顺序反直觉） */
function cmpTag(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN');
}

/** 未分类的固定标签（筛选 UI 用，不写进 tags） */
export const UNTAGGED = '__untagged__';

/** 目录层级分隔符 */
const SEP = '/';

/** 类型谓词：`unknown` → 普通对象（非 null、非数组）。替代 as 断言，零债务 */
function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isEntry(x: unknown): x is DocEntry {
  if (!isRecord(x)) return false;
  return (
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.ts === 'number' &&
    Array.isArray(x.tags) &&
    x.tags.every((t) => typeof t === 'string')
  );
}

/** 兼容旧数据：补齐缺失的 folder，并清洗路径格式 */
function normalize(e: DocEntry): DocEntry {
  return { ...e, folder: cleanFolder(typeof e.folder === 'string' ? e.folder : '') };
}

/** 清洗目录路径：去首尾斜杠、合并重复斜杠、丢弃空段 */
function cleanFolder(raw: string): string {
  return raw
    .split(SEP)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(SEP);
}

export class DocLibrary {
  private load(): DocEntry[] {
    try {
      const raw = localStorage.getItem(LIB_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isEntry).map(normalize) : [];
    } catch {
      return []; // localStorage 禁用/损坏 → 退化为内存态，不阻断主流程
    }
  }

  private save(list: DocEntry[]): void {
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(list));
    } catch {
      // 配额满：优先丢弃源码快照再试一次（保住元数据）
      try {
        const slim = list.map((e, i) => (i < SOURCE_KEEP ? e : { ...e, source: undefined }));
        localStorage.setItem(LIB_KEY, JSON.stringify(slim));
      } catch {
        // 仍失败则静默——文件管理是增强能力，不能拖垮文档读写
      }
    }
  }

  /** 全部条目（新的在前） */
  list(): DocEntry[] {
    return this.load().sort((a, b) => b.ts - a.ts);
  }

  get(id: string): DocEntry | undefined {
    return this.load().find((e) => e.id === id);
  }

  /**
   * 登记/更新一条（按 id 去重，更新时间戳）。
   * 超出 SOURCE_KEEP 的旧条目会被剥掉 source。
   */
  upsert(
    /**
     * 字段内联而非 `Pick<MindDoc, ...>` —— 避免 docLibrary 依赖 document.ts：
     * LocalDocHost（document.ts）反过来要用 DocLibrary 作为单一事实源，
     * 若这边 import MindDoc 就形成循环依赖（depcruise 会拦）。
     * 三个字段都是 string，结构化类型天然兼容 MindDoc。
     *
     * `ts` 通常省略（= 现在）。迁移旧数据时**必须传**：否则每条都盖上迁移时刻，
     * 而旧列表是「最新在前」存的，最后写入的反而是最旧的、拿到最大 ts → 顺序整体反转。
     */
    doc: {
      id: string;
      name: string;
      source: string;
      tags?: string[];
      folder?: string;
      ts?: number;
    },
  ): DocEntry {
    const prev = this.get(doc.id);
    const list = this.load().filter((e) => e.id !== doc.id);
    const entry: DocEntry = {
      id: doc.id,
      name: doc.name,
      ts: doc.ts ?? Date.now(),
      folder: doc.folder !== undefined ? cleanFolder(doc.folder) : (prev?.folder ?? ''),
      tags: doc.tags ?? prev?.tags ?? [],
      source: doc.source,
    };
    list.unshift(entry);
    this.persistSorted(list);
    return entry;
  }

  /** 移动文档到指定目录（路径会被清洗；'' 表示移到根目录） */
  move(id: string, folder: string): void {
    const list = this.load();
    const hit = list.find((e) => e.id === id);
    if (!hit) return;
    hit.folder = cleanFolder(folder);
    this.save(list);
  }

  private loadCustomFolders(): string[] {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }

  private saveCustomFolders(folders: string[]): void {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch {
      // ignore
    }
  }

  /**
   * 确保初始化预置分类目录（开箱自带示例与常用分类）。
   * 仅在库为空或仅包含 1 篇初始示例且无自定义目录时写入。
   */
  ensurePresetFolders(): void {
    const existing = this.loadCustomFolders();
    if (existing.length === 0 && this.load().length <= 1) {
      this.saveCustomFolders([...DEFAULT_PRESET_FOLDERS]);
    }
  }

  /**
   * 增加自定义目录（支持多级，空目录亦会持久化）。
   */
  addFolder(folderPath: string): void {
    const cleaned = cleanFolder(folderPath);
    if (!cleaned) return;
    const current = new Set(this.loadCustomFolders());
    const segs = cleaned.split(SEP);
    for (let i = 1; i <= segs.length; i++) {
      current.add(segs.slice(0, i).join(SEP));
    }
    this.saveCustomFolders([...current]);
  }

  /**
   * 移除自定义目录（连同其子目录从目录表中清理，所含文档退回根目录）。
   */
  removeFolder(folderPath: string): void {
    const cleaned = cleanFolder(folderPath);
    if (!cleaned) return;
    const prefix = `${cleaned}${SEP}`;
    const next = this.loadCustomFolders().filter((f) => f !== cleaned && !f.startsWith(prefix));
    this.saveCustomFolders(next);

    // 级联处理归属文档：移回根目录
    const list = this.load();
    let dirty = false;
    for (const e of list) {
      if (e.folder === cleaned || e.folder.startsWith(prefix)) {
        e.folder = '';
        dirty = true;
      }
    }
    if (dirty) this.save(list);
  }

  /**
   * 全部目录路径（含所有层级的父目录与自定义空目录），按字典序。
   * 例：有 `a/b/c` 一条 → 返回 `['a', 'a/b', 'a/b/c']`，便于 UI 逐级渲染。
   */
  folders(): string[] {
    const set = new Set<string>(this.loadCustomFolders());
    for (const e of this.load()) {
      const segs = e.folder.split(SEP).filter((s) => s.length > 0);
      for (let i = 1; i <= segs.length; i++) set.add(segs.slice(0, i).join(SEP));
    }
    return [...set].sort(cmpTag);
  }

  /**
   * 某目录下的**直接子项**：子目录名 + 直属文档。
   * `folder` 传 '' 表示根目录。
   */
  childrenOf(folder: string): { dirs: string[]; docs: DocEntry[] } {
    const prefix = folder === '' ? '' : `${folder}${SEP}`;
    const dirs = new Set<string>();
    const docs: DocEntry[] = [];

    // 从全量 folders() 中提取直属子目录（包含空目录）
    for (const f of this.folders()) {
      if (folder === '') {
        const top = f.split(SEP)[0];
        if (top) dirs.add(top);
      } else if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        if (rest.length > 0) dirs.add(rest.split(SEP)[0]!);
      }
    }

    for (const e of this.list()) {
      // 直属本文档：folder 恰好相等。
      if (e.folder === folder) {
        docs.push(e);
        continue;
      }
    }
    return { dirs: [...dirs].sort(cmpTag), docs };
  }

  rename(id: string, name: string): void {
    const list = this.load();
    const hit = list.find((e) => e.id === id);
    if (!hit) return;
    hit.name = name;
    this.save(list);
  }

  setTags(id: string, tags: string[]): void {
    const list = this.load();
    const hit = list.find((e) => e.id === id);
    if (!hit) return;
    // 去重 + 去空白 + 稳定排序（避免同名标签重复堆积）
    // 用 localeCompare 而非默认 sort：后者按 UTF-16 码点排，中文顺序反直觉
    hit.tags = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))].sort(cmpTag);
    this.save(list);
  }

  remove(id: string): void {
    this.save(this.load().filter((e) => e.id !== id));
  }

  /** 全部已用标签（按字典序） */
  allTags(): string[] {
    const set = new Set<string>();
    for (const e of this.load()) for (const t of e.tags) set.add(t);
    return [...set].sort(cmpTag);
  }

  /** 按标签筛选（UNTAGGED 表示「无标签」） */
  byTag(tag: string | null): DocEntry[] {
    const all = this.list();
    if (tag === null) return all;
    if (tag === UNTAGGED) return all.filter((e) => e.tags.length === 0);
    return all.filter((e) => e.tags.includes(tag));
  }

  /** 排序后落盘，并只保留最近若干条的源码快照 */
  private persistSorted(list: DocEntry[]): void {
    list.sort((a, b) => b.ts - a.ts);
    const slimmed = list.map((e, i) => (i < SOURCE_KEEP ? e : { ...e, source: undefined }));
    this.save(slimmed);
  }
}

/**
 * RelationSchema —— 关系类型注册表（E6.1·自 markvault-js RelationSchema 采纳，精简移植）。
 * - 词汇 schema 化：{id, label, reverseId?, isSymmetric, color, isActive}；rel 仍是开放字符串
 *   （schema 只提供 label/色板/分组/反向查询，未注册的 rel 走中性兜底）
 * - 反向关系：causes↔isCausedBy 成对注册；Passive 组系统维护，用户选择器不展示
 * - 构造校验：重复 id 告警 + reverseId 未注册告警 + reverse 互指一致性告警（markvault 原设计）
 */

/** 关系类型配置 */
export interface RelationTypeConfig {
  id: string;
  label: string;
  /** 反向类型 id（成对注册；对称关系 reverseId = 自身） */
  reverseId?: string;
  isSymmetric: boolean;
  /** 语义色（hex；失效时由渲染层降灰） */
  color: string;
  /** false = 被动反向类型（系统维护，选择器不展示） */
  isActive: boolean;
  /**
   * 虚线语义（P2-2 · schema 化；缺省 false = 实线）。
   * 强语义（动态/论证/阐释/应用）实线；弱/结构/引用类（relates-to/supplements/
   * duplicates/references）虚线——passive 反向须与正向同态。
   */
  dashed?: boolean;
}

/** 语义分组（选择器/面板分组渲染） */
export interface SemanticGroup {
  label: string;
  types: string[];
}

/** 内建词汇（markvault 精简子集；blocks/causes/relates-to/duplicates 与既有 relVisualOf 对齐） */
export const DEFAULT_RELATION_TYPES: readonly RelationTypeConfig[] = [
  // ── Dynamic 动态（因果/时序/依赖）──
  {
    id: 'blocks',
    label: '阻断',
    reverseId: 'isBlockedBy',
    isSymmetric: false,
    color: '#e24b4a',
    isActive: true,
  },
  {
    id: 'causes',
    label: '导致',
    reverseId: 'isCausedBy',
    isSymmetric: false,
    color: '#e11d48',
    isActive: true,
  },
  {
    id: 'enables',
    label: '使能',
    reverseId: 'isEnabledBy',
    isSymmetric: false,
    color: '#0d9488',
    isActive: true,
  },
  {
    id: 'precedes',
    label: '先于',
    reverseId: 'follows',
    isSymmetric: false,
    color: '#0284c7',
    isActive: true,
  },
  // ── Argumentative 论证 ──
  {
    id: 'proves',
    label: '证明',
    reverseId: 'isProvedBy',
    isSymmetric: false,
    color: '#16a34a',
    isActive: true,
  },
  {
    id: 'refutes',
    label: '反驳',
    reverseId: 'isRefutedBy',
    isSymmetric: false,
    color: '#dc2626',
    isActive: true,
  },
  {
    id: 'contrasts',
    label: '对比',
    reverseId: 'contrasts',
    isSymmetric: true,
    color: '#ca8a04',
    isActive: true,
  },
  // ── Expositive 阐释 ──
  {
    id: 'elaborates',
    label: '详述',
    reverseId: 'isElaboratedBy',
    isSymmetric: false,
    color: '#a16207',
    isActive: true,
  },
  {
    id: 'exemplifies',
    label: '举例',
    reverseId: 'isExemplifiedBy',
    isSymmetric: false,
    color: '#eab308',
    isActive: true,
  },
  {
    id: 'illustrates',
    label: '图示',
    reverseId: 'isIllustratedBy',
    isSymmetric: false,
    color: '#ea580c',
    isActive: true,
  },
  // ── Referential 引用 ──
  {
    id: 'references',
    label: '引用',
    reverseId: 'isReferencedBy',
    isSymmetric: false,
    color: '#0891b2',
    isActive: true,
    dashed: true,
  },
  {
    id: 'applies',
    label: '应用',
    reverseId: 'isAppliedBy',
    isSymmetric: false,
    color: '#2563eb',
    isActive: true,
  },
  // ── Structural 结构 ──
  {
    id: 'relates-to',
    label: '关联',
    reverseId: 'relates-to',
    isSymmetric: true,
    color: '#78716c',
    isActive: true,
    dashed: true,
  },
  {
    id: 'supplements',
    label: '补充',
    reverseId: 'supplements',
    isSymmetric: true,
    color: '#10b981',
    isActive: true,
    dashed: true,
  },
  {
    id: 'duplicates',
    label: '重复',
    reverseId: 'duplicates',
    isSymmetric: true,
    color: '#ef9f27',
    isActive: true,
    dashed: true,
  },
  // ── Passive 被动反向（系统维护，选择器不展示）──
  {
    id: 'isBlockedBy',
    label: '被阻断',
    reverseId: 'blocks',
    isSymmetric: false,
    color: '#e24b4a',
    isActive: false,
  },
  {
    id: 'isCausedBy',
    label: '被导致',
    reverseId: 'causes',
    isSymmetric: false,
    color: '#e11d48',
    isActive: false,
  },
  {
    id: 'isEnabledBy',
    label: '被使能',
    reverseId: 'enables',
    isSymmetric: false,
    color: '#0d9488',
    isActive: false,
  },
  {
    id: 'follows',
    label: '承接',
    reverseId: 'precedes',
    isSymmetric: false,
    color: '#0284c7',
    isActive: false,
  },
  {
    id: 'isProvedBy',
    label: '被证明',
    reverseId: 'proves',
    isSymmetric: false,
    color: '#16a34a',
    isActive: false,
  },
  {
    id: 'isRefutedBy',
    label: '被反驳',
    reverseId: 'refutes',
    isSymmetric: false,
    color: '#dc2626',
    isActive: false,
  },
  {
    id: 'isElaboratedBy',
    label: '被详述',
    reverseId: 'elaborates',
    isSymmetric: false,
    color: '#a16207',
    isActive: false,
  },
  {
    id: 'isExemplifiedBy',
    label: '被举例',
    reverseId: 'exemplifies',
    isSymmetric: false,
    color: '#eab308',
    isActive: false,
  },
  {
    id: 'isIllustratedBy',
    label: '被图示',
    reverseId: 'illustrates',
    isSymmetric: false,
    color: '#ea580c',
    isActive: false,
  },
  {
    id: 'isReferencedBy',
    label: '被引用',
    reverseId: 'references',
    isSymmetric: false,
    color: '#0891b2',
    isActive: false,
    dashed: true,
  },
  {
    id: 'isAppliedBy',
    label: '被应用',
    reverseId: 'applies',
    isSymmetric: false,
    color: '#2563eb',
    isActive: false,
  },
];

/** 语义分组（选择器分组渲染；Passive 组不进用户选择器） */
export const SEMANTIC_GROUPS: readonly SemanticGroup[] = [
  { label: '动态', types: ['blocks', 'causes', 'enables', 'precedes'] },
  { label: '论证', types: ['proves', 'refutes', 'contrasts'] },
  { label: '阐释', types: ['elaborates', 'exemplifies', 'illustrates'] },
  { label: '引用', types: ['references', 'applies'] },
  { label: '结构', types: ['relates-to', 'supplements', 'duplicates'] },
];

export class RelationSchema {
  private configs: readonly RelationTypeConfig[];
  private _labelMap = new Map<string, string>();
  private _configMap = new Map<string, RelationTypeConfig>();
  private _reverseMap = new Map<string, string>();
  private _allTypes: string[] = [];
  private _activeTypes: string[] = [];

  constructor(configs: readonly RelationTypeConfig[] = DEFAULT_RELATION_TYPES) {
    this.configs = configs;
    const seen = new Set<string>();
    for (const cfg of configs) {
      // 构造校验 1：重复 id
      if (seen.has(cfg.id)) {
        console.warn(`[RelationSchema] 重复关系类型 id "${cfg.id}" — 忽略后续定义`);
        continue;
      }
      seen.add(cfg.id);
      this._configMap.set(cfg.id, cfg);
      this._labelMap.set(cfg.id, cfg.label);
      this._allTypes.push(cfg.id);
      if (cfg.isActive) this._activeTypes.push(cfg.id);
      if (cfg.reverseId) this._reverseMap.set(cfg.id, cfg.reverseId);
    }
    // 构造校验 2：reverseId 未注册 / 互指不一致
    for (const cfg of configs) {
      if (!cfg.reverseId) continue;
      const rev = this._configMap.get(cfg.reverseId);
      if (!rev) {
        console.warn(
          `[RelationSchema] "${cfg.id}".reverseId "${cfg.reverseId}" 未注册 — 反向查询将失败`,
        );
      } else if (!cfg.isSymmetric && rev.reverseId !== cfg.id) {
        console.warn(
          `[RelationSchema] "${cfg.id}" ↔ "${cfg.reverseId}" 非互指（"${cfg.reverseId}".reverseId = "${rev.reverseId ?? '无'}"）`,
        );
      }
    }
  }

  getLabel(id: string): string {
    return this._labelMap.get(id) ?? id;
  }

  getConfig(id: string): RelationTypeConfig | undefined {
    return this._configMap.get(id);
  }

  /** 反向关系 id（A causes B ⇔ B isCausedBy A）；未注册 → null */
  reverseOf(id: string): string | null {
    return this._reverseMap.get(id) ?? null;
  }

  getAllTypes(): string[] {
    return [...this._allTypes];
  }

  /** 主动类型（用户选择器展示集） */
  getActiveTypes(): string[] {
    return [...this._activeTypes];
  }

  /** 按语义分组取主动类型（选择器分组渲染） */
  getGroupedActiveTypes(): Array<{ label: string; types: string[] }> {
    return SEMANTIC_GROUPS.map((g) => ({
      label: g.label,
      types: g.types.filter((t) => this._activeTypes.includes(t)),
    })).filter((g) => g.types.length > 0);
  }

  /** 按分组渲染全部主动类型为 datalist option 序列（label（id）形式辅助认知） */
  activeOptions(): Array<{ value: string; label: string }> {
    return this.getActiveTypes().map((id) => ({
      value: id,
      label: `${this.getLabel(id)}（${id}）`,
    }));
  }
}

/** 默认单例（react 侧全局词汇；未来可由插件注册表扩展） */
export const defaultRelationSchema = new RelationSchema();

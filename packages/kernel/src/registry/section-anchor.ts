/**
 * sections 锚定解析契约（v1.5.0 · Phase 1 子树锚定，仿 note-anchor.ts 的 groups 先例）。
 *
 * Section 的 root 锚复用内核统一锚体系（parseLinkAnchor/resolveLinkAnchor）：
 * - `cid:xxx`  → 稳定子树身份（写入一律落 cid；改名/移动不失效——cid 双轨的另一半
 *   在 anchor-migrate，对 cid 锚「原样保留」即正确迁移）
 * - `node:根/分支/名` → 文本路径锚（读取兼容；改名/移动后可经 planReferenceMigration
 *   按 nodeId 迁移重建）
 * - 三态：well-formed（唯一命中）/ dangling（失效，如子树被删）/ stale（歧义/非法）
 *
 * dangling 治理（D3 裁决）：**数据无损**——dangling 的 Section 元数据保留在文档中，
 * 产出 W-SECTION-DANGLING 诊断，渲染层画幽灵态灰框，用户显式清理；绝不静默删除
 * （与 W-ORPHAN-NOTE 同一哲学）。
 */
import {
  buildCidIndex,
  parseLinkAnchor,
  resolveLinkAnchor,
  type AnchorResolutionState,
} from './note-anchor.js';
import { sectionsOf } from '../protocol/section.js';
import type { SectionSpec } from '../protocol/types.js';
import type { EditableNode } from '../tree/treeOps.js';

/** Section root 锚失效/非法的诊断码（D3 裁决） */
export const W_SECTION_DANGLING = 'W-SECTION-DANGLING';

/** 解析后的 Section（纯函数输出，无渲染语义） */
export interface ResolvedSection {
  spec: SectionSpec;
  state: AnchorResolutionState;
  /** well-formed → 子树根节点 id（渲染层据此求 AABB / 拖拽接 center 管线） */
  rootId?: string;
  reason?: string;
}

/**
 * 解析文档根 note 的 sections 清单（cid 索引全量预建一次，逐条复用）。
 * 形态非法的 spec 已在 sectionsOf 层跳过；这里只处理锚解析三态。
 */
export function resolveSections(root: EditableNode): ResolvedSection[] {
  const specs = sectionsOf(root.note);
  if (specs.length === 0) return [];
  const cidIndex = buildCidIndex(root);
  return specs.map((spec) => {
    const anchor = parseLinkAnchor(spec.root);
    if (!anchor) {
      return { spec, state: 'stale' as const, reason: 'unparsable-anchor' };
    }
    const res = resolveLinkAnchor(root, anchor, cidIndex);
    return {
      spec,
      state: res.state,
      ...(res.nodeId !== undefined ? { rootId: res.nodeId } : {}),
      ...(res.reason !== undefined ? { reason: res.reason } : {}),
    };
  });
}

/** Section 级诊断（非阻断；渲染层/面板据此提示幽灵态与一键清理） */
export interface SectionDiagnostic {
  code: typeof W_SECTION_DANGLING;
  sectionId: string;
  message: string;
}

/** 收集非 well-formed Section 的诊断（dangling 与 stale 同码不同措辞，均可解释） */
export function collectSectionDiagnostics(
  resolved: readonly ResolvedSection[],
): SectionDiagnostic[] {
  const out: SectionDiagnostic[] = [];
  for (const r of resolved) {
    if (r.state === 'well-formed') continue;
    const name = r.spec.title ?? r.spec.id;
    out.push({
      code: W_SECTION_DANGLING,
      sectionId: r.spec.id,
      message:
        r.state === 'dangling'
          ? `Section「${name}」的子树根锚已失效（${r.reason ?? 'unknown'}）：元数据保留，渲染幽灵态待清理`
          : `Section「${name}」的子树根锚歧义/非法（${r.reason ?? 'unknown'}）：元数据保留`,
    });
  }
  return out;
}

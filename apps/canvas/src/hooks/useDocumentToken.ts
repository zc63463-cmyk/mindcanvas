/**
 * 文档会话令牌 —— 「当前这棵树是从哪次文档加载来的」的**单调递增**身份。
 *
 * 解决的问题（R2）：切文档走 `controller.reset(editable)` **复用同一 controller 实例**
 * （`useDocumentSwitch.ts:89`；`controller.ts:475` 只复位字段，不换 identity、不 dispose），
 * 因此任何以 `controller` 对象身份为判据的清理 effect 都**不会**在切文档时触发
 * —— 摘要草稿（`summaryDraft`）就这样跨文档活着，吞掉新文档的第一次点击。
 *
 * 为什么是令牌而不是文档的某个字段（任务书 R2 约束：不得仅靠文件名/source/dirty/controller 身份）：
 * - 文件名可重复（`未命名.mm.md` 多次新建）；
 * - `source` 相同不代表不是替换：**同内容替换**（重开同一文件）也要让旧草稿失效；
 * - `dirty` 是内容状态，与「换了哪棵树」无关；
 * - controller 身份根本不随替换变化（见上）。
 *
 * 令牌**只**在「文档被整体替换」时推进。三条路径：
 * 1. `bump()`：宿主在真正替换的那一刻显式调用（`useDocumentSwitch` 检测到 `doc.source`
 *    变化时调用 —— 该 effect 的 deps 严格锁在 `doc.source`，保存路径不改写 source，
 *    所以保存 / 另存为 / 普通编辑都不会走到这里）；
 * 2. 重挂载（换文档时若组件真被重挂）：`useState` 初值随计数器自增，令牌自然变化；
 * 3. 进程内新文档：无（新 Stage = 新 hook 实例）。
 *
 * 「同内容替换」为什么有效：判据是「加载次数/替换次数」这一**事件**，而不是任何内容比较
 * —— 哪怕两份 `source` 逐字相同，替换事件依然使令牌 +1。
 */
import { useRef, useState } from 'react';

/** 进程内单调计数器：让「重挂载」也表现为令牌变化（新实例 ≠ 旧会话） */
let mountSeq = 0;

export interface DocumentToken {
  /** 当前文档会话令牌（值本身无意义，只比较是否变化） */
  token: number;
  /** 显式宣告「文档被整体替换」（幂等调用无副作用：每次都推进，故只在真替换处调用） */
  bump: () => void;
}

export function useDocumentToken(): DocumentToken {
  const [instanceSeq] = useState(() => {
    mountSeq += 1;
    return mountSeq;
  });
  // 令牌 = (重挂载序号, 本次会话内的替换计数) 的组合：任一变化都使令牌变化。
  // 用「序号 × 大常数 + 计数」而不是拼接字符串：保持 number 便于比较与日志。
  const [replaceCount, setReplaceCount] = useState(0);
  const token = instanceSeq * 1_000_000 + replaceCount;
  const bump = useRef((): void => {
    setReplaceCount((n) => n + 1);
  });
  return { token, bump: bump.current };
}

/**
 * 启动页（S2）—— 打开应用时的文档入口。
 *
 * 解决什么问题：此前应用启动即硬编码打开内置 `gateway.mm.md` 示例，
 * 用户无法打开自己的文档，导致「用 mindcanvas 管理自己的真实工作」无从发生。
 *
 * 数据来自 `DocumentHost.recent()`（localStorage，上限 8，新在前）。
 *
 * ⚠️ 重要约束：`remember()` 存的是 `{ ...doc, handle: undefined, ts }` ——
 * **含 source**（所以能直接恢复内容、无需重新授权），但**文件句柄被主动丢弃**
 * （FileSystemFileHandle 不可序列化）。因此从最近列表恢复的文档，
 * **保存时需要重新关联文件**（走 FS API 重新选择，或下载兜底）。
 * 本组件必须在 UI 上说清这一点，否则用户编辑完点保存会困惑。
 *
 * 不是什么：不含文档编辑/保存逻辑（都在 `useDocumentActions` 与 `DocumentHost`）。
 */
import type { CSSProperties } from 'react';
import type { MindDoc } from '@mindcanvas/react';
import { CHROME } from '@mindcanvas/react';

export interface StartupScreenProps {
  /** 最近文档（新在前） */
  recent: readonly MindDoc[];
  /** 选择某条最近文档（内容即存下的 source） */
  onOpenRecent: (doc: MindDoc) => void;
  onNew: () => void;
  /** 跳过，直接看内置示例 */
  onUseSample: () => void;
  /** C+1：进入自由画布子模式（可选；缺省不渲染该入口，导图入口不受影响） */
  onOpenFreeCanvas?: () => void;
}

/** 相对时间（刚刚 / N 分钟前 / … / 具体日期） */
function formatRelative(ts: number | undefined): string {
  if (ts === undefined) return '';
  const diff = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** 粗略节点数（标题 + 列表项），仅用于列表展示 */
function countNodes(source: string | undefined): number {
  if (!source) return 0;
  return (source.match(/^\s*(#{1,6}\s|-\s)/gm) ?? []).length;
}

const btnBase: CSSProperties = {
  border: `1px solid ${CHROME.panelBorder}`,
  borderRadius: CHROME.radiusSmall,
  background: CHROME.panelBg,
  color: CHROME.text,
  fontFamily: CHROME.fontFamily,
  fontSize: CHROME.fontSize,
  padding: '9px 16px',
  cursor: 'pointer',
};

export function StartupScreen({
  recent,
  onOpenRecent,
  onNew,
  onUseSample,
  onOpenFreeCanvas,
}: StartupScreenProps) {
  const [latest, ...rest] = recent;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: CHROME.bg,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        overflow: 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '.5px' }}>mindcanvas</div>
          <div style={{ fontSize: CHROME.fontSize, color: CHROME.textMuted, marginTop: 6 }}>
            纯文本思维导图 · 选择要打开的文档
          </div>
        </div>

        {latest !== undefined && (
          <>
            <button
              type="button"
              onClick={() => onOpenRecent(latest)}
              style={{
                ...btnBase,
                width: '100%',
                textAlign: 'left',
                padding: '14px 16px',
                borderColor: CHROME.panelBorderStrong,
                background: CHROME.neonSoft,
              }}
            >
              <div style={{ fontSize: 11, color: CHROME.neon, marginBottom: 4 }}>继续上次</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{latest.name}</div>
              <div style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted, marginTop: 4 }}>
                {countNodes(latest.source)} 个节点 · {formatRelative(latest.ts)}
              </div>
            </button>

            {rest.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div
                  style={{
                    fontSize: CHROME.fontSizeSmall,
                    color: CHROME.textMuted,
                    marginBottom: 8,
                  }}
                >
                  最近
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {rest.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onOpenRecent(d)}
                      style={{ ...btnBase, textAlign: 'left', padding: '10px 14px' }}
                    >
                      <div style={{ fontSize: 13 }}>{d.name}</div>
                      <div
                        style={{
                          fontSize: CHROME.fontSizeSmall,
                          color: CHROME.textMuted,
                          marginTop: 2,
                        }}
                      >
                        {countNodes(d.source)} 个节点 · {formatRelative(d.ts)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onNew} style={{ ...btnBase, flex: 1 }}>
            新建
          </button>
          <button type="button" onClick={onUseSample} style={{ ...btnBase, flex: 1 }}>
            看内置示例
          </button>
        </div>

        {/* C+1：自由画布入口（加法；缺省 prop 时不渲染，导图入口不受影响） */}
        {onOpenFreeCanvas !== undefined && (
          <button
            type="button"
            data-startup-freecanvas
            onClick={onOpenFreeCanvas}
            style={{ ...btnBase, width: '100%', marginTop: 10 }}
          >
            自由画布（便签 / 卡片翻面 / 连线）
          </button>
        )}

        {/* 「打开…」不在此处：file input 与其 onChange 逻辑都在 StageContent 内，
            搬动它会牵动文档读取链路。进入后用右上角文档菜单打开其他文件。 */}
        <div
          style={{
            marginTop: 14,
            fontSize: CHROME.fontSizeSmall,
            color: CHROME.textMuted,
            textAlign: 'center',
          }}
        >
          要打开其他文件，进入后点右上角「文档」菜单
        </div>

        {recent.length > 0 && (
          <div
            style={{
              marginTop: 20,
              padding: '10px 12px',
              borderRadius: CHROME.radiusSmall,
              background: CHROME.panelBg,
              border: `1px solid ${CHROME.panelBorder}`,
              fontSize: CHROME.fontSizeSmall,
              color: CHROME.textMuted,
              lineHeight: 1.6,
            }}
          >
            从「最近」打开会用已缓存的内容恢复，但文件关联已失效——
            <span style={{ color: CHROME.text }}> 保存时需重新选择原文件</span>
            （浏览器安全限制，文件句柄无法持久保存）。
          </div>
        )}
      </div>
    </div>
  );
}

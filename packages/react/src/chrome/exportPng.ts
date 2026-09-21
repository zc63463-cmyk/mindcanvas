/**
 * PNG 导出（N3：分享闭环第二格式）。
 * exportSvg 字符串 → Blob(svg) → Image → Canvas（scale 倍分辨率）→ toBlob('image/png')。
 * 降级语义（result.ok === false）：
 * - 'tainted'：SVG 内含外部图片（跨域资产）→ canvas 被 taint，toBlob 抛 SecurityError
 * - 'unsupported'：无 canvas 2d（测试环境 / 旧浏览器）或 toBlob 返回空
 * 调用方降级：回落下载 SVG + 提示。
 */
import type { LayoutResult } from '@mindcanvas/kernel';
import { exportSvg } from './exportSvg.js';
import type { TokenSet } from '../theme/index.js';

export type ExportPngResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: 'tainted' | 'unsupported' };

/** 从 SVG 字符串解析 width/height（exportSvg 总是写入这两个属性） */
export function readSvgSize(svg: string): { width: number; height: number } | null {
  const m = /width="([\d.]+)"\s+height="([\d.]+)"/.exec(svg);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** 布局 + 令牌 → PNG Blob（全图导出，scale 倍分辨率；降级见文件头） */
export async function exportPng(
  layout: LayoutResult,
  token: TokenSet,
  opts: {
    scale?: number;
    title?: string;
    /** G6″（A6/T23）：跨岛父子连接补线（透传 exportSvg） */
    boundaryLinks?: ReadonlyArray<{ fromId: string; toId: string }>;
  } = {},
): Promise<ExportPngResult> {
  const svg = exportSvg(layout, token, { title: opts.title, boundaryLinks: opts.boundaryLinks });
  const size = readSvgSize(svg);
  if (!size) return { ok: false, reason: 'unsupported' };
  return renderPng(svg, size.width, size.height, opts.scale ?? 2);
}

/** SVG 文本 → PNG Blob（scale 倍分辨率；可注入测试；任何环境异常 → unsupported 降级） */
export function renderPng(
  svg: string,
  width: number,
  height: number,
  scale = 2,
): Promise<ExportPngResult> {
  return new Promise((resolve) => {
    try {
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      const cleanup = (): void => URL.revokeObjectURL(url);
      img.onerror = () => {
        cleanup();
        resolve({ ok: false, reason: 'unsupported' });
      };
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            cleanup();
            resolve({ ok: false, reason: 'unsupported' });
            return;
          }
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((png) => {
            cleanup();
            if (png) resolve({ ok: true, blob: png });
            else resolve({ ok: false, reason: 'unsupported' });
          }, 'image/png');
        } catch {
          // 跨域图片污染画布（SecurityError）→ 降级
          cleanup();
          resolve({ ok: false, reason: 'tainted' });
        }
      };
      img.src = url;
    } catch {
      // 环境不支持（无 createObjectURL 等）→ 降级
      resolve({ ok: false, reason: 'unsupported' });
    }
  });
}

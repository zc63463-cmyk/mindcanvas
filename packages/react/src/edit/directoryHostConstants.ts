/**
 * 目录宿主的常量（单独一层：`directoryHost.ts` 逼近 `bigFiles` 预算，
 * 且这些常量被 `directoryHostAssets.ts` 与宿主同时引用 —— 放这里避免循环 import）。
 */

/** 扫描时的默认跳过目录（这些目录里不会有导图，遍历纯属浪费） */
export const SCAN_SKIP_DIRS: readonly string[] = [
  'node_modules',
  '.git',
  '.obsidian',
  '.vscode',
  'dist',
  'build',
  '.cache',
];

/** 工作区内资产目录名（T4） */
export const ASSETS_DIR = 'assets';

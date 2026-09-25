/**
 * tauri build 后收集产物到 release/（规范布局）：
 *   release/
 *   ├── portable/tavern-card-studio.exe            # 免安装版（运行时自建 data/）
 *   └── TavernCard Studio_<ver>_x64-setup.exe      # NSIS 安装包（单文件）
 */
import { copyFileSync, mkdirSync, readdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const targetRelease = join(root, 'src-tauri', 'target', 'release');
const nsisDir = join(targetRelease, 'bundle', 'nsis');
const outDir = join(root, 'release');
const portableDir = join(outDir, 'portable');

// 版本一致性：tauri.conf.json 与 package.json 漂移时中止，避免 release/ 混版本
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
if (pkg.version !== tauriConf.version) {
  console.error(`版本不一致：package.json ${pkg.version} vs tauri.conf.json ${tauriConf.version}`);
  process.exit(1);
}

if (!existsSync(targetRelease)) {
  console.error('未找到构建产物：请先运行 `npx tauri build`');
  process.exit(1);
}

mkdirSync(portableDir, { recursive: true });
// 清掉旧版本安装包，避免新旧并存
if (existsSync(outDir)) {
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('-setup.exe')) rmSync(join(outDir, f));
  }
}

// ① 免安装 exe（单文件即可运行，WebView2 为系统组件）
const mainExe = join(targetRelease, 'tavern-card-studio.exe');
if (!existsSync(mainExe)) {
  console.error('未找到 tavern-card-studio.exe');
  process.exit(1);
}
copyFileSync(mainExe, join(portableDir, 'tavern-card-studio.exe'));
console.log('portable  → release/portable/tavern-card-studio.exe');

// ② NSIS 安装包（保持构建名，直接放 release/ 根）
if (existsSync(nsisDir)) {
  const setups = readdirSync(nsisDir).filter((f) => f.endsWith('-setup.exe'));
  if (!setups.length) console.warn('warn: bundle/nsis 下没有 *-setup.exe（只打包了 portable？）');
  for (const f of setups) {
    copyFileSync(join(nsisDir, f), join(outDir, f));
    console.log(`installer  → release/${f}`);
  }
} else {
  console.warn('warn: 未找到 bundle/nsis 目录');
}

console.log('release/ 收集完成');

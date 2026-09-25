/**
 * 内置字体目录：全部为 SIL OFL 等开源授权的中文字体，
 * 下载源为官方 GitHub 发布（含 gh-proxy 镜像回退），安装后仅存本地。
 */

export interface FontCatalogEntry {
  id: string;
  /** 界面显示名 */
  name: string;
  /** CSS font-family 名（安装后以此引用） */
  family: string;
  /** 风格标签（宋体 / 楷体 / 仿宋 / 手写…） */
  style: string;
  description: string;
  license: string;
  sizeLabel: string;
  /** 下载地址：按序尝试（官方源在前，镜像在后），任一成功即止 */
  urls: string[];
  /** 下载物为 zip 压缩包，需解包提取字体文件 */
  archive?: boolean;
  /** FontFace weight 描述（可变字体填权重区间） */
  weight?: string;
}

/**
 * 下载源顺序：官方 GitHub 直链优先（桌面端经 Rust 命令下载，无跨域限制），
 * gh-proxy 镜像作慢速时的回退。注意浏览器 webview 受 CORS 约束：
 * Releases 的最终下载域不带跨域头，Release 渠道字体在浏览器模式不可下载
 * （raw.githubusercontent.com 的仓库文件有 CORS 头，可直接下载）。
 */

const GH = 'https://github.com';
const MIRROR = 'https://gh-proxy.com';

export const FONT_CATALOG: FontCatalogEntry[] = [
  {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷',
    family: 'LXGW WenKai',
    style: '楷体',
    description: '基于 Klee One 的开源楷书，笔意温润，长文阅读极佳',
    license: 'SIL OFL 1.1',
    sizeLabel: '约 23 MB',
    urls: [
      `${GH}/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf`,
      `${MIRROR}/https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf`,
    ],
  },
  {
    id: 'noto-serif-sc',
    name: '思源宋体',
    family: 'Noto Serif SC',
    style: '宋体',
    description: 'Adobe/Google 联合出品，笔画粗细均匀的现代宋体（可变字重）',
    license: 'SIL OFL 1.1',
    sizeLabel: '约 24 MB',
    weight: '200 900',
    urls: [
      'https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf',
      `${MIRROR}/https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf`,
    ],
  },
  {
    id: 'zhuque-fangsong',
    name: '朱雀仿宋',
    family: 'Zhuque Fangsong',
    style: '仿宋',
    description: 'Triones Type 出品的开源仿宋，笔画清瘦，古典气息浓厚',
    license: 'SIL OFL 1.1',
    sizeLabel: '约 5 MB',
    urls: [
      `${GH}/TrionesType/zhuque/releases/download/v0.212/ZhuqueFangsong-v0.212.zip`,
      `${MIRROR}/https://github.com/TrionesType/zhuque/releases/download/v0.212/ZhuqueFangsong-v0.212.zip`,
    ],
    archive: true,
  },
  {
    id: 'huiwen-mincho',
    name: '汇文明朝体',
    family: 'Huiwen Mincho',
    style: '明朝体',
    description: '复古老宋风味，适合书卷气封面与标题',
    license: 'SIL OFL 1.1',
    sizeLabel: '约 23 MB',
    urls: [
      'https://raw.githubusercontent.com/bosswnx/huiwenmincho-improved/main/%E5%8C%AF%E6%96%87%E6%98%8E%E6%9C%9D%E9%AB%94.ttf',
      `${MIRROR}/https://raw.githubusercontent.com/bosswnx/huiwenmincho-improved/main/%E5%8C%AF%E6%96%87%E6%98%8E%E6%9C%9D%E9%AB%94.ttf`,
    ],
  },
  {
    id: 'yozai',
    name: '悠哉字体',
    family: 'Yozai',
    style: '手写',
    description: '圆润手写感，适合开场白与轻小说风格',
    license: 'SIL OFL 1.1',
    sizeLabel: '约 14 MB',
    urls: [
      `${GH}/lxgw/yozai-font/releases/download/v0.868/Yozai-Regular.ttf`,
      `${MIRROR}/https://github.com/lxgw/yozai-font/releases/download/v0.868/Yozai-Regular.ttf`,
    ],
  },
];

export function getCatalogEntry(id: string): FontCatalogEntry | undefined {
  return FONT_CATALOG.find((f) => f.id === id);
}

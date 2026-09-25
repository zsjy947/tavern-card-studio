<script setup lang="ts">
/** 外观设置：主题选择（含文学氛围主题）+ 界面字体（单下拉：已装 + 目录点选即装） */
import { computed, reactive, ref } from 'vue';
import {
  NCard, NSpace, NText, NButton, NIcon, NSelect, NProgress, NPopconfirm, NSpin, useMessage,
} from 'naive-ui';
import { AddOutline, TrashOutline, CheckmarkCircle } from '@vicons/ionicons5';
import { THEMES } from '@/core/theme';
import { FONT_CATALOG, type FontCatalogEntry } from '@/core/font';
import { useAppearance } from '@/stores/appearance';
import { downloadCatalogFont, importLocalFont } from '@/services/fontService';
import { pickFiles, formatBytes } from '@/utils/file';

const message = useMessage();
const appearance = useAppearance();

/* ---------------- 主题 ---------------- */
async function applyTheme(id: string) {
  await appearance.setTheme(id);
  message.success(`已切换主题：${appearance.theme.label}`);
}

/* ---------------- 字体 ---------------- */
const applying = ref(false);
/** 下载进度：fontId → { loaded, total } */
const downloads = reactive<Record<string, { loaded: number; total: number }>>({});

const installedIds = computed(() => new Set(appearance.installedFonts.map((f) => f.id)));

/** 单下拉：默认字体 + 已安装（组1）+ 目录（组2，点选即下载安装） */
const fontOptions = computed(() => {
  const groups: ReturnType<typeof buildGroup>[] = [
    buildGroup('可用字体', [
      { label: '默认字体（跟随系统）', value: '' },
      ...appearance.installedFonts.map((f) => ({
        label: `${f.name}（${f.style}${appearance.missingFontIds.includes(f.id) ? '，文件缺失' : ''}）`,
        value: f.id,
      })),
    ]),
  ];
  const pending = FONT_CATALOG.filter((e) => !installedIds.value.has(e.id));
  if (pending.length) {
    groups.push(buildGroup('字体目录（点选即下载安装）', pending.map((e) => ({
      label: `${e.name} · ${e.style} · ${e.sizeLabel}`,
      value: `catalog:${e.id}`,
    }))));
  }
  return groups;
});

function buildGroup(label: string, children: { label: string; value: string }[]) {
  return { type: 'group' as const, label, key: label, children };
}

const downloadEntry = computed(() => {
  const id = Object.keys(downloads)[0];
  return id ? { id, ...downloads[id]! } : null;
});

async function onFontSelect(value: string) {
  if (value.startsWith('catalog:')) {
    const entry = FONT_CATALOG.find((e) => e.id === value.slice('catalog:'.length));
    if (entry) await doDownload(entry);
    return;
  }
  await onFontChange(value);
}

async function onFontChange(id: string) {
  if (id === appearance.fontId) return;
  applying.value = true;
  try {
    await appearance.setFont(id);
    message.success(id ? `界面字体已应用：${appearance.fontMeta?.name}` : '已恢复默认字体');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    applying.value = false;
  }
}

async function doDownload(entry: FontCatalogEntry) {
  if (downloads[entry.id]) return;
  downloads[entry.id] = { loaded: 0, total: 0 };
  try {
    const meta = await downloadCatalogFont(entry, (loaded, total) => {
      downloads[entry.id] = { loaded, total };
    });
    await appearance.refreshInstalled();
    message.success(`「${meta.name}」安装完成（${formatBytes(meta.size)}），已自动应用`);
    if (appearance.fontId !== meta.id) await onFontChange(meta.id);
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    delete downloads[entry.id];
  }
}

async function doImportLocal() {
  const files = await pickFiles('.ttf,.otf,.woff,.woff2', false);
  if (!files.length) return;
  applying.value = true;
  try {
    const meta = await importLocalFont(files[0]!);
    await appearance.refreshInstalled();
    await appearance.setFont(meta.id);
    message.success(`已导入并应用「${meta.name}」`);
  } catch (e) {
    message.error(`导入失败：${(e as Error).message}`);
  } finally {
    applying.value = false;
  }
}

async function doRemove(fontId: string, name: string) {
  await appearance.uninstallFont(fontId);
  message.info(`已卸载「${name}」，已回退默认字体`);
}
</script>

<template>
  <NSpin v-if="!appearance.ready" size="small" style="display: block; margin: 32px auto" />
  <NSpace v-else vertical :size="14">
    <NCard size="small" title="主题模式">
      <template #header-extra>
        <NText depth="3" style="font-size: 12px">切换即时生效，随备份迁移</NText>
      </template>
      <div class="theme-grid">
        <button
          v-for="t in THEMES" :key="t.id"
          class="theme-swatch" :class="{ 'theme-swatch-active': appearance.themeId === t.id }"
          @click="applyTheme(t.id)"
        >
          <div
            class="swatch-preview"
            :style="{ backgroundColor: t.palette.bg, backgroundImage: t.texture, backgroundSize: 'cover, auto, 160px' }"
          >
            <div class="swatch-card" :style="{ background: t.palette.surface, borderColor: t.palette.border }">
              <span class="swatch-dot" :style="{ background: t.palette.accent }" />
              <span class="swatch-line" :style="{ background: t.palette.text3 }" />
              <span class="swatch-line swatch-line-short" :style="{ background: t.palette.border }" />
            </div>
          </div>
          <div class="swatch-meta">
            <span class="swatch-label">
              {{ t.label }}
              <NIcon v-if="appearance.themeId === t.id" size="14" class="swatch-check"><CheckmarkCircle /></NIcon>
            </span>
            <span class="swatch-desc">{{ t.description }}</span>
          </div>
        </button>
      </div>
    </NCard>

    <NCard size="small" title="界面字体">
      <template #header-extra>
        <NButton size="tiny" secondary :disabled="applying || appearance.fontPreparing" @click="doImportLocal">
          <template #icon><NIcon><AddOutline /></NIcon></template>
          导入本地字体
        </NButton>
      </template>
      <NSpace vertical :size="10">
        <NSpace :size="10" align="center">
          <NSelect
            :value="appearance.fontId"
            :options="fontOptions"
            :loading="applying || appearance.fontPreparing"
            filterable
            placeholder="选择界面字体"
            style="max-width: 420px"
            @update:value="onFontSelect"
          />
          <NPopconfirm
            v-if="appearance.fontId"
            @positive-click="doRemove(appearance.fontId, appearance.fontMeta?.name ?? '当前字体')"
          >
            <template #trigger>
              <NButton size="tiny" quaternary type="error">
                <template #icon><NIcon><TrashOutline /></NIcon></template>
                卸载当前
              </NButton>
            </template>
            卸载后回退默认字体，需要时可重新下载/导入，确认？
          </NPopconfirm>
        </NSpace>

        <div v-if="downloadEntry" class="font-dl">
          <NProgress
            v-if="downloadEntry.total"
            type="line" :height="4" :show-indicator="false"
            :percentage="Math.round((downloadEntry.loaded / downloadEntry.total) * 100)"
          />
          <NText depth="3" style="font-size: 11px">
            正在下载安装 {{ downloadEntry.total
              ? formatBytes(downloadEntry.loaded) + ' / ' + formatBytes(downloadEntry.total)
              : '…（大文件约需 1-2 分钟）' }}
          </NText>
        </div>

        <NText v-if="appearance.fontId && appearance.missingFontIds.includes(appearance.fontId)" type="warning" style="font-size: 12px">
          当前字体的文件缺失或不可读（可能被手动删除），界面已回退默认渲染；可在字体目录重新安装同款，或「导入本地字体」替代。
        </NText>

        <NText depth="3" style="font-size: 12px; line-height: 1.8">
          字体来自官方开源发布渠道，桌面端安装后落盘到数据目录 data/fonts/，浏览器模式存于浏览器数据库，均不随备份导出，可随时重新下载。
          含全部常用汉字，首次启用需解码数秒。预览：简体中文的字体渲染测试 The quick brown fox 1234567890
        </NText>
      </NSpace>
    </NCard>
  </NSpace>
</template>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.theme-swatch {
  border: 1px solid var(--tcs-border, rgba(255, 255, 255, 0.09));
  border-radius: 12px;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  text-align: left;
  transition: border-color .15s, transform .15s;
}
.theme-swatch:hover { border-color: var(--tcs-accent-border, rgba(139, 92, 246, .35)); transform: translateY(-1px); }
.theme-swatch-active {
  border-color: var(--tcs-accent, #8b5cf6);
  box-shadow: 0 0 0 1px var(--tcs-accent, #8b5cf6);
}
.swatch-preview { height: 64px; padding: 12px 14px; display: flex; align-items: stretch; }
.swatch-card {
  flex: 1; border-radius: 8px; border: 1px solid;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; justify-content: center;
}
.swatch-dot { width: 22px; height: 6px; border-radius: 3px; display: block; }
.swatch-line { width: 80%; height: 4px; border-radius: 2px; opacity: .55; display: block; }
.swatch-line-short { width: 50%; opacity: .3; }
.swatch-meta { padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 2px; }
.swatch-label {
  font-size: 13px; font-weight: 700; color: var(--tcs-text-1, #ececf1);
  display: flex; align-items: center; gap: 4px;
}
.swatch-check { color: var(--tcs-accent, #8b5cf6); }
.swatch-desc { font-size: 11px; color: var(--tcs-text-3, #8b8b96); }
.font-dl { display: flex; flex-direction: column; gap: 4px; max-width: 420px; }
</style>

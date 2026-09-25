<script setup lang="ts">
/** 外观设置：主题选择（含文学氛围主题）+ 界面字体管理（在线安装 / 本地导入） */
import { computed, reactive, ref } from 'vue';
import {
  NCard, NSpace, NTag, NText, NButton, NIcon, NSelect, NProgress, NPopconfirm, useMessage,
} from 'naive-ui';
import { CloudDownloadOutline, AddOutline, TrashOutline, CheckmarkCircle } from '@vicons/ionicons5';
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

const fontOptions = computed(() => [
  { label: '默认字体（跟随系统）', value: '' },
  ...appearance.installedFonts.map((f) => ({
    label: `${f.name}（${f.style}${f.size ? '，' + formatBytes(f.size) : ''}）`,
    value: f.id,
  })),
]);

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
    message.success(`「${meta.name}」安装完成（${formatBytes(meta.size)}），可在上方选择应用`);
    // 若当前是默认字体，直接应用新装字体
    if (!appearance.fontId) await onFontChange(meta.id);
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
  message.info(`已卸载「${name}」`);
}
</script>

<template>
  <NSpace vertical :size="14">
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
      <NSpace vertical :size="12">
        <NSelect
          :value="appearance.fontId"
          :options="fontOptions"
          :loading="applying || appearance.fontPreparing"
          filterable
          placeholder="选择界面字体"
          style="max-width: 420px"
          @update:value="onFontChange"
        />

        <div class="font-catalog">
          <div v-for="entry in FONT_CATALOG" :key="entry.id" class="font-row">
            <div class="font-row-main">
              <div class="font-row-head">
                <span class="font-name">{{ entry.name }}</span>
                <NTag size="tiny" :bordered="false" round>{{ entry.style }}</NTag>
                <NTag v-if="installedIds.has(entry.id)" size="tiny" type="success" :bordered="false" round>已安装</NTag>
              </div>
              <NText depth="3" class="font-desc">{{ entry.description }}</NText>
              <NText depth="3" class="font-meta">{{ entry.sizeLabel }} · {{ entry.license }} · 开源免费</NText>
            </div>
            <div class="font-row-ops">
              <template v-if="downloads[entry.id]">
                <div class="font-dl">
                  <NProgress
                    v-if="downloads[entry.id]!.total"
                    type="line" :height="6" :show-indicator="false"
                    :percentage="Math.round((downloads[entry.id]!.loaded / downloads[entry.id]!.total) * 100)"
                  />
                  <NText depth="3" style="font-size: 11px">
                    下载中 {{ downloads[entry.id]!.total
                      ? formatBytes(downloads[entry.id]!.loaded) + ' / ' + formatBytes(downloads[entry.id]!.total)
                      : '…（大文件约需 1-2 分钟）' }}
                  </NText>
                </div>
              </template>
              <template v-else>
                <NButton
                  v-if="!installedIds.has(entry.id)"
                  size="tiny" type="primary" secondary
                  @click="doDownload(entry)"
                >
                  <template #icon><NIcon><CloudDownloadOutline /></NIcon></template>
                  下载安装
                </NButton>
                <NPopconfirm v-else @positive-click="doRemove(entry.id, entry.name)">
                  <template #trigger>
                    <NButton size="tiny" quaternary type="error">
                      <template #icon><NIcon><TrashOutline /></NIcon></template>
                      卸载
                    </NButton>
                  </template>
                  卸载后可在需要时重新下载，确认？
                </NPopconfirm>
              </template>
            </div>
          </div>
        </div>

        <NText depth="3" style="font-size: 12px; line-height: 1.8">
          字体来自官方开源发布渠道（GitHub Releases），失败会自动尝试镜像；桌面端安装后落盘到数据目录 data/fonts/，浏览器模式存于浏览器数据库，均不随备份导出，可随时重新下载。
          桌面模式经本机直连下载；浏览器模式受跨域限制，Release 渠道字体不可下载，可用「导入本地字体」替代。
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

.font-catalog { display: flex; flex-direction: column; }
.font-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 2px;
  border-top: 1px dashed var(--tcs-border, rgba(255, 255, 255, 0.07));
}
.font-row:first-child { border-top: none; }
.font-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.font-row-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.font-name { font-weight: 700; font-size: 13px; }
.font-desc { font-size: 12px; }
.font-meta { font-size: 11px; }
.font-row-ops { flex: none; width: 200px; display: flex; justify-content: flex-end; }
.font-dl { display: flex; flex-direction: column; gap: 4px; width: 100%; }
</style>

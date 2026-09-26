<script setup lang="ts">
/** 设置与备份：全量备份导出/导入 zip、数据概览、关于 */
import { computed, onMounted, ref } from 'vue';
import {
  NSpace, NButton, NCard, NTag, NText, useMessage, NIcon, NPopconfirm, NInput, NSwitch, NFormItem,
} from 'naive-ui';
import { DownloadOutline, CloudUploadOutline } from '@vicons/ionicons5';
import { exportBackup, importBackup, downloadBlob, timestampName } from '@/services/backupService';
import { getSetting, setSetting, SETTING_KEYS } from '@/services/appSettings';
import { pickFiles, formatBytes } from '@/utils/file';
import { getStore } from '@/db';
import { isTauri } from '@/db/tauri';
import { getExportDir, setExportDir, pickExportDir, openExportDir } from '@/services/exportService';
import { renderExportFilename } from '@/core/card/exportName';
import { listShortcuts, shortcutVersion } from '@/composables/useShortcuts';
import { i18n, switchLanguage, UI_LANGUAGES } from '@/i18n';
import { useWorkspace } from '@/stores/workspace';
import { useAppearance } from '@/stores/appearance';
import AppearanceSettings from '@/components/AppearanceSettings.vue';

const message = useMessage();
const ws = useWorkspace();
const appearance = useAppearance();
const busy = ref('');
const dbInfo = ref<{ driver: string; tables: Record<string, number> }>({ driver: '', tables: {} });
const userName = ref('User');
const dualWrite = ref(true);
/* 导出文件夹（桌面端） */
const isDesktop = isTauri();
const exportDir = ref('');
const exportDirPicking = ref(false);
/* 导出文件名模板（P1-2） */
const exportTemplate = ref('');
const templatePreview = computed(() => renderExportFilename(exportTemplate.value, { name: '角色名', spec: 'v3', version: '1.0' }));

async function persistExportTemplate(v: string) {
  await setSetting(SETTING_KEYS.exportFilenameTemplate, v);
}

/* 快捷键注册表（只读展示；数据来自 useShortcuts 注册表，注册变化自动刷新） */
const shortcuts = computed(() => {
  void shortcutVersion.value;
  return listShortcuts();
});

/* 界面语言（i18n 骨架，通用层先行） */
const uiLanguage = ref<'zh-CN' | 'en-US'>('zh-CN');
const languageOptions = UI_LANGUAGES;
onMounted(() => {
  uiLanguage.value = (i18n.global.locale.value as 'zh-CN' | 'en-US') ?? 'zh-CN';
});

onMounted(async () => {
  // 降级提示已上移 LayoutView 全局通知（D3）；此处保留静态存储详情
  // 主动刷新已装字体列表：即使启动期读取失败，进设置页也会自愈
  appearance.refreshInstalled().catch((e) => console.error('字体列表刷新失败：', e));
  const store = await getStore();
  const dump = await store.dump();
  dbInfo.value = {
    driver: store.kind === 'sqlite' ? 'SQLite（桌面模式）' : store.kind === 'indexeddb' ? 'IndexedDB（浏览器模式）' : '内存（测试）',
    tables: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])),
  };
  // 偏好项从库加载（持久化，跨会话生效）
  userName.value = await getSetting(SETTING_KEYS.uiUserName, 'User');
  dualWrite.value = await getSetting(SETTING_KEYS.pngDualWrite, true);
  exportTemplate.value = await getSetting<string>(SETTING_KEYS.exportFilenameTemplate, '');
  if (isDesktop) {
    getExportDir().then((d) => (exportDir.value = d)).catch((e) => console.error('导出目录读取失败：', e));
  }
});

async function chooseExportDir() {
  exportDirPicking.value = true;
  try {
    const picked = await pickExportDir();
    if (picked) {
      await setExportDir(picked);
      exportDir.value = picked;
      message.success('导出文件夹已更新');
    }
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    exportDirPicking.value = false;
  }
}

async function resetExportDir() {
  await setExportDir(null);
  exportDir.value = await getExportDir();
  message.success('已恢复默认导出文件夹');
}

async function persistUserName(v: string) {
  ws.userName = v;
  await setSetting(SETTING_KEYS.uiUserName, v);
}

async function persistDualWrite(v: boolean) {
  dualWrite.value = v;
  await setSetting(SETTING_KEYS.pngDualWrite, v);
}

async function doExport() {
  busy.value = 'export';
  try {
    const blob = await exportBackup();
    const path = await downloadBlob(blob, timestampName('tavern-card-studio-backup', 'zip'));
    message.success(path ? `备份已导出：${path}` : '备份已导出');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}

async function doImport(wipe: boolean) {
  const files = await pickFiles('.zip', false);
  if (!files.length) return;
  busy.value = 'import';
  try {
    const r = await importBackup(new Uint8Array(await files[0]!.arrayBuffer()), { wipe });
    await ws.refreshCards(true);
    message.success(`恢复完成：${Object.entries(r.tables).map(([k, n]) => `${k} ${n}`).join('，')}`);
    location.reload();
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div style="max-width: 820px">
    <NSpace vertical :size="14">
      <AppearanceSettings />

      <NCard size="small" title="运行环境">
        <NSpace :size="10" align="center">
          <NTag :bordered="false" type="info">{{ dbInfo.driver }}</NTag>
          <NText depth="3" style="font-size: 12px">
            桌面（Tauri）模式下数据存于 exe 同级 data/ 目录（便携优先，失败回退 AppData）；浏览器模式存于 IndexedDB
          </NText>
        </NSpace>
        <NSpace :size="6" style="margin-top: 10px" wrap>
          <NTag v-for="(n, t) in dbInfo.tables" :key="t" size="small" round :bordered="false">{{ t }}：{{ n }}</NTag>
        </NSpace>
      </NCard>

      <NCard size="small" title="全量备份">
        <NSpace :size="10">
          <NButton size="small" type="primary" :loading="busy === 'export'" @click="doExport">
            <template #icon><NIcon><DownloadOutline /></NIcon></template>导出备份 zip
          </NButton>
          <NButton size="small" secondary :loading="busy === 'import'" @click="doImport(false)">
            <template #icon><NIcon><CloudUploadOutline /></NIcon></template>导入（合并）
          </NButton>
          <NPopconfirm @positive-click="doImport(true)">
            <template #trigger>
              <NButton size="small" secondary type="warning">导入（清空后恢复）</NButton>
            </template>
            将清空当前全部数据再导入备份，确认？
          </NPopconfirm>
        </NSpace>
        <NText depth="3" style="display: block; margin-top: 8px; font-size: 12px">
          备份包含卡库、版本、模板、AI 渠道（含 API Key，注意保管）、同人项目与设置
        </NText>
      </NCard>

      <NCard size="small" title="偏好">
        <NFormItem label="界面语言 / Language（通用层先行，视图渐进迁移）" label-placement="left">
          <NSelect
            :value="uiLanguage" :options="languageOptions" style="width: 200px" size="small"
            @update:value="(v: string) => switchLanguage(v as 'zh-CN' | 'en-US')"
          />
        </NFormItem>
        <NFormItem v-if="isDesktop" label="导出文件夹（卡/备份/模板/世界书导出的保存位置）" label-placement="left">
          <NSpace :size="8" align="center" style="width: 100%">
            <NText code style="font-size: 12px; word-break: break-all">{{ exportDir || '读取中…' }}</NText>
            <NButton size="tiny" secondary :loading="exportDirPicking" @click="chooseExportDir">选择文件夹…</NButton>
            <NButton size="tiny" quaternary @click="openExportDir().catch((e) => message.error((e as Error).message))">打开文件夹</NButton>
            <NButton size="tiny" quaternary @click="resetExportDir">恢复默认</NButton>
          </NSpace>
        </NFormItem>
        <NFormItem label="导出文件名模板（占位符 {name}/{spec}/{version}/{date}）" label-placement="left">
          <NSpace :size="8" align="center" style="width: 100%">
            <NInput v-model:value="exportTemplate" style="width: 240px" placeholder="{name}_{date}" @update:value="persistExportTemplate" />
            <NText depth="3" style="font-size: 12px">
              示例：<NText code>{{ templatePreview }}</NText>
            </NText>
          </NSpace>
        </NFormItem>
        <NFormItem label="默认 {{user}} 名（预览用）" label-placement="left">
          <NInput v-model:value="userName" style="width: 200px" @update:value="persistUserName" />
        </NFormItem>
        <NFormItem label="PNG 导出双写 ccv3 + chara（兼容新旧前端）" label-placement="left">
          <NSwitch :value="dualWrite" @update:value="persistDualWrite" />
        </NFormItem>
      </NCard>

      <NCard size="small" title="快捷键">
        <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
          注册表驱动（与命令面板同源）；输入框聚焦时纯按键不触发，避免误触。
        </NText>
        <table class="shortcut-table">
          <thead><tr><th>按键</th><th>范围</th><th>作用</th></tr></thead>
          <tbody>
            <tr v-for="s in shortcuts" :key="s.id">
              <td><NTag size="tiny" :bordered="false">{{ s.comboNormalized }}</NTag></td>
              <td style="font-size: 12px; opacity: .75">{{ s.scopeLabel }}</td>
              <td style="font-size: 12px">{{ s.description }}</td>
            </tr>
          </tbody>
        </table>
      </NCard>

      <NCard size="small" title="关于">
        <NText depth="3" style="font-size: 13px; line-height: 1.8">
          <p><b>TavernCard Studio</b> v0.1.0 —— 本地桌面端 SillyTavern 角色卡工作站</p>
          <p>· 转换 / 编辑 / 模板美化 / AI 辅助生成 / 诊断修复 / 同人卡工坊</p>
          <p>· 所有数据仅在本地（SQLite / IndexedDB），API Key 不出本机，无遥测</p>
          <p>· PNG 编解码与 SillyTavern 官方实现对齐：读取 ccv3 → chara 回退；导出默认双写</p>
        </NText>
      </NCard>
    </NSpace>
  </div>
</template>

<style scoped>
.shortcut-table { width: 100%; border-collapse: collapse; }
.shortcut-table th { text-align: left; font-size: 12px; opacity: .65; padding: 3px 8px 6px; }
.shortcut-table td { padding: 3px 8px; border-top: 1px dashed var(--tcs-border, rgba(255,255,255,.08)); }
</style>

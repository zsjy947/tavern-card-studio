<script setup lang="ts">
/** 设置与备份：全量备份导出/导入 zip、数据概览、关于 */
import { onMounted, ref } from 'vue';
import {
  NSpace, NButton, NCard, NTag, NText, useMessage, NIcon, NPopconfirm, NInput, NSwitch, NFormItem,
} from 'naive-ui';
import { DownloadOutline, CloudUploadOutline } from '@vicons/ionicons5';
import { exportBackup, importBackup, downloadBlob, timestampName } from '@/services/backupService';
import { getSetting, setSetting, SETTING_KEYS } from '@/services/appSettings';
import { pickFiles, formatBytes } from '@/utils/file';
import { getStore } from '@/db';
import { useWorkspace } from '@/stores/workspace';

const message = useMessage();
const ws = useWorkspace();
const busy = ref('');
const dbInfo = ref<{ driver: string; tables: Record<string, number> }>({ driver: '', tables: {} });
const userName = ref('User');
const dualWrite = ref(true);

onMounted(async () => {
  const store = await getStore();
  const dump = await store.dump();
  dbInfo.value = {
    driver: store.kind === 'sqlite' ? 'SQLite（桌面模式）' : store.kind === 'indexeddb' ? 'IndexedDB（浏览器模式）' : '内存（测试）',
    tables: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])),
  };
  // 偏好项从库加载（持久化，跨会话生效）
  userName.value = await getSetting(SETTING_KEYS.uiUserName, 'User');
  dualWrite.value = await getSetting(SETTING_KEYS.pngDualWrite, true);
});

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
    downloadBlob(blob, timestampName('tavern-card-studio-backup', 'zip'));
    message.success('备份已导出');
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
        <NFormItem label="默认 {{user}} 名（预览用）" label-placement="left">
          <NInput v-model:value="userName" style="width: 200px" @update:value="persistUserName" />
        </NFormItem>
        <NFormItem label="PNG 导出双写 ccv3 + chara（兼容新旧前端）" label-placement="left">
          <NSwitch :value="dualWrite" @update:value="persistDualWrite" />
        </NFormItem>
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

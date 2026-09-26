<script setup lang="ts">
/**
 * 导入选项对话框（ROADMAP P1-5）：
 * 世界书「保持内嵌 / 拆为 ST 全局世界书 JSON」、正则「随卡 / 导出独立脚本 JSON」。
 * 选项组合可保存为命名预设（settings.import_presets，上限 10）并一键复用。
 */
import { onMounted, ref } from 'vue';
import { NButton, NInput, NRadioGroup, NRadioButton, NSpace, NTag, NText, useMessage } from 'naive-ui';
import { getSetting, setSetting, SETTING_KEYS } from '@/services/appSettings';
import { DEFAULT_IMPORT_OPTIONS, type ImportSplitOptions } from '@/core/card/importOptions';

export interface ImportPreset {
  name: string;
  options: ImportSplitOptions;
}

const show = defineModel<boolean>('show', { default: false });
const options = defineModel<ImportSplitOptions>('options', { default: () => ({ ...DEFAULT_IMPORT_OPTIONS }) });
const emit = defineEmits<{ confirm: [] }>();
const message = useMessage();

const presets = ref<ImportPreset[]>([]);
const newPresetName = ref('');

onMounted(loadPresets);

async function loadPresets() {
  presets.value = await getSetting<ImportPreset[]>(SETTING_KEYS.importPresets, []);
}

async function savePreset() {
  const name = newPresetName.value.trim();
  if (!name) {
    message.error('请先给这组选项起个名字');
    return;
  }
  const next = [{ name, options: { ...options.value } }, ...presets.value.filter((p) => p.name !== name)].slice(0, 10);
  await setSetting(SETTING_KEYS.importPresets, next);
  presets.value = next;
  newPresetName.value = '';
  message.success(`预设「${name}」已保存（上限 10 个）`);
}

async function removePreset(name: string) {
  const next = presets.value.filter((p) => p.name !== name);
  await setSetting(SETTING_KEYS.importPresets, next);
  presets.value = next;
}

function applyPreset(p: ImportPreset) {
  options.value = { ...p.options };
  message.info(`已载入预设「${p.name}」`);
}

function confirm() {
  emit('confirm');
  show.value = false;
}
</script>

<template>
  <div v-if="show" class="import-opts-scrim" @click.self="show = false">
    <div class="import-opts-panel">
      <div class="import-opts-title">导入选项</div>

      <NSpace vertical :size="12">
        <div>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 4px">世界书</NText>
          <NRadioGroup v-model:value="options.worldbookMode" size="small">
            <NRadioButton value="embed">保持内嵌（默认）</NRadioButton>
            <NRadioButton value="export">拆为 ST 全局世界书 JSON（导出目录）</NRadioButton>
          </NRadioGroup>
        </div>
        <div>
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 4px">正则脚本</NText>
          <NRadioGroup v-model:value="options.regexMode" size="small">
            <NRadioButton value="embed">随卡（默认）</NRadioButton>
            <NRadioButton value="export">导出独立脚本 JSON（ST 脚本库格式）</NRadioButton>
          </NRadioGroup>
        </div>

        <div v-if="presets.length">
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 4px">预设</NText>
          <NSpace :size="6">
            <NTag
              v-for="p in presets" :key="p.name" size="small" round :bordered="false"
              style="cursor: pointer" @click="applyPreset(p)"
            >
              {{ p.name }}
            </NTag>
            <NButton size="tiny" quaternary type="error" @click="removePreset(presets[0]!.name)">删最新</NButton>
          </NSpace>
        </div>

        <NSpace :size="6" align="center">
          <NInput v-model:value="newPresetName" size="small" placeholder="保存当前组合为预设…" style="width: 200px" @keyup.enter="savePreset" />
          <NButton size="small" secondary @click="savePreset">保存预设</NButton>
        </NSpace>

        <NSpace justify="end" :size="8">
          <NButton size="small" @click="show = false">取消</NButton>
          <NButton size="small" type="primary" @click="confirm">开始导入</NButton>
        </NSpace>
      </NSpace>
    </div>
  </div>
</template>

<style scoped>
.import-opts-scrim {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center;
}
.import-opts-panel {
  width: min(520px, 92vw);
  background: var(--tcs-surface, #1a1a22);
  border: 1px solid var(--tcs-border, rgba(255,255,255,.12));
  border-radius: 12px; padding: 18px;
}
.import-opts-title { font-weight: 700; margin-bottom: 12px; }
</style>

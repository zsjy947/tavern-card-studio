<script setup lang="ts">
/** AI 中心：多渠道管理（文本/生图）、测连、拉模型、用量记录 */
import { onMounted, ref } from 'vue';
import {
  NSpace, NButton, NCard, NInput, NForm, NFormItem, NSelect, NSwitch, NTag, useMessage, NIcon, NInputNumber,
  NModal, NPopconfirm, NDataTable, NEmpty, NTabs, NTabPane, NText, NRadioGroup, NRadioButton,
} from 'naive-ui';
import { AddOutline, TrashOutline, FlashOutline, CloudDownloadOutline } from '@vicons/ionicons5';
import { useWorkspace } from '@/stores/workspace';
import { saveChannel, deleteChannel, listUsage, makeLlmClient } from '@/services/aiService';
import { generateImageOpenAi, generateImageNovelAi } from '@/core/llm/image';
import type { AiChannelRow, AiUsageLogRow } from '@/services/types';

const message = useMessage();
const ws = useWorkspace();

const showForm = ref(false);
const editing = ref<Partial<AiChannelRow> | null>(null);
const testing = ref('');
const usage = ref<AiUsageLogRow[]>([]);
const models = ref<string[]>([]);

onMounted(async () => {
  await ws.refreshChannels();
  usage.value = await listUsage();
});

function openNew(kind: 'text' | 'image') {
  editing.value = {
    kind,
    provider: 'openai',
    name: kind === 'text' ? '新文本渠道' : '新生图渠道',
    baseUrl: kind === 'text' ? 'https://api.openai.com/v1' : 'https://api.openai.com/v1',
    apiKey: '',
    modelId: '',
    isActive: false,
  };
  showForm.value = true;
}

function openEdit(c: AiChannelRow) {
  editing.value = { ...c };
  showForm.value = true;
}

async function save() {
  if (!editing.value?.name || !editing.value.baseUrl) {
    message.error('名称与 Base URL 必填');
    return;
  }
  await saveChannel(editing.value as AiChannelRow);
  await ws.refreshChannels();
  showForm.value = false;
  message.success('渠道已保存');
}

async function testConn(c: AiChannelRow) {
  testing.value = c.id;
  try {
    const client = makeLlmClient(c);
    const r = await client.testConnection();
    r.ok ? message.success(`${c.name}：${r.message}`) : message.error(`${c.name}：${r.message}`);
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    testing.value = '';
  }
}

async function pullModels(c: AiChannelRow) {
  testing.value = c.id;
  try {
    const client = makeLlmClient(c);
    models.value = await client.listModels();
    message.success(`拉到 ${models.value.length} 个模型，表单里可选择`);
    openEdit(c);
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    testing.value = '';
  }
}

const usageColumns = [
  { title: '时间', key: 'createdAt', width: 170, render: (r: AiUsageLogRow) => new Date(r.createdAt).toLocaleString() },
  { title: '功能', key: 'feature', ellipsis: { tooltip: true } },
  { title: '渠道', key: 'channelName', width: 120 },
  { title: '入 tokens', key: 'promptTokens', width: 90 },
  { title: '出 tokens', key: 'completionTokens', width: 90 },
  { title: '耗时', key: 'ms', width: 80, render: (r: AiUsageLogRow) => `${(r.ms / 1000).toFixed(1)}s` },
];

/* 生图测试 */
const imgPrompt = ref('一位银发少女站在图书馆窗边，逆光，细腻插画风格');
const imgBusy = ref(false);
const imgResult = ref('');

async function testImage() {
  const ch = ws.activeChannel('image');
  if (!ch) {
    message.error('先配置生图渠道');
    return;
  }
  imgBusy.value = true;
  try {
    const r = ch.provider === 'novelai'
      ? await generateImageNovelAi({ ...ch } as Parameters<typeof generateImageNovelAi>[0], imgPrompt.value)
      : await generateImageOpenAi({ ...ch } as Parameters<typeof generateImageOpenAi>[0], imgPrompt.value);
    imgResult.value = r.dataUrl;
    message.success('生图完成');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    imgBusy.value = false;
  }
}
</script>

<template>
  <div style="max-width: 980px">
    <NTabs type="line" default-value="channels">
      <NTabPane name="channels" tab="渠道管理">
        <NSpace :size="10" style="margin-bottom: 12px">
          <NButton size="small" type="primary" @click="openNew('text')">
            <template #icon><NIcon><AddOutline /></NIcon></template>文本渠道
          </NButton>
          <NButton size="small" @click="openNew('image')">
            <template #icon><NIcon><AddOutline /></NIcon></template>生图渠道
          </NButton>
        </NSpace>

        <NEmpty v-if="!ws.channels.length" description="还没有渠道。文本渠道用于生成/优化/翻译/诊断，生图渠道用于头像立绘。" />
        <NSpace v-else vertical :size="10">
          <NCard v-for="c in ws.channels" :key="c.id" size="small" :bordered="true">
            <template #header>
              <NSpace :size="8" align="center">
                <NTag size="small" :bordered="false" :type="c.kind === 'text' ? 'info' : 'warning'">{{ c.kind === 'text' ? '文本' : '生图' }}</NTag>
                <b>{{ c.name }}</b>
                <NTag v-if="c.isActive" size="tiny" type="success" round :bordered="false">激活</NTag>
              </NSpace>
            </template>
            <template #header-extra>
              <NSpace :size="6">
                <NButton size="tiny" :loading="testing === c.id" @click="testConn(c)">
                  <template #icon><NIcon><FlashOutline /></NIcon></template>测连
                </NButton>
                <NButton size="tiny" secondary @click="pullModels(c)">
                  <template #icon><NIcon><CloudDownloadOutline /></NIcon></template>拉模型
                </NButton>
                <NButton size="tiny" tertiary @click="openEdit(c)">编辑</NButton>
                <NPopconfirm @positive-click="async () => { await deleteChannel(c.id); await ws.refreshChannels(); }">
                  <template #trigger>
                    <NButton size="tiny" tertiary type="error">
                      <template #icon><NIcon><TrashOutline /></NIcon></template>
                    </NButton>
                  </template>
                  删除渠道 {{ c.name }}？
                </NPopconfirm>
              </NSpace>
            </template>
            <NSpace :size="14" style="font-size: 13px">
              <NText depth="2">Base：<NText code>{{ c.baseUrl }}</NText></NText>
              <NText depth="2">模型：<NText code>{{ c.modelId || '未设置' }}</NText></NText>
              <NText depth="3">Key：{{ c.apiKey ? '●●●●' + c.apiKey.slice(-4) : '未配置' }}</NText>
            </NSpace>
          </NCard>
        </NSpace>
      </NTabPane>

      <NTabPane name="image" tab="生图工作台">
        <NSpace vertical :size="10">
          <NInput v-model:value="imgPrompt" type="textarea" :rows="3" placeholder="生图提示词" />
          <NButton type="primary" size="small" :loading="imgBusy" @click="testImage">生成测试图</NButton>
          <img v-if="imgResult" :src="imgResult" style="max-width: 360px; border-radius: 12px" alt="生成结果" />
          <NText depth="3" style="font-size: 12px">生成的图片可在编辑器里作为卡面底图导出（导出 PNG 时选为底图）</NText>
        </NSpace>
      </NTabPane>

      <NTabPane name="usage" tab="调用记录">
        <NDataTable :columns="usageColumns" :data="usage" size="small" :bordered="false" :max-height="480" />
      </NTabPane>
    </NTabs>

    <NModal v-model:show="showForm" preset="card" :title="editing?.id ? '编辑渠道' : '新建渠道'" style="width: 560px">
      <NForm v-if="editing" label-placement="left" label-width="86" size="small">
        <NFormItem label="名称"><NInput v-model:value="editing.name" /></NFormItem>
        <NFormItem label="类型">
          <NRadioGroup v-model:value="editing.kind" size="small">
            <NRadioButton value="text">文本</NRadioButton>
            <NRadioButton value="image">生图</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="协议">
          <NRadioGroup v-model:value="editing.provider" size="small">
            <NRadioButton value="openai">OpenAI 兼容</NRadioButton>
            <NRadioButton value="novelai">NovelAI</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem label="Base URL">
          <NInput v-model:value="editing.baseUrl" placeholder="https://open.bigmodel.cn/api/paas/v4" />
        </NFormItem>
        <NFormItem label=" ">
          <NText depth="3" style="font-size: 12px; line-height: 1.8">
            主流厂商路径（填到版本号一级即可，/chat/completions 自动追加）：<br />
            GLM：<NText code>https://open.bigmodel.cn/api/paas/v4</NText>　GLM Coding：<NText code>https://open.bigmodel.cn/api/coding/paas/v4</NText><br />
            DeepSeek：<NText code>https://api.deepseek.com</NText>　OpenAI：<NText code>https://api.openai.com/v1</NText>
          </NText>
        </NFormItem>
        <NFormItem label="API Key">
          <NInput v-model:value="editing.apiKey" type="password" show-password-on="click" placeholder="仅存本地" />
        </NFormItem>
        <NFormItem label="模型">
          <NSelect v-model:value="editing.modelId" :options="models.map((m) => ({ label: m, value: m }))" filterable tag
            placeholder="手填或拉模型后选择" />
        </NFormItem>
        <NFormItem v-if="editing.kind === 'text'" label="全局系统提示词">
          <NInput v-model:value="editing.globalSystemPrompt" type="textarea" :rows="2"
            placeholder="所有文本请求自动前插的 system 消息（如：输出使用简体中文，文风克制细腻）" />
        </NFormItem>
        <NFormItem v-if="editing.kind === 'text'" label="并发上限">
          <NInputNumber v-model:value="editing.concurrencyLimit" :min="1" :max="8" style="width: 120px" />
          <NText depth="3" style="margin-left: 10px; font-size: 12px">超出排队，防限流</NText>
        </NFormItem>
        <NFormItem label="设为激活">
          <NSwitch v-model:value="editing.isActive" />
          <NText depth="3" style="margin-left: 10px; font-size: 12px">同类型渠道同时只有一个激活</NText>
        </NFormItem>
        <NSpace justify="end">
          <NButton size="small" @click="showForm = false">取消</NButton>
          <NButton size="small" type="primary" @click="save">保存</NButton>
        </NSpace>
      </NForm>
    </NModal>
  </div>
</template>

<script setup lang="ts">
/**
 * 组装透视（试卡闭环 M1）：选卡 + 手工编辑对话 + ST 骨架参数 → 实时组装预览。
 * 纯本地计算不调 LLM；同 seed 重放一致。语义近似项在"说明"折叠面板内列明，
 * 真机校准流程见 docs/st-golden-guide.md。
 */
import { computed, onMounted, ref, watch } from 'vue';
import {
  NSpace, NButton, NSelect, NCard, NTag, useMessage, NIcon, NEmpty, NCollapse, NCollapseItem,
  NInput, NInputNumber, NAlert, NTabs, NTabPane,
} from 'naive-ui';
import { EyeOutline, DownloadOutline, AddOutline, TrashOutline, RefreshOutline } from '@vicons/ionicons5';
import { useWorkspace } from '@/stores/workspace';
import * as cardService from '@/services/cardService';
import { downloadText, timestampName } from '@/services/backupService';
import TokenBadge from '@/components/TokenBadge.vue';
import {
  runAssembly, mergeSegmentsForExport, exportAssemblyJson, exportAssemblyText, reasonText,
  type AssembleResult,
} from '@/services/xrayService';
import { ST_DEFAULT_SETTINGS, createChatState, pushMessage, type StSettings } from '@/core/st';

const message = useMessage();
const ws = useWorkspace();
onMounted(async () => {
  await ws.refreshCards(true);
});

const cardId = ref<string | null>(null);
const loadedCard = ref<Parameters<typeof runAssembly>[0] | null>(null);
watch(cardId, async (id) => {
  if (!id) {
    loadedCard.value = null;
    return;
  }
  try {
    const row = await cardService.getCard(id);
    loadedCard.value = row ? JSON.parse(JSON.stringify(row.card)) : null;
    resetChat();
  } catch (e) {
    message.error((e as Error).message);
  }
});

/* ---- 对话编辑器 ---- */
interface ChatEditItem {
  role: 'user' | 'assistant';
  content: string;
}
const chatItems = ref<ChatEditItem[]>([]);

function resetChat() {
  const st = loadedCard.value ? createChatState(loadedCard.value, settings.value.userName) : null;
  chatItems.value = st ? st.messages.map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content })) : [];
}
function addMessage(role: 'user' | 'assistant') {
  chatItems.value.push({ role, content: '' });
}
function removeMessage(i: number) {
  chatItems.value.splice(i, 1);
}

/* ---- ST 骨架参数 ---- */
const settings = ref<StSettings>({ ...ST_DEFAULT_SETTINGS, authorNote: { ...ST_DEFAULT_SETTINGS.authorNote } });
const seed = ref<number>(1234);
function resetSettings() {
  settings.value = { ...ST_DEFAULT_SETTINGS, authorNote: { ...ST_DEFAULT_SETTINGS.authorNote } };
  message.success('已恢复 ST 默认');
}

/* ---- 组装（纯本地即时计算） ---- */
const assembly = computed<{ result: AssembleResult; merged: { role: string; content: string }[] } | { error: string } | null>(() => {
  if (!loadedCard.value) return null;
  try {
    const st = createChatState(loadedCard.value, settings.value.userName);
    for (const it of chatItems.value) pushMessage(st, it.role, it.content);
    const result = runAssembly(loadedCard.value, st, settings.value, seed.value);
    return { result, merged: mergeSegmentsForExport(result) };
  } catch (e) {
    return { error: (e as Error).message };
  }
});
const result = computed(() => (assembly.value && 'result' in assembly.value ? assembly.value.result : null));

const wiActivated = computed(() => result.value?.wiTraces.filter((t) => t.activated) ?? []);
const wiSkipped = computed(() => result.value?.wiTraces.filter((t) => !t.activated) ?? []);

const roleType: Record<string, 'default' | 'success' | 'info'> = { system: 'default', user: 'success', assistant: 'info' };

/* ---- 导出 ---- */
async function exportJson() {
  const a = assembly.value;
  if (!a || !('result' in a)) return;
  const saved = await downloadText(exportAssemblyJson(a.result, a.merged), timestampName('xray', 'json'));
  if (saved) message.success(`已导出：${saved}`);
}
async function exportTextFile() {
  const a = assembly.value;
  if (!a || !('result' in a)) return;
  const saved = await downloadText(exportAssemblyText(a.result, a.merged), timestampName('xray', 'txt'), 'text/plain');
  if (saved) message.success(`已导出：${saved}`);
}
</script>

<template>
  <div style="max-width: 1080px">
    <NSpace :size="10" style="margin-bottom: 14px" align="center">
      <NSelect
        v-model:value="cardId"
        :options="ws.cards.filter((c) => !c.deletedAt).map((c) => ({ label: c.name, value: c.id }))"
        filterable
        placeholder="选择要透视的卡"
        style="width: 240px"
      />
      <NInputNumber v-model:value="seed" size="small" style="width: 130px" :min="0" :max="4294967295" placeholder="seed">
        <template #prefix>seed</template>
      </NInputNumber>
      <NButton size="small" secondary @click="resetChat">
        <template #icon><NIcon><RefreshOutline /></NIcon></template>重置对话
      </NButton>
      <NButton size="small" secondary @click="resetSettings">恢复默认设置</NButton>
    </NSpace>

    <NCard v-if="!loadedCard" size="small">
      <NEmpty description="选择一张卡开始：组装透视会实时计算「这张卡在酒馆里会被组装成什么 prompt」——无需 AI 渠道，不发送任何请求">
        <template #icon><NIcon size="42"><EyeOutline /></NIcon></template>
      </NEmpty>
    </NCard>

    <template v-else>
      <NCard size="small" title="对话编辑（宏保持原文，组装时求值）" style="margin-bottom: 14px">
        <NSpace vertical :size="8">
          <div v-for="(it, i) in chatItems" :key="i" class="chat-row">
            <NSelect :value="it.role" @update:value="(v: 'user' | 'assistant') => (it.role = v)" :options="[ { label: '用户', value: 'user' }, { label: '角色', value: 'assistant' } ]" size="small" style="width: 92px" />
            <NInput v-model:value="it.content" type="textarea" size="small" :autosize="{ minRows: 1, maxRows: 6 }" placeholder="消息内容，支持 {{char}}/{{user}}/{{random:}} 等宏" />
            <NButton size="tiny" quaternary type="error" @click="removeMessage(i)">
              <template #icon><NIcon><TrashOutline /></NIcon></template>
            </NButton>
          </div>
        </NSpace>
        <NSpace style="margin-top: 10px">
          <NButton size="small" secondary @click="addMessage('user')">
            <template #icon><NIcon><AddOutline /></NIcon></template>用户消息
          </NButton>
          <NButton size="small" secondary @click="addMessage('assistant')">
            <template #icon><NIcon><AddOutline /></NIcon></template>角色消息
          </NButton>
        </NSpace>
      </NCard>

      <NCollapse style="margin-bottom: 14px">
        <NCollapseItem title="ST 骨架参数（默认值可改；不解析酒馆全局设置文件）" name="settings">
          <NSpace vertical :size="8" style="padding: 4px 2px">
            <div class="set-row"><span class="set-label" v-pre>用户名（{{user}}）</span><NInput v-model:value="settings.userName" size="small" style="width: 160px" /></div>
            <div class="set-row"><span class="set-label">上下文大小</span><NInputNumber v-model:value="settings.contextSize" size="small" style="width: 160px" :min="512" :step="512" /><span class="set-hint">世界书预算 = {{ settings.wiBudgetPercent }}% × {{ settings.contextSize }} = {{ result?.budgetTokens ?? '—' }} tok</span></div>
            <div class="set-row"><span class="set-label">世界书预算 %</span><NInputNumber v-model:value="settings.wiBudgetPercent" size="small" style="width: 120px" :min="0" :max="100" /></div>
            <div class="set-row"><span class="set-label">扫描深度</span><NInputNumber v-model:value="settings.wiScanDepth" size="small" style="width: 120px" :min="1" :max="20" /></div>
            <div class="set-row"><span class="set-label">最小激活条数</span><NInputNumber v-model:value="settings.wiMinActivations" size="small" style="width: 120px" :min="0" :max="100" /></div>
            <div class="set-row"><span class="set-label">递归步数上限</span><NInputNumber v-model:value="settings.wiMaxRecursionSteps" size="small" style="width: 120px" :min="0" :max="50" /></div>
            <div class="set-row"><span class="set-label">用户人设</span><NInput v-model:value="settings.userPersona" type="textarea" size="small" :autosize="{ minRows: 1, maxRows: 4 }" style="flex: 1" placeholder="空 = 不注入" /></div>
            <div class="set-row"><span class="set-label">作者注释</span><NInput v-model:value="settings.authorNote.content" type="textarea" size="small" :autosize="{ minRows: 1, maxRows: 4 }" style="flex: 1" placeholder="空 = 不注入" /></div>
            <div class="set-row"><span class="set-label">作者注释深度</span><NInputNumber v-model:value="settings.authorNote.depth" size="small" style="width: 120px" :min="0" :max="32" /></div>
            <div class="set-row"><span class="set-label">全局 PHI</span><NInput v-model:value="settings.phiPrompt" type="textarea" size="small" :autosize="{ minRows: 1, maxRows: 4 }" style="flex: 1" placeholder="Post-History Instructions（Jailbreak 位）" /></div>
          </NSpace>
        </NCollapseItem>
        <NCollapseItem title="说明：模拟范围与近似项" name="about">
          <div class="about-body">
            <p><b>模拟范围</b>：卡字段、卡内世界书（蓝绿灯/逻辑/概率/组/递归/超时效果/预算）、卡内正则脚本（双通路）、ST 默认骨架参数。</p>
            <p><b>已知近似</b>（真机黄金样本校准中，见 docs/st-golden-guide.md）：示例对话不拆轮次；use_group_scoring 降级为纯权重选举；cooldown 自激活楼起算；预算按宏展开前原文计 token；正则 placement=5 不参与扫描文本。</p>
            <p><b>明确不支持</b>：消息树/群聊、instruct 模板与文本补全模式、酒馆全局世界书/预设导入、向量检索、酒馆助手脚本执行。</p>
          </div>
        </NCollapseItem>
      </NCollapse>

      <NAlert v-if="assembly && 'error' in assembly" type="error" style="margin-bottom: 14px">组装失败：{{ assembly.error }}</NAlert>

      <template v-if="result">
        <NAlert v-if="result.warnings.length" type="warning" style="margin-bottom: 14px" :show-icon="false">
          <div v-for="(w, i) in result.warnings" :key="i">{{ w }}</div>
        </NAlert>

        <NCard size="small" style="margin-bottom: 14px">
          <template #header>
            <NSpace align="center" :size="10">
              <span>组装结果</span>
              <NTag size="small" :bordered="false">{{ result.tokens.total }} tok{{ result.tokens.estimated ? '~' : '' }}</NTag>
              <NTag size="small" :bordered="false" type="info">{{ result.segments.length }} 段</NTag>
              <NTag size="small" :bordered="false" :type="wiSkipped.length ? 'warning' : 'success'">世界书 {{ wiActivated.length }}/{{ result.wiTraces.length }}</NTag>
              <span style="font-weight: 400; font-size: 12px; opacity: .6">seed={{ result.seed }} · 纯本地计算，未发送请求</span>
            </NSpace>
          </template>
          <template #header-extra>
            <NSpace :size="6">
              <NButton size="tiny" secondary @click="exportTextFile">
                <template #icon><NIcon><DownloadOutline /></NIcon></template>文本
              </NButton>
              <NButton size="tiny" secondary @click="exportJson">
                <template #icon><NIcon><DownloadOutline /></NIcon></template>JSON
              </NButton>
            </NSpace>
          </template>
          <div class="seg-list">
            <div v-for="seg in result.segments" :key="seg.id" class="seg-row">
              <div class="seg-head">
                <NTag size="tiny" :bordered="false" :type="roleType[seg.role]">{{ seg.role }}</NTag>
                <span class="seg-label">{{ seg.label }}</span>
                <span class="seg-source">{{ seg.source }}</span>
                <span class="seg-tokens"><TokenBadge :text="seg.content" :label="`${seg.tokens} tok`" /></span>
              </div>
              <pre class="seg-content">{{ seg.content }}</pre>
            </div>
          </div>
        </NCard>

        <NCard size="small" style="margin-bottom: 14px">
          <template #header>
            <NSpace align="center" :size="10">
              <span>世界书触发明细</span>
              <span style="font-weight: 400; font-size: 12px; opacity: .6">预算 {{ result.budgetTokens }} tok</span>
            </NSpace>
          </template>
          <NTabs type="segment" size="small" animated>
            <NTabPane name="on" :tab="`已激活（${wiActivated.length}）`">
              <NSpace vertical :size="6">
                <div v-for="t in wiActivated" :key="t.uid" class="wi-row">
                  <NTag size="tiny" :bordered="false" :type="t.lamp === 'blue' ? 'info' : 'success'">{{ t.lamp === 'blue' ? '蓝灯' : '绿灯' }}</NTag>
                  <b>{{ t.comment || `#${t.uid}` }}</b>
                  <span class="wi-reason">{{ reasonText(t) }}</span>
                  <span class="wi-tokens">{{ t.contentTokens }} tok</span>
                </div>
                <NEmpty v-if="!wiActivated.length" description="没有条目被激活" size="small" />
              </NSpace>
            </NTabPane>
            <NTabPane name="off" :tab="`未激活（${wiSkipped.length}）`">
              <NSpace vertical :size="6">
                <div v-for="t in wiSkipped" :key="t.uid" class="wi-row">
                  <NTag size="tiny" :bordered="false" :type="t.lamp === 'blue' ? 'info' : 'default'">{{ t.lamp === 'blue' ? '蓝灯' : '绿灯' }}</NTag>
                  <b>{{ t.comment || `#${t.uid}` }}</b>
                  <span class="wi-reason">{{ reasonText(t) }}</span>
                </div>
                <NEmpty v-if="!wiSkipped.length" description="全部条目都已激活" size="small" />
              </NSpace>
            </NTabPane>
          </NTabs>
        </NCard>

        <NCard v-if="result.regexPreview" size="small" style="margin-bottom: 14px" title="末条 AI 消息 · 正则双通路对照">
          <div class="rx-grid">
            <div><div class="rx-title">原文</div><pre class="seg-content">{{ result.regexPreview.raw }}</pre></div>
            <div><div class="rx-title">显示态（markdownOnly 生效）</div><pre class="seg-content">{{ result.regexPreview.display }}</pre></div>
            <div><div class="rx-title">发送态（promptOnly 生效）</div><pre class="seg-content">{{ result.regexPreview.prompt }}</pre></div>
          </div>
        </NCard>

        <NCollapse>
          <NCollapseItem title="扫描窗口文本（世界书键匹配的输入）" name="scan">
            <pre class="seg-content">{{ result.scanText || '（空）' }}</pre>
          </NCollapseItem>
        </NCollapse>
      </template>
    </template>
  </div>
</template>

<style scoped>
.chat-row { display: flex; gap: 8px; align-items: flex-start; }
.set-row { display: flex; gap: 10px; align-items: center; }
.set-label { width: 120px; font-size: 13px; opacity: .85; flex-shrink: 0; }
.set-hint { font-size: 12px; opacity: .55; }
.about-body { font-size: 13px; line-height: 1.7; padding: 4px 2px; }
.about-body p { margin: 4px 0; }
.seg-list { display: flex; flex-direction: column; gap: 10px; }
.seg-row { border-bottom: 1px dashed var(--tcs-border, rgba(255, 255, 255, 0.06)); padding-bottom: 8px; }
.seg-head { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.seg-label { font-weight: 700; }
.seg-source { font-size: 11px; opacity: .5; font-family: monospace; }
.seg-tokens { margin-left: auto; }
.seg-content { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55; opacity: .92; margin: 6px 0 0; max-height: 220px; overflow: auto; padding: 6px 8px; background: var(--tcs-fill, rgba(128, 128, 128, 0.08)); border-radius: 6px; }
.wi-row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed var(--tcs-border, rgba(255, 255, 255, 0.05)); flex-wrap: wrap; }
.wi-reason { opacity: .75; }
.wi-tokens { margin-left: auto; font-size: 12px; opacity: .55; }
.rx-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.rx-title { font-size: 12px; font-weight: 700; opacity: .75; margin-bottom: 4px; }
@media (max-width: 900px) { .rx-grid { grid-template-columns: 1fr; } }
</style>

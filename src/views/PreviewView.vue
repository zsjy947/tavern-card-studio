<script setup lang="ts">
/**
 * 卡片市场式只读预览（ROADMAP P2-1）：卡库双击进入。
 * 封面大图 / 基础信息 / 开场白渲染（宏替换 + 美化占位符徽标）/ 世界书折叠（蓝绿灯徽标）/
 * 正则与脚本清单 / token 概览。无任何写入口；右上「编辑」进编辑器。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton, NCard, NEmpty, NIcon, NSpace, NSpin, NTag, NText, NCollapse, NCollapseItem,
} from 'naive-ui';
import { ArrowBackOutline, CreateOutline } from '@vicons/ionicons5';
import { cardSpec, type AnyCard, type BookEntry } from '@/core/card';
import * as cardService from '@/services/cardService';
import type { CardRow } from '@/services/types';
import { countTokens } from '@/core/stats/tokens';
import CardCover from '@/components/CardCover.vue';
import { useWorkspace } from '@/stores/workspace';

const route = useRoute();
const router = useRouter();
const ws = useWorkspace();

const id = computed(() => String(route.params.id));
const row = ref<CardRow | null>(null);

onMounted(async () => {
  const found = await cardService.getCard(id.value);
  row.value = found ?? null;
});

const card = computed<AnyCard | null>(() => row.value?.card ?? null);
const data = computed(() => (card.value?.data ?? {}) as Record<string, unknown>);

const USER_MACRO = '{{user}}';

/** {{user}}/{{char}} 宏替换（预览用） */
function renderMacros(text: string): string {
  return text
    .replaceAll(/\{\{user\}\}/gi, ws.userName)
    .replaceAll(/\{\{char\}\}/gi, card.value?.data.name ?? 'Char');
}

/** 美化占位符（<XxxBar/> 等）→ 徽标提示 */
const PLACEHOLDER_RE = /<\/?[A-Za-z][\w-]*(?:PlaceHolder|Bar|Panel|Status|Impl)[\w-]*\s*\/?>/g;

function renderGreeting(text: string): string {
  return renderMacros(text)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(PLACEHOLDER_RE, (m) => `<span class="greet-ph" title="渲染占位符，酒馆内生效">${m}</span>`)
    .replace(/\n/g, '<br>');
}

const entries = computed<BookEntry[]>(() => ((data.value.character_book as { entries?: BookEntry[] } | undefined)?.entries ?? []));
const entryTokens = computed(() => entries.value.reduce((acc, e) => acc + countTokens(e.content).total, 0));
const greetings = computed(() => [String(data.value.first_mes ?? ''), ...((data.value.alternate_greetings as string[] | undefined) ?? [])].filter(Boolean));
const greetingTokens = computed(() => greetings.value.reduce((acc, g) => acc + countTokens(g).total, 0));
const countTokensText = computed(() => {
  const t = row.value?.tokenStats;
  if (!t) return '—';
  return `${t.estimated ? '~' : ''}${t.total}`;
});

const regexes = computed(() => ((data.value.extensions as Record<string, unknown> | undefined)?.regex_scripts as { scriptName?: string; promptOnly?: boolean; markdownOnly?: boolean }[] | undefined) ?? []);
const scripts = computed(() => ((data.value.extensions as Record<string, unknown> | undefined)?.TavernHelper_scripts as { name?: string }[] | undefined) ?? []);

const specLabel = computed(() => (card.value ? { v1: 'V1', v2: 'V2', v3: 'V3' }[cardSpec(card.value)] ?? 'V1' : ''));
</script>

<template>
  <NSpin v-if="!card" style="min-height: 200px" />
  <NEmpty v-else-if="!row" description="卡片不存在" />
  <div v-else class="preview-root" data-shortcut-scope="preview">
    <div class="preview-head">
      <NSpace align="center" :size="10">
        <NButton size="small" quaternary @click="router.back()">
          <template #icon><NIcon><ArrowBackOutline /></NIcon></template>
        </NButton>
        <span class="preview-title">{{ card.data.name || '未命名' }}</span>
        <NTag size="small" round :bordered="false" type="info">{{ specLabel }}</NTag>
        <NTag size="small" round :bordered="false">{{ countTokensText }} tk</NTag>
        <NTag v-for="t in card.data.tags.slice(0, 5)" :key="t" size="small" round :bordered="false" type="warning">{{ t }}</NTag>
      </NSpace>
      <NButton size="small" type="primary" @click="router.push(`/editor/${id}`)">
        <template #icon><NIcon><CreateOutline /></NIcon></template>编辑
      </NButton>
    </div>

    <div class="preview-body">
      <div class="preview-side">
        <NCard size="small">
          <CardCover :src="row?.cover ?? null" :name="card.data.name || '?'" :size="220" />
          <div class="preview-meta">
            <div v-if="card.data.creator" class="preview-meta-row"><span>作者</span><b>{{ card.data.creator }}</b></div>
            <div v-if="card.data.character_version" class="preview-meta-row"><span>版本</span><b>{{ card.data.character_version }}</b></div>
            <div class="preview-meta-row"><span>更新</span><b>{{ new Date(row!.updatedAt).toLocaleDateString() }}</b></div>
          </div>
        </NCard>
        <NCard size="small" title="Token 概览">
          <div class="preview-meta">
            <div class="preview-meta-row"><span>导入统计</span><b>{{ countTokensText }}</b></div>
            <div class="preview-meta-row"><span>世界书</span><b>{{ entryTokens }}</b></div>
            <div class="preview-meta-row"><span>开场白 ×{{ greetings.length }}</span><b>{{ greetingTokens }}</b></div>
          </div>
        </NCard>
        <NCard v-if="regexes.length || scripts.length" size="small" title="正则 / 脚本">
          <div class="preview-list">
            <div v-for="r in regexes" :key="r.scriptName" class="preview-list-row">
              <NTag size="tiny" :bordered="false" :type="r.promptOnly ? 'warning' : 'info'">{{ r.promptOnly ? '只发提示词' : r.markdownOnly ? '只渲染' : '双向' }}</NTag>
              <span>{{ r.scriptName }}</span>
            </div>
            <div v-for="s in scripts" :key="s.name" class="preview-list-row">
              <NTag size="tiny" :bordered="false" type="success">脚本</NTag>
              <span>{{ s.name }}</span>
            </div>
          </div>
        </NCard>
      </div>

      <div class="preview-main">
        <NCard v-if="data.description" size="small" title="描述">
          <pre class="preview-text">{{ data.description }}</pre>
        </NCard>
        <NCard v-if="data.personality" size="small" title="性格">
          <pre class="preview-text">{{ data.personality }}</pre>
        </NCard>
        <NCard v-if="data.scenario" size="small" title="场景">
          <pre class="preview-text">{{ data.scenario }}</pre>
        </NCard>

        <NCard size="small" :title="`开场白渲染（${USER_MACRO} = ${ws.userName}）`">
          <div v-for="(g, i) in greetings" :key="i" class="greet-block">
            <NTag size="tiny" :bordered="false">{{ i === 0 ? '主开场白' : `备选 ${i}` }}</NTag>
            <div class="greet-html" v-html="renderGreeting(g)" />
          </div>
        </NCard>

        <NCard v-if="entries.length" size="small" :title="`世界书（${entries.length} 条 · ${entryTokens} tk）`">
          <NCollapse>
            <NCollapseItem v-for="e in entries" :key="e.id" :name="String(e.id)">
              <template #header>
                <NSpace align="center" :size="6">
                  <NTag size="tiny" :bordered="false" :type="e.constant ? 'success' : 'default'">{{ e.constant ? '蓝灯' : '绿灯' }}</NTag>
                  <span style="font-size: 13px">{{ e.comment || '（未命名）' }}</span>
                  <NText v-if="e.keys.length" depth="3" style="font-size: 11px">{{ e.keys.join('、') }}</NText>
                </NSpace>
              </template>
              <pre class="preview-text">{{ e.content }}</pre>
            </NCollapseItem>
          </NCollapse>
        </NCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview-root { max-width: 1180px; margin: 0 auto; }
.preview-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.preview-title { font-size: 18px; font-weight: 800; }
.preview-body { display: grid; grid-template-columns: 260px 1fr; gap: 14px; align-items: start; }
.preview-side { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 0; }
.preview-meta { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.preview-meta-row { display: flex; justify-content: space-between; font-size: 12px; opacity: .85; }
.preview-meta-row span { opacity: .6; }
.preview-list { display: flex; flex-direction: column; gap: 6px; max-height: 220px; overflow: auto; }
.preview-list-row { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.preview-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.preview-text { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.7; font-family: inherit; }
.greet-block { padding: 10px 0; }
.greet-block + .greet-block { border-top: 1px dashed var(--tcs-border, rgba(255,255,255,.1)); }
.greet-html { font-size: 13px; line-height: 1.75; margin-top: 6px; }
:deep(.greet-ph) {
  display: inline-block; padding: 0 6px; margin: 0 2px;
  border: 1px dashed var(--tcs-accent, #8b5cf6); border-radius: 6px;
  font-size: 11px; color: var(--tcs-accent, #8b5cf6); opacity: .9;
}
@media (max-width: 900px) {
  .preview-body { grid-template-columns: 1fr; }
  .preview-side { position: static; }
}
</style>

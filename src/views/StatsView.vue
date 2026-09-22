<script setup lang="ts">
/** 统计看板：卡数/模板数/数据体积/token 分布/AI 调用趋势 */
import { computed, onMounted, ref } from 'vue';
import { NCard, NGrid, NGridItem, NStatistic, NSpace, NTag, NText, NEmpty } from 'naive-ui';
import { useWorkspace } from '@/stores/workspace';
import { listUsage } from '@/services/aiService';
import { listTemplates } from '@/services/templateService';
import { listProjects } from '@/services/projectService';
import { getStore } from '@/db';
import type { AiUsageLogRow } from '@/services/types';
import { formatBytes } from '@/utils/file';

const ws = useWorkspace();
const usage = ref<AiUsageLogRow[]>([]);
const templateCount = ref(0);
const projectCount = ref(0);
const dbSize = ref(0);

onMounted(async () => {
  await ws.refreshCards(true);
  usage.value = await listUsage();
  templateCount.value = (await listTemplates()).length;
  projectCount.value = (await listProjects()).length;
  try {
    const dump = await (await getStore()).dump();
    dbSize.value = JSON.stringify(dump).length;
  } catch { /* 浏览器隐私模式可能失败 */ }
});

const cards = computed(() => ws.cards.filter((c) => !c.deletedAt));

const totalTokens = computed(() => cards.value.reduce((a, c) => a + (c.tokenStats?.total ?? 0), 0));
const specDist = computed(() => {
  const m = new Map<string, number>();
  for (const c of cards.value) m.set(c.spec, (m.get(c.spec) ?? 0) + 1);
  return [...m.entries()];
});
const topTags = computed(() => {
  const m = new Map<string, number>();
  for (const c of cards.value) for (const t of c.tags) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
});

const usageByDay = computed(() => {
  const m = new Map<string, { calls: number; tokens: number }>();
  for (const u of usage.value) {
    const day = u.createdAt.slice(0, 10);
    const prev = m.get(day) ?? { calls: 0, tokens: 0 };
    m.set(day, { calls: prev.calls + 1, tokens: prev.tokens + u.promptTokens + u.completionTokens });
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-14);
});
const maxDayTokens = computed(() => Math.max(1, ...usageByDay.value.map(([, v]) => v.tokens)));

const usageByFeature = computed(() => {
  const m = new Map<string, number>();
  for (const u of usage.value) m.set(u.feature, (m.get(u.feature) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
});

const tokenBuckets = computed(() => {
  const buckets = [
    { label: '< 1k', test: (t: number) => t < 1000 },
    { label: '1k-3k', test: (t: number) => t >= 1000 && t < 3000 },
    { label: '3k-6k', test: (t: number) => t >= 3000 && t < 6000 },
    { label: '6k-10k', test: (t: number) => t >= 6000 && t < 10000 },
    { label: '> 10k', test: (t: number) => t >= 10000 },
  ];
  return buckets.map((b) => ({ label: b.label, count: cards.value.filter((c) => b.test(c.tokenStats?.total ?? 0)).length }));
});
const maxBucket = computed(() => Math.max(1, ...tokenBuckets.value.map((b) => b.count)));
</script>

<template>
  <div style="max-width: 1000px">
    <NGrid :cols="4" :x-gap="14" :y-gap="14">
      <NGridItem><NCard size="small"><NStatistic label="卡库卡片" :value="cards.length" /></NCard></NGridItem>
      <NGridItem><NCard size="small"><NStatistic label="模板" :value="templateCount" /></NCard></NGridItem>
      <NGridItem><NCard size="small"><NStatistic label="同人项目" :value="projectCount" /></NCard></NGridItem>
      <NGridItem><NCard size="small"><NStatistic label="数据体积" :value="formatBytes(dbSize)" /></NCard></NGridItem>
    </NGrid>

    <NGrid :cols="2" :x-gap="14" style="margin-top: 14px">
      <NGridItem>
        <NCard size="small" title="卡片 token 分布（全文，cl100k）">
          <div class="bar-list">
            <div v-for="b in tokenBuckets" :key="b.label" class="bar-row">
              <span class="bar-label">{{ b.label }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: (b.count / maxBucket) * 100 + '%' }"></div></div>
              <span class="bar-value">{{ b.count }}</span>
            </div>
          </div>
          <NText depth="3" style="font-size: 12px">全库合计 {{ totalTokens.toLocaleString() }} tokens</NText>
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard size="small" title="AI 调用趋势（近 14 天）">
          <NEmpty v-if="!usageByDay.length" size="small" description="还没有 AI 调用记录" />
          <div v-else class="trend-chart">
            <div v-for="[day, v] in usageByDay" :key="day" class="trend-col" :title="`${day}：${v.calls} 次 / ${v.tokens} tokens`">
              <div class="trend-bar" :style="{ height: (v.tokens / maxDayTokens) * 100 + '%' }"></div>
              <span class="trend-day">{{ day.slice(5) }}</span>
            </div>
          </div>
          <NSpace :size="6" style="margin-top: 8px" v-if="usageByDay.length">
            <NTag size="tiny" :bordered="false" type="info">总调用 {{ usage.length }} 次</NTag>
            <NTag size="tiny" :bordered="false" type="info">总 tokens {{ usage.reduce((a, u) => a + u.promptTokens + u.completionTokens, 0).toLocaleString() }}</NTag>
          </NSpace>
        </NCard>
      </NGridItem>
    </NGrid>

    <NGrid :cols="2" :x-gap="14" style="margin-top: 14px">
      <NGridItem>
        <NCard size="small" title="规格分布">
          <NSpace :size="8">
            <NTag v-for="[spec, n] in specDist" :key="spec" round :bordered="false" type="info">{{ spec === 'chara_card_v3' ? 'V3' : spec === 'chara_card_v2' ? 'V2' : 'V1' }}：{{ n }}</NTag>
          </NSpace>
        </NCard>
      </NGridItem>
      <NGridItem>
        <NCard size="small" title="高频标签">
          <NSpace :size="6">
            <NTag v-for="[t, n] in topTags" :key="t" size="small" round :bordered="false">{{ t }} × {{ n }}</NTag>
          </NSpace>
        </NCard>
      </NGridItem>
    </NGrid>

    <NCard size="small" title="AI 功能调用排行" style="margin-top: 14px">
      <NEmpty v-if="!usageByFeature.length" size="small" description="无记录" />
      <NSpace v-else :size="8">
        <NTag v-for="[f, n] in usageByFeature" :key="f" round :bordered="false" type="warning">{{ f }} × {{ n }}</NTag>
      </NSpace>
    </NCard>
  </div>
</template>

<style scoped>
.bar-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.bar-row { display: flex; align-items: center; gap: 10px; }
.bar-label { width: 52px; font-size: 12px; text-align: right; opacity: .75; }
.bar-track { flex: 1; height: 14px; background: rgba(255,255,255,.06); border-radius: 7px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #a78bfa); border-radius: 7px; transition: width .4s; }
.bar-value { width: 30px; font-size: 12px; font-variant-numeric: tabular-nums; }
.trend-chart { display: flex; align-items: flex-end; gap: 6px; height: 140px; padding: 4px 0; }
.trend-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.trend-bar { width: 70%; background: linear-gradient(180deg, #a78bfa, #7c3aed); border-radius: 4px 4px 0 0; min-height: 2px; }
.trend-day { font-size: 10px; opacity: .6; }
</style>

<script setup lang="ts">
/** 两卡横向对比（优化文档 P0-5）：字段级 diff + 关键字段并排预览 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NSpace, NButton, NTag, NEmpty, NSpin, NSelect, NDescriptions, NDescriptionsItem, NText,
} from 'naive-ui';
import { useWorkspace } from '@/stores/workspace';
import * as cardService from '@/services/cardService';
import type { AnyCard } from '@/core/card';
import CardCover from '@/components/CardCover.vue';

const route = useRoute();
const router = useRouter();
const ws = useWorkspace();

const aId = ref<string | null>((route.query.a as string) ?? null);
const bId = ref<string | null>((route.query.b as string) ?? null);

onMounted(async () => {
  await ws.refreshCards(true);
});

const options = computed(() => ws.cards.filter((c) => !c.deletedAt).map((c) => ({ label: c.name, value: c.id })));
const cardA = computed(() => ws.cards.find((c) => c.id === aId.value) ?? null);
const cardB = computed(() => ws.cards.find((c) => c.id === bId.value) ?? null);

const FIELD_LABELS: Record<string, string> = {
  name: '角色名', description: '描述', personality: '性格', scenario: '场景',
  first_mes: '开场白', mes_example: '对话示例', creator_notes: '作者留言',
  system_prompt: '系统提示', post_history_instructions: '贴身指令',
};

const SIDE_FIELDS = ['description', 'personality', 'scenario', 'first_mes'] as const;

const diffs = computed(() => {
  if (!cardA.value || !cardB.value) return [];
  return cardService.diffCards(cardA.value.card, cardB.value.card);
});

function stat(card: AnyCard | null | undefined) {
  const d = (card?.data ?? {}) as Record<string, unknown>;
  const book = (d.character_book as { entries?: unknown[] } | undefined)?.entries?.length ?? 0;
  const regex = ((d.extensions as { regex_scripts?: unknown[] } | undefined)?.regex_scripts?.length ?? 0);
  const greetings = (d.alternate_greetings as unknown[] | undefined)?.length ?? 0;
  return { book, regex, greetings };
}

const statsA = computed(() => stat(cardA.value?.card));
const statsB = computed(() => stat(cardB.value?.card));

function sideText(card: AnyCard | null | undefined, field: string): string {
  return String(((card?.data as Record<string, unknown> | undefined)?.[field] as string) ?? '（空）');
}
</script>

<template>
  <div style="max-width: 1080px">
    <NSpace :size="10" style="margin-bottom: 14px" align="center">
      <NButton size="small" quaternary @click="router.back()">‹ 返回</NButton>
      <NSelect v-model:value="aId" :options="options" filterable placeholder="卡片 A" style="width: 220px" size="small" />
      <NText depth="3">vs</NText>
      <NSelect v-model:value="bId" :options="options" filterable placeholder="卡片 B" style="width: 220px" size="small" />
    </NSpace>

    <NSpin :show="ws.cardsLoading">
      <NEmpty v-if="!cardA || !cardB" description="选择两张卡片开始对比（常用于二创前后对照）" style="padding: 60px 0" />
      <template v-else>
        <NDescriptions :column="2" bordered size="small" style="margin-bottom: 14px">
          <NDescriptionsItem label="卡片">
            <NSpace :size="8" align="center">
              <CardCover :src="cardA.cover" :name="cardA.name" :size="32" />
              <b>{{ cardA.name }}</b>
              <NTag size="tiny" :bordered="false">{{ cardA.spec === 'chara_card_v3' ? 'V3' : 'V2' }}</NTag>
              <span style="opacity: .6">→</span>
              <CardCover :src="cardB.cover" :name="cardB.name" :size="32" />
              <b>{{ cardB.name }}</b>
              <NTag size="tiny" :bordered="false">{{ cardB.spec === 'chara_card_v3' ? 'V3' : 'V2' }}</NTag>
            </NSpace>
          </NDescriptionsItem>
          <NDescriptionsItem label="规模">
            世界书 {{ statsA.book }} 条 / 正则 {{ statsA.regex }} / 备选开场 {{ statsA.greetings }}
            → 世界书 {{ statsB.book }} 条 / 正则 {{ statsB.regex }} / 备选开场 {{ statsB.greetings }}
          </NDescriptionsItem>
          <NDescriptionsItem label="token（全文）">
            {{ cardA.tokenStats?.total ?? '—' }} → {{ cardB.tokenStats?.total ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem label="差异字段数">{{ diffs.length }}</NDescriptionsItem>
        </NDescriptions>

        <div class="cmp-diffs">
          <div v-for="d in diffs" :key="d.field" class="cmp-diff-row">
            <NTag size="small" :bordered="false" type="info" style="width: 110px; justify-content: center">
              {{ FIELD_LABELS[d.field] ?? d.field }}
            </NTag>
            <span class="cmp-a">{{ (d.before ?? '∅').slice(0, 160) }}{{ (d.before ?? '').length > 160 ? '…' : '' }}</span>
            <span class="cmp-arrow">→</span>
            <span class="cmp-b">{{ (d.after ?? '∅').slice(0, 160) }}{{ (d.after ?? '').length > 160 ? '…' : '' }}</span>
          </div>
          <NTag v-if="!diffs.length" type="success" :bordered="false">两张卡的关键字段完全一致</NTag>
        </div>

        <div class="cmp-side">
          <div v-for="f in SIDE_FIELDS" :key="f" class="cmp-side-block">
            <div class="cmp-side-title">{{ FIELD_LABELS[f] }}</div>
            <div class="cmp-side-grid">
              <pre class="cmp-pre">{{ sideText(cardA.card, f).slice(0, 2000) }}</pre>
              <pre class="cmp-pre">{{ sideText(cardB.card, f).slice(0, 2000) }}</pre>
            </div>
          </div>
        </div>
      </template>
    </NSpin>
  </div>
</template>

<style scoped>
.cmp-diffs { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.cmp-diff-row { display: flex; align-items: baseline; gap: 10px; font-size: 12px; }
.cmp-a { color: var(--tcs-bad, #f87171); flex: 1; min-width: 0; }
.cmp-b { color: var(--tcs-good, #4ade80); flex: 1; min-width: 0; }
.cmp-arrow { opacity: .5; }
.cmp-side-title { font-weight: 700; margin: 12px 0 6px; }
.cmp-side-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.cmp-pre {
  background: var(--tcs-editor-bg, rgba(0, 0, 0, 0.3)); border-radius: 8px; padding: 10px;
  font-size: 12px; line-height: 1.6; white-space: pre-wrap; max-height: 320px; overflow: auto; margin: 0;
}
</style>

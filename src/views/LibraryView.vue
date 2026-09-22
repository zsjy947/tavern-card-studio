<script setup lang="ts">
/** 卡库：搜索/标签筛选/分类/批量导出/回收站 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NSpace, NInput, NButton, NTag, NEmpty, NSpin, NDropdown, NPopconfirm,
  NModal, NList, NListItem, useMessage, NIcon, NTabs, NTab, NCascader, NSelect,
} from 'naive-ui';
import { SearchOutline, AddOutline, TrashOutline, DownloadOutline, CloudUploadOutline, RefreshOutline, ArrowUpOutline } from '@vicons/ionicons5';
import { useWorkspace } from '@/stores/workspace';
import type { CardRow } from '@/services/types';
import * as cardService from '@/services/cardService';
import * as backupService from '@/services/backupService';
import { pickJsonFiles, pickPngFiles, sanitizeFilename } from '@/utils/file';
import CardCover from '@/components/CardCover.vue';
import JSZip from 'jszip';

const router = useRouter();
const message = useMessage();
const ws = useWorkspace();

const keyword = ref('');
const tagFilter = ref<string | null>(null);
const showTrash = ref(false);
const selected = ref<Set<string>>(new Set());
const importing = ref(false);
const restoreTarget = ref<CardRow | null>(null);

const allTags = computed(() => {
  const counts = new Map<string, number>();
  for (const c of ws.cards) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => ({ label, value: label }));
});

const filtered = computed(() => {
  let list = ws.cards;
  if (showTrash.value) list = list.filter((c) => c.deletedAt);
  else list = list.filter((c) => !c.deletedAt);
  const kw = keyword.value.trim().toLowerCase();
  if (kw) {
    list = list.filter(
      (c) =>
        c.name.toLowerCase().includes(kw) ||
        c.tags.some((t) => t.toLowerCase().includes(kw)) ||
        String((c.card.data as { description?: string }).description ?? '').toLowerCase().includes(kw),
    );
  }
  if (tagFilter.value) list = list.filter((c) => c.tags.includes(tagFilter.value!));
  return list;
});

onMounted(async () => {
  await ws.refreshCards(true);
});

async function importCards() {
  const files = await pickPngFiles(true).then((f) => (f.length ? f : pickJsonFiles(true)));
  if (!files.length) return;
  importing.value = true;
  let ok = 0;
  const errors: string[] = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (f.name.toLowerCase().endsWith('.json')) {
        await cardService.importCardFromJson(new TextDecoder().decode(bytes));
      } else {
        await cardService.importCardFromPng(bytes);
      }
      ok++;
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  importing.value = false;
  await ws.refreshCards(true);
  if (ok) message.success(`导入 ${ok} 张卡${errors.length ? `，${errors.length} 张失败` : ''}`);
  if (errors.length) errors.slice(0, 3).forEach((e) => message.error(e));
}

async function newCard() {
  const row = await cardService.createCard('新角色');
  await ws.refreshCards(true);
  router.push(`/editor/${row.id}`);
}

function toggleSelect(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

async function exportSelected(kind: 'json' | 'png') {
  const cards = ws.cards.filter((c) => selected.value.has(c.id));
  if (!cards.length) {
    message.warning('先点选卡片（单击卡片右上角选择）');
    return;
  }
  if (cards.length === 1 && kind === 'json') {
    backupService.downloadText(cardService.cardToJsonText(cards[0]!.card), `${sanitizeFilename(cards[0]!.name)}.json`);
    return;
  }
  const zip = new JSZip();
  for (const c of cards) {
    if (kind === 'json') {
      zip.file(`${sanitizeFilename(c.name)}.json`, cardService.cardToJsonText(c.card));
    } else {
      const bytes = await cardService.cardToPngBytes(c.card);
      zip.file(`${sanitizeFilename(c.name)}.png`, bytes);
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  backupService.downloadBlob(blob, backupService.timestampName('cards', 'zip'));
  message.success(`已导出 ${cards.length} 张卡（zip）`);
}

async function trash(id: string) {
  await cardService.trashCard(id);
  await ws.refreshCards(true);
  message.success('已移入回收站');
}

async function hardDelete(c: CardRow) {
  await cardService.hardDeleteCard(c.id);
  await ws.refreshCards(true);
  message.success('已彻底删除');
}

async function restore(c: CardRow) {
  await cardService.restoreCard(c.id);
  await ws.refreshCards(true);
  message.success('已恢复');
}
</script>

<template>
  <div>
    <NSpace align="center" :size="10" style="margin-bottom: 14px" wrap>
      <NInput v-model:value="keyword" placeholder="搜索卡名 / 标签 / 描述…" clearable style="width: 240px">
        <template #prefix><NIcon><SearchOutline /></NIcon></template>
      </NInput>
      <NSelect v-model:value="tagFilter" :options="allTags" placeholder="标签筛选" clearable style="width: 150px" size="small" />
      <NButton size="small" secondary @click="importCards" :loading="importing">
        <template #icon><NIcon><CloudUploadOutline /></NIcon></template>导入 PNG / JSON
      </NButton>
      <NButton size="small" secondary @click="exportSelected('json')">
        <template #icon><NIcon><DownloadOutline /></NIcon></template>导出所选 JSON
      </NButton>
      <NButton size="small" secondary @click="exportSelected('png')">导出所选 PNG</NButton>
      <NButton size="small" quaternary @click="ws.refreshCards(true)">
        <template #icon><NIcon><RefreshOutline /></NIcon></template>
      </NButton>
      <div style="flex:1"></div>
      <NSwitch v-model:value="showTrash" size="small">
        <template #checked>回收站</template>
        <template #unchecked>卡库</template>
      </NSwitch>
      <NButton type="primary" size="small" @click="newCard">
        <template #icon><NIcon><AddOutline /></NIcon></template>新建角色卡
      </NButton>
    </NSpace>

    <NSpin :show="ws.cardsLoading">
      <NEmpty v-if="!filtered.length" description="没有卡片，导入或新建一张开始" style="padding: 60px 0" />
      <div v-else class="lib-grid">
        <div v-for="c in filtered" :key="c.id" class="lib-card" :class="{ 'lib-card-selected': selected.has(c.id) }">
          <div class="lib-card-main" @click="router.push(`/editor/${c.id}`)">
            <CardCover :src="c.cover" :name="c.name" :size="56" />
            <div class="lib-card-info">
              <div class="lib-card-name">{{ c.name }}</div>
              <div class="lib-card-meta">
                <NTag size="tiny" :bordered="false">{{ c.spec === 'chara_card_v3' ? 'V3' : c.spec === 'chara_card_v2' ? 'V2' : 'V1' }}</NTag>
                <span v-if="c.tokenStats" class="lib-card-tk">{{ c.tokenStats.total }} tk</span>
                <span class="lib-card-date">{{ new Date(c.updatedAt).toLocaleDateString() }}</span>
              </div>
              <div class="lib-card-tags">
                <NTag v-for="t in c.tags.slice(0, 4)" :key="t" size="tiny" round :bordered="false" type="info">{{ t }}</NTag>
                <NTag v-if="c.tags.length > 4" size="tiny" round :bordered="false">+{{ c.tags.length - 4 }}</NTag>
              </div>
            </div>
          </div>
          <div class="lib-card-ops">
            <NButton text size="tiny" @click.stop="toggleSelect(c.id)">{{ selected.has(c.id) ? '取消选择' : '选择' }}</NButton>
            <template v-if="!showTrash">
              <NPopconfirm @positive-click="trash(c.id)">
                <template #trigger><NButton text size="tiny" type="error">删除</NButton></template>
                移入回收站？
              </NPopconfirm>
            </template>
            <template v-else>
              <NButton text size="tiny" type="success" @click.stop="restore(c)">恢复</NButton>
              <NPopconfirm @positive-click="hardDelete(c)">
                <template #trigger><NButton text size="tiny" type="error">彻底删除</NButton></template>
                不可恢复，确认？
              </NPopconfirm>
            </template>
          </div>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.lib-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px;
}
.lib-card {
  background: rgba(255, 255, 255, 0.028);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px; padding: 12px 14px;
  transition: border-color .15s, transform .15s, box-shadow .15s;
}
.lib-card:hover { border-color: rgba(139, 92, 246, .55); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.25); }
.lib-card-selected { border-color: #8b5cf6; background: rgba(139, 92, 246, 0.07); }
.lib-card-main { display: flex; gap: 12px; cursor: pointer; }
.lib-card-info { flex: 1; min-width: 0; }
.lib-card-name { font-weight: 700; font-size: 14px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lib-card-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; opacity: .75; margin-bottom: 6px; }
.lib-card-tk { font-variant-numeric: tabular-nums; }
.lib-card-date { margin-left: auto; }
.lib-card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.lib-card-ops { display: flex; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,.06); }
</style>

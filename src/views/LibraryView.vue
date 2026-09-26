<script setup lang="ts">
/** 卡库：搜索/标签筛选/分类目录/批量导出/回收站/两卡对比入口 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NSpace, NInput, NButton, NTag, NEmpty, NSpin, NDropdown, NPopconfirm,
  useMessage, NIcon, NSelect, NSwitch, NTree, type TreeOption,
} from 'naive-ui';
import { SearchOutline, AddOutline, DownloadOutline, CloudUploadOutline, RefreshOutline, GitCompareOutline } from '@vicons/ionicons5';
import { useWorkspace } from '@/stores/workspace';
import type { CardRow, CategoryRow } from '@/services/types';
import * as cardService from '@/services/cardService';
import * as categoryService from '@/services/categoryService';
import * as backupService from '@/services/backupService';
import { pickJsonFiles, pickPngFiles, pickFiles, sanitizeFilename } from '@/utils/file';
import { dataUrlToBytes, imageFileToCoverDataUrl } from '@/utils/image';
import CardCover from '@/components/CardCover.vue';
import JSZip from 'jszip';

const router = useRouter();
const message = useMessage();
const ws = useWorkspace();

const keyword = ref('');
const tagFilter = ref<string | null>(null);
const categoryFilter = ref<string | null>(null); // null=全部, 'none'=未分类
const showTrash = ref(false);
const selected = ref<Set<string>>(new Set());
const importing = ref(false);
const categories = ref<CategoryRow[]>([]);

const allTags = computed(() => {
  const counts = new Map<string, number>();
  for (const c of ws.cards) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => ({ label, value: label }));
});

const categoryTree = computed<TreeOption[]>(() => [
  { key: 'all', label: `全部（${ws.cards.filter((c) => !c.deletedAt).length}）` },
  { key: 'none', label: `未分类（${ws.cards.filter((c) => !c.deletedAt && !c.categoryId).length}）` },
  ...categories.value.map((cat) => ({
    key: cat.id,
    label: `${cat.name}（${ws.cards.filter((c) => !c.deletedAt && c.categoryId === cat.id).length}）`,
  })),
]);

function onCategorySelect(keys: string[]) {
  const k = keys[0];
  categoryFilter.value = !k || k === 'all' ? null : k === 'none' ? 'none' : k;
}

const filtered = computed(() => {
  let list = ws.cards;
  if (showTrash.value) list = list.filter((c) => c.deletedAt);
  else list = list.filter((c) => !c.deletedAt);
  if (categoryFilter.value === 'none') list = list.filter((c) => !c.categoryId);
  else if (categoryFilter.value) list = list.filter((c) => c.categoryId === categoryFilter.value);
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

async function refresh() {
  await ws.refreshCards(true);
  categories.value = await categoryService.listCategories();
}

onMounted(refresh);

async function addCategory() {
  const name = window.prompt('新分类名称：');
  if (!name?.trim()) return;
  try {
    await categoryService.createCategory(name.trim());
    await refresh();
  } catch (e) {
    message.error((e as Error).message);
  }
}

async function removeCategory() {
  if (!categoryFilter.value || categoryFilter.value === 'none') return;
  const cat = categories.value.find((c) => c.id === categoryFilter.value);
  if (!cat) return;
  if (!window.confirm(`删除分类「${cat.name}」？其中卡片将回到未分类（不会删卡）`)) return;
  const r = await categoryService.deleteCategory(cat.id);
  categoryFilter.value = null;
  await refresh();
  message.success(`分类已删除，${r.movedCards} 张卡回到未分类`);
}

function cardOps(c: CardRow) {
  const catOptions: { key: string; label: string }[] = [
    { key: 'cat:none', label: '移到未分类' },
    ...categories.value.map((cat) => ({ key: `cat:${cat.id}`, label: `移到「${cat.name}」` })),
  ];
  return [
    { key: 'select', label: selected.value.has(c.id) ? '取消选择' : '选择' },
    ...(categories.value.length ? catOptions : []),
    { key: 'edit', label: '在编辑器中打开' },
    { key: 'cover', label: c.cover ? '更换封面' : '设置封面（导出 PNG 的底图）' },
    ...(c.cover ? [{ key: 'cover:remove', label: '移除封面' }] : []),
  ];
}

async function onCardOp(key: string, c: CardRow) {
  if (key === 'select') toggleSelect(c.id);
  else if (key === 'edit') router.push(`/editor/${c.id}`);
  else if (key === 'cover') await setCover(c);
  else if (key === 'cover:remove') await removeCover(c);
  else if (key.startsWith('cat:')) {
    await categoryService.assignCategory(c.id, key === 'cat:none' ? null : key.slice(4));
    await refresh();
    message.success('已归类');
  }
}

/** 卡库直设封面：选图压缩后写 CardRow.cover（导出 PNG 将用其作底图） */
async function setCover(c: CardRow) {
  const files = await pickFiles('image/png,image/jpeg,image/webp', false);
  if (!files.length) return;
  try {
    const dataUrl = await imageFileToCoverDataUrl(files[0]!);
    await cardService.updateCardPatch(c.id, { cover: dataUrl });
    await refresh();
    message.success(`「${c.name}」封面已设置（导出 PNG 时作为底图）`);
  } catch (e) {
    message.error(`封面设置失败：${(e as Error).message}`);
  }
}

async function removeCover(c: CardRow) {
  await cardService.updateCardPatch(c.id, { cover: null });
  await refresh();
  message.success(`「${c.name}」封面已移除，导出 PNG 将使用占位图`);
}

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
  await refresh();
  if (ok) message.success(`导入 ${ok} 张卡${errors.length ? `，${errors.length} 张失败` : ''}`);
  if (errors.length) errors.slice(0, 3).forEach((e) => message.error(e));
}

async function newCard() {
  const row = await cardService.createCard('新角色');
  await refresh();
  router.push(`/editor/${row.id}`);
}

function toggleSelect(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function compareSelected() {
  const ids = [...selected.value];
  if (ids.length !== 2) {
    message.warning('先选择恰好两张卡（卡片操作菜单 → 选择）');
    return;
  }
  router.push({ path: '/compare', query: { a: ids[0], b: ids[1] } });
}

async function exportSelected(kind: 'json' | 'png') {
  const cards = ws.cards.filter((c) => selected.value.has(c.id));
  if (!cards.length) {
    message.warning('先选择卡片（卡片操作菜单 → 选择）');
    return;
  }
  if (cards.length === 1 && kind === 'json') {
    const path = await backupService.downloadText(cardService.cardToJsonText(cards[0]!.card), `${sanitizeFilename(cards[0]!.name)}.json`);
    message.success(path ? `已导出：${path}` : '已导出 JSON');
    return;
  }
  if (kind === 'png') {
    const noCover = cards.filter((c) => !dataUrlToBytes(c.cover)).map((c) => c.name);
    if (noCover.length) {
      message.warning(`这些卡没有封面，导出将使用占位底图：${noCover.slice(0, 5).join('、')}${noCover.length > 5 ? ' 等' : ''}（卡片操作菜单 → 设置封面）`);
    }
  }
  const zip = new JSZip();
  for (const c of cards) {
    if (kind === 'json') {
      zip.file(`${sanitizeFilename(c.name)}.json`, cardService.cardToJsonText(c.card));
    } else {
      // 有封面则用封面作底图（还原原导入图/自设封面），无封面用占位图
      const basePng = dataUrlToBytes(c.cover);
      const bytes = await cardService.cardToPngBytes(c.card, basePng);
      zip.file(`${sanitizeFilename(c.name)}.png`, bytes);
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const path = await backupService.downloadBlob(blob, backupService.timestampName('cards', 'zip'));
  message.success(`已导出 ${cards.length} 张卡（zip）${path ? `，保存到 ${path}` : ''}`);
}

async function trash(id: string) {
  await cardService.trashCard(id);
  await refresh();
  message.success('已移入回收站');
}

async function hardDelete(c: CardRow) {
  await cardService.hardDeleteCard(c.id);
  await refresh();
  message.success('已彻底删除');
}

async function restore(c: CardRow) {
  await cardService.restoreCard(c.id);
  await refresh();
  message.success('已恢复');
}
</script>

<template>
  <div class="lib-layout">
    <!-- 左侧分类树 -->
    <div class="lib-side">
      <div class="lib-side-head">
        <span style="font-weight: 700; font-size: 13px">分类</span>
        <NSpace :size="2">
          <NButton text size="tiny" @click="addCategory">＋新建</NButton>
          <NButton v-if="categoryFilter && categoryFilter !== 'none'" text size="tiny" type="error" @click="removeCategory">删除</NButton>
        </NSpace>
      </div>
      <NTree
        block-line expand-on-click
        :data="categoryTree"
        :selected-keys="categoryFilter ? [categoryFilter] : ['all']"
        @update:selected-keys="onCategorySelect"
      />
    </div>

    <!-- 右侧卡列表 -->
    <div class="lib-main">
      <NSpace align="center" :size="10" style="margin-bottom: 14px" wrap>
        <NInput v-model:value="keyword" placeholder="搜索卡名 / 标签 / 描述…" clearable style="width: 240px">
          <template #prefix><NIcon><SearchOutline /></NIcon></template>
        </NInput>
        <NSelect v-model:value="tagFilter" :options="allTags" placeholder="标签筛选" clearable style="width: 150px" size="small" />
        <NButton size="small" secondary @click="importCards" :loading="importing">
          <template #icon><NIcon><CloudUploadOutline /></NIcon></template>导入 PNG / JSON
        </NButton>
        <NButton size="small" secondary @click="exportSelected('json')">
          <template #icon><NIcon><DownloadOutline /></NIcon></template>导出 JSON
        </NButton>
        <NButton size="small" secondary @click="exportSelected('png')">导出 PNG</NButton>
        <NButton size="small" tertiary @click="compareSelected">
          <template #icon><NIcon><GitCompareOutline /></NIcon></template>对比
        </NButton>
        <NButton size="small" quaternary @click="refresh">
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
                  <NTag size="small" :bordered="false">{{ c.spec === 'chara_card_v3' ? 'V3' : c.spec === 'chara_card_v2' ? 'V2' : 'V1' }}</NTag>
                  <NTag v-if="c.categoryId && categories.find(x => x.id === c.categoryId)" size="small" round :bordered="false" type="warning">
                    {{ categories.find(x => x.id === c.categoryId)!.name }}
                  </NTag>
                  <span v-if="c.tokenStats" class="lib-card-tk">{{ c.tokenStats.total }} tk</span>
                  <span class="lib-card-date">{{ new Date(c.updatedAt).toLocaleDateString() }}</span>
                </div>
                <div class="lib-card-tags">
                  <NTag v-for="t in c.tags.slice(0, 4)" :key="t" size="small" round :bordered="false" type="info">{{ t }}</NTag>
                  <NTag v-if="c.tags.length > 4" size="small" round :bordered="false">+{{ c.tags.length - 4 }}</NTag>
                </div>
              </div>
            </div>
            <div class="lib-card-ops">
              <NDropdown :options="cardOps(c)" @select="(key: string) => onCardOp(key, c)">
                <NButton text size="tiny">操作 ▾</NButton>
              </NDropdown>
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
  </div>
</template>

<style scoped>
.lib-layout { display: flex; gap: 16px; align-items: flex-start; }
.lib-side {
  flex: none; width: 190px; border: 1px solid var(--tcs-border, rgba(255,255,255,.07)); border-radius: 12px;
  padding: 10px; background: var(--tcs-fill-soft, rgba(255,255,255,.02)); position: sticky; top: 0;
}
.lib-side-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.lib-main { flex: 1; min-width: 0; }
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.lib-card {
  background: var(--tcs-fill-soft, rgba(255, 255, 255, 0.028));
  border: 1px solid var(--tcs-border, rgba(255, 255, 255, 0.07));
  border-radius: 14px; padding: 12px 14px;
  transition: border-color .15s, transform .15s, box-shadow .15s;
}
.lib-card:hover { border-color: var(--tcs-accent-border, rgba(139, 92, 246, .55)); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.25); }
.lib-card-selected { border-color: var(--tcs-accent, #8b5cf6); background: var(--tcs-accent-soft, rgba(139, 92, 246, 0.07)); }
.lib-card-main { display: flex; gap: 12px; cursor: pointer; }
.lib-card-info { flex: 1; min-width: 0; }
.lib-card-name { font-weight: 700; font-size: 14px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lib-card-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: .8; margin-bottom: 6px; }
.lib-card-tk { font-variant-numeric: tabular-nums; }
.lib-card-date { margin-left: auto; }
.lib-card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.lib-card-ops { display: flex; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--tcs-border, rgba(255,255,255,.06)); align-items: center; }
</style>

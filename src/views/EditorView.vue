<script setup lang="ts">
/** 卡片编辑器：Tab 式全字段编辑 + 保存 + 版本管理 + 规格转换 + 本地撤销栈 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NSpace, NButton, NTabs, NTabPane, useMessage, NIcon, NPopconfirm, NModal,
  NTag, NSwitch, NTimeline, NTimelineItem, NInput, NEmpty, NSpin, NSelect,
} from 'naive-ui';
import { SaveOutline, ArrowBackOutline, GitBranchOutline, SparklesOutline, ArrowUndoOutline, ArrowRedoOutline } from '@vicons/ionicons5';
import type { AnyCard } from '@/core/card';
import { convertSpec, cardSpec } from '@/core/card';
import * as cardService from '@/services/cardService';
import { useWorkspace } from '@/stores/workspace';
import type { CardVersionRow } from '@/services/types';
import { countTokens } from '@/core/stats/tokens';
import { useCardHistory } from '@/composables/useCardHistory';
import { pickFiles } from '@/utils/file';
import { imageFileToCoverDataUrl } from '@/utils/image';
import CardCover from '@/components/CardCover.vue';
import BasicTab from './editor/BasicTab.vue';
import GreetingsTab from './editor/GreetingsTab.vue';
import WorldbookTab from './editor/WorldbookTab.vue';
import CharacterMembersTab from './editor/CharacterMembersTab.vue';
import RegexTab from './editor/RegexTab.vue';
import ScriptsTab from './editor/ScriptsTab.vue';
import ExtensionsTab from './editor/ExtensionsTab.vue';

const route = useRoute();
const router = useRouter();
const message = useMessage();
const ws = useWorkspace();

const id = computed(() => String(route.params.id));
const card = ref<AnyCard | null>(null);
const dirty = ref(false);
const saving = ref(false);
const showVersions = ref(false);
const versions = ref<CardVersionRow[]>([]);
const versionNote = ref('');

/* ---------------- 封面（CardRow.cover，不属卡 JSON，独立于 dirty/save 流程） ---------------- */

const cover = ref<string | null>(null);
const coverBusy = ref(false);

async function changeCover() {
  const files = await pickFiles('image/png,image/jpeg,image/webp', false);
  if (!files.length) return;
  coverBusy.value = true;
  try {
    const dataUrl = await imageFileToCoverDataUrl(files[0]!);
    await cardService.updateCardPatch(id.value, { cover: dataUrl });
    cover.value = dataUrl;
    await ws.refreshCards(true);
    message.success('封面已更新（导出 PNG 时将作为底图）');
  } catch (e) {
    message.error(`封面设置失败：${(e as Error).message}`);
  } finally {
    coverBusy.value = false;
  }
}

async function removeCover() {
  coverBusy.value = true;
  try {
    await cardService.updateCardPatch(id.value, { cover: null });
    cover.value = null;
    await ws.refreshCards(true);
    message.success('封面已移除，导出 PNG 将使用占位图');
  } catch (e) {
    message.error(`封面移除失败：${(e as Error).message}`);
  } finally {
    coverBusy.value = false;
  }
}

/* ---------------- 本地撤销/重做（优化文档 P0-2） ---------------- */

const history = useCardHistory<AnyCard>({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '' } as never });

function markDirty() {
  dirty.value = true;
  if (card.value) history.commit(card.value);
}

function applyRestored(v: AnyCard) {
  card.value = v;
  dirty.value = true;
}

function undo() {
  const v = history.undo();
  if (v) {
    applyRestored(v);
    message.info('已撤销');
  }
}

function redo() {
  const v = history.redo();
  if (v) {
    applyRestored(v);
    message.info('已重做');
  }
}

async function loadCard() {
  const row = await cardService.getCard(id.value);
  if (!row) {
    message.error('卡片不存在');
    router.replace('/library');
    return;
  }
  card.value = JSON.parse(JSON.stringify(row.card)) as AnyCard;
  cover.value = row.cover ?? null;
  dirty.value = false;
  history.reset(card.value);
  history.bindHotkeys(window, applyRestored);
}

onMounted(loadCard);

// 路由 id 变化时组件会被复用（如命令面板里「新建角色卡」），必须重载，否则保存会写错卡
watch(id, (next, prev) => {
  if (next === prev) return;
  if (card.value && dirty.value) message.warning('上一张卡的未保存修改已丢弃（可用版本历史找回）');
  void loadCard();
});

onBeforeUnmount(() => history.unbindHotkeys());

// Ctrl+S 保存
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (dirty.value) void save();
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

async function save() {
  if (!card.value) return;
  saving.value = true;
  try {
    await cardService.saveCard(id.value, card.value, { note: versionNote.value || undefined, keepCover: true });
    dirty.value = false;
    versionNote.value = '';
    if (card.value) history.reset(card.value);
    await ws.refreshCards(true);
    message.success('已保存（自动存版本快照）');
  } catch (e) {
    message.error(`保存失败：${(e as Error).message}`);
  } finally {
    saving.value = false;
  }
}

const totalTokens = computed(() => {
  if (!card.value) return 0;
  const d = card.value.data as Record<string, unknown>;
  const parts = [
    'description', 'personality', 'scenario', 'first_mes', 'mes_example',
    'system_prompt', 'post_history_instructions',
  ].map((k) => String(d[k] ?? ''));
  for (const g of ((d.alternate_greetings as string[] | undefined) ?? [])) parts.push(g);
  for (const e of (((d.character_book as { entries?: { content?: string }[] } | undefined)?.entries) ?? [])) parts.push(e.content ?? '');
  return parts.reduce((acc, t) => acc + countTokens(t).total, 0);
});

const specLabel = computed(() => (card.value ? { v1: 'V1', v2: 'V2', v3: 'V3' }[cardSpec(card.value)] : ''));

async function switchSpec(target: 'v2' | 'v3') {
  if (!card.value) return;
  card.value = convertSpec(card.value, target);
  markDirty();
  message.success(`已转换为 ${target.toUpperCase()}（保存后生效）`);
}

async function openVersions() {
  versions.value = await cardService.listVersions(id.value);
  showVersions.value = true;
}

const versionDiffs = ref<cardService.FieldDiff[]>([]);

function previewDiff(v: CardVersionRow) {
  if (!card.value) return;
  versionDiffs.value = cardService.diffCards(v.card, card.value);
}

async function rollback(v: CardVersionRow) {
  await cardService.rollbackToVersion(id.value, v.id);
  const row = await cardService.getCard(id.value);
  card.value = JSON.parse(JSON.stringify(row!.card)) as AnyCard;
  dirty.value = false;
  showVersions.value = false;
  versions.value = await cardService.listVersions(id.value);
  message.success(`已回滚到 v${v.versionNo}`);
}
</script>

<template>
  <NSpin v-if="!card" style="min-height: 200px" />
  <div v-else class="editor-root">
    <div class="editor-header">
      <NSpace align="center" :size="10">
        <NButton size="small" quaternary @click="router.push('/library')">
          <template #icon><NIcon><ArrowBackOutline /></NIcon></template>
        </NButton>
        <!-- 封面：点击即选图更换；悬停提示操作 -->
        <div class="cover-wrap" :title="cover ? '点击更换封面' : '点击设置封面'">
          <button class="cover-btn" :disabled="coverBusy" @click="changeCover">
            <CardCover :src="cover" :name="card.data.name || '?'" :size="44" />
          </button>
          <NButton v-if="cover" size="tiny" quaternary type="error" class="cover-remove" :disabled="coverBusy"
            title="移除封面（导出 PNG 将用占位图）" @click="removeCover">×</NButton>
        </div>
        <span class="editor-title">{{ card.data.name || '未命名' }}</span>
        <NTag size="small" round :bordered="false" type="info">{{ specLabel }}</NTag>
        <NTag size="small" round :bordered="false">{{ totalTokens }} tk（全文）</NTag>
        <NTag v-if="dirty" size="small" round type="warning" :bordered="false">未保存</NTag>
      </NSpace>
      <NSpace align="center" :size="8">
        <NSelect
          :value="card.spec === 'chara_card_v3' ? 'v3' : card.spec === 'chara_card_v2' ? 'v2' : 'v3'"
          :options="[{ label: '转 V2', value: 'v2' }, { label: '转 V3', value: 'v3' }]"
          size="tiny" style="width: 90px"
          @update:value="switchSpec"
        />
        <NButton size="small" secondary :disabled="!history.canUndo.value" @click="undo">
          <template #icon><NIcon><ArrowUndoOutline /></NIcon></template>撤销
        </NButton>
        <NButton size="small" secondary :disabled="!history.canRedo.value" @click="redo">
          <template #icon><NIcon><ArrowRedoOutline /></NIcon></template>重做
        </NButton>
        <NButton size="small" secondary @click="openVersions">
          <template #icon><NIcon><GitBranchOutline /></NIcon></template>版本
        </NButton>
        <NButton size="small" type="primary" :loading="saving" :disabled="!dirty" @click="save">
          <template #icon><NIcon><SaveOutline /></NIcon></template>保存
        </NButton>
      </NSpace>
    </div>

    <NTabs type="line" animated default-value="basic" style="margin-top: 4px">
      <NTabPane name="basic" tab="基础信息">
        <BasicTab :card="card" @change="markDirty" />
      </NTabPane>
      <NTabPane name="greetings" tab="描述与开场白">
        <GreetingsTab :card="card" @change="markDirty" />
      </NTabPane>
      <NTabPane name="worldbook" tab="世界书">
        <WorldbookTab :card="card" @change="markDirty" />
      </NTabPane>
      <NTabPane name="members" tab="角色成员">
        <CharacterMembersTab :card="card" @change="markDirty" />
      </NTabPane>
      <NTabPane name="regex" tab="正则">
        <RegexTab :card="card" @change="markDirty" />
      </NTabPane>
      <NTabPane name="scripts" tab="脚本">
        <ScriptsTab :card="card" @change="markDirty" />
      </NTabPane>
      <NTabPane name="extensions" tab="扩展">
        <ExtensionsTab :card="card" @change="markDirty" />
      </NTabPane>
    </NTabs>

    <NModal v-model:show="showVersions" preset="card" title="版本历史" style="width: 640px">
      <NSpace vertical :size="10">
        <NInput v-model:value="versionNote" size="small" placeholder="下次保存的版本备注（可选）" />
        <NEmpty v-if="!versions.length" description="还没有版本" />
        <NTimeline v-else>
          <NTimelineItem v-for="v in versions" :key="v.id" :title="`v${v.versionNo} · ${v.note}`" :time="new Date(v.createdAt).toLocaleString()">
            <NSpace :size="6">
              <NButton size="tiny" @click="previewDiff(v)">对比当前</NButton>
              <NPopconfirm @positive-click="rollback(v)">
                <template #trigger><NButton size="tiny" type="warning">回滚到此版</NButton></template>
                当前未保存修改将丢弃，确认？
              </NPopconfirm>
            </NSpace>
          </NTimelineItem>
        </NTimeline>
        <div v-if="versionDiffs.length" class="version-diff">
          <div v-for="(d, i) in versionDiffs" :key="i" class="version-diff-row">
            <b>{{ d.field }}</b>（{{ d.kind }}）：<span class="diff-before">{{ (d.before || '∅').slice(0, 120) }}</span>
            → <span class="diff-after">{{ (d.after || '∅').slice(0, 120) }}</span>
          </div>
        </div>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.editor-root { max-width: 1080px; margin: 0 auto; }
.editor-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.editor-title { font-size: 16px; font-weight: 800; }
.cover-wrap { position: relative; display: inline-flex; }
.cover-btn {
  padding: 0; border: 1px solid var(--tcs-border, rgba(255,255,255,.12)); border-radius: 10px;
  background: transparent; cursor: pointer; overflow: hidden; line-height: 0;
  transition: border-color .15s;
}
.cover-btn:hover { border-color: var(--tcs-accent, #8b5cf6); }
.cover-btn:disabled { opacity: .6; cursor: wait; }
.cover-remove {
  position: absolute; top: -6px; right: -6px; z-index: 1;
  height: 18px; width: 18px; padding: 0; font-size: 14px; line-height: 18px;
  background: var(--tcs-surface, #1a1a22); border: 1px solid var(--tcs-border, rgba(255,255,255,.15));
}
.version-diff { max-height: 260px; overflow: auto; border-top: 1px dashed var(--tcs-border, rgba(255,255,255,.1)); padding-top: 8px; }
.version-diff-row { font-size: 12px; margin-bottom: 6px; line-height: 1.5; }
.diff-before { color: var(--tcs-bad, #f87171); }
.diff-after { color: var(--tcs-good, #4ade80); }
</style>

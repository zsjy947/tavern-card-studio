<script setup lang="ts">
/**
 * 角色成员 Tab（多人卡）：启发式识别 character_book.entries 中的角色条目，
 * 提供结构化编辑（名称/主角或配角/触发词/YAML 内容），直接写回条目本体。
 * 识别不出的条目不展示（世界书 Tab 继续管理）。
 */
import { computed } from 'vue';
import { NForm, NFormItem, NInput, NDynamicTags, NSpace, NTag, NRadioGroup, NRadioButton, NText, NEmpty } from 'naive-ui';
import type { AnyCard, BookEntry } from '@/core/card';
import TokenBadge from '@/components/TokenBadge.vue';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ (e: 'change'): void }>();

const data = computed(() => props.card.data as Record<string, unknown>);
const book = computed(() => (data.value.character_book ?? { entries: [] }) as { entries: BookEntry[] });

/**
 * 角色条目启发式（参照现代中文社区多人卡惯例：成员设定进世界书 YAML 结构条目）：
 * ① 内容含 YAML 的 name/姓名 字段；② 主角式常驻条目（constant 蓝灯 + 无触发词 + 有分行内容）
 */
function isCharacterEntry(e: BookEntry): boolean {
  if (/(^|\n)\s*(name|姓名)\s*:/.test(e.content ?? '')) return true;
  return Boolean(e.constant && (e.keys?.length ?? 0) === 0 && e.comment && (e.content ?? '').includes('\n'));
}

/** 索引 → 条目（保持与 character_book.entries 的引用关系，直接写回本体） */
const members = computed(() => book.value.entries
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => isCharacterEntry(entry)));

function entryName(e: BookEntry): string {
  const m = /(?:^|\n)\s*(?:name|姓名)\s*:\s*(.+)/.exec(e.content ?? '');
  return (m?.[1] ?? e.comment ?? '').trim();
}

function patchEntry(index: number, p: Partial<BookEntry>) {
  const e = book.value.entries[index];
  if (!e) return;
  Object.assign(e, p);
  emit('change');
}

/** 名称改动同步：comment 与 YAML name 行一起变（保持条目可被再次识别） */
function renameMember(index: number, name: string) {
  const e = book.value.entries[index];
  if (!e) return;
  e.comment = name;
  if (/(^|\n)\s*(name|姓名)\s*:/.test(e.content ?? '')) {
    e.content = (e.content ?? '').replace(/(^|\n)(\s*)(name|姓名)(\s*):[^\n]*/, (_m, nl, sp) => `${nl}${sp}name: ${name}`);
  }
  emit('change');
}

function setRole(index: number, role: 'lead' | 'support') {
  const e = book.value.entries[index];
  if (!e) return;
  if (role === 'lead') {
    // 保留 keys：切回配角时不丢用户配置的触发词（constant 下 keys 不生效，无副作用）
    patchEntry(index, { constant: true });
  } else {
    const name = entryName(e) || e.comment || '';
    const merged = [...new Set([name, ...(e.keys ?? [])])].filter(Boolean);
    patchEntry(index, { constant: false, keys: merged });
  }
}

function memberRole(e: BookEntry): 'lead' | 'support' {
  return e.constant ? 'lead' : 'support';
}
</script>

<template>
  <div class="members-root">
    <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 12px">
      多人卡心智：每个成员一条世界书条目——主角 constant 常驻注入，配角按称呼关键词触发。
      此处只列出可识别为角色的条目，其余设定条目请到「世界书」页管理；改动后记得保存。
    </NText>

    <NEmpty v-if="!members.length" description="未在世界书中识别到角色条目（条目内容需含 YAML 的 name 字段，或为常驻无触发词的成员条目）" />

    <div v-for="{ entry, index } in members" :key="index" class="member-card">
      <NSpace :size="10" align="center" wrap style="margin-bottom: 8px">
        <NTag size="small" :bordered="false" :type="memberRole(entry) === 'lead' ? 'success' : 'info'">
          {{ memberRole(entry) === 'lead' ? '主角 · 常驻' : '配角 · 触发' }}
        </NTag>
        <NTag size="tiny" :bordered="false">条目 #{{ index }}</NTag>
        <TokenBadge :text="entry.content ?? ''" :warn-at="1200" style="margin-left: auto" />
      </NSpace>

      <NForm label-placement="left" label-width="86" size="small">
        <NFormItem label="成员名称">
          <NInput :value="entryName(entry) || entry.comment" @update:value="(v: string) => renameMember(index, v)" />
        </NFormItem>
        <NFormItem label="角色定位">
          <NRadioGroup :value="memberRole(entry)" size="small" @update:value="(v: 'lead' | 'support') => setRole(index, v)">
            <NRadioButton value="lead">主角（constant 常驻）</NRadioButton>
            <NRadioButton value="support">配角（触发词）</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem v-if="memberRole(entry) === 'support'" label="触发称呼">
          <NDynamicTags :value="entry.keys ?? []" @update:value="(v: string[]) => patchEntry(index, { keys: v })" />
        </NFormItem>
        <NFormItem label="条目内容">
          <NInput type="textarea" :rows="8" :value="entry.content ?? ''" @update:value="(v: string) => patchEntry(index, { content: v })" />
        </NFormItem>
      </NForm>
    </div>
  </div>
</template>

<style scoped>
.members-root { max-width: 860px; }
.member-card {
  border: 1px solid var(--tcs-border, rgba(255,255,255,.08)); border-radius: 12px;
  padding: 14px 16px; margin-bottom: 14px;
}
</style>

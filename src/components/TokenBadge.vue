<script setup lang="ts">
import { computed } from 'vue';
import { NTooltip, NTag } from 'naive-ui';
import { countTokens } from '@/core/stats/tokens';

const props = defineProps<{ text: string; label?: string; warnAt?: number }>();

const stats = computed(() => countTokens(props.text ?? ''));
const level = computed(() => {
  const warn = props.warnAt ?? 1500;
  if (stats.value.total > warn * 1.5) return 'error';
  if (stats.value.total > warn) return 'warning';
  return 'default';
});
</script>

<template>
  <NTooltip trigger="hover">
    <template #trigger>
      <NTag size="small" :type="level" :bordered="false" round style="font-variant-numeric: tabular-nums">
        {{ label ? `${label} · ` : '' }}{{ stats.total }} tk / {{ stats.chars }} 字
      </NTag>
    </template>
    分类：spec {{ stats.spec }} · 词边界 {{ stats.wb }} · 其他 {{ stats.other }}（cl100k）
  </NTooltip>
</template>

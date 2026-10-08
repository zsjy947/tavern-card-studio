<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NTooltip, NTag } from 'naive-ui';
import { countTokens, warmUpEncoder } from '@/core/stats/tokens';

const props = defineProps<{
  text: string;
  label?: string;
  warnAt?: number;
  /** 外部已算好的总 token：跳过二次 BPE 编码（逐段徽标场景编码是主渲染成本） */
  tokens?: number;
}>();

/** 编码器就绪后自增：computed 依赖它以重算为精确值（无感替换粗估） */
const readyTick = ref(0);
onMounted(() => {
  void warmUpEncoder()
    .then(() => (readyTick.value += 1))
    .catch(() => undefined);
});

interface Stats {
  total: number;
  chars: number;
  spec?: number;
  wb?: number;
  other?: number;
  estimated?: boolean;
}

const stats = computed<Stats>(() => {
  void readyTick.value;
  if (props.tokens != null) return { total: props.tokens, chars: (props.text ?? '').length };
  return countTokens(props.text ?? '');
});
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
        {{ stats.estimated ? '~' : '' }}{{ label ? `${label} · ` : '' }}{{ stats.total }} tk / {{ stats.chars }} 字
      </NTag>
    </template>
    <template v-if="stats.spec != null">分类：spec {{ stats.spec }} · 词边界 {{ stats.wb }} · 其他 {{ stats.other }}（cl100k{{ stats.estimated ? '，词表加载中：粗估' : '' }}）</template>
    <template v-else>token 取自组装器计数（免二次编码），共 {{ stats.chars }} 字</template>
  </NTooltip>
</template>

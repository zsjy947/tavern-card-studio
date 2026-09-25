<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = defineProps<{ src?: string | null; name: string; size?: number }>();

const initial = computed(() => (props.name || '?').trim().slice(0, 1) || '?');
const hue = computed(() => {
  let h = 0;
  for (const ch of props.name ?? '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
});
const broken = ref(false);
watch(() => props.src, () => (broken.value = false));
</script>

<template>
  <div class="card-cover" :style="{ width: (size ?? 64) + 'px', height: (size ?? 64) + 'px' }">
    <img v-if="src && !broken" :src="src" :alt="name" @error="broken = true" />
    <div v-else class="card-cover-fallback" :style="{ background: `linear-gradient(135deg, hsl(${hue},45%,32%), hsl(${(hue + 60) % 360},45%,22%))` }">
      {{ initial }}
    </div>
  </div>
</template>

<style scoped>
.card-cover { border-radius: 10px; overflow: hidden; flex: none; background: var(--tcs-cover-bg, #1a1a22); }
.card-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card-cover-fallback {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 800; color: rgba(255, 255, 255, 0.85);
  letter-spacing: 1px;
}
</style>

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CardRow, AiChannelRow } from '@/services/types';
import * as cardService from '@/services/cardService';
import * as aiService from '@/services/aiService';
import { getSetting, SETTING_KEYS } from '@/services/appSettings';

/** 全局工作区状态：卡列表 / 渠道 / 当前用户偏好 */
export const useWorkspace = defineStore('workspace', () => {
  const cards = ref<CardRow[]>([]);
  const channels = ref<AiChannelRow[]>([]);
  const cardsLoading = ref(false);
  const userName = ref('User');

  // 启动时恢复持久化偏好（设置页可改）
  void getSetting(SETTING_KEYS.uiUserName, 'User').then((v) => (userName.value = v));

  async function refreshCards(includeDeleted = false) {
    cardsLoading.value = true;
    try {
      cards.value = await cardService.listCards(includeDeleted);
    } finally {
      cardsLoading.value = false;
    }
  }

  async function refreshChannels() {
    channels.value = await aiService.listChannels();
  }

  function activeChannel(kind: 'text' | 'image'): AiChannelRow | undefined {
    return channels.value.find((c) => c.kind === kind && c.isActive) ?? channels.value.find((c) => c.kind === kind);
  }

  return { cards, channels, cardsLoading, userName, refreshCards, refreshChannels, activeChannel };
});

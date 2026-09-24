<script setup lang="ts">
/** 转换工具：PNG→JSON、JSON→PNG、批量 zip、完整性校验报告 */
import { ref } from 'vue';
import {
  NSpace, NButton, NRadioGroup, NRadioButton, NInput, NTag, useMessage, NIcon, NCollapse, NCollapseItem, NList, NListItem, NText,
} from 'naive-ui';
import { ImageOutline, DocumentTextOutline, SwapHorizontalOutline } from '@vicons/ionicons5';
import * as cardService from '@/services/cardService';
import { parseLooseCard } from '@/core/card';
import { extractCardFromPng, injectCardIntoPng, makePlaceholderPng } from '@/core/png';
import { runStaticChecks } from '@/core/diag/staticChecks';
import { downloadText, downloadBlob, timestampName } from '@/services/backupService';
import { pickJsonFiles, pickPngFiles, sanitizeFilename } from '@/utils/file';
import JSZip from 'jszip';

const message = useMessage();
const mode = ref<'png2json' | 'json2png'>('png2json');
const dualWrite = ref(true);
const report = ref<{ name: string; ok: boolean; detail: string }[]>([]);
const busy = ref(false);
const lastJsonPreview = ref('');

async function convertPngToJson() {
  const files = await pickPngFiles(true);
  if (!files.length) return;
  busy.value = true;
  report.value = [];
  const zip = new JSZip();
  let okCount = 0;
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const { raw } = extractCardFromPng(bytes);
      const card = parseLooseCard(raw);
      const json = JSON.stringify(card, null, 2);
      lastJsonPreview.value = json.slice(0, 2000);
      const out = `${sanitizeFilename(f.name.replace(/\.png$/i, ''))}.json`;
      if (files.length === 1) {
        downloadText(json, out);
      } else {
        zip.file(out, json);
      }
      const issues = runStaticChecks(card);
      const errors = issues.filter((i) => i.severity === 'error').length;
      // 明细直接进报告，避免只报「N 个错误」却看不到错在哪
      const details = issues.slice(0, 4).map((i) => `${i.severity === 'error' ? '✗' : i.severity === 'warn' ? '⚠' : 'ℹ'} ${i.field}：${i.message}`);
      report.value.push({
        name: f.name,
        ok: errors === 0,
        detail: `${card.data.name} · ${card.spec === 'chara_card_v3' ? 'V3' : card.spec === 'chara_card_v2' ? 'V2' : 'V1'} · ${errors ? `${errors} 个错误` : '校验通过'}${issues.length ? `（${issues.length} 项）` : ''}${details.length ? '\n' + details.join('\n') : ''}`,
      });
      okCount++;
    } catch (e) {
      report.value.push({ name: f.name, ok: false, detail: (e as Error).message });
    }
  }
  if (files.length > 1 && okCount) {
    downloadBlob(await zip.generateAsync({ type: 'blob' }), timestampName('png2json', 'zip'));
  }
  busy.value = false;
  message.success(`转换完成 ${okCount}/${files.length}`);
}

/** JSON→PNG：支持先选卡后选底图，或无底图占位 */
async function convertJsonToPng() {
  const files = await pickJsonFiles(true);
  if (!files.length) return;
  busy.value = true;
  report.value = [];
  let basePng: Uint8Array | null = null;
  const baseFiles = await pickPngFiles();
  if (baseFiles.length) {
    basePng = new Uint8Array(await baseFiles[0]!.arrayBuffer());
  }
  const zip = new JSZip();
  let okCount = 0;
  for (const f of files) {
    try {
      const text = await f.text();
      const card = parseLooseCard(JSON.parse(text));
      const png = await cardService.cardToPngBytes(card, basePng, { dualWrite: dualWrite.value });
      const out = `${sanitizeFilename(card.data.name || f.name.replace(/\.json$/i, ''))}.png`;
      if (files.length === 1 && !baseFiles.length) {
        // 单文件也走 zip 太绕，直接下载 png
        downloadBlob(new Blob([png as BlobPart], { type: 'image/png' }), out);
      } else {
        zip.file(out, png);
      }
      report.value.push({ name: f.name, ok: true, detail: `${card.data.name} → ${out}${basePng ? '（指定底图）' : '（占位底图）'}` });
      okCount++;
    } catch (e) {
      report.value.push({ name: f.name, ok: false, detail: (e as Error).message });
    }
  }
  if (files.length > 1 && okCount) {
    downloadBlob(await zip.generateAsync({ type: 'blob' }), timestampName('json2png', 'zip'));
  }
  busy.value = false;
  message.success(`转换完成 ${okCount}/${files.length}`);
}

function run() {
  if (mode.value === 'png2json') void convertPngToJson();
  else void convertJsonToPng();
}
</script>

<template>
  <div class="converter">
    <NSpace vertical :size="16" style="max-width: 880px">
      <div class="converter-card">
        <NRadioGroup v-model:value="mode" size="small">
          <NRadioButton value="png2json">
            <template #default><NIcon style="vertical-align: -3px"><ImageOutline /></NIcon>&nbsp;PNG → JSON</template>
          </NRadioButton>
          <NRadioButton value="json2png">
            <template #default><NIcon style="vertical-align: -3px"><DocumentTextOutline /></NIcon>&nbsp;JSON → PNG</template>
          </NRadioButton>
        </NRadioGroup>

        <NText depth="3" style="font-size: 13px; display: block; margin: 12px 0">
          <template v-if="mode === 'png2json'">
            读取 PNG 卡内 tEXt 元数据（优先 ccv3，回退 chara），归一化后导出 JSON。多文件自动打包 zip，附完整性校验报告。
          </template>
          <template v-else>
            把卡 JSON 嵌入 PNG 底图 tEXt 块。先选 JSON（可多选），再可选一张底图；不选底图时使用占位图。
          </template>
        </NText>

        <NSpace :size="10" align="center">
          <NButton type="primary" :loading="busy" @click="run">
            <template #icon><NIcon><SwapHorizontalOutline /></NIcon></template>
            {{ mode === 'png2json' ? '选择 PNG 并转换' : '选择 JSON 并转换' }}
          </NButton>
          <NTag v-if="mode === 'json2png'" size="small" round :bordered="false" :type="dualWrite ? 'success' : 'warning'" style="cursor: pointer" @click="dualWrite = !dualWrite">
            {{ dualWrite ? '双写 ccv3 + chara（推荐）' : '仅写 chara（兼容模式）' }}
          </NTag>
        </NSpace>
      </div>

      <NCollapse v-if="report.length">
        <NCollapseItem title="转换报告" name="report">
          <NList bordered size="small">
            <NListItem v-for="(r, i) in report" :key="i">
              <NSpace :size="8" align="center">
                <NTag size="small" :bordered="false" :type="r.ok ? 'success' : 'error'">{{ r.ok ? 'OK' : '失败' }}</NTag>
                <b style="font-size: 13px">{{ r.name }}</b>
                <NText depth="3" style="font-size: 12px; white-space: pre-line; line-height: 1.6">{{ r.detail }}</NText>
              </NSpace>
            </NListItem>
          </NList>
        </NCollapseItem>
      </NCollapse>

      <NCollapse v-if="lastJsonPreview">
        <NCollapseItem title="最后一次转换结果预览" name="preview">
          <NInput type="textarea" :value="lastJsonPreview" :rows="10" readonly />
        </NCollapseItem>
      </NCollapse>

      <NCollapse>
        <NCollapseItem title="格式说明（与 SillyTavern 对齐）" name="help">
          <NText depth="3" style="font-size: 13px; line-height: 1.8">
            <p>· ST 读取顺序：优先 tEXt/ccv3（V3），回退 tEXt/chara（V2/V1），base64 → UTF-8 JSON</p>
            <p>· 本工具导出默认双写 ccv3 + chara，保证新旧前端都能识别</p>
            <p>· 导入自动做 V1/V2/V3 归一化（data 块展开、tags 兼容、顶层冗余字段补齐）</p>
          </NText>
        </NCollapseItem>
      </NCollapse>
    </NSpace>
  </div>
</template>

<style scoped>
.converter-card {
  background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px; padding: 18px 20px;
}
</style>

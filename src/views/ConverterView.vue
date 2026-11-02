<script setup lang="ts">
/** 转换工具：PNG→JSON、JSON→PNG、批量 zip、完整性校验报告、最近转换记录（P1-4）、批量断点续跑（§三.4） */
import { onMounted, ref } from 'vue';
import {
  NSpace, NButton, NRadioGroup, NRadioButton, NInput, NTag, useMessage, NIcon, NCollapse, NCollapseItem, NList, NListItem, NText, NTooltip, NEmpty, NSwitch, NProgress, NAlert,
} from 'naive-ui';
import { ImageOutline, DocumentTextOutline, SwapHorizontalOutline, DownloadOutline } from '@vicons/ionicons5';
import * as cardService from '@/services/cardService';
import { parseLooseCard } from '@/core/card';
import { extractCardFromPng, injectCardIntoPng, makePlaceholderPng } from '@/core/png';
import { runStaticChecks } from '@/core/diag/staticChecks';
import { downloadText, downloadBlob, timestampName } from '@/services/backupService';
import { pickJsonFiles, pickPngFiles, sanitizeFilename } from '@/utils/file';
import { listRecentConversions, listBatchRuns, recordConversion, recordBatchRun, reDownloadConversion, getProduct } from '@/services/converterService';
import { bytesHash, formatBytes, type RecentConversion, type BatchRun } from '@/core/converter/recent';
import { genId } from '@/db';
import JSZip from 'jszip';

const message = useMessage();
const mode = ref<'png2json' | 'json2png'>('png2json');
const dualWrite = ref(true);
interface ReportRow { name: string; ok: boolean; detail: string; file?: File }
const report = ref<ReportRow[]>([]);
const busy = ref(false);
const lastJsonPreview = ref('');
const recent = ref<RecentConversion[]>([]);
const progress = ref<{ done: number; total: number } | null>(null);
/** 上次未完成批量（断点续跑）：该批已成功记录按 文件名:源指纹 索引 */
const resume = ref<{ run: BatchRun; done: Map<string, RecentConversion>; okCount: number } | null>(null);
// 底图显式选择：不再在选完 JSON 后隐藏式串行弹第二个对话框
const basePngName = ref('');
const basePngBytes = ref<Uint8Array | null>(null);

onMounted(async () => {
  const [recents, runs] = await Promise.all([
    listRecentConversions().catch(() => [] as RecentConversion[]),
    listBatchRuns().catch(() => [] as BatchRun[]),
  ]);
  recent.value = recents;
  // 中断检测：finishedAt 缺失 = 上次批量没跑完（关窗/刷新/切页杀掉循环）
  const unfinished = runs.find((r) => !r.finishedAt);
  if (unfinished) {
    const done = new Map(
      recents
        .filter((r) => r.batchId === unfinished.id && r.status !== 'failed')
        .map((r) => [`${r.fileName}:${r.sourceHash ?? ''}`, r] as const),
    );
    resume.value = { run: unfinished, done, okCount: done.size };
  }
});

async function reDownload(entry: RecentConversion) {
  try {
    const path = await reDownloadConversion(entry);
    message.success(path ? `已重新保存：${path}` : `已重新下载 ${entry.outputName}`);
  } catch (e) {
    message.warning((e as Error).message);
  }
}

/* ---------------- 批量断点续跑（§三.4） ---------------- */

/** 批量开始：登记 BatchRun（单文件转换不建批）；返回 run 供批末补 finishedAt */
async function beginBatch(direction: 'png2json' | 'json2png', total: number): Promise<BatchRun | null> {
  if (total <= 1) return null;
  const run: BatchRun = { id: genId('batch'), direction, total, startedAt: new Date().toISOString() };
  await recordBatchRun(run).catch(() => undefined);
  return run;
}

/** 批量收尾：补 finishedAt（无论成败——失败文件已按 status:failed 留痕） */
async function finishBatch(run: BatchRun | null, zipPath: string | null) {
  if (!run) return;
  await recordBatchRun({ ...run, finishedAt: new Date().toISOString(), zipPath }).catch(() => undefined);
}

/** 同方向重跑时按 文件名:源指纹 跳过该批已成功文件（一次性消费） */
function takeResumeDone(direction: 'png2json' | 'json2png'): Map<string, RecentConversion> | null {
  const done = resume.value?.run.direction === direction ? resume.value.done : null;
  resume.value = null;
  return done;
}

/** 已完成文件的续跑处理：产物还在缓存则回填 zip，否则只报告跳过 */
async function skipDone(prev: RecentConversion, zip: JSZip, doneSet: Set<string>): Promise<void> {
  doneSet.add(prev.fileName);
  const product = getProduct(prev.id);
  if (product) zip.file(prev.outputName, product.bytes);
  report.value.push({
    name: prev.fileName,
    ok: true,
    detail: product ? '已完成（跳过重复转换，产物已回填 zip）' : '已完成（跳过重复转换；产物未保留，未入本次 zip）',
  });
}

async function chooseBasePng() {
  const files = await pickPngFiles();
  if (!files.length) return;
  basePngBytes.value = new Uint8Array(await files[0]!.arrayBuffer());
  basePngName.value = files[0]!.name;
}

function clearBasePng() {
  basePngBytes.value = null;
  basePngName.value = '';
}

async function convertPngToJson() {
  const files = await pickPngFiles(true);
  if (!files.length) return;
  await runPng2Json(files);
}

async function runPng2Json(files: File[]) {
  busy.value = true;
  report.value = [];
  const zip = new JSZip();
  const done = takeResumeDone('png2json');
  const doneNames = new Set<string>();
  let okCount = 0;
  let converted = 0;
  let savedPath: string | null = null;
  const run = await beginBatch('png2json', files.length);
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      progress.value = { done: i + 1, total: files.length };
      let hash = '';
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        hash = bytesHash(bytes);
        const prev = done?.get(`${f.name}:${hash}`);
        if (prev) {
          await skipDone(prev, zip, doneNames);
          okCount++;
          continue;
        }
        const { raw } = extractCardFromPng(bytes);
        const card = parseLooseCard(raw);
        const json = JSON.stringify(card, null, 2);
        lastJsonPreview.value = json.slice(0, 2000);
        const out = `${sanitizeFilename(f.name.replace(/\.png$/i, ''))}.json`;
        if (files.length === 1) {
          savedPath = await downloadText(json, out);
        } else {
          zip.file(out, json);
        }
        await recordConversion({
          direction: 'png2json',
          fileName: f.name,
          cardName: String(card.data.name ?? ''),
          spec: card.spec,
          outputName: out,
          bytes: new TextEncoder().encode(json),
          mime: 'application/json',
          savedPath,
          batchId: run?.id,
          status: 'ok',
          sourceHash: hash,
        }).catch(() => undefined);
        const issues = runStaticChecks(card);
        const errors = issues.filter((i) => i.severity === 'error').length;
        // 明细直接进报告，避免只报「N 个错误」却看不到错在哪
        const details = issues.slice(0, 4).map((i) => `${i.severity === 'error' ? '✗' : i.severity === 'warn' ? '⚠' : 'ℹ'} ${i.field}：${i.message}`);
        report.value.push({
          name: f.name,
          ok: errors === 0,
          detail: `${card.data.name} · ${card.spec === 'chara_card_v3' ? 'V3' : card.spec === 'chara_card_v2' ? 'V2' : 'V1'} · ${errors ? `${errors} 个错误` : '校验通过'}${issues.length ? `（${issues.length} 项）` : ''}${details.length ? '\n' + details.join('\n') : ''}`,
          file: f,
        });
        okCount++;
        converted++;
      } catch (e) {
        // 失败也留痕：断点续跑时不跳过，可在报告里单条重试
        await recordConversion({
          direction: 'png2json',
          fileName: f.name,
          cardName: '',
          spec: '',
          outputName: '',
          batchId: run?.id,
          status: 'failed',
          error: (e as Error).message,
          sourceHash: hash || undefined,
        }).catch(() => undefined);
        report.value.push({ name: f.name, ok: false, detail: (e as Error).message, file: f });
      }
    }
    if (files.length > 1 && okCount) {
      savedPath = await downloadBlob(await zip.generateAsync({ type: 'blob' }), timestampName('png2json', 'zip'));
    }
    await finishBatch(run, savedPath);
    recent.value = await listRecentConversions().catch(() => recent.value);
    message.success(`转换完成 ${converted + doneNames.size}/${files.length}${doneNames.size ? `（续跑跳过已完成 ${doneNames.size}）` : ''}${savedPath ? `，已保存到 ${savedPath}` : ''}`);
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

/** JSON→PNG：底图由面板显式选择（或占位图），不再隐藏式串行弹窗 */
async function convertJsonToPng() {
  const files = await pickJsonFiles(true);
  if (!files.length) return;
  await runJson2Png(files);
}

async function runJson2Png(files: File[]) {
  busy.value = true;
  report.value = [];
  const basePng = basePngBytes.value;
  const zip = new JSZip();
  const done = takeResumeDone('json2png');
  const doneNames = new Set<string>();
  let okCount = 0;
  let converted = 0;
  let savedPath: string | null = null;
  const run = await beginBatch('json2png', files.length);
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      progress.value = { done: i + 1, total: files.length };
      let hash = '';
      try {
        const buf = await f.arrayBuffer();
        hash = bytesHash(new Uint8Array(buf));
        const prev = done?.get(`${f.name}:${hash}`);
        if (prev) {
          await skipDone(prev, zip, doneNames);
          okCount++;
          continue;
        }
        const text = new TextDecoder().decode(buf);
        const card = parseLooseCard(JSON.parse(text));
        const png = await cardService.cardToPngBytes(card, basePng, { dualWrite: dualWrite.value });
        const out = `${sanitizeFilename(card.data.name || f.name.replace(/\.json$/i, ''))}.png`;
        if (files.length === 1) {
          // 单文件直接下载 png（无论是否指定底图），避免产物困在永不落地的 zip 里
          savedPath = await downloadBlob(new Blob([png as BlobPart], { type: 'image/png' }), out);
        } else {
          zip.file(out, png);
        }
        await recordConversion({
          direction: 'json2png',
          fileName: f.name,
          cardName: String(card.data.name ?? ''),
          spec: card.spec,
          outputName: out,
          bytes: png,
          mime: 'image/png',
          savedPath,
          batchId: run?.id,
          status: 'ok',
          sourceHash: hash,
        }).catch(() => undefined);
        report.value.push({ name: f.name, ok: true, detail: `${card.data.name} → ${out}${basePng ? `（底图：${basePngName.value}）` : '（占位底图）'}`, file: f });
        okCount++;
        converted++;
      } catch (e) {
        await recordConversion({
          direction: 'json2png',
          fileName: f.name,
          cardName: '',
          spec: '',
          outputName: '',
          batchId: run?.id,
          status: 'failed',
          error: (e as Error).message,
          sourceHash: hash || undefined,
        }).catch(() => undefined);
        report.value.push({ name: f.name, ok: false, detail: (e as Error).message, file: f });
      }
    }
    if (files.length > 1 && okCount) {
      savedPath = await downloadBlob(await zip.generateAsync({ type: 'blob' }), timestampName('json2png', 'zip'));
    }
    await finishBatch(run, savedPath);
    recent.value = await listRecentConversions().catch(() => recent.value);
    message.success(`转换完成 ${converted + doneNames.size}/${files.length}${doneNames.size ? `（续跑跳过已完成 ${doneNames.size}）` : ''}${savedPath ? `，已保存到 ${savedPath}` : ''}`);
  } finally {
    busy.value = false;
    progress.value = null;
  }
}

/** 报告里失败行的单条重试（用保留的 File 引用原样重跑） */
async function retryOne(r: ReportRow) {
  if (!r.file || busy.value) return;
  if (mode.value === 'png2json') await runPng2Json([r.file]);
  else await runJson2Png([r.file]);
}

function run() {
  if (mode.value === 'png2json') void convertPngToJson();
  else void convertJsonToPng();
}
</script>

<template>
  <div class="converter">
    <NSpace vertical :size="16" style="max-width: 880px">
      <NAlert v-if="resume" type="warning" :bordered="false" closable style="font-size: 12px" @close="resume = null">
        上次批量转换未完成（{{ resume.run.direction === 'png2json' ? 'PNG→JSON' : 'JSON→PNG' }}，成功 {{ resume.okCount }} / 共 {{ resume.run.total }}）。
        同方向重新选择同一批文件时会按内容自动跳过已完成的（本次会话内产物还会回填 zip）。
      </NAlert>

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
            把卡 JSON 嵌入 PNG 底图 tEXt 块。先选 JSON（可多选）；底图在下方显式选择，不选时使用占位图。
          </template>
        </NText>

        <NSpace v-if="mode === 'json2png'" :size="10" align="center" style="margin-bottom: 12px">
          <NText depth="3" style="font-size: 13px">底图：</NText>
          <NButton v-if="!basePngBytes" size="small" @click="chooseBasePng">选择 PNG…（不选则用占位图）</NButton>
          <template v-else>
            <NTag size="small" :bordered="false" type="info" closable @close="clearBasePng">{{ basePngName }}</NTag>
            <NButton size="small" quaternary @click="chooseBasePng">更换</NButton>
          </template>
        </NSpace>

        <NSpace :size="10" align="center">
          <NButton type="primary" :loading="busy" @click="run">
            <template #icon><NIcon><SwapHorizontalOutline /></NIcon></template>
            {{ mode === 'png2json' ? '选择 PNG 并转换' : '选择 JSON 并转换' }}
          </NButton>
          <NSpace v-if="mode === 'json2png'" :size="8" align="center" :wrap-item="false">
            <NSwitch v-model:value="dualWrite" size="small">
              <template #checked>双写 ccv3 + chara</template>
              <template #unchecked>仅写 chara</template>
            </NSwitch>
            <NText depth="3" style="font-size: 12px">{{ dualWrite ? '推荐：新旧前端都能识别' : '兼容模式：旧前端专用' }}</NText>
          </NSpace>
        </NSpace>

        <!-- 批量进行时进度：done/total + 线性进度条 -->
        <div v-if="progress" style="margin-top: 12px; max-width: 420px">
          <NProgress type="line" :percentage="progress.total ? Math.round((progress.done / progress.total) * 100) : 100" :show-indicator="false" />
          <NText depth="3" style="font-size: 12px">{{ progress.done }}/{{ progress.total }}</NText>
        </div>
      </div>

      <NCollapse v-if="report.length">
        <NCollapseItem title="转换报告" name="report">
          <NList bordered size="small">
            <NListItem v-for="(r, i) in report" :key="i">
              <NSpace :size="8" align="center">
                <NTag size="small" :bordered="false" :type="r.ok ? 'success' : 'error'">{{ r.ok ? 'OK' : '失败' }}</NTag>
                <b style="font-size: 13px">{{ r.name }}</b>
                <NText depth="3" style="font-size: 12px; white-space: pre-line; line-height: 1.6">{{ r.detail }}</NText>
                <NButton v-if="!r.ok && r.file && !busy" size="tiny" secondary @click="retryOne(r)">重试</NButton>
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

      <NCollapse v-if="recent.length" style="margin-top: 4px">
        <NCollapseItem :title="`最近转换（${recent.length}，上限 50）`" name="recent">
          <NList bordered size="small">
            <NListItem v-for="r in recent.slice(0, 20)" :key="r.id">
              <NSpace :size="8" align="center" style="width: 100%">
                <NTag size="small" :bordered="false" :type="r.status === 'failed' ? 'error' : r.direction === 'png2json' ? 'info' : 'success'">
                  {{ r.status === 'failed' ? '失败' : r.direction === 'png2json' ? 'PNG→JSON' : 'JSON→PNG' }}
                </NTag>
                <b style="font-size: 13px">{{ r.cardName || r.fileName }}</b>
                <NText v-if="r.status === 'failed'" depth="3" style="font-size: 12px; white-space: pre-line">{{ r.error }}</NText>
                <NText depth="3" style="font-size: 12px">{{ formatBytes(r.sizeBytes) }} · {{ new Date(r.savedAt).toLocaleString() }}</NText>
                <NTooltip :disabled="r.sizeBytes <= 2 * 1024 * 1024">
                  <template #trigger>
                    <NButton size="tiny" secondary :disabled="r.sizeBytes > 2 * 1024 * 1024" @click="reDownload(r)">
                      <template #icon><NIcon><DownloadOutline /></NIcon></template>重新下载
                    </NButton>
                  </template>
                  产物 >2MB 未保留，请重新转换
                </NTooltip>
              </NSpace>
            </NListItem>
          </NList>
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
  background: var(--tcs-fill, rgba(255,255,255,.03)); border: 1px solid var(--tcs-border, rgba(255,255,255,.07));
  border-radius: 14px; padding: 18px 20px;
}
</style>

<script setup lang="ts">
/** 诊断与调整：静态检查（即时）+ 卡医 LLM 诊断（结构化报告）+ 修复建议 → diff → 应用 */
import { computed, onMounted, ref } from 'vue';
import {
  NSpace, NButton, NSelect, NCard, NTag, useMessage, NIcon, NEmpty, NCollapse, NCollapseItem, NInput, NSpin, NModal, NDescriptions, NDescriptionsItem, NProgress, NGrid,
} from 'naive-ui';
import { MedicalOutline, ShieldCheckmarkOutline, BuildOutline } from '@vicons/ionicons5';
import { useWorkspace } from '@/stores/workspace';
import * as cardService from '@/services/cardService';
import { staticDiagnose, listSkills, runDoctorSkill, applyPatch, type DiagIssue, type DoctorReport, type PatchOp } from '@/services/diagService';
import type { SkillRow } from '@/services/types';
import { diffCards } from '@/services/cardService';

const message = useMessage();
const ws = useWorkspace();

const cardId = ref<string | null>(null);
const issues = ref<DiagIssue[]>([]);
const thresholds = ref({ fieldTokens: 2000, descriptionTokens: 4000, firstMesTokens: 2000 });
const skills = ref<SkillRow[]>([]);
const skillId = ref<string | null>(null);
const doctorBusy = ref(false);
const doctorStream = ref('');
const report = ref<DoctorReport | null>(null);

onMounted(async () => {
  await ws.refreshCards(true);
  skills.value = await listSkills();
  skillId.value = skills.value[0]?.id ?? null;
});

const card = computed(() => ws.cards.find((c) => c.id === cardId.value && !c.deletedAt) ?? null);

function runStatic() {
  if (!card.value) {
    message.warning('先选择卡片');
    return;
  }
  issues.value = staticDiagnose(card.value.card, thresholds.value);
  const errs = issues.value.filter((i) => i.severity === 'error').length;
  message.success(errs ? `发现 ${errs} 个错误、${issues.value.length - errs} 个提示` : '静态检查通过');
}

async function runDoctor() {
  if (!card.value || !skillId.value) return;
  const skill = skills.value.find((s) => s.id === skillId.value)!;
  doctorBusy.value = true;
  doctorStream.value = '';
  report.value = null;
  try {
    const row = await cardService.getCard(card.value.id);
    report.value = await runDoctorSkill(skill, row!.card, {
      onDelta: (_d, full) => (doctorStream.value = full),
    });
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    doctorBusy.value = false;
  }
}

/* 修复应用：处方 → 可编辑补丁 → diff 预览 → 应用 */
const showPatch = ref(false);
const patchText = ref('');
const patchPreview = ref<cardService.FieldDiff[]>([]);

function openPatch(prescription?: { rewrite?: string; for?: string }) {
  if (prescription?.rewrite) {
    patchText.value = JSON.stringify([{ field: 'description', value: prescription.rewrite }], null, 2);
  } else {
    patchText.value = JSON.stringify([{ field: '', value: '' }], null, 2);
  }
  showPatch.value = true;
}

function previewPatch() {
  if (!card.value) return;
  try {
    const ops = JSON.parse(patchText.value) as PatchOp[];
    const next = applyPatch(card.value.card, ops);
    patchPreview.value = diffCards(card.value.card, next);
  } catch (e) {
    message.error((e as Error).message);
  }
}

async function applyPatchNow() {
  if (!card.value) return;
  try {
    const ops = JSON.parse(patchText.value) as PatchOp[];
    const row = await cardService.getCard(card.value.id);
    const next = applyPatch(row!.card, ops);
    await cardService.saveCard(card.value.id, next, { note: '诊断修复应用', keepCover: true });
    await ws.refreshCards(true);
    showPatch.value = false;
    message.success('修复已应用（自动存版本快照，可回滚）');
  } catch (e) {
    message.error((e as Error).message);
  }
}

const severityType = { error: 'error', warn: 'warning', info: 'info' } as const;
</script>

<template>
  <div style="max-width: 980px">
    <NSpace :size="10" style="margin-bottom: 14px" align="center">
      <NSelect v-model:value="cardId" :options="ws.cards.filter((c) => !c.deletedAt).map((c) => ({ label: c.name, value: c.id }))" filterable placeholder="选择要诊断的卡" style="width: 240px" />
      <NButton size="small" type="primary" @click="runStatic">
        <template #icon><NIcon><ShieldCheckmarkOutline /></NIcon></template>静态检查（本地即时）
      </NButton>
      <NSelect v-model:value="skillId" :options="skills.map((s) => ({ label: s.name, value: s.id }))" size="small" style="width: 180px" />
      <NButton size="small" secondary :loading="doctorBusy" @click="runDoctor">
        <template #icon><NIcon><MedicalOutline /></NIcon></template>AI 诊断
      </NButton>
    </NSpace>

    <NGrid v-if="issues.length" :cols="2" :x-gap="14">
      <NCard size="small" title="静态检查结果">
        <NSpace vertical :size="6">
          <div v-for="(i, idx) in issues" :key="idx" class="diag-row">
            <NTag size="tiny" :bordered="false" :type="severityType[i.severity]">{{ i.severity }}</NTag>
            <b>{{ i.field }}</b>
            <span>{{ i.message }}</span>
            <span v-if="i.suggestion" class="diag-suggestion">→ {{ i.suggestion }}</span>
          </div>
        </NSpace>
      </NCard>
    </NGrid>

    <NCard v-if="doctorBusy || report" size="small" title="卡医报告" style="margin-top: 14px">
      <NSpin v-if="doctorBusy" size="small" style="width: 100%">
        <div class="doctor-stream">{{ doctorStream.slice(-600) || '等待模型输出…' }}</div>
      </NSpin>
      <template v-else-if="report">
        <NDescriptions :column="2" size="small" bordered style="margin-bottom: 12px">
          <NDescriptionsItem label="总评分">
            <NProgress type="line" :percentage="report.overall.score" :color="report.overall.score > 70 ? '#4ade80' : report.overall.score > 40 ? '#facc15' : '#f87171'" style="width: 160px" />
          </NDescriptionsItem>
          <NDescriptionsItem label="总评">{{ report.overall.summary }}</NDescriptionsItem>
        </NDescriptions>
        <div class="doctor-dims">
          <div v-for="d in report.dimensions" :key="d.name" class="doctor-dim">
            <span class="doctor-dim-name">{{ d.name }}</span>
            <NProgress type="line" :percentage="d.score * 10" :height="8" :color="d.score >= 7 ? '#4ade80' : d.score >= 4 ? '#facc15' : '#f87171'" />
            <span class="doctor-dim-comment">{{ d.comment }}</span>
          </div>
        </div>
        <NCollapse style="margin-top: 10px">
          <NCollapseItem :title="`问题清单（${report.issues.length}）`" name="issues">
            <div v-for="(p, i) in report.issues" :key="i" class="diag-row">
              <NTag size="tiny" :bordered="false" :type="p.severity === 'error' ? 'error' : p.severity === 'warn' ? 'warning' : 'info'">{{ p.severity }}</NTag>
              <b>{{ p.field }}</b><span>{{ p.problem }}</span>
              <span class="diag-suggestion">证据：{{ p.evidence }}</span>
            </div>
          </NCollapseItem>
          <NCollapseItem :title="`处方（${report.prescriptions.length}）`" name="rx">
            <div v-for="(p, i) in report.prescriptions" :key="i" class="diag-row">
              <span style="flex: 1"><b>{{ p.for }}</b>：{{ p.action }}</span>
              <NButton v-if="p.rewrite" size="tiny" secondary @click="openPatch(p)">
                <template #icon><NIcon><BuildOutline /></NIcon></template>应用改写
              </NButton>
            </div>
          </NCollapseItem>
        </NCollapse>
      </template>
    </NCard>

    <NCard v-if="!issues.length && !report && !doctorBusy" size="small">
      <NEmpty description="选择一张卡开始：静态检查无需 AI，秒出结果；AI 诊断给出维度评分与可执行处方">
        <template #icon><NIcon size="42"><MedicalOutline /></NIcon></template>
      </NEmpty>
    </NCard>

    <NModal v-model:show="showPatch" preset="card" title="应用修复（diff 预览）" style="width: 680px">
      <NSpace vertical :size="10">
        <NInput v-model:value="patchText" type="textarea" :rows="6" placeholder='[{"field":"description","value":"新内容"}]' />
        <NSpace>
          <NButton size="small" @click="previewPatch">预览 diff</NButton>
          <NButton size="small" type="primary" @click="applyPatchNow">应用并保存（自动快照）</NButton>
        </NSpace>
        <div v-if="patchPreview.length" class="patch-diff">
          <div v-for="(d, i) in patchPreview" :key="i">
            <b>{{ d.field }}</b>：<span class="diff-before">{{ (d.before || '∅').slice(0, 100) }}</span> →
            <span class="diff-after">{{ (d.after || '∅').slice(0, 100) }}</span>
          </div>
          <NTag v-if="!patchPreview.length" size="small">无变化</NTag>
        </div>
      </NSpace>
    </NModal>
  </div>
</template>

<style scoped>
.diag-row { display: flex; align-items: baseline; gap: 8px; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed rgba(255,255,255,.05); flex-wrap: wrap; }
.diag-suggestion { color: #a78bfa; font-size: 12px; }
.doctor-stream { white-space: pre-wrap; font-size: 12px; opacity: .7; min-height: 80px; max-height: 200px; overflow: auto; }
.doctor-dims { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.doctor-dim { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 12px; }
.doctor-dim-name { font-weight: 700; }
.doctor-dim-comment { grid-column: 1 / -1; opacity: .65; }
.patch-diff { font-size: 12px; max-height: 240px; overflow: auto; }
.diff-before { color: #f87171; }
.diff-after { color: #4ade80; }
</style>

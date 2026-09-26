<script setup lang="ts">
/**
 * 编辑器「变量」Tab：MVU 变量设计器三步向导（设计 → 审查 → 注入）。
 * 设计借鉴 CardForge 变量设计器的方法论（分组建模 / 三产物审查 / 幂等注入），独立实现。
 * 变量组定义持久化在 extensions.tcsMvuVarGroups；注入走 core/mvu/suite（幂等，可重复执行）。
 */
import { computed, ref, watch } from 'vue';
import {
  NAlert, NButton, NCheckbox, NDivider, NIcon, NInput, NInputNumber, NPopconfirm,
  NRadioButton, NRadioGroup, NSelect, NSpace, NTabPane, NTabs, NTag, NText, useMessage,
} from 'naive-ui';
import { ArrowUpOutline, ArrowDownOutline, TrashOutline, AddOutline, SparklesOutline } from '@vicons/ionicons5';
import type { AnyCard, MvuVarField, MvuVarGroup } from '@/core/card';
import {
  MVU_FIELD_TYPES,
  MVU_OUTPUT_EMPHASIS_TEXT,
  MVU_OUTPUT_FORMAT_TEXT,
  MVU_PRESETS,
  buildInitVarYaml,
  buildUpdateRuleText,
  buildZodCode,
  mvuCheckIssues,
  newMvuField,
  type MvuFieldType,
} from '@/core/mvu/model';
import { MVU_DEFAULT_CONFIG, applyMvuToCard, detectExistingMvu, removeExistingMvu, type MvuSuiteConfig } from '@/core/mvu/suite';
import { MVU_ALWAYS_ON_GROUPS } from '@/core/mvu/model';
import { varGroupsToPaths } from '@/core/llm/htmlgen';

const props = defineProps<{ card: AnyCard }>();
const emit = defineEmits<{ change: [] }>();
const message = useMessage();

const STEPS = ['设计', '审查', '注入'] as const;

/* ---------------- 状态：向导步骤 + 变量组 + 注入配置 ---------------- */

const step = ref(0);
const groups = ref<MvuVarGroup[]>([]);
const config = ref<MvuSuiteConfig>({ ...MVU_DEFAULT_CONFIG });

const data = computed(() => props.card.data as Record<string, unknown>);
const ext = computed(() => (data.value.extensions ?? {}) as Record<string, unknown>);

function loadFromCard() {
  const saved = ext.value.tcsMvuVarGroups as MvuVarGroup[] | undefined;
  groups.value = saved ? (JSON.parse(JSON.stringify(saved)) as MvuVarGroup[]) : [];
}

watch(() => props.card, loadFromCard, { immediate: true });

/* ---------------- 变量组编辑 ---------------- */

const fieldTypeOptions = MVU_FIELD_TYPES.map((t) => ({ label: t.label, value: t.value }));

function addGroup() {
  groups.value.push({ name: `新分组${groups.value.length + 1}`, fields: [] });
}

function removeGroup(i: number) {
  groups.value.splice(i, 1);
}

function moveGroup(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= groups.value.length) return;
  [groups.value[i], groups.value[j]] = [groups.value[j]!, groups.value[i]!];
}

function addField(gi: number) {
  groups.value[gi]!.fields.push(newMvuField());
}

function removeField(gi: number, fi: number) {
  groups.value[gi]!.fields.splice(fi, 1);
}

function loadPreset(key: string) {
  const p = MVU_PRESETS[key];
  if (!p) return;
  groups.value = JSON.parse(JSON.stringify(p.groups)) as MvuVarGroup[];
  message.success('预设已加载，可继续调整');
}

const hasUnnamedGroup = computed(() => groups.value.some((g) => !g.name.trim()));

/* ---------------- 三产物 + lint ---------------- */

const trackPresent = computed(() => config.value.trackPresentChars);
const zodCode = computed(() => buildZodCode(groups.value, { trackPresentChars: trackPresent.value }));
const initVarYaml = computed(() => buildInitVarYaml(groups.value, { trackPresentChars: trackPresent.value }));
const updateRuleText = computed(() => buildUpdateRuleText(groups.value, { trackPresentChars: trackPresent.value }));

const issues = computed(() => mvuCheckIssues(groups.value, zodCode.value));

const varPaths = computed(() => varGroupsToPaths(groups.value));

/* ---------------- 注入 / 清空 ---------------- */

const existing = computed(() => detectExistingMvu(props.card));

function apply() {
  if (!groups.value.length) {
    message.error('请先添加变量分组');
    return;
  }
  if (issues.value.length) {
    message.warning(`存在 ${issues.value.length} 个问题，已仍可注入（建议先修复）`);
  }
  const next = applyMvuToCard(props.card, JSON.parse(JSON.stringify(groups.value)), zodCode.value, config.value);
  // 原地生效（编辑器保存流程统一落库）
  const d = props.card.data as Record<string, unknown>;
  d.extensions = (next.data as Record<string, unknown>).extensions;
  d.character_book = (next.data as Record<string, unknown>).character_book;
  d.first_mes = (next.data as Record<string, unknown>).first_mes;
  d.alternate_greetings = (next.data as Record<string, unknown>).alternate_greetings;
  emit('change');
  message.success('MVU 套装已注入（13 件套，幂等可重复执行）；记得保存卡');
  step.value = 2;
}

function clearAll() {
  const next = removeExistingMvu(props.card);
  const d = props.card.data as Record<string, unknown>;
  d.extensions = (next.data as Record<string, unknown>).extensions;
  d.character_book = (next.data as Record<string, unknown>).character_book;
  d.first_mes = (next.data as Record<string, unknown>).first_mes;
  d.alternate_greetings = (next.data as Record<string, unknown>).alternate_greetings;
  groups.value = [];
  emit('change');
  message.success('已清空全部 MVU 条目（脚本 + 世界书 + 正则 + 开场白占位符 + 变量组）');
}

const alwaysOn = MVU_ALWAYS_ON_GROUPS;

const presetOptions = Object.entries(MVU_PRESETS).map(([k, v]) => ({ label: v.label, value: k }));
</script>

<template>
  <div class="mvu-tab">
    <NAlert type="info" :show-icon="false" style="margin-bottom: 12px">
      MVU 变量系统完整套装：2 脚本 + 5（或 4+N 拆分）世界书条目 + 4 正则 + 开场白占位符。
      <b>酒馆端前置依赖</b>：酒馆助手（JS-Slash-Runner，渲染器开启）、提示词模板、MagVarUpdate 库三者装齐后变量才会生效。
    </NAlert>

    <NSpace :size="8" style="margin-bottom: 12px">
      <NButton v-for="(s, si) in STEPS" :key="s" size="small" :type="step === si ? 'primary' : 'default'"
        :secondary="step !== si" @click="step = si">
        {{ si + 1 }}. {{ s }}
      </NButton>
      <div style="flex: 1" />
      <NTag v-if="existing" size="small" type="warning" :bordered="false">已检测到 MVU 套装（注入将替换）</NTag>
    </NSpace>

    <!-- ============ 第一步：设计 ============ -->
    <div v-if="step === 0">
      <NSpace align="center" :size="8" style="margin-bottom: 10px">
        <span class="mvu-label">快捷预设</span>
        <NSelect :options="presetOptions" placeholder="加载预设…" size="small" style="width: 160px" @update:value="(k: string) => loadPreset(k)" />
        <NButton size="small" @click="addGroup"><template #icon><NIcon><AddOutline /></NIcon></template>添加分组</NButton>
      </NSpace>

      <div v-for="(g, gi) in groups" :key="gi" class="mvu-group">
        <NSpace align="center" :size="6" style="margin-bottom: 8px">
          <NButton size="tiny" quaternary @click="moveGroup(gi, -1)"><template #icon><NIcon><ArrowUpOutline /></NIcon></template></NButton>
          <NButton size="tiny" quaternary @click="moveGroup(gi, 1)"><template #icon><NIcon><ArrowDownOutline /></NIcon></template></NButton>
          <NInput v-model:value="g.name" size="small" placeholder="分组名（如：世界/主角/NPC）" style="width: 180px" />
          <NTag v-if="alwaysOn.includes(g.name)" size="tiny" type="info" :bordered="false">拆分注入时恒蓝灯</NTag>
          <NText depth="3" style="font-size: 12px">字段名可用「.」表达嵌套（如 货币.石质天元）；「_」开头=只读</NText>
          <div style="flex: 1" />
          <NButton size="tiny" type="primary" secondary @click="addField(gi)">加字段</NButton>
          <NPopconfirm @positive-click="removeGroup(gi)">
            <template #trigger><NButton size="tiny" quaternary type="error"><template #icon><NIcon><TrashOutline /></NIcon></template></NButton></template>
            删除分组「{{ g.name }}」？
          </NPopconfirm>
        </NSpace>
        <table class="mvu-fields">
          <thead>
            <tr><th>变量名</th><th>类型</th><th>默认值</th><th>min</th><th>max</th><th>钳位</th><th>枚举值/record子字段</th><th>check 触发条件</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="(f, fi) in g.fields" :key="fi">
              <td><NInput v-model:value="f.name" size="tiny" placeholder="名称" /></td>
              <td><NSelect v-model:value="f.type" size="tiny" :options="fieldTypeOptions" style="width: 90px" /></td>
              <td><NInput v-model:value="f.defaultValue" size="tiny" style="width: 70px" /></td>
              <td><NInputNumber v-model:value="f.min" size="tiny" style="width: 70px" :show-button="false" placeholder="min" /></td>
              <td><NInputNumber v-model:value="f.max" size="tiny" style="width: 70px" :show-button="false" placeholder="max" /></td>
              <td><NCheckbox v-model:checked="f.clamp" size="small" /></td>
              <td>
                <NInput v-if="f.type === 'enum'" v-model:value="f.enumValues" size="tiny" placeholder="值1,值2,…" />
                <NInput v-else-if="f.type === 'record'" v-model:value="f.recordFields" size="tiny" placeholder="子字段:类型, 如 名字:string" />
                <span v-else class="mvu-na">—</span>
              </td>
              <td><NInput v-model:value="f.description" size="tiny" placeholder="check：何时更新/幅度（默认按类型给出）" /></td>
              <td><NButton size="tiny" quaternary type="error" @click="removeField(gi, fi)">×</NButton></td>
            </tr>
            <tr v-if="!g.fields.length"><td colspan="9" class="mvu-empty">该分组还没有字段</td></tr>
          </tbody>
        </table>
      </div>
      <NText v-if="hasUnnamedGroup" type="error" style="font-size: 12px">存在未命名分组</NText>

      <NDivider style="margin: 14px 0 10px">注入配置</NDivider>
      <NSpace vertical :size="10">
        <NSpace align="center">
          <span class="mvu-label">变量列表注入</span>
          <NRadioGroup v-model:value="config.injectMode" size="small">
            <NRadioButton value="whole">整体（一条变量列表）</NRadioButton>
            <NRadioButton value="split">按分组拆分（省 token）</NRadioButton>
          </NRadioGroup>
        </NSpace>
        <NSpace align="center">
          <span class="mvu-label">保留最近 N 楼变量更新</span>
          <NInputNumber v-model:value="config.keepFloors" size="small" :min="1" :max="20" style="width: 90px" />
          <NText depth="3" style="font-size: 12px">（正则 minDepth = N×2，防止旧楼更新灌爆上下文）</NText>
        </NSpace>
        <NSpace align="center">
          <span class="mvu-label">在场角色追踪</span>
          <NCheckbox v-model:checked="config.trackPresentChars">自动加「在场角色」变量 + check 规则</NCheckbox>
        </NSpace>
      </NSpace>
      <div style="margin-top: 14px">
        <NButton type="primary" @click="step = 1">下一步：审查三产物</NButton>
      </div>
    </div>

    <!-- ============ 第二步：审查 ============ -->
    <div v-else-if="step === 1">
      <NAlert v-if="issues.length" type="warning" style="margin-bottom: 10px" title="lint 自查发现的问题">
        <div v-for="(iss, i) in issues" :key="i" style="font-size: 12px">· {{ iss }}</div>
      </NAlert>
      <NAlert v-else type="success" :show-icon="false" style="margin-bottom: 10px">lint 自查通过，未发现问题</NAlert>

      <NTabs type="segment" size="small" default-value="zod">
        <NTabPane name="zod" tab="Zod Schema（脚本）">
          <pre class="mvu-pre">{{ zodCode }}</pre>
        </NTabPane>
        <NTabPane name="initvar" tab="initvar YAML">
          <pre class="mvu-pre">{{ initVarYaml }}</pre>
        </NTabPane>
        <NTabPane name="rule" tab="更新规则">
          <pre class="mvu-pre">{{ updateRuleText }}</pre>
        </NTabPane>
        <NTabPane name="fmt" tab="输出格式（固定模板）">
          <pre class="mvu-pre">{{ MVU_OUTPUT_FORMAT_TEXT }}</pre>
        </NTabPane>
        <NTabPane name="paths" tab="变量路径（{{ varPaths.length }}）">
          <pre class="mvu-pre">{{ varPaths.join('\n') || '（无）' }}</pre>
        </NTabPane>
      </NTabs>

      <NSpace style="margin-top: 14px">
        <NButton @click="step = 0">返回设计</NButton>
        <NButton type="primary" :disabled="!groups.length" @click="apply">
          <template #icon><NIcon><SparklesOutline /></NIcon></template>
          注入 {{ existing ? '（替换已有套装）' : 'MVU 套装' }}
        </NButton>
      </NSpace>
    </div>

    <!-- ============ 第三步：完成 ============ -->
    <div v-else>
      <NAlert type="success" :show-icon="false" style="margin-bottom: 12px" title="已注入">
        变量组已写入 extensions.tcsMvuVarGroups；开场白末尾已追加 {{ '<StatusPlaceHolderImpl/>' }} 占位符。点击编辑器右上「保存」落库。
      </NAlert>
      <NAlert type="warning" :show-icon="false" style="margin-bottom: 12px" title="酒馆端前置依赖（缺一不可）">
        ① 酒馆助手 JS-Slash-Runner（脚本渲染器开启、代码折叠=仅前端） ② 提示词模板扩展 ③ MagVarUpdate 库（套装脚本会自动 import bundle.js）。
        真机验收清单见 ROADMAP 已知事项。
      </NAlert>
      <pre class="mvu-pre">{{ MVU_OUTPUT_EMPHASIS_TEXT }}</pre>
      <NSpace style="margin-top: 12px">
        <NButton @click="step = 0">继续调整</NButton>
        <NPopconfirm @positive-click="clearAll">
          <template #trigger><NButton type="error" secondary>清空所有 MVU 条目</NButton></template>
          将移除脚本 + 世界书条目 + 正则 + 开场白占位符 + 变量组数据，确认？
        </NPopconfirm>
      </NSpace>
    </div>
  </div>
</template>

<style scoped>
.mvu-tab { font-size: 13px; }
.mvu-label { font-weight: 600; font-size: 12px; opacity: .85; }
.mvu-group { border: 1px dashed var(--tcs-border, rgba(255,255,255,.12)); border-radius: 8px; padding: 10px; margin-bottom: 10px; }
.mvu-fields { width: 100%; border-collapse: collapse; font-size: 12px; }
.mvu-fields th { text-align: left; font-weight: 600; opacity: .7; padding: 2px 4px; white-space: nowrap; }
.mvu-fields td { padding: 2px 4px; vertical-align: middle; }
.mvu-empty { opacity: .5; text-align: center; padding: 8px; }
.mvu-na { opacity: .4; }
.mvu-pre {
  background: var(--tcs-surface-2, rgba(127,127,127,.08));
  border-radius: 8px; padding: 10px 12px; font-size: 12px; line-height: 1.55;
  overflow: auto; max-height: 360px; white-space: pre-wrap; word-break: break-all;
}
</style>

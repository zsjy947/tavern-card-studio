/**
 * 合成 600 张测试卡写入当前默认驱动（默认写独立 fixture 文件供浏览器模式导入/性能验证）。
 * 用法：node scripts/gen-fixture-cards.mjs [数量=600] [输出文件=tests/fixtures/synthetic-cards.json]
 * 输出为 { tavernCardStudioFixture: 1, cards: [...] } 数组，可在卡库导入，或
 * 用 --sqlite 直接写入运行中的桌面端库（不常用，默认文件模式）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const count = Number(process.argv[2] ?? 600);
const outFile = join(root, 'tests', 'fixtures', 'synthetic-cards.json');

const TAG_POOL = ['都市', '修仙', '奇幻', '校园', '悬疑', '科幻', '恋爱', '冒险', '多人', '单欣赏'];
const PREFIX = ['林', '沈', '苏', '顾', '叶', '陆', '秦', '江', '温', '许'];
const SUFFIX = ['晚', '舟', '宁', '云', '川', '月', '枫', '雪', '岚', '行'];

function makeCard(i) {
  const name = `${PREFIX[i % 10]}${SUFFIX[(i * 7) % 10]}${i % 3 === 0 ? '儿' : ''}`;
  const tags = [TAG_POOL[i % 10], TAG_POOL[(i * 3) % 10]].filter((v, idx, a) => a.indexOf(v) === idx);
  return {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: `${name} · 合成${i}`,
      description: `合成卡 ${i}：这是一张用于大规模卡库性能验证的合成角色卡。描述字段填充足够长度的文本以模拟真实卡：`.repeat(3),
      personality: '冷静、克制、偶尔毒舌。',
      scenario: '雨夜的便利店门口。',
      first_mes: `合成卡 ${i} 的开场白。{{char}} 抬眼看了 {{user}} 一眼……`,
      mes_example: '',
      creator_notes: 'scripts/gen-fixture-cards.mjs 生成',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      tags,
      creator: 'tcs-fixture',
      character_version: String(1 + (i % 5)),
      extensions: {},
      character_book: {
        name: `${name} 世界书`,
        entries: Array.from({ length: 6 }, (_, j) => ({
          id: j,
          keys: [`关键词${i}_${j}`],
          secondary_keys: [],
          comment: `条目${j}`,
          content: `合成条目内容 ${i}-${j}：`.repeat(8),
          constant: j === 0,
          selective: j !== 0,
          insertion_order: 100,
          enabled: true,
          position: j === 0 ? 'before_char' : 'after_char',
          use_regex: false,
          extensions: { position: j === 0 ? 0 : 1, depth: 4, probability: 100, useProbability: true },
        })),
      },
    },
  };
}

mkdirSync(dirname(outFile), { recursive: true });
const cards = Array.from({ length: count }, (_, i) => makeCard(i));
writeFileSync(outFile, JSON.stringify({ tavernCardStudioFixture: 1, count, cards }, null, 0), 'utf8');
console.log(`已生成 ${count} 张合成卡 → ${outFile}（大小 ${(Buffer.byteLength(JSON.stringify(cards)) / 1024 / 1024).toFixed(1)} MB）`);

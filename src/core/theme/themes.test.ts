/** 主题定义完整性测试：结构、唯一性、纹理可用性 */
import { describe, expect, it } from 'vitest';
import { THEMES, DEFAULT_THEME_ID, getTheme } from './themes';
import { cssVarsOf, statusColorsOf, type ThemeDefinition } from './model';

describe('theme definitions', () => {
  it('id 唯一且非空，默认主题存在', () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    expect(getTheme(DEFAULT_THEME_ID)).toBeDefined();
  });

  it('必含浅色与深色两种模式，文学主题至少两套', () => {
    expect(THEMES.some((t) => t.mode === 'dark')).toBe(true);
    expect(THEMES.some((t) => t.mode === 'light')).toBe(true);
    expect(THEMES.filter((t) => t.texture !== 'none').length).toBeGreaterThanOrEqual(2);
  });

  it('每套主题色板字段齐全且为合法颜色值', () => {
    const colorLike = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(/;
    for (const t of THEMES) {
      expect(t.label.trim()).toBeTruthy();
      expect(t.description.trim()).toBeTruthy();
      for (const [k, v] of Object.entries(t.palette)) {
        if (k === 'brandGrad') {
          expect(v).toContain('linear-gradient');
        } else {
          expect(v, `${t.id}.${k}`).toMatch(colorLike);
        }
      }
    }
  });

  it('纹理为 data URL SVG 或 CSS 渐变，cssVarsOf 覆盖全部变量', () => {
    for (const t of THEMES) {
      if (t.texture === 'none') continue;
      const ok = t.texture.includes('data:image/svg+xml') || t.texture.includes('gradient');
      expect(ok, `${t.id} texture`).toBe(true);
    }
    const vars = cssVarsOf(THEMES[0]!);
    for (const v of Object.values(vars)) expect(v).toBeTruthy();
    expect(Object.keys(vars).length).toBeGreaterThanOrEqual(20);
  });

  it('getTheme 未知 id 返回 undefined，statusColors 取自色板', () => {
    expect(getTheme('nope')).toBeUndefined();
    const t: ThemeDefinition = THEMES[0]!;
    expect(statusColorsOf(t)).toEqual({ good: t.palette.good, warn: t.palette.warn, bad: t.palette.bad });
  });
});

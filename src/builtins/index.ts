import { builtinCardTemplates } from './cardTemplates';
import { builtinStatusbarTemplates } from './statusbarTemplates';
import { builtinRegexTemplates } from './regexTemplates';
import { builtinPromptTemplates } from './promptTemplates';
import { seedSkills } from './skills';

export const BUILTIN_TEMPLATES = [
  ...builtinCardTemplates(),
  ...builtinStatusbarTemplates(),
  ...builtinRegexTemplates(),
  ...builtinPromptTemplates(),
];

export { seedSkills };
export * from './cardTemplates';
export * from './statusbarTemplates';
export * from './regexTemplates';
export * from './promptTemplates';

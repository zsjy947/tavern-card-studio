import { builtinStatusbarTemplates, type StatusbarPayload } from '@/builtins/statusbarTemplates';

const list = builtinStatusbarTemplates();

export const SIMPLE_STATUSBAR = 'SimpleBar';
export const simpleStatusbarPayload = (list.find((t) => t.id === 'tpl-sb-simple')!.payload as StatusbarPayload);
export const radarStatusbarPayload = (list.find((t) => t.id === 'tpl-sb-radar')!.payload as StatusbarPayload);

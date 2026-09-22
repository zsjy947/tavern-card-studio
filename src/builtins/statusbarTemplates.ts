/**
 * 内置状态栏模板（美化三件套：HTML + 正则占位渲染 + 世界书规则条目）。
 *
 * 三件套一键插入逻辑见 services/beautifyService.ts：
 * 1. first_mes 插入 tag 占位（如 <SimpleBar/>）
 * 2. extensions.regex_scripts 注册占位 → HTML 的渲染脚本
 * 3. character_book 添加状态栏规则条目（蓝灯 constant）
 *
 * 模板约定：
 * - 变量一律 {{getvar::名字}}，插入时用初始值/用户值替换（TavernHelper 环境下 JS 会再次用运行时变量刷新）
 * - 图片一律外链（本地文件夹 file:// 或在线 URL），不做 base64 内嵌（项目需求 #6）
 */
import type { TemplateRow } from '@/services/types';

export interface StatusbarVariable {
  key: string;
  label: string;
  initial: string;
}

export interface StatusbarPayload {
  tag: string;
  html: string;
  css: string;
  js: string;
  variables: StatusbarVariable[];
  worldinfoEntry: { comment: string; keys: string[]; content: string };
  previewMock: Record<string, string>;
  /** 建议图链（外链） */
  imageHints?: string[];
}

/* ---------------- 1. 简约数值栏 ---------------- */

const simple: StatusbarPayload = {
  tag: '<SimpleBar/>',
  html: `<div class="tcs-simple">
  <span class="tcs-name">{{getvar::char_name}}</span>
  <span class="tcs-sep">·</span>
  <span class="tcs-item">好感 <b>{{getvar::favor}}</b></span>
  <span class="tcs-item">体力 <b>{{getvar::energy}}</b></span>
  <span class="tcs-item">金钱 <b>{{getvar::money}}</b></span>
  <span class="tcs-item">{{getvar::place}}</span>
  <span class="tcs-item">{{getvar::time}}</span>
</div>`,
  css: `.tcs-simple{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:8px 14px;margin:6px 0 12px;
  background:linear-gradient(90deg,rgba(124,58,237,.16),rgba(124,58,237,.04));
  border-left:3px solid #7c3aed;border-radius:8px;
  font-size:13px;color:#c9b8ff;line-height:1.6;
}
.tcs-simple b{color:#e6dcff;font-weight:600;margin:0 2px;}
.tcs-name{font-weight:700;color:#e6dcff;letter-spacing:1px;}
.tcs-sep{opacity:.5;}`,
  js: `(function(){
  // TavernHelper 环境下用运行时变量刷新数值；普通环境保持插入时的初始值
  try{
    var vars = (typeof getVariables==='function') ? (getVariables()||{}) : {};
    var el = document.currentScript ? document.currentScript.parentElement : null;
    if(!el || !vars.char_name) return;
    el.querySelector('.tcs-name') && (el.querySelector('.tcs-name').textContent = vars.char_name||'');
  }catch(e){}
})();`,
  variables: [
    { key: 'char_name', label: '角色名', initial: '{{char}}' },
    { key: 'favor', label: '好感度', initial: '0' },
    { key: 'energy', label: '体力', initial: '100' },
    { key: 'money', label: '金钱', initial: '500' },
    { key: 'place', label: '地点', initial: '家中' },
    { key: 'time', label: '时间', initial: '清晨' },
  ],
  worldinfoEntry: {
    comment: '状态栏变量规则（蓝灯）',
    keys: ['状态栏', 'statusbar'],
    content: `[状态栏规则] 每次回复末尾输出 <SimpleBar/> 占位符之前，先在心里更新以下变量（不直接展示过程）：好感(favor)、体力(energy)、金钱(money)、地点(place)、时间(time)。剧情推进应当与数值变化互相呼应；好感变化幅度每次不超过 ±5，除非发生重大事件。`,
  },
  previewMock: { char_name: '林晚', favor: '23', energy: '87', money: '1520', place: '学院图书馆', time: '午后' },
};

/* ---------------- 2. 六维属性图 ---------------- */

const radar: StatusbarPayload = {
  tag: '<RadarPanel/>',
  html: `<div class="tcs-radar">
  <div class="tcs-radar-left">
    <svg viewBox="0 0 200 200" class="tcs-svg">
      <g class="tcs-grid">
        <polygon points="100,12 178,56 178,144 100,188 22,144 22,56"/>
        <polygon points="100,42 152,72 152,128 100,158 48,128 48,72"/>
        <polygon points="100,72 126,87 126,113 100,128 74,113 74,87"/>
        <line x1="100" y1="12" x2="100" y2="72"/><line x1="178" y1="56" x2="126" y2="87"/>
        <line x1="178" y1="144" x2="126" y2="113"/><line x1="22" y1="144" x2="74" y2="113"/>
        <line x1="22" y1="56" x2="74" y2="87"/>
      </g>
      <polygon class="tcs-shape" points="{{getvar::radar_points}}"/>
      <g class="tcs-labels">
        <text x="100" y="8">力量 {{getvar::stat_str}}</text>
        <text x="182" y="52">敏捷 {{getvar::stat_agi}}</text>
        <text x="182" y="150">体质 {{getvar::stat_con}}</text>
        <text x="100" y="198">智力 {{getvar::stat_int}}</text>
        <text x="16" y="150">感知 {{getvar::stat_per}}</text>
        <text x="16" y="52">魅力 {{getvar::stat_cha}}</text>
      </g>
    </svg>
  </div>
  <div class="tcs-radar-right">
    <div class="tcs-title">{{getvar::char_name}} · 状态</div>
    <div class="tcs-line"><span>等级</span><b>{{getvar::level}}</b></div>
    <div class="tcs-line"><span>HP</span><b>{{getvar::hp}}</b></div>
    <div class="tcs-line"><span>MP</span><b>{{getvar::mp}}</b></div>
    <div class="tcs-line"><span>状态</span><b>{{getvar::condition}}</b></div>
    <div class="tcs-line"><span>所处</span><b>{{getvar::place}}</b></div>
  </div>
</div>`,
  css: `.tcs-radar{display:flex;gap:16px;align-items:center;padding:10px 16px;margin:8px 0 14px;
  background:radial-gradient(ellipse at 30% 50%,rgba(59,130,246,.12),transparent 70%),#0d1117;
  border:1px solid #1f2c44;border-radius:14px;color:#a5c8ff;}
.tcs-radar-left{flex:0 0 190px;}
.tcs-svg{width:190px;height:190px;display:block;}
.tcs-grid polygon,.tcs-grid line{fill:none;stroke:#1f3a5f;stroke-width:1;}
.tcs-shape{fill:rgba(59,130,246,.35);stroke:#3b82f6;stroke-width:2;stroke-linejoin:round;}
.tcs-labels text{fill:#7da2d8;font-size:11px;text-anchor:middle;}
.tcs-radar-right{flex:1;min-width:0;}
.tcs-title{font-weight:700;color:#d6e7ff;margin-bottom:8px;letter-spacing:1px;}
.tcs-line{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;border-bottom:1px dashed #1c2c46;}
.tcs-line span{opacity:.75;}
.tcs-line b{color:#d6e7ff;font-weight:600;}`,
  js: `(function(){ try{ var v=(typeof getVariables==='function')?(getVariables()||{}):null; if(!v) return;
  // 用六维数值（0-100）重算雷达多边形顶点
  var st=[v.stat_str,v.stat_agi,v.stat_con,v.stat_int,v.stat_per,v.stat_cha].map(Number);
  if(st.some(isNaN)) return;
  var cx=100,cy=100,R=86,pts=[];
  for(var i=0;i<6;i++){var a=-Math.PI/2+i*Math.PI/3;var r=R*Math.max(0.05,Math.min(1,st[i]/100));
    pts.push((cx+r*Math.cos(a)).toFixed(1)+','+(cy+r*Math.sin(a)).toFixed(1));}
  var el=document.currentScript?document.currentScript.parentElement:null;
  var shape=el&&el.querySelector('.tcs-shape'); if(shape) shape.setAttribute('points',pts.join(' '));
  }catch(e){} })();`,
  variables: [
    { key: 'char_name', label: '角色名', initial: '{{char}}' },
    { key: 'radar_points', label: '雷达图顶点（自动）', initial: '100,30 165,65 165,135 100,170 35,135 35,65' },
    { key: 'stat_str', label: '力量', initial: '60' },
    { key: 'stat_agi', label: '敏捷', initial: '75' },
    { key: 'stat_con', label: '体质', initial: '55' },
    { key: 'stat_int', label: '智力', initial: '80' },
    { key: 'stat_per', label: '感知', initial: '65' },
    { key: 'stat_cha', label: '魅力', initial: '90' },
    { key: 'level', label: '等级', initial: '5' },
    { key: 'hp', label: 'HP', initial: '42/50' },
    { key: 'mp', label: 'MP', initial: '30/30' },
    { key: 'condition', label: '状态', initial: '健康' },
    { key: 'place', label: '地点', initial: '旧城区' },
  ],
  worldinfoEntry: {
    comment: '六维状态面板规则（蓝灯）',
    keys: ['状态面板', '六维', 'radar'],
    content: `[面板规则] 角色拥有六维属性（力量/敏捷/体质/智力/感知/魅力，0-100）与 HP/MP。每次回复根据剧情推进更新数值；受挫或受伤时数值下降并体现到叙事中；<RadarPanel/> 占位符由正则渲染为面板，AI 不输出面板本体。`,
  },
  previewMock: {
    char_name: '艾琳', radar_points: '100,41 165,65 165,135 100,170 35,135 42,61',
    stat_str: '60', stat_agi: '75', stat_con: '55', stat_int: '80', stat_per: '65', stat_cha: '90',
    level: '5', hp: '42/50', mp: '30/30', condition: '轻伤', place: '旧城区',
  },
};

/* ---------------- 3. 立绘卡面 ---------------- */

const portrait: StatusbarPayload = {
  tag: '<PortraitCard/>',
  html: `<div class="tcs-portrait">
  <div class="tcs-p-img">
    <img src="{{getvar::portrait_url}}" alt="立绘"/>
    <div class="tcs-p-veil"></div>
  </div>
  <div class="tcs-p-info">
    <div class="tcs-p-name">{{getvar::char_name}}</div>
    <div class="tcs-p-sub">{{getvar::title}}</div>
    <div class="tcs-p-bars">
      <div class="tcs-bar"><i data-fill="{{getvar::favor}}" style="width:{{getvar::favor}}%"></i><span>好感</span></div>
      <div class="tcs-bar"><i data-fill="{{getvar::trust}}" style="width:{{getvar::trust}}%"></i><span>信任</span></div>
      <div class="tcs-bar"><i data-fill="{{getvar::mood}}" style="width:{{getvar::mood}}%"></i><span>心情</span></div>
    </div>
    <div class="tcs-p-foot">{{getvar::place}} · {{getvar::time}} · {{getvar::outfit}}</div>
  </div>
</div>`,
  css: `.tcs-portrait{display:flex;gap:0;width:100%;max-width:560px;margin:8px 0 14px;
  background:#141018;border:1px solid #3b2a4d;border-radius:16px;overflow:hidden;
  box-shadow:0 6px 24px rgba(0,0,0,.45);color:#e9defc;}
.tcs-p-img{flex:0 0 170px;position:relative;min-height:220px;background:#1c1524;}
.tcs-p-img img{width:100%;height:100%;object-fit:cover;display:block;}
.tcs-p-veil{position:absolute;inset:0;background:linear-gradient(90deg,transparent 55%,rgba(20,16,24,.92));}
.tcs-p-info{flex:1;padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-width:0;}
.tcs-p-name{font-size:20px;font-weight:800;letter-spacing:2px;color:#f3ecff;}
.tcs-p-sub{font-size:12px;color:#b79ae0;}
.tcs-p-bars{display:flex;flex-direction:column;gap:7px;margin-top:4px;}
.tcs-bar{position:relative;height:16px;background:#241a30;border-radius:8px;overflow:hidden;}
.tcs-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:8px;
  background:linear-gradient(90deg,#8b5cf6,#d946ef);transition:width .4s;}
.tcs-bar span{position:absolute;left:8px;top:0;line-height:16px;font-size:11px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6);}
.tcs-p-foot{margin-top:auto;font-size:12px;color:#8d7bb0;}`,
  js: `(function(){ try{ var v=(typeof getVariables==='function')?(getVariables()||{}):null; if(!v) return;
  var el=document.currentScript?document.currentScript.parentElement:null; if(!el) return;
  el.querySelectorAll('.tcs-bar i').forEach(function(bar){
    var key=(bar.getAttribute('data-fill')||'').trim(); var val=Number(v[key!==''?key:'']??bar.style.width.replace('%',''));
    if(!isNaN(val)) bar.style.width=Math.max(0,Math.min(100,val))+'%';
  }); }catch(e){} })();`,
  variables: [
    { key: 'char_name', label: '角色名', initial: '{{char}}' },
    { key: 'title', label: '头衔/身份', initial: '流浪剑士' },
    { key: 'portrait_url', label: '立绘外链（本地文件夹或在线链接）', initial: 'https://picsum.photos/seed/tcs/340/440' },
    { key: 'favor', label: '好感 0-100', initial: '30' },
    { key: 'trust', label: '信任 0-100', initial: '45' },
    { key: 'mood', label: '心情 0-100', initial: '70' },
    { key: 'place', label: '地点', initial: '酒馆' },
    { key: 'time', label: '时间', initial: '傍晚' },
    { key: 'outfit', label: '服装', initial: '旅行装' },
  ],
  worldinfoEntry: {
    comment: '立绘卡面规则（蓝灯）',
    keys: ['立绘', 'portrait'],
    content: `[卡面规则] <PortraitCard/> 渲染立绘卡面。立绘外链存于变量 portrait_url；好感/信任/心情（0-100）随剧情波动，服饰(outfit)随场景更换。描述角色外观变化时同步更新 outfit 变量。`,
  },
  previewMock: {
    char_name: '月见', title: '夜行药师', portrait_url: 'https://picsum.photos/seed/tcs2/340/440',
    favor: '30', trust: '45', mood: '70', place: '城南药铺', time: '傍晚', outfit: '墨绿长袍',
  },
  imageHints: ['立绘使用外链：本地图片放到酒馆 Public 目录后用相对/绝对路径，或使用在线图床链接'],
};

/* ---------------- 4. 手机聊天 UI ---------------- */

const phone: StatusbarPayload = {
  tag: '<PhoneUI/>',
  html: `<div class="tcs-phone">
  <div class="tcs-ph-head">
    <span class="tcs-ph-back">‹</span>
    <span class="tcs-ph-avatar">{{getvar::char_name}}</span>
    <span class="tcs-ph-name">{{getvar::char_name}}</span>
    <span class="tcs-ph-state">{{getvar::online}}</span>
  </div>
  <div class="tcs-ph-body">
    <div class="tcs-sys">{{getvar::last_note}}</div>
  </div>
  <div class="tcs-ph-foot">
    <span class="tcs-ph-heart">♥ {{getvar::favor}}</span>
    <span class="tcs-ph-loc">{{getvar::place}}</span>
    <span class="tcs-ph-time">{{getvar::time}}</span>
  </div>
</div>`,
  css: `.tcs-phone{width:100%;max-width:420px;margin:8px auto 14px;border-radius:22px;overflow:hidden;
  background:#0b1220;border:1px solid #1d2c44;font-size:13px;color:#cfe0ff;
  box-shadow:0 8px 30px rgba(0,0,0,.5);}
.tcs-ph-head{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#101a2c;border-bottom:1px solid #1d2c44;}
.tcs-ph-back{font-size:20px;color:#5f7fae;}
.tcs-ph-avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#8b5cf6);
  display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;}
.tcs-ph-name{font-weight:700;}
.tcs-ph-state{margin-left:auto;font-size:11px;color:#4ade80;}
.tcs-ph-body{padding:14px;min-height:64px;background:
  radial-gradient(circle at 80% 20%,rgba(59,130,246,.08),transparent 60%),#0b1220;}
.tcs-sys{background:#16233a;border-radius:10px;padding:8px 12px;font-size:12px;color:#9db8e0;line-height:1.6;}
.tcs-ph-foot{display:flex;gap:12px;padding:8px 14px;background:#101a2c;border-top:1px solid #1d2c44;font-size:12px;color:#7d9cc9;}
.tcs-ph-heart{color:#f472b6;}`,
  js: `(function(){ try{ var v=(typeof getVariables==='function')?(getVariables()||{}):null; if(!v||!v.char_name) return;
  var el=document.currentScript?document.currentScript.parentElement:null; if(!el) return;
  var av=el.querySelector('.tcs-ph-avatar'); if(av) av.textContent=(v.char_name||'?').slice(0,1);
  }catch(e){} })();`,
  variables: [
    { key: 'char_name', label: '角色名', initial: '{{char}}' },
    { key: 'online', label: '在线状态', initial: '在线' },
    { key: 'last_note', label: '最近动态（一行）', initial: '刚刚拍了一张窗外的晚霞……' },
    { key: 'favor', label: '好感', initial: '12' },
    { key: 'place', label: '地点', initial: '公司' },
    { key: 'time', label: '时间', initial: '18:42' },
  ],
  worldinfoEntry: {
    comment: '手机 UI 规则（蓝灯）',
    keys: ['手机', 'phone'],
    content: `[手机规则] 世界内存在即时通讯软件。<PhoneUI/> 渲染聊天界面顶部状态；角色会在聊天软件里主动给 {{user}} 发消息（可作为剧情钩子）；last_note 变量记录最近一条动态。好感(favor)影响回复速度与语气。`,
  },
  previewMock: { char_name: '苏晚', online: '在线', last_note: '刚刚拍了一张窗外的晚霞……', favor: '12', place: '公司', time: '18:42' },
};

export function builtinStatusbarTemplates(): TemplateRow[] {
  const defs: [string, string, string, StatusbarPayload][] = [
    ['tpl-sb-simple', '简约数值栏', '一条横向状态栏：好感/体力/金钱/地点/时间，最轻量', simple],
    ['tpl-sb-radar', '六维属性图', 'SVG 雷达图 + 数值面板，适合 RPG 属性卡', radar],
    ['tpl-sb-portrait', '立绘卡面', '外链立绘 + 三条属性进度条 + 场景信息', portrait],
    ['tpl-sb-phone', '手机聊天 UI', '仿即时通讯界面顶栏，适合现代恋爱卡', phone],
  ];
  return defs.map(([id, name, description, payload]) => ({
    id,
    kind: 'statusbar' as const,
    name,
    description,
    payload,
    builtin: true,
    createdAt: '',
    updatedAt: '',
  }));
}

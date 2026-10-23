// 用户输入框的回复接口。现在是本地关键词占位，接 realtime 模型时只替换 replyTo 的实现。
//
// 输入 ctx：{text, lang:'zh'|'en', episode, choice:'I01'…, key:'greeting'…, options:[{value,zh,en}], state, prompt:{zh,en}}
// 返回：{reply?:{zh,en}, suggest?:value, choose?:value}
//   reply   显示为咪的回应字幕
//   suggest 高亮这个选项，等用户自己点
//   choose  直接替用户选这个选项（回应字幕显示约 1.6 秒后进入分支）
// 页面同时会派发 document 事件 'mii:say'（detail 里有 ctx 和 reply），方便测试时记录。

const KEYWORDS = {
  I01: {paw: ['交给', '你来', '靠你', 'paw', 'trust', 'you do it', 'take care'], hug: ['抱', '拥抱', '贴贴', 'hug', 'cuddle', 'come here']},
  I02: {A: ['红', '蝴蝶结', '背带', 'red', 'bow', 'overall'], B: ['水手', '帽', '蓝', 'sailor', 'hat', 'blue']},
  I03: {R: ['米饭', '饭', '炒蛋', '鸡蛋', 'rice', 'egg'], P: ['意面', '面', '菠菜', 'pasta', 'spinach', 'noodle']},
  I04: {S: ['草莓', '红色', 'strawberr'], B: ['蓝莓', 'blueberr']},
  I05: {slow: ['慢', '别急', '不急', 'slow', 'take your time', 'easy'], again: ['可以', '加油', '再来', '相信', 'you can', 'again', 'got this', 'go']},
  I06: {praise: ['好吃', '厉害', '最棒', '夸', 'delicious', 'best', 'favorite', 'good job'], photo: ['拍', '照', '相机', 'photo', 'picture', 'camera']},
  I07: {rock: ['石头', 'rock', 'stone', 'fist'], scissors: ['剪刀', 'scissor'], paper: ['布', 'paper', 'palm']},
  I08: {replay: ['再看', '重播', '一遍', 'again', 'replay', 'watch'], like: ['赞', '喜欢', '点赞', 'like', 'heart']},
  I09: {plain: ['水果', '就这样', '不要酸奶', 'plain', 'just fruit', 'no yogurt'], yogurt: ['酸奶', 'yogurt', 'yoghurt']},
  I10: {table: ['餐桌', '桌', 'table'], window: ['窗', 'window', 'view']},
  I11: {cuddle: ['抱', '过来', '一起睡', 'cuddle', 'hug', 'come here'], blanket: ['被', '盖', '毯', 'blanket', 'cover', 'tuck']},
};
const MATCHED = {zh: '咪听懂了，点一下就这么办。', en: 'Mii got it. Tap it.'};
const FALLBACK = [
  {zh: '咪歪着头，认真听你说完了。', en: 'Mii listens, head tilted.'},
  {zh: '咪眨眨眼，看看你，又看看选项。', en: 'Mii blinks. Pick one?'},
];
let misses = 0;

export async function replyTo(ctx) {
  const text = ctx.text.toLowerCase();
  const table = KEYWORDS[ctx.choice] || {};
  for (const o of ctx.options) {
    const words = (table[o.value] || []).concat(o.zh, o.en.toLowerCase());
    if (words.some(w => text.includes(w.toLowerCase()))) return {reply: MATCHED, suggest: o.value};
  }
  return {reply: FALLBACK[misses++ % FALLBACK.length]};
}

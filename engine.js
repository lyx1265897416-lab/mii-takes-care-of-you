export const defaults={greeting:'paw',outfit:'A',menu:'R',fruit:'S',encouragement:'slow',praise:'praise',dance:'replay',rps:'rock',snack:'plain',place:'table',bedtime:'blanket'};
export const resolve=(pattern,state)=>pattern.replace(/\{(\w+)\}/g,(_,k)=>state[k]??defaults[k]);
export function flatten(steps,state){return steps.flatMap(s=>s.branch?flatten(s.cases[state[s.branch]??defaults[s.branch]]??[],state):[s]);}
export function route(episode,state){return flatten(episode.steps,state).map(s=>s.shot?{...s,id:resolve(s.shot,state)}:s);}
export function applyChoice(state,node,value){if(!node.options.some(o=>o.value===value))throw Error('Invalid choice'); const next={...state,[node.key]:value};if(node.key==='rps')next.rpsOutcome={rock:'draw',scissors:'mii_win',paper:'player_win'}[value];if(node.key==='praise')next.photo=value==='photo';return next;}
export function localePolicy(languages,preference){const chinese=/^zh(?:-|$)/i.test(languages[0]||'en');return {chineseSystem:chinese,lang:chinese?(preference==='en'?'en':'zh'):'en'};}
export const episodeClock=(items,shots,index,time=0)=>({elapsed:items.slice(0,index).reduce((a,s)=>a+(s.id?shots[s.id]?.duration||0:0),0)+time,total:items.reduce((a,s)=>a+(s.id?shots[s.id]?.duration||0:0),0)});

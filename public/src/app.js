const screens=[...document.querySelectorAll(".screen")];
const $=s=>document.querySelector(s);

const state={
  playerName:"",
  selectedClass:"warrior",
  roomId:null,
  round:1,
  seconds:30,
  cards:[],
  originalCards:[],
  parenMode:false,
  parenSelection:[],
  parenRange:null,
  submitted:false,
  timerId:null,
  roundEndsAt:0,
  players:[],
  queue:[],
  battleLog:[],
  roundLocked:false,
  ultimateTarget:null,
  ultimateSolution:null
};

const CLASSES={
  warrior:{
    name:"戰士",specialty:"防禦",ultimate:"絕對壁壘",
    ult:"shieldAll",detail:"護盾大幅提升"
  },
  mage:{
    name:"法師",specialty:"範圍攻擊",ultimate:"元素風暴",
    ult:"aoe",detail:"全體攻擊"
  },
  priest:{
    name:"牧師",specialty:"恢復",ultimate:"神聖回響",
    ult:"fullHeal",detail:"大量恢復"
  },
  ranger:{
    name:"弓手",specialty:"攻擊",ultimate:"穿心連矢",
    ult:"multiShot",detail:"連續攻擊"
  },
  assassin:{
    name:"刺客",specialty:"破防",ultimate:"暗影處決",
    ult:"execute",detail:"強力破防"
  },
  warlock:{
    name:"術士",specialty:"增益／詛咒",ultimate:"命運逆轉",
    ult:"curse",detail:"強化詛咒"
  }
};

const ACTIONS=[
  {label:"≤ 0",name:"詛咒",desc:"攻擊血最高",id:"curse"},
  {label:"1–9",name:"抵擋",desc:"獲得護盾",id:"guard"},
  {label:"10–19",name:"恢復",desc:"恢復生命",id:"heal"},
  {label:"20–29",name:"攻擊",desc:"攻擊血最高",id:"attack"},
  {label:"≥ 30",name:"尾刀",desc:"攻擊血最低",id:"execute"}
];

const MOCK_ROOMS=[
  {id:"A-102",owner:"Mika",players:2,max:4},
  {id:"B-317",owner:"Kai",players:3,max:4},
  {id:"C-008",owner:"Nora",players:1,max:4}
];

function showScreen(name){
  screens.forEach(s=>s.classList.toggle("active",s.dataset.screen===name));
}

function renderClasses(){
  $("#classGrid").innerHTML=Object.entries(CLASSES).map(([id,c])=>`
    <button class="class-card ${state.selectedClass===id?"selected":""}" data-class="${id}">
      <strong>${c.name}</strong>
      <span>${c.specialty}</span>
      <small>${c.ultimate}</small>
    </button>`).join("");
  document.querySelectorAll(".class-card").forEach(btn=>btn.addEventListener("click",()=>{
    state.selectedClass=btn.dataset.class;
    renderClasses();
  }));
}

function renderRooms(){
  $("#roomList").innerHTML=MOCK_ROOMS.map(r=>`
    <div class="room-item">
      <span><strong>${r.id}</strong> · ${r.owner} · ${r.players}/${r.max}</span>
      <button data-room="${r.id}">加入</button>
    </div>`).join("");
  document.querySelectorAll("[data-room]").forEach(btn=>btn.addEventListener("click",()=>startRoom(btn.dataset.room)));
}

function makePlayer(id,name,classId,isHuman=false){
  return {
    id,name,classId,isHuman,
    hp:100,maxHp:100,shield:0,armor:0,
    damage:0,healing:0,ultimates:0,
    alive:true,submitted:false,submission:null
  };
}

function startRoom(id){
  state.roomId=id;
  state.round=1;
  state.players=[
    makePlayer("p1",state.playerName,state.selectedClass,true),
    makePlayer("p2","Mika","mage"),
    makePlayer("p3","Kai","assassin"),
    makePlayer("p4","Nora","priest")
  ];
  state.battleLog=[];
  beginRound();
  showScreen("battle");
}

function beginRound(){
  if(checkBattleEnd())return;
  let ultimate=null;
  for(let attempt=0;attempt<40&&!ultimate;attempt++){
    state.cards=randomSharedCards();
    state.originalCards=state.cards.map(c=>({...c}));
    ultimate=pickReachableUltimate(state.originalCards);
  }
  if(!ultimate){
    state.cards=[
      {id:"fallback-1",value:"6",type:"number"},
      {id:"fallback-2",value:"+",type:"op"},
      {id:"fallback-3",value:"3",type:"number"},
      {id:"fallback-4",value:"×",type:"op"},
      {id:"fallback-5",value:"2",type:"number"}
    ];
    state.originalCards=state.cards.map(c=>({...c}));
    ultimate={target:18,formula:"(6 + 3) × 2"};
  }
  state.ultimateTarget=ultimate.target;
  state.ultimateSolution=ultimate.formula;
  state.parenRange=null;
  state.parenSelection=[];
  state.submitted=false;
  state.queue=[];
  state.roundLocked=false;
  state.players.filter(p=>p.alive).forEach(p=>{p.submitted=false;p.submission=null});
  const cls=CLASSES[state.selectedClass];
  $("#ultimateTarget").textContent=state.ultimateTarget;
  $("#ultimateName").textContent=cls.ultimate;
  $("#roundLabel").textContent=`R${state.round}`;
  $("#actionBands").innerHTML=ACTIONS.map(a=>`<span class="band">${a.label} · ${a.name}</span>`).join("");
  renderPlayers();
  renderCards();
  updateFormula();
  renderLog();
  startTimer();
  scheduleBots();
}

function randomSharedCards(){
  const numbers=Array.from({length:3},()=>String(Math.floor(Math.random()*9)+1));
  const ops=["+","−","×","÷"];
  const operators=Array.from({length:2},()=>ops[Math.floor(Math.random()*ops.length)]);
  const raw=[...numbers,...operators];
  for(let i=raw.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [raw[i],raw[j]]=[raw[j],raw[i]];
  }
  return raw.map((value,i)=>({
    id:`c${state.round}-${i}`,
    value,
    type:["+", "−", "×", "÷"].includes(value)?"op":"number"
  }));
}

function renderPlayers(){
  $("#playersStrip").innerHTML=state.players.map(p=>{
    const cls=CLASSES[p.classId];
    const hpPct=Math.max(0,p.hp/p.maxHp*100);
    return `
    <div class="player-chip ${!p.alive?"dead":""} ${p.isHuman?"self":""}">
      <div class="topline"><span>${p.name} · ${cls.name}</span><span>${Math.max(0,p.hp)}</span></div>
      <div class="hpbar"><i style="width:${hpPct}%"></i></div>
      <div class="statusline">
        <span>盾 ${p.shield}</span>
        <span>破防 ${p.armor}</span>
        <span>${p.submitted?"已送出":p.alive?"思考中":"淘汰"}</span>
      </div>
    </div>`;
  }).join("");
}

function renderCards(){
  const row=$("#cardsRow");
  row.innerHTML=state.cards.map((c,i)=>{
    const inParen=state.parenRange && i>=state.parenRange[0] && i<=state.parenRange[1];
    return `<div class="card ${state.parenSelection.includes(i)?"paren-selected":""} ${inParen&&i===state.parenRange[0]?"paren-start":""} ${inParen&&i===state.parenRange[1]?"paren-end":""}" data-index="${i}" data-type="${c.type}">${c.value}</div>`;
  }).join("");
  bindCardInteractions();
}

function bindCardInteractions(){
  document.querySelectorAll(".card").forEach(card=>{
    card.addEventListener("click",()=>selectParen(Number(card.dataset.index)));
    card.addEventListener("pointerdown",dragStart);
  });
}

let dragging=null;
function dragStart(e){
  if(state.parenMode||state.submitted||state.roundLocked)return;
  e.preventDefault();
  const card=e.currentTarget;
  dragging={
    index:Number(card.dataset.index),
    el:card,
    pointerId:e.pointerId,
    x:e.clientX,
    y:e.clientY
  };
  card.classList.add("dragging");
  document.addEventListener("pointermove",dragMove,{passive:false});
  document.addEventListener("pointerup",dragEnd,{once:true});
  document.addEventListener("pointercancel",dragEnd,{once:true});
}

function dragMove(e){
  if(!dragging||e.pointerId!==dragging.pointerId)return;
  e.preventDefault();
  dragging.x=e.clientX;
  dragging.y=e.clientY;
  const dx=e.clientX-dragging.el.getBoundingClientRect().left-dragging.el.offsetWidth/2;
  const dy=e.clientY-dragging.el.getBoundingClientRect().top-dragging.el.offsetHeight/2;
  dragging.el.style.transform=`translate(${dx}px,${dy}px) scale(1.06)`;
  dragging.el.style.zIndex="20";
}

function dragEnd(e){
  if(!dragging)return;
  document.removeEventListener("pointermove",dragMove);
  const source=dragging.index;
  const row=$("#cardsRow");
  const rowRect=row.getBoundingClientRect();
  let target=source;

  if(e.clientX>=rowRect.left-30&&e.clientX<=rowRect.right+30&&e.clientY>=rowRect.top-40&&e.clientY<=rowRect.bottom+40){
    const cards=[...row.querySelectorAll(".card")];
    let best=Infinity;
    cards.forEach((el,i)=>{
      if(i===source)return;
      const rect=el.getBoundingClientRect();
      const cx=rect.left+rect.width/2;
      const cy=rect.top+rect.height/2;
      const d=Math.hypot(e.clientX-cx,e.clientY-cy);
      if(d<best){best=d;target=i}
    });
  }

  dragging.el.classList.remove("dragging");
  dragging.el.style.transform="";
  dragging.el.style.zIndex="";

  if(target!==source){
    const [moved]=state.cards.splice(source,1);
    state.cards.splice(target,0,moved);
    state.parenRange=null;
    state.parenSelection=[];
  }

  dragging=null;
  renderCards();
  updateFormula();
}

function selectParen(index){
  if(!state.parenMode||state.submitted||state.roundLocked)return;
  const expectedTypes=["number","op","number"];
  const step=state.parenSelection.length;
  if(step===0){
    if(state.cards[index].type!=="number")return flashHint("先選數字");
    state.parenSelection=[index];
  }else{
    const prev=state.parenSelection[state.parenSelection.length-1];
    if(Math.abs(index-prev)!==1)return flashHint("只能選相鄰卡牌");
    if(state.cards[index].type!==expectedTypes[step])return flashHint(step===1?"第二張選符號":"第三張選數字");
    const direction=step===1?Math.sign(index-prev):Math.sign(state.parenSelection[1]-state.parenSelection[0]);
    if(step===2 && index!==prev+direction)return flashHint("請沿同一方向選取");
    state.parenSelection.push(index);
  }
  if(state.parenSelection.length===3){
    const sorted=[...state.parenSelection].sort((a,b)=>a-b);
    state.parenRange=[sorted[0],sorted[2]];
    state.parenSelection=[];
    state.parenMode=false;
    $("#parenBtn").classList.remove("active");
    flashHint("括號完成");
  }
  renderCards();
  updateFormula();
}

function flashHint(text){
  $("#parenHint").textContent=text;
  clearTimeout(flashHint.t);
  flashHint.t=setTimeout(()=>$("#parenHint").textContent="",1400);
}

function isValidOrder(cards=state.cards){
  return cards.every((c,i)=>c.type===(i%2===0?"number":"op"));
}

function formulaString(cards=state.cards,parenRange=state.parenRange){
  if(!isValidOrder(cards)) return null;
  const parts=cards.map(c=>c.value);
  if(parenRange){
    parts[parenRange[0]]="("+parts[parenRange[0]];
    parts[parenRange[1]]=parts[parenRange[1]]+")";
  }
  return parts.join(" ");
}

function evaluateFormula(formula){
  if(!formula)return null;
  const safe=formula.replaceAll("−","-").replaceAll("×","*").replaceAll("÷","/").replaceAll(" ","");
  if(!/^[0-9+\-*/().]+$/.test(safe))return null;
  try{
    const value=Function(`"use strict";return (${safe})`)();
    return Number.isFinite(value)?Math.round(value*100)/100:null;
  }catch{return null}
}

function actionFor(value,classId=state.selectedClass){
  if(value===null)return {id:"invalid",name:""};
  const cls=CLASSES[classId];
  if(Number.isFinite(state.ultimateTarget)&&Math.abs(value-state.ultimateTarget)<0.0001){
    return {id:"ultimate",name:`${cls.ultimate} · 終極絕招`};
  }
  if(value<=0)return {id:"curse",name:"詛咒 · 攻擊血最高"};
  if(value<=9)return {id:"guard",name:"抵擋 · 獲得護盾"};
  if(value<=19)return {id:"heal",name:"恢復"};
  if(value<=29)return {id:"attack",name:"攻擊 · 血最高"};
  return {id:"execute",name:"尾刀 · 血最低"};
}

function updateFormula(){
  const formula=formulaString();
  const value=evaluateFormula(formula);
  const action=actionFor(value);
  $("#formulaText").textContent=formula||"數字 → 符號 → 數字 → 符號 → 數字";
  $("#formulaResult").textContent=value===null?"—":value;
  $("#matchedAction").textContent=action.name;
}

function startTimer(){
  clearInterval(state.timerId);
  state.seconds=30;
  state.roundEndsAt=Date.now()+30000;
  $("#timer").textContent=state.seconds;
  state.timerId=setInterval(()=>{
    state.seconds=Math.max(0,Math.ceil((state.roundEndsAt-Date.now())/1000));
    $("#timer").textContent=state.seconds;
    if(state.seconds<=0){
      clearInterval(state.timerId);
      const human=state.players.find(p=>p.isHuman);
      if(human?.alive&&!human.submitted){
        human.submitted=true;
        human.submission={forfeit:true,at:Date.now()};
        state.submitted=true;
        addLog(`${human.name} 放棄本回合`);
        renderPlayers();
      }
      finalizeRoundWhenReady(true);
    }
  },200);
}

function resetFormula(){
  if(state.submitted||state.roundLocked)return;
  state.cards=state.originalCards.map(c=>({...c}));
  state.parenSelection=[];
  state.parenRange=null;
  state.parenMode=false;
  $("#parenBtn").classList.remove("active");
  renderCards();
  updateFormula();
}

function submitAnswer(){
  if(state.submitted||state.roundLocked)return;
  const human=state.players.find(p=>p.isHuman);
  if(!human?.alive)return;
  const formula=formulaString();
  const result=evaluateFormula(formula);
  if(result===null)return flashHint("算式尚未完成");
  const action=actionFor(result,human.classId);
  state.submitted=true;
  human.submitted=true;
  human.submission={forfeit:false,formula,result,action,at:Date.now()};
  $("#submitBtn").style.opacity=".55";
  addLog(`${human.name} 已送出`);
  renderPlayers();
  finalizeRoundWhenReady(false);
}

function scheduleBots(){
  state.players.filter(p=>p.alive&&!p.isHuman).forEach((bot,i)=>{
    const delay=5000+Math.floor(Math.random()*19000)+i*350;
    setTimeout(()=>{
      if(state.roundLocked||!bot.alive||bot.submitted)return;
      const choice=findBotFormula(bot.classId);
      bot.submitted=true;
      bot.submission=choice?{...choice,at:Date.now()}:{forfeit:true,at:Date.now()};
      addLog(`${bot.name} ${choice?"已送出":"放棄本回合"}`);
      renderPlayers();
      finalizeRoundWhenReady(false);
    },delay);
  });
}

function permutations(arr){
  if(arr.length<=1)return [arr];
  const out=[];
  arr.forEach((item,i)=>{
    const rest=[...arr.slice(0,i),...arr.slice(i+1)];
    permutations(rest).forEach(p=>out.push([item,...p]));
  });
  return out;
}

function allReachableFormulas(cards){
  const results=[];
  const seen=new Set();
  for(const order of permutations(cards)){
    if(!isValidOrder(order))continue;
    for(const range of [null,[0,2],[2,4]]){
      const formula=formulaString(order,range);
      const value=evaluateFormula(formula);
      if(value===null||!Number.isFinite(value))continue;
      const key=`${formula}=${value}`;
      if(seen.has(key))continue;
      seen.add(key);
      results.push({formula,value,usesParen:Boolean(range)});
    }
  }
  return results;
}

function pickReachableUltimate(cards){
  const all=allReachableFormulas(cards);
  const positiveIntegers=all.filter(x=>Number.isInteger(x.value)&&x.value>0&&x.value<=99);
  if(!positiveIntegers.length)return null;

  const preferred=positiveIntegers.filter(x=>x.value>=10&&x.value<=60&&x.usesParen);
  const normal=positiveIntegers.filter(x=>x.value>=10&&x.value<=60);
  const pool=preferred.length?preferred:(normal.length?normal:positiveIntegers);
  const choice=pool[Math.floor(Math.random()*pool.length)];

  console.debug("[Arithmancy] reachable ultimate",choice.value,choice.formula);
  return {target:choice.value,formula:choice.formula};
}

function findBotFormula(classId){
  const all=permutations(state.originalCards);
  const candidates=[];
  for(const cards of all){
    if(!isValidOrder(cards))continue;
    const ranges=[null,[0,2],[2,4]];
    for(const range of ranges){
      const formula=formulaString(cards,range);
      const result=evaluateFormula(formula);
      if(result===null)continue;
      const action=actionFor(result,classId);
      let score=Math.random()*3;
      if(action.id==="ultimate")score+=100;
      else if(action.id==="execute")score+=42;
      else if(action.id==="attack")score+=34;
      else if(action.id==="heal")score+=24;
      else if(action.id==="guard")score+=20;
      else if(action.id==="curse")score+=30;
      candidates.push({forfeit:false,formula,result,action,score});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  return candidates[0]||null;
}

function finalizeRoundWhenReady(force){
  if(state.roundLocked)return;
  const alive=state.players.filter(p=>p.alive);
  if(!force && alive.some(p=>!p.submitted))return;
  state.roundLocked=true;
  clearInterval(state.timerId);
  state.queue=alive
    .filter(p=>p.submission&&!p.submission.forfeit)
    .sort((a,b)=>a.submission.at-b.submission.at);
  resolveQueue();
}

async function resolveQueue(){
  $("#submitBtn").style.opacity=".55";
  if(!state.queue.length){
    addLog("本回合無人行動");
  }
  for(let i=0;i<state.queue.length;i++){
    const actor=state.queue[i];
    if(!actor.alive)continue;
    applyAction(actor,actor.submission);
    renderPlayers();
    renderLog();
    await wait(520);
    if(checkBattleEnd())return;
  }
  addLog(`第 ${state.round} 回合結束`);
  renderLog();
  state.round++;
  setTimeout(beginRound,900);
}

function applyAction(actor,submission){
  const action=submission.action.id;
  const value=Math.abs(submission.result);
  if(action==="ultimate"){
    applyUltimate(actor);
    actor.ultimates++;
    addLog(`${actor.name} 發動 ${CLASSES[actor.classId].ultimate}`);
    return;
  }
  if(action==="guard"){
    const gain=12+Math.min(18,Math.round(value));
    actor.shield+=gain;
    addLog(`${actor.name} 獲得 ${gain} 護盾`);
    return;
  }
  if(action==="heal"){
    const bonus=actor.classId==="priest"?8:0;
    const amount=14+Math.min(16,Math.round(value/2))+bonus;
    heal(actor,amount);
    addLog(`${actor.name} 恢復 ${amount}`);
    return;
  }
  if(action==="curse"){
    const target=highestHpEnemy(actor);
    if(!target)return;
    const amount=10+(actor.classId==="warlock"?8:0)+Math.min(8,Math.round(value));
    target.armor+=actor.classId==="warlock"?8:4;
    dealDamage(actor,target,amount,"詛咒");
    return;
  }
  if(action==="attack"){
    const target=highestHpEnemy(actor);
    if(!target)return;
    let amount=18+Math.min(14,Math.round(value/3));
    if(actor.classId==="ranger")amount+=6;
    dealDamage(actor,target,amount,"攻擊");
    return;
  }
  if(action==="execute"){
    const target=lowestHpEnemy(actor);
    if(!target)return;
    let amount=24+Math.min(18,Math.round(value/4));
    if(target.hp<=30)amount+=10;
    if(actor.classId==="assassin"){
      target.armor+=10;
      amount+=5;
    }
    dealDamage(actor,target,amount,"尾刀");
  }
}

function applyUltimate(actor){
  const enemies=state.players.filter(p=>p.alive&&p.id!==actor.id);
  switch(actor.classId){
    case "warrior":
      actor.shield+=52;
      actor.armor=Math.max(0,actor.armor-8);
      break;
    case "mage":
      enemies.forEach(t=>dealDamage(actor,t,24,"元素風暴",false));
      break;
    case "priest":
      heal(actor,46);
      actor.shield+=18;
      break;
    case "ranger":{
      const target=lowestHpEnemy(actor);
      if(target){
        dealDamage(actor,target,20,"穿心一矢",false);
        if(target.alive)dealDamage(actor,target,20,"穿心二矢",false);
        if(target.alive)dealDamage(actor,target,20,"穿心三矢",false);
      }
      break;
    }
    case "assassin":{
      const target=lowestHpEnemy(actor);
      if(target){
        target.shield=0;
        target.armor+=22;
        dealDamage(actor,target,42,"暗影處決",false);
      }
      break;
    }
    case "warlock":{
      const target=highestHpEnemy(actor);
      if(target){
        target.armor+=18;
        dealDamage(actor,target,28,"命運逆轉",false);
        actor.shield+=18;
      }
      break;
    }
  }
}

function heal(player,amount){
  if(!player.alive)return;
  const before=player.hp;
  player.hp=Math.min(player.maxHp,player.hp+amount);
  player.healing+=player.hp-before;
}

function dealDamage(actor,target,raw,label,log=true){
  if(!target?.alive)return 0;
  const vuln=1+Math.min(40,target.armor)/100;
  let amount=Math.max(1,Math.round(raw*vuln));
  const absorbed=Math.min(target.shield,amount);
  target.shield-=absorbed;
  amount-=absorbed;
  const hpDamage=Math.min(target.hp,amount);
  target.hp-=hpDamage;
  actor.damage+=hpDamage;
  if(log)addLog(`${actor.name} ${label} ${target.name} · ${hpDamage}`);
  if(target.hp<=0){
    target.hp=0;
    target.alive=false;
    target.shield=0;
    addLog(`${target.name} 淘汰`);
  }
  return hpDamage;
}

function highestHpEnemy(actor){
  return state.players.filter(p=>p.alive&&p.id!==actor.id).sort((a,b)=>b.hp-a.hp)[0]||null;
}

function lowestHpEnemy(actor){
  return state.players.filter(p=>p.alive&&p.id!==actor.id).sort((a,b)=>a.hp-b.hp)[0]||null;
}

function checkBattleEnd(){
  const alive=state.players.filter(p=>p.alive);
  if(state.players.length>0&&alive.length<=1){
    clearInterval(state.timerId);
    showResults();
    return true;
  }
  return false;
}

function addLog(text){
  state.battleLog.unshift(text);
  state.battleLog=state.battleLog.slice(0,6);
  renderLog();
}

function renderLog(){
  $("#battleLog").innerHTML=state.battleLog.map(x=>`<div>${x}</div>`).join("");
}

function showResults(){
  const rows=[...state.players].sort((a,b)=>{
    if(a.alive!==b.alive)return a.alive?-1:1;
    if(b.damage!==a.damage)return b.damage-a.damage;
    return b.healing-a.healing;
  });
  $("#winnerName").textContent=rows[0]?.name||"";
  $("#ranking").innerHTML=`
    <div class="rank-row header"><span>#</span><span>玩家</span><span>傷害</span><span>恢復</span><span>絕招</span></div>
    ${rows.map((r,i)=>`<div class="rank-row"><strong>${i+1}</strong><span>${r.name} · ${CLASSES[r.classId].name}</span><span>${r.damage}</span><span>${r.healing}</span><span>${r.ultimates}</span></div>`).join("")}
  `;
  $("#submitBtn").style.opacity="1";
  showScreen("results");
}

function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

$("#fightBtn").addEventListener("click",()=>{
  const name=$("#playerName").value.trim();
  if(!name){$("#playerName").focus();return}
  state.playerName=name;
  renderClasses();
  renderRooms();
  showScreen("lobby");
});

$("#createRoomBtn").addEventListener("click",()=>startRoom("NEW-"+Math.floor(Math.random()*900+100)));

$("#parenBtn").addEventListener("click",()=>{
  if(state.submitted||state.roundLocked)return;
  if(state.parenRange){
    state.parenRange=null;
    state.parenSelection=[];
    updateFormula();
    renderCards();
    return;
  }
  state.parenMode=!state.parenMode;
  state.parenSelection=[];
  $("#parenBtn").classList.toggle("active",state.parenMode);
  flashHint(state.parenMode?"依序點：數字 → 符號 → 數字":"");
});

$("#resetBtn").addEventListener("click",resetFormula);
$("#submitBtn").addEventListener("click",submitAnswer);
$("#backLobbyBtn").addEventListener("click",()=>{clearInterval(state.timerId);renderRooms();showScreen("lobby")});

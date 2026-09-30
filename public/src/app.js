const screens=[...document.querySelectorAll(".screen")];
const $=s=>document.querySelector(s);
const ROUND_SECONDS=60;
const MAX_ROUNDS=10;

const state={
  playerName:"",selectedClass:"warrior",roomId:null,round:1,seconds:ROUND_SECONDS,
  cards:[],originalCards:[],parenMode:false,parenSelection:[],parenRange:null,
  submitted:false,timerId:null,roundEndsAt:0,players:[],queue:[],battleLog:[],
  roundLocked:false,targets:[],solutions:{},
  clientId:sessionStorage.getItem("arithmancyClientId")||crypto.randomUUID(),
  waitingRoom:null,isHost:false,roomMode:null,waitingPoll:null
};
sessionStorage.setItem("arithmancyClientId",state.clientId);


const CLASSES={
  warrior:{name:"戰士",specialty:"防禦",ultimate:"絕對壁壘",image:"warrior.png"},
  mage:{name:"法師",specialty:"範圍攻擊",ultimate:"元素風暴",image:"mage.png"},
  priest:{name:"牧師",specialty:"恢復",ultimate:"神聖回響",image:"priest.png"},
  ranger:{name:"弓手",specialty:"攻擊",ultimate:"穿心連矢",image:"ranger.png"},
  assassin:{name:"刺客",specialty:"破防",ultimate:"暗影處決",image:"assassin.png"},
  warlock:{name:"術士",specialty:"增益／詛咒",ultimate:"命運逆轉",image:"warlock.png"}
};

const ACTION_META={
  ultimate:{label:"絕招",image:"skill-ultimate.png"},
  attack:{label:"攻擊／詛咒",image:"skill-attack.png"},
  guard:{label:"抵擋",image:"skill-guard.png"},
  heal:{label:"恢復／增益",image:"skill-heal.png"},
  execute:{label:"尾刀",image:"skill-execute.png"}
};

const AI_ROOM={id:"AI-001",owner:"訓練模式",players:4,max:6,ai:true};

function showScreen(name){screens.forEach(s=>s.classList.toggle("active",s.dataset.screen===name))}

function renderClasses(){
  $("#classGrid").innerHTML=Object.entries(CLASSES).map(([id,c])=>`
    <button class="class-card ${state.selectedClass===id?"selected":""}" data-class="${id}" aria-label="${c.name}">
      <img class="class-art" src="./assets/images/${c.image}" alt="${c.name}">
    </button>`).join("");
  document.querySelectorAll(".class-card").forEach(btn=>btn.onclick=()=>{state.selectedClass=btn.dataset.class;renderClasses()});
}

async function renderRooms(){
  const list=$("#roomList");
  list.innerHTML=`
    <div class="room-item ai-room">
      <span><strong>${AI_ROOM.owner}</strong></span>
      <button data-ai-room>加入</button>
    </div>
    <div class="room-loading">讀取真人房間中...</div>`;

  document.querySelector("[data-ai-room]")?.addEventListener("click",joinAIRoom);

  try{
    const res=await fetch("/api/rooms",{cache:"no-store"});
    const data=await res.json();
    const rooms=(data.rooms||[]).filter(r=>!r.started);
    const humanHtml=rooms.map(r=>`
      <div class="room-item">
        <span><strong>${escapeHtml(r.id)}</strong> · ${escapeHtml(r.owner)} · ${r.players}/${r.max}</span>
        <button data-human-room="${escapeHtml(r.id)}">加入</button>
      </div>`).join("");
    list.querySelector(".room-loading")?.remove();
    if(humanHtml) list.insertAdjacentHTML("beforeend",humanHtml);
    list.querySelectorAll("[data-human-room]").forEach(btn=>btn.onclick=()=>joinHumanRoom(btn.dataset.humanRoom));
  }catch{
    list.querySelector(".room-loading")?.remove();
    list.insertAdjacentHTML("beforeend",'<div class="room-empty">真人房間暫時無法讀取</div>');
  }
}

function makePlayer(id,name,classId,isHuman=false){
  return {id,name,classId,isHuman,hp:100,maxHp:100,guardCharges:0,vulnerability:0,damage:0,healing:0,ultimates:0,alive:true,submitted:false,submission:null};
}

function startRoom(id,roomPlayers=null,aiMode=false){
  clearInterval(state.waitingPoll);
  state.roomId=id;state.round=1;state.roomMode=aiMode?"ai":"human";
  if(aiMode){
    state.players=[
      makePlayer(state.clientId,state.playerName,state.selectedClass,true),
      makePlayer("ai-mage","Mika","mage"),
      makePlayer("ai-assassin","Kai","assassin"),
      makePlayer("ai-priest","Nora","priest")
    ];
  }else{
    const src=(roomPlayers||[]).slice(0,4);
    state.players=src.map((p,i)=>makePlayer(p.id||("human-"+i),p.name,p.classId,p.id===state.clientId));
    while(state.players.length<2)state.players.push(makePlayer("guest-"+state.players.length,"等待玩家","warrior"));
    state.players=state.players.filter(p=>p.name!=="等待玩家");
  }
  state.battleLog=[];
  showScreen("battle");
  beginRound();
}

async function createHumanRoom(){
  const id="R-"+Math.random().toString(36).slice(2,6).toUpperCase();
  try{
    const res=await fetch("/api/rooms",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({id,playerId:state.clientId,name:state.playerName,classId:state.selectedClass})
    });
    if(!res.ok)throw new Error("create failed");
    const {room}=await res.json();
    state.isHost=true;state.roomMode="human";
    enterWaitingRoom(room);
  }catch{
    alert("建立房間失敗，請稍後再試");
  }
}

async function joinHumanRoom(id){
  try{
    const res=await fetch(`/api/rooms/${encodeURIComponent(id)}/join`,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({playerId:state.clientId,name:state.playerName,classId:state.selectedClass})
    });
    if(!res.ok)throw new Error("join failed");
    const {room}=await res.json();
    state.isHost=room.ownerId===state.clientId;state.roomMode="human";
    enterWaitingRoom(room);
  }catch{
    alert("房間已滿或已開始");
    renderRooms();
  }
}

function joinAIRoom(){
  const room={
    id:AI_ROOM.id,ownerId:state.clientId,owner:state.playerName,max:4,started:false,
    players:[
      {id:state.clientId,name:state.playerName,classId:state.selectedClass},
      {id:"ai-mage",name:"Mika",classId:"mage"},
      {id:"ai-assassin",name:"Kai",classId:"assassin"},
      {id:"ai-priest",name:"Nora",classId:"priest"}
    ]
  };
  state.isHost=true;state.roomMode="ai";
  enterWaitingRoom(room);
}

function enterWaitingRoom(room){
  state.waitingRoom=room;
  renderWaitingRoom();
  showScreen("waiting");
  clearInterval(state.waitingPoll);
  if(state.roomMode==="human"){
    state.waitingPoll=setInterval(refreshWaitingRoom,1800);
  }
}

async function refreshWaitingRoom(){
  if(!state.waitingRoom||state.roomMode!=="human")return;
  try{
    const res=await fetch(`/api/rooms/${encodeURIComponent(state.waitingRoom.id)}/state`,{cache:"no-store"});
    const data=await res.json();
    if(!data.room)return;
    state.waitingRoom=data.room;
    state.isHost=data.room.ownerId===state.clientId;
    renderWaitingRoom();
    if(data.room.started){
      clearInterval(state.waitingPoll);
      startRoom(data.room.id,data.room.players,false);
    }
  }catch{}
}

function renderWaitingRoom(){
  const room=state.waitingRoom;if(!room)return;
  $("#waitingPlayers").innerHTML=room.players.map(p=>`
    <div class="waiting-player">
      <img class="waiting-avatar" src="./assets/images/${CLASSES[p.classId]?.image||"warrior.png"}" alt="">
      <strong>${escapeHtml(p.name)}</strong>
    </div>`).join("");
  const canStart=state.roomMode==="ai" || room.players.length>=2;
  $("#waitingFightBtn").style.display=state.isHost&&canStart?"block":"none";
}

async function hostStartFight(){
  if(!state.waitingRoom||!state.isHost)return;
  if(state.roomMode==="human"&&state.waitingRoom.players.length<2)return;
  if(state.roomMode==="ai"){
    startRoom(state.waitingRoom.id,state.waitingRoom.players,true);
    return;
  }
  try{
    const res=await fetch(`/api/rooms/${encodeURIComponent(state.waitingRoom.id)}/start`,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({playerId:state.clientId})
    });
    if(!res.ok)throw new Error("start failed");
    const {room}=await res.json();
    state.waitingRoom=room;
    startRoom(room.id,room.players,false);
  }catch{
    alert("無法開始房間");
  }
}

function leaveWaitingRoom(){
  clearInterval(state.waitingPoll);
  state.waitingRoom=null;state.isHost=false;
  renderRooms();showScreen("lobby");
}

function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

function beginRound(){
  if(checkBattleEnd())return;
  let setup=null;
  for(let attempt=0;attempt<80&&!setup;attempt++){
    const cards=randomSharedCards();
    setup=buildFiveTargets(cards);
    if(setup){
      state.cards=cards;
      state.originalCards=cards.map(c=>({...c}));
    }
  }
  if(!setup){
    state.cards=[
      {id:"f1",value:"6",type:"number"},{id:"f2",value:"+",type:"op"},
      {id:"f3",value:"3",type:"number"},{id:"f4",value:"×",type:"op"},
      {id:"f5",value:"2",type:"number"}
    ];
    state.originalCards=state.cards.map(c=>({...c}));
    setup=buildFiveTargets(state.cards);
  }

  state.targets=setup.targets;
  state.solutions=setup.solutions;
  state.parenRange=null;state.parenSelection=[];state.parenMode=false;
  state.submitted=false;state.queue=[];state.roundLocked=false;
  state.players.filter(p=>p.alive).forEach(p=>{p.submitted=false;p.submission=null});
  $("#roundLabel").textContent=`Q${state.round}/${MAX_ROUNDS}`;
  renderTargets();renderPlayers();renderCards();updateFormula();renderLog();hideActionStage();
  startTimer();scheduleBots();
}

function randomSharedCards(){
  const nums=Array.from({length:3},()=>String(Math.floor(Math.random()*9)+1));
  const ops=["+","−","×","÷"];
  const raw=[...nums,ops[Math.floor(Math.random()*4)],ops[Math.floor(Math.random()*4)]];
  for(let i=raw.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[raw[i],raw[j]]=[raw[j],raw[i]]}
  return raw.map((value,i)=>({id:`q${state.round}-${i}-${Math.random().toString(36).slice(2,5)}`,value,type:ops.includes(value)?"op":"number"}));
}

function renderTargets(){
  $("#actionBands").innerHTML=state.targets.map(t=>`
    <div class="target-chip" data-action="${t.id}">
      <img class="action-icon" src="./assets/images/${ACTION_META[t.id].image}" alt="">
      <span>${ACTION_META[t.id].label}</span><strong>${t.value}</strong>
    </div>`).join("");
}

function renderPlayers(){
  $("#playersStrip").innerHTML=state.players.map(p=>{
    const hpPct=Math.max(0,p.hp/p.maxHp*100);
    return `<div class="player-chip ${!p.alive?"dead":""} ${p.isHuman?"self":""}" data-player-id="${p.id}">
      <img class="player-avatar" src="./assets/images/${CLASSES[p.classId].image}" alt="">
      <div class="topline">
        <span>${p.name}</span>
        <span class="player-state">${p.guardCharges>0?"抵擋中":""}</span>
        <span class="hp-value">${Math.max(0,p.hp)}</span>
      </div>
      <div class="hpbar"><i style="width:${hpPct}%"></i></div>
    </div>`;
  }).join("");
}

function renderCards(){
  $("#cardsRow").innerHTML=state.cards.map((c,i)=>{
    const inParen=state.parenRange&&i>=state.parenRange[0]&&i<=state.parenRange[1];
    return `<div class="card ${state.parenSelection.includes(i)?"paren-selected":""} ${inParen&&i===state.parenRange[0]?"paren-start":""} ${inParen&&i===state.parenRange[1]?"paren-end":""}" data-index="${i}">${c.value}</div>`;
  }).join("");
  document.querySelectorAll(".card").forEach(card=>{
    card.onclick=()=>selectParen(Number(card.dataset.index));
    card.onpointerdown=dragStart;
  });
}

let dragging=null;
function dragStart(e){
  if(state.parenMode||state.submitted||state.roundLocked)return;
  e.preventDefault();
  const el=e.currentTarget;
  dragging={index:+el.dataset.index,el,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY};
  el.classList.add("dragging");
  document.addEventListener("pointermove",dragMove,{passive:false});
  document.addEventListener("pointerup",dragEnd,{once:true});
  document.addEventListener("pointercancel",dragEnd,{once:true});
}
function dragMove(e){
  if(!dragging||e.pointerId!==dragging.pointerId)return;
  e.preventDefault();
  const dx=e.clientX-dragging.startX,dy=e.clientY-dragging.startY;
  dragging.el.style.transform=`translate(${dx}px,${dy}px) scale(1.06)`;
  dragging.el.style.zIndex="20";
}
function dragEnd(e){
  if(!dragging)return;
  document.removeEventListener("pointermove",dragMove);
  const source=dragging.index,row=$("#cardsRow"),els=[...row.querySelectorAll(".card")];
  let target=source,best=Infinity;
  els.forEach((el,i)=>{
    if(i===source)return;
    const r=el.getBoundingClientRect(),d=Math.hypot(e.clientX-(r.left+r.width/2),e.clientY-(r.top+r.height/2));
    if(d<best){best=d;target=i}
  });
  dragging.el.classList.remove("dragging");dragging.el.style.transform="";dragging.el.style.zIndex="";
  if(target!==source){
    const [moved]=state.cards.splice(source,1);state.cards.splice(target,0,moved);
    state.parenRange=null;state.parenSelection=[];
  }
  dragging=null;renderCards();updateFormula();
}

function selectParen(index){
  if(!state.parenMode||state.submitted||state.roundLocked)return;
  const types=["number","op","number"],step=state.parenSelection.length;
  if(step===0){
    if(state.cards[index].type!=="number")return flashHint("先選數字");
    state.parenSelection=[index];
  }else{
    const prev=state.parenSelection.at(-1);
    if(Math.abs(index-prev)!==1)return flashHint("只能選相鄰卡牌");
    if(state.cards[index].type!==types[step])return flashHint(step===1?"再選符號":"再選數字");
    const direction=step===1?Math.sign(index-prev):Math.sign(state.parenSelection[1]-state.parenSelection[0]);
    if(step===2&&index!==prev+direction)return flashHint("請沿同一方向選取");
    state.parenSelection.push(index);
  }
  if(state.parenSelection.length===3){
    const x=[...state.parenSelection].sort((a,b)=>a-b);
    state.parenRange=[x[0],x[2]];state.parenSelection=[];state.parenMode=false;
    $("#parenBtn").classList.remove("active");flashHint("括號完成");
  }
  renderCards();updateFormula();
}

function flashHint(text){
  $("#parenHint").textContent=text;clearTimeout(flashHint.t);
  flashHint.t=setTimeout(()=>$("#parenHint").textContent="",1600);
}

function isValidOrder(cards=state.cards){return cards.every((c,i)=>c.type===(i%2===0?"number":"op"))}
function formulaString(cards=state.cards,range=state.parenRange){
  if(!isValidOrder(cards))return null;
  const p=cards.map(c=>c.value);
  if(range){p[range[0]]="("+p[range[0]];p[range[1]]=p[range[1]]+")"}
  return p.join(" ");
}
function evaluateFormula(formula){
  if(!formula)return null;
  const safe=formula.replaceAll("−","-").replaceAll("×","*").replaceAll("÷","/").replaceAll(" ","");
  if(!/^[0-9+\-*/().]+$/.test(safe))return null;
  try{const v=Function(`"use strict";return (${safe})`)();return Number.isFinite(v)?Math.round(v*100)/100:null}catch{return null}
}

function actionFor(value,classId=state.selectedClass){
  if(value===null)return {id:"invalid",name:""};
  const hit=state.targets.find(t=>Math.abs(t.value-value)<0.0001);
  if(!hit)return {id:"invalid",name:"非指定答案"};
  if(hit.id==="ultimate")return {id:"ultimate",name:CLASSES[classId].ultimate};
  if(hit.id==="attack")return {id:"attack",name:classId==="warlock"?"詛咒":"攻擊"};
  return {id:hit.id,name:ACTION_META[hit.id].label};
}

function updateFormula(){
  const formula=formulaString(),value=evaluateFormula(formula),action=actionFor(value);
  const answer=$("#answerDisplay");
  if(answer){
    answer.textContent=value===null?"—":String(value);
    answer.classList.toggle("matched",action.id!=="invalid");
    answer.classList.toggle("no-action",value!==null&&action.id==="invalid");
  }
  document.querySelectorAll(".target-chip").forEach(el=>el.classList.toggle("matched",action.id===el.dataset.action));
}

function permutations(arr){
  if(arr.length<=1)return [arr];
  const out=[];
  arr.forEach((item,i)=>permutations([...arr.slice(0,i),...arr.slice(i+1)]).forEach(p=>out.push([item,...p])));
  return out;
}

function allReachableFormulas(cards){
  const byValue=new Map();
  for(const order of permutations(cards)){
    if(!isValidOrder(order))continue;
    for(const range of [null,[0,2],[2,4]]){
      const formula=formulaString(order,range),value=evaluateFormula(formula);
      if(value===null||!Number.isInteger(value)||Math.abs(value)>99)continue;
      if(!byValue.has(value))byValue.set(value,{formula,value,usesParen:Boolean(range)});
      else if(range&&!byValue.get(value).usesParen)byValue.set(value,{formula,value,usesParen:true});
    }
  }
  return [...byValue.values()];
}

function buildFiveTargets(cards){
  const all=allReachableFormulas(cards);
  const useful=all.filter(x=>x.value>=-20&&x.value<=60);
  if(useful.length<5)return null;

  const sorted=[...useful].sort((a,b)=>a.value-b.value);
  const picks=[];
  const indices=[0,Math.floor((sorted.length-1)*.25),Math.floor((sorted.length-1)*.5),Math.floor((sorted.length-1)*.75),sorted.length-1];
  for(const idx of indices){
    let pick=sorted[idx];
    if(picks.some(p=>p.value===pick.value)){
      pick=sorted.find(x=>!picks.some(p=>p.value===x.value));
    }
    if(pick)picks.push(pick);
  }
  if(picks.length<5)return null;

  const parenCandidate=useful.filter(x=>x.usesParen).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))[0];
  if(parenCandidate&&!picks.some(p=>p.value===parenCandidate.value))picks[0]=parenCandidate;

  const ordered=[
    {id:"ultimate",entry:picks[0]},
    {id:"attack",entry:picks[3]},
    {id:"guard",entry:picks[1]},
    {id:"heal",entry:picks[2]},
    {id:"execute",entry:picks[4]}
  ];

  const values=new Set(ordered.map(x=>x.entry.value));
  if(values.size<5)return null;
  return {
    targets:ordered.map(x=>({id:x.id,value:x.entry.value})),
    solutions:Object.fromEntries(ordered.map(x=>[x.id,x.entry]))
  };
}

function startTimer(){
  clearInterval(state.timerId);
  state.seconds=ROUND_SECONDS;state.roundEndsAt=Date.now()+ROUND_SECONDS*1000;$("#timer").textContent=state.seconds;
  state.timerId=setInterval(()=>{
    state.seconds=Math.max(0,Math.ceil((state.roundEndsAt-Date.now())/1000));$("#timer").textContent=state.seconds;
    if(state.seconds<=0){
      clearInterval(state.timerId);
      const human=state.players.find(p=>p.isHuman);
      if(human?.alive&&!human.submitted){
        human.submitted=true;human.submission={forfeit:true,at:Date.now()};state.submitted=true;addLog(`${human.name} 放棄`);renderPlayers();
      }
      finalizeRoundWhenReady(true);
    }
  },200);
}

function resetFormula(){
  if(state.submitted||state.roundLocked)return;
  state.cards=state.originalCards.map(c=>({...c}));state.parenSelection=[];state.parenRange=null;state.parenMode=false;
  $("#parenBtn").classList.remove("active");renderCards();updateFormula();
}

function submitAnswer(){
  if(state.submitted||state.roundLocked)return;
  const human=state.players.find(p=>p.isHuman);if(!human?.alive)return;
  const formula=formulaString(),result=evaluateFormula(formula),action=actionFor(result,human.classId);
  if(result===null)return flashHint("算式尚未完成");
  state.submitted=true;human.submitted=true;
  human.submission={forfeit:false,formula,result,action,at:Date.now(),elapsed:ROUND_SECONDS-state.seconds};
  addLog(`${human.name} 完成 · ${human.submission.elapsed}s`);renderPlayers();updateFormula();
  finalizeRoundWhenReady(false);
}

function scheduleBots(){
  if(state.roomMode!=="ai")return;
  state.players.filter(p=>p.alive&&!p.isHuman).forEach((bot,i)=>{
    const delay=7000+Math.floor(Math.random()*38000)+i*500;
    setTimeout(()=>{
      if(state.roundLocked||!bot.alive||bot.submitted)return;
      const choice=findBotFormula(bot.classId);
      bot.submitted=true;bot.submission=choice?{...choice,at:Date.now(),elapsed:Math.round(delay/1000)}:{forfeit:true,at:Date.now()};
      addLog(`${bot.name} ${choice?"完成":"放棄"}`);renderPlayers();finalizeRoundWhenReady(false);
    },delay);
  });
}

function findBotFormula(classId){
  const weighted=["ultimate","execute","attack","heal","guard"];
  const id=weighted[Math.floor(Math.random()*weighted.length)];
  const solution=state.solutions[id]||state.solutions.attack;
  if(!solution)return null;
  return {forfeit:false,formula:solution.formula,result:solution.value,action:actionFor(solution.value,classId)};
}

function finalizeRoundWhenReady(force){
  if(state.roundLocked)return;
  const alive=state.players.filter(p=>p.alive);
  if(!force&&alive.some(p=>!p.submitted))return;
  state.roundLocked=true;clearInterval(state.timerId);
  state.queue=alive.filter(p=>p.submission&&!p.submission.forfeit&&p.submission.action?.id!=="invalid").sort((a,b)=>a.submission.at-b.submission.at);
  resolveQueue();
}

async function resolveQueue(){
  showActionStage();
  if(!state.queue.length){showSkillBanner("本題無人行動","");await wait(1600)}
  for(let i=0;i<state.queue.length;i++){
    const actor=state.queue[i];if(!actor.alive)continue;
    await performAnimatedAction(actor,actor.submission,i+1);
    if(checkBattleEnd())return;
  }
  hideActionStage();addLog(`第 ${state.round} 題結束`);renderLog();
  if(state.round>=MAX_ROUNDS){await wait(900);showResults();return}
  state.round++;setTimeout(beginRound,1400);
}

async function performAnimatedAction(actor,submission,order){
  const action=submission.action.id;
  const actorEl=playerEl(actor.id);
  actorEl?.classList.add("acting");
  showSkillBanner(`#${order}  ${actor.name}`,submission.action.name);
  await wait(850);

  const before=new Map(state.players.map(p=>[p.id,{hp:p.hp,guard:p.guardCharges}]));
  const targets=previewTargets(actor,action);
  targets.forEach(t=>playerEl(t.id)?.classList.add(action==="heal"||action==="guard"?"buffing":"targeted"));
  await wait(500);

  applyAction(actor,submission);
  renderPlayers();
  await wait(120);

  for(const p of state.players){
    const prev=before.get(p.id);if(!prev)continue;
    const hpDiff=p.hp-prev.hp;
    if(hpDiff<0){animateHit(p.id,-hpDiff)}
    else if(hpDiff>0){animateHeal(p.id,hpDiff)}
    if(p.guardCharges>prev.guard)animateGuard(p.id);
  }

  if(action==="ultimate")$("#battleFlash").classList.add("ultimate-flash");
  await wait(action==="ultimate"?1700:1250);
  $("#battleFlash").className="battle-flash";
  document.querySelectorAll(".player-chip").forEach(el=>el.classList.remove("acting","targeted","buffing","hit","heal-pop","guard-pop"));
  await wait(450);
}

function previewTargets(actor,action){
  if(action==="guard"||action==="heal")return [actor];
  if(action==="ultimate"){
    if(actor.classId==="mage")return state.players.filter(p=>p.alive&&p.id!==actor.id);
    if(actor.classId==="warrior"||actor.classId==="priest")return [actor];
    return [lowestHpEnemy(actor)||highestHpEnemy(actor)].filter(Boolean);
  }
  if(action==="execute")return [lowestHpEnemy(actor)].filter(Boolean);
  return [highestHpEnemy(actor)].filter(Boolean);
}

function applyAction(actor,submission){
  const action=submission.action.id;
  if(action==="ultimate"){applyUltimate(actor);actor.ultimates++;addLog(`${actor.name} · ${CLASSES[actor.classId].ultimate}`);return}
  if(action==="guard"){actor.guardCharges=1;addLog(`${actor.name} · 抵擋 1 次`);return}
  if(action==="heal"){
    const amount=actor.classId==="priest"?30:22;heal(actor,amount);actor.vulnerability=Math.max(0,actor.vulnerability-8);
    addLog(`${actor.name} · 恢復 ${amount}`);return;
  }
  if(action==="attack"){
    const target=highestHpEnemy(actor);if(!target)return;
    if(actor.classId==="warlock"){target.vulnerability=Math.min(40,target.vulnerability+12);dealDamage(actor,target,18,"詛咒")}
    else {let amount=actor.classId==="ranger"?30:24;if(actor.classId==="assassin")target.vulnerability=Math.min(40,target.vulnerability+8);dealDamage(actor,target,amount,"攻擊")}
    return;
  }
  if(action==="execute"){
    const target=lowestHpEnemy(actor);if(!target)return;
    let amount=target.hp<=35?38:28;if(actor.classId==="assassin")amount+=6;dealDamage(actor,target,amount,"尾刀");
  }
}

function applyUltimate(actor){
  const enemies=state.players.filter(p=>p.alive&&p.id!==actor.id);
  if(actor.classId==="warrior"){actor.guardCharges=2;actor.vulnerability=Math.max(0,actor.vulnerability-15)}
  if(actor.classId==="mage")enemies.forEach(t=>dealDamage(actor,t,26,"元素風暴",false));
  if(actor.classId==="priest"){heal(actor,48);actor.guardCharges=1}
  if(actor.classId==="ranger"){const t=lowestHpEnemy(actor);if(t){dealDamage(actor,t,22,"連矢",false);if(t.alive)dealDamage(actor,t,22,"連矢",false);if(t.alive)dealDamage(actor,t,22,"連矢",false)}}
  if(actor.classId==="assassin"){const t=lowestHpEnemy(actor);if(t){t.guardCharges=0;t.vulnerability=Math.min(40,t.vulnerability+20);dealDamage(actor,t,44,"暗影處決",false)}}
  if(actor.classId==="warlock"){const t=highestHpEnemy(actor);if(t){t.vulnerability=Math.min(40,t.vulnerability+18);dealDamage(actor,t,30,"命運逆轉",false);actor.guardCharges=1}}
}

function heal(p,amount){if(!p.alive)return;const before=p.hp;p.hp=Math.min(p.maxHp,p.hp+amount);p.healing+=p.hp-before}
function dealDamage(actor,target,raw,label,log=true){
  if(!target?.alive)return 0;
  if(target.guardCharges>0){target.guardCharges--;if(log)addLog(`${target.name} 抵擋了 ${label}`);return 0}
  const amount=Math.max(1,Math.round(raw*(1+Math.min(40,target.vulnerability)/100)));
  const dealt=Math.min(target.hp,amount);target.hp-=dealt;actor.damage+=dealt;
  if(log)addLog(`${actor.name} ${label} ${target.name} · ${dealt}`);
  if(target.hp<=0){target.hp=0;target.alive=false;target.guardCharges=0;addLog(`${target.name} 淘汰`)}
  return dealt;
}
function highestHpEnemy(actor){return state.players.filter(p=>p.alive&&p.id!==actor.id).sort((a,b)=>b.hp-a.hp)[0]||null}
function lowestHpEnemy(actor){return state.players.filter(p=>p.alive&&p.id!==actor.id).sort((a,b)=>a.hp-b.hp)[0]||null}

function playerEl(id){return document.querySelector(`[data-player-id="${id}"]`)}
function showActionStage(){$("#actionStage").classList.add("show");$("#formulaZone").classList.add("resolving")}
function hideActionStage(){$("#actionStage").classList.remove("show");$("#formulaZone").classList.remove("resolving")}
function showSkillBanner(actor,skill){$("#actionActor").textContent=actor;$("#actionSkill").textContent=skill}
function animateHit(id,amount){const el=playerEl(id);el?.classList.add("hit");floatText(el,`-${amount}`,"damage")}
function animateHeal(id,amount){const el=playerEl(id);el?.classList.add("heal-pop");floatText(el,`+${amount}`,"heal")}
function animateGuard(id){const el=playerEl(id);el?.classList.add("guard-pop");floatText(el,"BLOCK","guard")}
function floatText(el,text,kind){
  if(!el)return;const f=document.createElement("span");f.className=`float-text ${kind}`;f.textContent=text;el.appendChild(f);setTimeout(()=>f.remove(),1200);
}

function checkBattleEnd(){
  const alive=state.players.filter(p=>p.alive);
  if(state.players.length&&alive.length<=1){clearInterval(state.timerId);setTimeout(showResults,900);return true}
  return false;
}

function addLog(text){state.battleLog.unshift(text);state.battleLog=state.battleLog.slice(0,6);renderLog()}
function renderLog(){}

function showResults(){
  clearInterval(state.timerId);hideActionStage();
  const rows=[...state.players].sort((a,b)=>{
    if(a.alive!==b.alive)return a.alive?-1:1;
    if(b.hp!==a.hp)return b.hp-a.hp;
    if(b.damage!==a.damage)return b.damage-a.damage;
    return b.healing-a.healing;
  });
  $("#winnerName").textContent=rows[0]?.name||"";
  $("#ranking").innerHTML=`
    <div class="rank-row header"><span>#</span><span>玩家</span><span>傷害</span><span>恢復</span><span>絕招</span></div>
    ${rows.map((r,i)=>`<div class="rank-row"><strong>${i+1}</strong><span class="rank-player"><img class="rank-avatar" src="./assets/images/${CLASSES[r.classId].image}" alt=""><span>${r.name}</span></span><span>${r.damage}</span><span>${r.healing}</span><span>${r.ultimates}</span></div>`).join("")}`;
  showScreen("results");
}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}

$("#fightBtn").onclick=()=>{const name=$("#playerName").value.trim();if(!name)return $("#playerName").focus();state.playerName=name;renderClasses();renderRooms();showScreen("lobby")};
$("#createRoomBtn").onclick=createHumanRoom;
$("#waitingFightBtn").onclick=hostStartFight;
$("#leaveRoomBtn").onclick=leaveWaitingRoom;
$("#parenBtn").onclick=()=>{
  if(state.submitted||state.roundLocked)return;
  if(state.parenRange){state.parenRange=null;state.parenSelection=[];renderCards();updateFormula();return}
  state.parenMode=!state.parenMode;state.parenSelection=[];$("#parenBtn").classList.toggle("active",state.parenMode);flashHint(state.parenMode?"數字 → 符號 → 數字":"");
};
$("#submitBtn").onclick=submitAnswer;
$("#backLobbyBtn").onclick=()=>{clearInterval(state.timerId);clearInterval(state.waitingPoll);renderRooms();showScreen("lobby")};

const screens=[...document.querySelectorAll(".screen")];
const $=s=>document.querySelector(s);
const ROUND_SECONDS=60;
const MAX_ROUNDS=10;
const BASE_DAMAGE=24;
const BASE_HEAL=22;
const scaled=(base,multiplier)=>Math.round(base*multiplier);

const state={
  playerName:"",selectedClass:"warrior",roomId:null,round:1,seconds:ROUND_SECONDS,
  cards:[],originalCards:[],parenMode:false,parenSelection:[],parenRange:null,
  submitted:false,timerId:null,roundEndsAt:0,players:[],queue:[],battleLog:[],
  roundLocked:false,targets:[],solutions:{},
  clientId:sessionStorage.getItem("arithmancyClientId")||crypto.randomUUID(),
  waitingRoom:null,isHost:false,roomMode:null,waitingPoll:null,
  battlePoll:null,lastEventVersion:-1,playingServerEvents:false
};
sessionStorage.setItem("arithmancyClientId",state.clientId);


const CLASSES={
  warrior:{name:"戰士",specialty:"防禦",ultimate:"絕對壁壘",image:"warrior.png"},
  mage:{name:"法師",specialty:"範圍攻擊",ultimate:"元素風暴",image:"mage.png"},
  priest:{name:"牧師",specialty:"恢復",ultimate:"神聖回響",image:"priest.png"},
  ranger:{name:"弓手",specialty:"攻擊",ultimate:"穿心連矢",image:"ranger.png"},
  assassin:{name:"刺客",specialty:"爆發",ultimate:"暗影處決",image:"assassin.png"},
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

const AUDIO={
  home:new Audio("./assets/audio/bgm-home.mp3.mp3"),
  battle:new Audio("./assets/audio/bgm-battle.mp3.mp3"),
  ultimate:new Audio("./assets/audio/sfx-ultimate.mp3.mp3")
};
AUDIO.home.loop=true;
AUDIO.battle.loop=true;
AUDIO.home.volume=.42;
AUDIO.battle.volume=.46;
AUDIO.ultimate.volume=.85;

let activeBgm=null;
let audioUnlocked=false;

function desiredBgmForScreen(name){
  return name==="battle"?AUDIO.battle:AUDIO.home;
}

function playBgmForScreen(name){
  const next=desiredBgmForScreen(name);
  if(activeBgm===next&&!next.paused)return;
  if(activeBgm&&activeBgm!==next)activeBgm.pause();
  activeBgm=next;
  if(!audioUnlocked)return;
  next.play().catch(()=>{});
}

function unlockAudio(){
  if(audioUnlocked)return;
  audioUnlocked=true;
  const active=screens.find(x=>x.classList.contains("active"))?.dataset.screen||"home";
  playBgmForScreen(active);
}

document.addEventListener("pointerdown",unlockAudio,{once:true});
document.addEventListener("keydown",unlockAudio,{once:true});

function showScreen(name){
  screens.forEach(s=>s.classList.toggle("active",s.dataset.screen===name));
  playBgmForScreen(name);
}

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
  return {id,name,classId,isHuman,hp:100,maxHp:100,guardCharges:0,effects:[],damage:0,healing:0,ultimates:0,alive:true,submitted:false,submission:null};
}

function startRoom(id,roomPlayers=null,aiMode=false,battle=null){
  clearInterval(state.waitingPoll);
  clearInterval(state.battlePoll);
  state.roomId=id;state.round=1;state.roomMode=aiMode?"ai":"human";
  state.battleLog=[];

  if(aiMode){
    state.players=[
      makePlayer(state.clientId,state.playerName,state.selectedClass,true),
      makePlayer("ai-mage","Mika","mage"),
      makePlayer("ai-assassin","Kai","assassin"),
      makePlayer("ai-priest","Nora","priest")
    ];
    showScreen("battle");
    beginRound();
    return;
  }

  state.lastEventVersion=-1;
  state.playingServerEvents=false;
  showScreen("battle");
  if(battle)syncHumanBattle(battle,true);
  state.battlePoll=setInterval(refreshHumanBattle,700);
}

async function refreshHumanBattle(){
  if(state.roomMode!=="human"||!state.roomId)return;
  try{
    const res=await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/state`,{cache:"no-store"});
    const data=await res.json();
    if(!data.room?.battle)return;
    state.waitingRoom=data.room;
    await syncHumanBattle(data.room.battle,false);
  }catch{}
}

async function syncHumanBattle(battle,initial=false){
  if(!battle)return;
  state.round=battle.round;
  state.roundEndsAt=battle.roundEndsAt||0;
  state.targets=battle.targets||[];

  // The server owns the dealt cards, but the player owns their local order.
  // Polling must never overwrite a drag/reorder within the same round.
  const isNewRound=initial||state.renderedServerRound!==battle.round;
  if(isNewRound){
    state.cards=(battle.cards||[]).map(c=>({...c}));
    state.originalCards=state.cards.map(c=>({...c}));
  }

  state.players=(battle.players||[]).map(p=>({...p,isHuman:p.id===state.clientId,effects:p.effects||[]}));

  const me=state.players.find(p=>p.id===state.clientId);
  state.submitted=Boolean(me?.submitted);
  state.roundLocked=battle.phase!=="question";
  $("#roundLabel").textContent=`${battle.round}/${battle.maxRounds||MAX_ROUNDS}`;
  if(isNewRound)renderTargets();
  renderPlayers();

  if(battle.phase==="question"){
    if(isNewRound){
      state.renderedServerRound=battle.round;
      state.parenRange=null;state.parenSelection=[];state.parenMode=false;
      renderCards();updateFormula();hideActionStage();
    }
    $("#submitBtn").disabled=state.submitted;
    $("#submitBtn").classList.toggle("submitted",state.submitted);
    $("#answerDisplay")?.classList.toggle("submitted",state.submitted);
    updateServerTimer();
  }else{
    clearInterval(state.timerId);
    if(battle.eventVersion!==state.lastEventVersion&&!state.playingServerEvents){
      state.lastEventVersion=battle.eventVersion;
      await playServerEvents(battle);
    }else{
      renderPlayers();
    }
  }

  if(battle.phase==="ended"||battle.ended&&battle.phase!=="question"&&Date.now()>=battle.nextRoundAt){
    clearInterval(state.battlePoll);
    showResults();
  }
}

function updateServerTimer(){
  clearInterval(state.timerId);
  const tick=()=>{
    state.seconds=Math.max(0,Math.ceil((state.roundEndsAt-Date.now())/1000));
    $("#timer").textContent=state.seconds;
  };
  tick();
  state.timerId=setInterval(tick,200);
}

function hydrateSnapshot(snapshot,battlePlayers){
  return snapshot.map(x=>{
    const meta=battlePlayers.find(p=>p.id===x.id)||{};
    return {...meta,...x,isHuman:x.id===state.clientId,effects:meta.effects||[]};
  });
}

function actionNameFor(actor,actionId){
  if(actionId==="ultimate")return CLASSES[actor.classId]?.ultimate||"絕招";
  if(actionId==="attack")return actor.classId==="warlock"?"詛咒":"攻擊";
  if(actionId==="heal")return actor.classId==="warlock"?"增益":"恢復";
  return ACTION_META[actionId]?.label||"";
}

async function playServerEvents(battle){
  state.playingServerEvents=true;
  state.roundLocked=true;
  $("#submitBtn").disabled=true;
  $("#submitBtn").classList.add("submitted");
  showActionStage();

  const events=battle.events||[];
  if(!events.length){
    $("#actionClassImage").removeAttribute("src");
    $("#actionEffect").textContent="本題無人行動";
    await wait(1200);
    hideActionStage();
  }

  for(const event of events){
    const actor=battle.players.find(p=>p.id===event.actorId);
    if(!actor)continue;
    const before=hydrateSnapshot(event.before||[],battle.players);
    const after=hydrateSnapshot(event.after||[],battle.players);

    state.players=before;
    renderPlayers();
    await showActionOverlay(event.actionId,actor.classId);

    state.players=after;
    renderPlayers();
    showActionResult(actor,serverEventSummary(event,battle.players,event.actionId));

    for(const p of after){
      const prev=before.find(x=>x.id===p.id);if(!prev)continue;
      const diff=p.hp-prev.hp;
      if(diff<0)animateHit(p.id,-diff);
      else if(diff>0)animateHeal(p.id,diff);
      if(p.guardCharges>prev.guardCharges)animateGuard(p.id);
    }
    await wait(1350);
  }

  state.players=(battle.players||[]).map(p=>({...p,isHuman:p.id===state.clientId,effects:p.effects||[]}));
  renderPlayers();renderTargets();hideActionStage();
  state.playingServerEvents=false;
}

function serverEventSummary(event,players,actionId){
  const names=new Map(players.map(p=>[p.id,p.name]));
  const actor=players.find(p=>p.id===event.actorId);
  const actorName=actor?.name||"玩家";
  const parts=[];
  for(const a of event.after||[]){
    const b=(event.before||[]).find(x=>x.id===a.id);if(!b)continue;
    const targetName=names.get(a.id)||"玩家";
    if(a.hp<b.hp){
      const suffix=actor?.classId==="warlock"&&actionId==="attack"?" 2回合":"";
      parts.push(`${actorName} 造成 ${targetName} ${b.hp-a.hp} 傷害${suffix}`);
    }
    if(a.hp>b.hp){
      const suffix=actor?.classId==="warlock"&&actionId==="heal"?" 2回合":"";
      parts.push(`${actorName} 恢復 ${a.hp-b.hp}${suffix}`);
    }
    if(a.guardCharges>b.guardCharges)parts.push(`${actorName} 抵擋 +${a.guardCharges-b.guardCharges}`);
    if(a.guardCharges<b.guardCharges&&a.hp===b.hp)parts.push(`${targetName} 抵擋成功`);
  }
  return parts.join("｜")||`${actorName} 行動完成`;
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
      startRoom(data.room.id,data.room.players,false,data.room.battle);
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
  if(state.roomMode==="ai"){
    startRoom(state.waitingRoom.id,state.waitingRoom.players,true);
    return;
  }
  try{
    const stateRes=await fetch(`/api/rooms/${encodeURIComponent(state.waitingRoom.id)}/state`,{cache:"no-store"});
    const stateData=await stateRes.json();
    if(!stateData.room)throw new Error("ROOM_NOT_FOUND");
    state.waitingRoom=stateData.room;
    state.isHost=stateData.room.ownerId===state.clientId;
    if(!state.isHost)throw new Error("NOT_HOST");
    if(stateData.room.players.length<2)throw new Error("PLAYER_COUNT");

    const res=await fetch(`/api/rooms/${encodeURIComponent(state.waitingRoom.id)}/start`,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({playerId:state.clientId})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP_${res.status}`);
    state.waitingRoom=data.room;
    startRoom(data.room.id,data.room.players,false,data.room.battle);
  }catch(err){
    console.error("start room failed",err);
    alert(`無法開始房間：${err.message||"UNKNOWN"}`);
  }
}

async function leaveWaitingRoom(){
  clearInterval(state.waitingPoll);
  clearInterval(state.battlePoll);
  const room=state.waitingRoom;
  if(room&&state.roomMode==="human"){
    try{
      await fetch(`/api/rooms/${encodeURIComponent(room.id)}/leave`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({playerId:state.clientId}),
        keepalive:true
      });
    }catch{}
  }
  state.waitingRoom=null;state.isHost=false;state.roomId=null;
  renderRooms();showScreen("lobby");
}

function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}

function beginRound(){
  applyPersistentEffects();
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
  $("#submitBtn").disabled=false;
  $("#submitBtn").classList.remove("submitted");
  $("#answerDisplay")?.classList.remove("submitted");
  $("#roundLabel").textContent=`${state.round}/${MAX_ROUNDS}`;
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
  const me=state.players.find(p=>p.isHuman);
  const ultimateLocked=(me?.ultimates||0)>=2;
  $("#actionBands").innerHTML=state.targets.map(t=>`
    <div class="target-chip ${t.id==="ultimate"&&ultimateLocked?"disabled":""}" data-action="${t.id}">
      <img class="action-icon" src="./assets/images/${ACTION_META[t.id].image}" alt="">
      <span>${ACTION_META[t.id].label}</span><strong>${t.value}</strong>
    </div>`).join("");
}

function renderPlayers(){
  const strip=$("#playersStrip");
  const ids=new Set(state.players.map(p=>String(p.id)));

  // Remove only players that actually disappeared. Reusing existing DOM nodes
  // keeps avatar images decoded and prevents multiplayer polling from flashing.
  [...strip.querySelectorAll(".player-chip")].forEach(el=>{
    if(!ids.has(el.dataset.playerId))el.remove();
  });

  state.players.forEach(p=>{
    const id=String(p.id);
    const hpPct=Math.max(0,p.hp/p.maxHp*100);
    let el=[...strip.children].find(node=>node.dataset?.playerId===id);
    if(!el){
      el=document.createElement("div");
      el.className="player-chip";
      el.dataset.playerId=id;
      el.innerHTML=`
        <img class="player-avatar" alt="">
        <div class="topline">
          <span class="player-name"></span>
          <span class="player-state"></span>
          <span class="hp-value"></span>
        </div>
        <div class="hpbar"><i></i></div>`;
      strip.appendChild(el);
    }

    el.classList.toggle("dead",!p.alive);
    el.classList.toggle("self",Boolean(p.isHuman));
    const img=el.querySelector(".player-avatar");
    const src=`./assets/images/${CLASSES[p.classId]?.image||"warrior.png"}`;
    if(img.getAttribute("src")!==src)img.src=src;
    el.querySelector(".player-name").textContent=p.name;
    el.querySelector(".player-state").textContent=p.guardCharges>0?"抵擋中":"";
    el.querySelector(".hp-value").textContent=Math.max(0,p.hp);
    el.querySelector(".hpbar i").style.width=`${hpPct}%`;
    strip.appendChild(el);
  });
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
  if(state.parenMode||state.submitted||state.roundLocked||dragging)return;
  if(e.pointerType==="mouse"&&e.button!==0)return;
  e.preventDefault();
  const el=e.currentTarget;
  const row=$("#cardsRow");
  const rect=el.getBoundingClientRect();
  dragging={
    index:+el.dataset.index,
    el,row,pointerId:e.pointerId,
    startX:e.clientX,
    centerX:rect.left+rect.width/2,
    targetIndex:+el.dataset.index
  };
  try{el.setPointerCapture(e.pointerId)}catch{}
  el.classList.add("dragging");
  document.addEventListener("pointermove",dragMove,{passive:false});
  document.addEventListener("pointerup",dragEnd);
  document.addEventListener("pointercancel",dragCancel);
}
function dragMove(e){
  if(!dragging||e.pointerId!==dragging.pointerId)return;
  e.preventDefault();
  const dx=e.clientX-dragging.startX;
  dragging.el.style.transform=`translateX(${dx}px) scale(1.06)`;
  dragging.el.style.zIndex="20";

  // Decide the destination by horizontal slots only. This avoids mobile
  // getBoundingClientRect feedback from the transformed card itself.
  const cards=[...dragging.row.querySelectorAll(".card")];
  const centers=cards.map(card=>{
    if(card===dragging.el)return dragging.centerX;
    const r=card.getBoundingClientRect();
    return r.left+r.width/2;
  });
  let target=0;
  let best=Math.abs(e.clientX-centers[0]);
  for(let i=1;i<centers.length;i++){
    const d=Math.abs(e.clientX-centers[i]);
    if(d<best){best=d;target=i}
  }
  dragging.targetIndex=target;
  cards.forEach((card,i)=>card.classList.toggle("drop-target",i===target&&i!==dragging.index));
}
function finishDrag(commit){
  if(!dragging)return;
  const {index:source,targetIndex:target,el,row,pointerId}=dragging;
  document.removeEventListener("pointermove",dragMove);
  document.removeEventListener("pointerup",dragEnd);
  document.removeEventListener("pointercancel",dragCancel);
  try{el.releasePointerCapture(pointerId)}catch{}
  el.classList.remove("dragging");
  el.style.transform="";
  el.style.zIndex="";
  row.querySelectorAll(".drop-target").forEach(card=>card.classList.remove("drop-target"));
  dragging=null;

  if(commit&&target!==source){
    const [moved]=state.cards.splice(source,1);
    state.cards.splice(target,0,moved);
    state.parenRange=null;
    state.parenSelection=[];
  }
  renderCards();
  updateFormula();
}
function dragEnd(e){
  if(!dragging||e.pointerId!==dragging.pointerId)return;
  e.preventDefault();
  finishDrag(true);
}
function dragCancel(e){
  if(!dragging||e.pointerId!==dragging.pointerId)return;
  finishDrag(false);
}

function selectParen(index){
  if(!state.parenMode||state.submitted||state.roundLocked)return;
  const types=["number","op","number"],step=state.parenSelection.length;
  if(step===0){
    if(state.cards[index].type!=="number")return;
    state.parenSelection=[index];
  }else{
    const prev=state.parenSelection.at(-1);
    if(Math.abs(index-prev)!==1)return;
    if(state.cards[index].type!==types[step])return;
    const direction=step===1?Math.sign(index-prev):Math.sign(state.parenSelection[1]-state.parenSelection[0]);
    if(step===2&&index!==prev+direction)return;
    state.parenSelection.push(index);
  }
  if(state.parenSelection.length===3){
    const x=[...state.parenSelection].sort((a,b)=>a-b);
    state.parenRange=[x[0],x[2]];state.parenSelection=[];state.parenMode=false;
    $("#parenBtn").classList.remove("active");
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

function actionFor(value,classId=state.selectedClass,player=null){
  if(value===null)return {id:"invalid",name:""};
  const hit=state.targets.find(t=>Math.abs(t.value-value)<0.0001);
  if(!hit)return {id:"invalid",name:"非指定答案"};
  if(hit.id==="ultimate"){
    if((player?.ultimates||0)>=2)return {id:"invalid",name:"絕招已用完"};
    return {id:"ultimate",name:CLASSES[classId].ultimate};
  }
  if(hit.id==="attack")return {id:"attack",name:classId==="warlock"?"詛咒":"攻擊"};
  if(hit.id==="heal")return {id:"heal",name:classId==="warlock"?"增益":"恢復"};
  return {id:hit.id,name:ACTION_META[hit.id].label};
}

function updateFormula(){
  const me=state.players.find(p=>p.isHuman);
  const formula=formulaString(),value=evaluateFormula(formula),action=actionFor(value,me?.classId||state.selectedClass,me);
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

async function submitAnswer(){
  if(state.submitted||state.roundLocked)return;
  const human=state.players.find(p=>p.isHuman);if(!human?.alive)return;
  const formula=formulaString(),result=evaluateFormula(formula),action=actionFor(result,human.classId,human);
  if(result===null)return;

  if(state.roomMode==="human"){
    state.submitted=true;
    $("#answerDisplay")?.classList.add("submitted");
    $("#submitBtn").disabled=true;
    $("#submitBtn").classList.add("submitted");
    try{
      const res=await fetch(`/api/rooms/${encodeURIComponent(state.roomId)}/submit`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({playerId:state.clientId,formula})
      });
      const data=await res.json();
      if(!res.ok){
        state.submitted=false;
        $("#submitBtn").disabled=false;
        $("#submitBtn").classList.remove("submitted");
        $("#answerDisplay")?.classList.remove("submitted");
        console.error("submit failed",data);
        alert(`答案無法送出：${data.error||`HTTP_${res.status}`}`);
        return;
      }
      if(data.room?.battle)await syncHumanBattle(data.room.battle,false);
    }catch{
      state.submitted=false;
      $("#submitBtn").disabled=false;
      $("#submitBtn").classList.remove("submitted");
      $("#answerDisplay")?.classList.remove("submitted");
    }
    return;
  }

  state.submitted=true;human.submitted=true;
  human.submission={forfeit:false,formula,result,action,at:Date.now(),elapsed:ROUND_SECONDS-state.seconds};
  $("#answerDisplay")?.classList.add("submitted");
  $("#submitBtn").disabled=true;
  $("#submitBtn").classList.add("submitted");
  addLog(`${human.name} 完成 · ${human.submission.elapsed}s`);renderPlayers();updateFormula();
  finalizeRoundWhenReady(false);
}

function scheduleBots(){
  if(state.roomMode!=="ai")return;
  state.players.filter(p=>p.alive&&!p.isHuman).forEach((bot,i)=>{
    const delay=7000+Math.floor(Math.random()*38000)+i*500;
    setTimeout(()=>{
      if(state.roundLocked||!bot.alive||bot.submitted)return;
      const choice=findBotFormula(bot);
      bot.submitted=true;bot.submission=choice?{...choice,at:Date.now(),elapsed:Math.round(delay/1000)}:{forfeit:true,at:Date.now()};
      addLog(`${bot.name} ${choice?"完成":"放棄"}`);renderPlayers();finalizeRoundWhenReady(false);
    },delay);
  });
}

function findBotFormula(bot){
  const weighted=(bot.ultimates||0)>=2
    ?["execute","attack","heal","guard"]
    :["ultimate","execute","attack","heal","guard"];
  const id=weighted[Math.floor(Math.random()*weighted.length)];
  const solution=state.solutions[id]||state.solutions.attack;
  if(!solution)return null;
  return {forfeit:false,formula:solution.formula,result:solution.value,action:actionFor(solution.value,bot.classId,bot)};
}

function finalizeRoundWhenReady(force){
  if(state.roundLocked)return;
  const alive=state.players.filter(p=>p.alive);
  if(!force&&alive.some(p=>!p.submitted))return;
  state.roundLocked=true;clearInterval(state.timerId);
  state.queue=alive.filter(p=>p.submission&&!p.submission.forfeit&&p.submission.action?.id!=="invalid").sort((a,b)=>{
    const sa=Math.floor((a.submission.elapsed??ROUND_SECONDS));
    const sb=Math.floor((b.submission.elapsed??ROUND_SECONDS));
    return sa===sb?Math.random()-.5:sa-sb;
  });
  resolveQueue();
}

async function resolveQueue(){
  showActionStage();
  if(!state.queue.length){
    showActionStage();
    $("#actionClassImage").removeAttribute("src");
    $("#actionEffect").textContent="本題無人行動";
    await wait(1600);
  }
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
  const targets=previewTargets(actor,action);
  actorEl?.classList.add("acting");

  await showActionOverlay(action,actor.classId);
  targets.forEach(t=>playerEl(t.id)?.classList.add(action==="heal"||action==="guard"?"buffing":"targeted"));

  const before=new Map(state.players.map(p=>[p.id,{hp:p.hp,guard:p.guardCharges}]));
  applyAction(actor,submission);
  renderPlayers();

  const effectText=buildEffectSummary(actor,action,before);
  showActionResult(actor,effectText);

  for(const p of state.players){
    const prev=before.get(p.id);if(!prev)continue;
    const hpDiff=p.hp-prev.hp;
    if(hpDiff<0){animateHit(p.id,-hpDiff)}
    else if(hpDiff>0){animateHeal(p.id,hpDiff)}
    if(p.guardCharges>prev.guard)animateGuard(p.id);
  }

  await wait(1350);
  document.querySelectorAll(".player-chip").forEach(el=>el.classList.remove("acting","targeted","buffing","hit","heal-pop","guard-pop"));
  await wait(250);
}

function previewTargets(actor,action){
  if(action==="guard"||action==="heal")return [actor];
  if(action==="ultimate"){
    if(actor.classId==="mage")return state.players.filter(p=>p.alive&&p.id!==actor.id);
    if(actor.classId==="warrior"||actor.classId==="priest")return [actor];
    if(actor.classId==="warlock")return [highestHpEnemy(actor),actor].filter(Boolean);
    return [lowestHpEnemy(actor)].filter(Boolean);
  }
  if(action==="execute"&&actor.classId==="mage")return state.players.filter(p=>p.alive&&p.id!==actor.id);
  if(action==="execute")return [lowestHpEnemy(actor)].filter(Boolean);
  return [highestHpEnemy(actor)].filter(Boolean);
}

function applyAction(actor,submission){
  const action=submission.action.id;

  if(action==="ultimate"){
    if((actor.ultimates||0)>=2)return;
    applyUltimate(actor);
    actor.ultimates++;
    addLog(`${actor.name} · ${CLASSES[actor.classId].ultimate}`);
    return;
  }

  if(action==="guard"){
    actor.guardCharges+=1;
    addLog(`${actor.name} · 抵擋 1 次`);
    return;
  }

  if(action==="heal"){
    if(actor.classId==="warrior") heal(actor,scaled(BASE_HEAL,1.5));
    else if(actor.classId==="priest") heal(actor,scaled(BASE_HEAL,2));
    else if(actor.classId==="warlock"){
      heal(actor,scaled(BASE_HEAL,.8));
      addEffect(actor,{type:"hot",remaining:2,amount:scaled(BASE_HEAL,.8),sourceId:actor.id});
    }else heal(actor,BASE_HEAL);
    return;
  }

  if(action==="attack"){
    const target=highestHpEnemy(actor);
    if(!target)return;
    const mult={warrior:1,mage:.7,priest:1,ranger:1.5,assassin:1.5,warlock:.8}[actor.classId]??1;
    dealDamage(actor,target,scaled(BASE_DAMAGE,mult),actor.classId==="warlock"?"詛咒":"攻擊");
    if(actor.classId==="warlock"&&target.alive){
      addEffect(target,{type:"dot",remaining:2,amount:scaled(BASE_DAMAGE,.8),sourceId:actor.id});
    }
    return;
  }

  if(action==="execute"){
    if(actor.classId==="mage"){
      const enemies=state.players.filter(p=>p.alive&&p.id!==actor.id);
      const lowest=randomTiedLocal(enemies,p=>p.hp,"min");
      enemies.forEach(t=>dealDamage(actor,t,scaled(BASE_DAMAGE,t.id===lowest?.id?1.2:.6),"尾刀",false));
      return;
    }
    const target=lowestHpEnemy(actor);
    if(!target)return;
    const mult={warrior:1,priest:1,ranger:1.5,assassin:2,warlock:1.5,mage:1}[actor.classId]??1;
    dealDamage(actor,target,scaled(BASE_DAMAGE,mult),"尾刀");
  }
}

function applyUltimate(actor){
  const enemies=state.players.filter(p=>p.alive&&p.id!==actor.id);

  if(actor.classId==="warrior"){
    actor.guardCharges+=2;
    return;
  }

  if(actor.classId==="mage"){
    const highest=randomTiedLocal(enemies,p=>p.hp,"max");
    enemies.forEach(t=>dealDamage(actor,t,scaled(BASE_DAMAGE,t.id===highest?.id?1.4:.8),"元素風暴",false));
    return;
  }

  if(actor.classId==="priest"){
    heal(actor,scaled(BASE_HEAL,2.5));
    actor.guardCharges+=1;
    return;
  }

  if(actor.classId==="ranger"){
    const target=lowestHpEnemy(actor);
    if(target)dealDamage(actor,target,scaled(BASE_DAMAGE,3),"穿心連矢",false);
    heal(actor,scaled(BASE_HEAL,.5));
    return;
  }

  if(actor.classId==="assassin"){
    const target=lowestHpEnemy(actor);
    if(target){
      target.guardCharges=0;
      dealDamage(actor,target,scaled(BASE_DAMAGE,2.5),"暗影處決",false);
    }
    return;
  }

  if(actor.classId==="warlock"){
    const target=highestHpEnemy(actor);
    if(target)dealDamage(actor,target,scaled(BASE_DAMAGE,2),"命運逆轉",false);
    heal(actor,scaled(BASE_HEAL,.7));
  }
}

function addEffect(target,effect){
  target.effects=target.effects||[];
  target.effects.push(effect);
}

function applyPersistentEffects(){
  const pending=[];
  for(const target of state.players){
    if(!target.alive||!target.effects?.length)continue;
    for(const effect of target.effects){
      if(effect.remaining<=0)continue;
      if(effect.type==="dot"){
        const source=state.players.find(p=>p.id===effect.sourceId)||target;
        const dealt=dealDamage(source,target,effect.amount,"詛咒",false);
        if(dealt>0)pending.push(`${target.name} 詛咒 -${dealt}`);
      }else if(effect.type==="hot"){
        const source=state.players.find(p=>p.id===effect.sourceId)||target;
        const before=target.hp;
        heal(target,effect.amount,source);
        const gained=target.hp-before;
        if(gained>0)pending.push(`${target.name} 增益 +${gained}`);
      }
      effect.remaining--;
    }
    target.effects=target.effects.filter(e=>e.remaining>0);
  }
  pending.forEach(addLog);
  renderPlayers();
}

function heal(p,amount,source=p){
  if(!p.alive)return 0;
  const before=p.hp;
  p.hp=Math.min(p.maxHp,p.hp+amount);
  const gained=p.hp-before;
  source.healing+=gained;
  return gained;
}

function dealDamage(actor,target,raw,label,log=true){
  if(!target?.alive)return 0;
  if(target.guardCharges>0){
    target.guardCharges--;
    if(log)addLog(`${target.name} 抵擋了 ${label}`);
    return 0;
  }
  const amount=Math.max(1,Math.round(raw));
  const dealt=Math.min(target.hp,amount);
  target.hp-=dealt;
  actor.damage+=dealt;
  if(log)addLog(`${actor.name} ${label} ${target.name} · ${dealt}`);
  if(target.hp<=0){
    target.hp=0;
    target.alive=false;
    target.guardCharges=0;
    addLog(`${target.name} 淘汰`);
  }
  return dealt;
}

function highestHpEnemy(actor){return randomTiedLocal(state.players.filter(p=>p.alive&&p.id!==actor.id),p=>p.hp,"max")}
function lowestHpEnemy(actor){return randomTiedLocal(state.players.filter(p=>p.alive&&p.id!==actor.id),p=>p.hp,"min")}
function randomTiedLocal(list,getter,mode){
  if(!list.length)return null;
  const best=mode==="max"?Math.max(...list.map(getter)):Math.min(...list.map(getter));
  const tied=list.filter(x=>getter(x)===best);
  return tied[Math.floor(Math.random()*tied.length)]||null;
}

function playerEl(id){return document.querySelector(`[data-player-id="${id}"]`)}
function showActionStage(){
  $("#actionStage").classList.add("show");
  $("#formulaZone").classList.add("resolving");
  $(".battle-shell")?.classList.add("resolving-actions");
}
function hideActionStage(){
  $("#actionStage").classList.remove("show");
  $("#formulaZone").classList.remove("resolving");
  $(".battle-shell")?.classList.remove("resolving-actions");
  $("#actionClassImage").removeAttribute("src");
  $("#actionEffect").textContent="";
}
function showActionResult(actor,text){
  showActionStage();
  $("#actionClassImage").src=`./assets/images/${CLASSES[actor.classId].image}`;
  $("#actionEffect").textContent=text||`${actor.name} 行動完成`;
}
function buildEffectSummary(actor,action,before){
  const parts=[];
  for(const p of state.players){
    const prev=before.get(p.id);if(!prev)continue;
    const hpDiff=p.hp-prev.hp;
    const guardDiff=p.guardCharges-prev.guard;
    if(hpDiff<0){
      const suffix=actor.classId==="warlock"&&action==="attack"?" 2回合":"";
      parts.push(`${actor.name} 造成 ${p.name} ${-hpDiff} 傷害${suffix}`);
    }
    if(hpDiff>0){
      const suffix=actor.classId==="warlock"&&action==="heal"?" 2回合":"";
      parts.push(`${actor.name} 恢復 ${hpDiff}${suffix}`);
    }
    if(guardDiff>0)parts.push(`${actor.name} 抵擋 +${guardDiff}`);
    if(guardDiff<0&&hpDiff===0)parts.push(`${p.name} 抵擋成功`);
  }
  return parts.join("｜")||`${actor.name} 行動完成`;
}
async function showActionOverlay(actionId,classId){
  const overlay=$("#ultimateOverlay");
  const img=overlay.querySelector("img");
  const isUltimate=actionId==="ultimate";
  img.src=isUltimate
    ?`./assets/images/ultimate-${classId}.png`
    :`./assets/images/${ACTION_META[actionId]?.image||"skill-attack.png"}`;
  img.alt=isUltimate?(CLASSES[classId]?.ultimate||"絕招"):(ACTION_META[actionId]?.label||"行動");
  if(isUltimate){
    try{
      AUDIO.ultimate.currentTime=0;
      AUDIO.ultimate.play().catch(()=>{});
    }catch{}
  }
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden","false");
  await wait(isUltimate?2000:1000);
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden","true");
}
async function showUltimateOverlay(classId){
  await showActionOverlay("ultimate",classId);
}

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
    <div class="rank-row header"><span aria-hidden="true"></span><span aria-hidden="true"></span><span>傷害</span><span>恢復</span><span>絕招</span></div>
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
  state.parenMode=!state.parenMode;state.parenSelection=[];$("#parenBtn").classList.toggle("active",state.parenMode);$("#parenHint").textContent="";
};
$("#submitBtn").onclick=submitAnswer;
$("#backLobbyBtn").onclick=()=>{clearInterval(state.timerId);clearInterval(state.waitingPoll);clearInterval(state.battlePoll);renderRooms();showScreen("lobby")};


window.addEventListener("pagehide",()=>{
  const room=state.waitingRoom;
  if(!room||state.roomMode!=="human"||room.started)return;
  try{
    fetch(`/api/rooms/${encodeURIComponent(room.id)}/leave`,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({playerId:state.clientId}),
      keepalive:true
    });
  }catch{}
});

playBgmForScreen("home");

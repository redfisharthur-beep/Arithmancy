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
  timerId:null
};

const CLASSES={
  warrior:{name:"戰士",specialty:"防禦",ultimate:"絕對壁壘",target:24},
  mage:{name:"法師",specialty:"範圍攻擊",ultimate:"元素風暴",target:36},
  priest:{name:"牧師",specialty:"恢復",ultimate:"神聖回響",target:18},
  ranger:{name:"弓手",specialty:"攻擊",ultimate:"穿心連矢",target:27},
  assassin:{name:"刺客",specialty:"破防",ultimate:"暗影處決",target:21},
  warlock:{name:"術士",specialty:"增益／詛咒",ultimate:"命運逆轉",target:13}
};

const ACTIONS=[
  {label:"≤ 0",name:"詛咒",desc:"攻擊血最高"},
  {label:"1–9",name:"抵擋",desc:"獲得護盾"},
  {label:"10–19",name:"恢復",desc:"恢復／增益"},
  {label:"20–29",name:"攻擊",desc:"攻擊血最高"},
  {label:"≥ 30",name:"尾刀",desc:"攻擊血最低"}
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

function randomSharedCards(){
  const numbers=Array.from({length:3},()=>String(Math.floor(Math.random()*9)+1));
  const ops=["+","−","×","÷"];
  const operators=Array.from({length:2},()=>ops[Math.floor(Math.random()*ops.length)]);
  return [...numbers,...operators].sort(()=>Math.random()-.5).map((value,i)=>({
    id:`c${Date.now()}-${i}`,
    value,
    type:["+", "−", "×", "÷"].includes(value)?"op":"number"
  }));
}

function startRoom(id){
  state.roomId=id;
  state.round=1;
  state.cards=randomSharedCards();
  state.originalCards=state.cards.map(c=>({...c}));
  state.parenRange=null;
  state.parenSelection=[];
  state.submitted=false;
  state.seconds=30;
  const cls=CLASSES[state.selectedClass];
  $("#ultimateTarget").textContent=cls.target;
  $("#ultimateName").textContent=cls.ultimate;
  $("#actionBands").innerHTML=ACTIONS.map(a=>`<span class="band">${a.label} · ${a.name}</span>`).join("");
  renderPlayers();
  renderCards();
  updateFormula();
  showScreen("battle");
  startTimer();
}

function renderPlayers(){
  const players=[
    {name:state.playerName,cls:CLASSES[state.selectedClass].name,hp:100},
    {name:"Mika",cls:"法師",hp:82},
    {name:"Kai",cls:"刺客",hp:67},
    {name:"Nora",cls:"牧師",hp:91}
  ];
  $("#playersStrip").innerHTML=players.map(p=>`
    <div class="player-chip">
      <div class="topline"><span>${p.name} · ${p.cls}</span><span>${p.hp}</span></div>
      <div class="hpbar"><i style="width:${p.hp}%"></i></div>
    </div>`).join("");
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
  if(state.parenMode) return;
  const card=e.currentTarget;
  dragging={index:Number(card.dataset.index),el:card,pointerId:e.pointerId};
  card.classList.add("dragging");
  card.setPointerCapture?.(e.pointerId);
  card.addEventListener("pointerup",dragEnd,{once:true});
  card.addEventListener("pointercancel",dragEnd,{once:true});
}
function dragEnd(e){
  if(!dragging)return;
  const source=dragging.index;
  const targetEl=document.elementFromPoint(e.clientX,e.clientY)?.closest(".card");
  dragging.el.classList.remove("dragging");
  if(targetEl){
    const target=Number(targetEl.dataset.index);
    if(Number.isInteger(target)&&target!==source){
      const [moved]=state.cards.splice(source,1);
      state.cards.splice(target,0,moved);
      state.parenRange=null;
      state.parenSelection=[];
    }
  }
  dragging=null;
  renderCards();
  updateFormula();
}

function selectParen(index){
  if(!state.parenMode)return;
  const expectedTypes=["number","op","number"];
  const step=state.parenSelection.length;
  if(step===0){
    if(state.cards[index].type!=="number")return flashHint("先選數字");
    state.parenSelection=[index];
  }else{
    const prev=state.parenSelection[state.parenSelection.length-1];
    if(Math.abs(index-prev)!==1)return flashHint("只能選相鄰卡牌");
    if(state.cards[index].type!==expectedTypes[step])return flashHint(step===1?"第二張要選運算符號":"第三張要選數字");
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

function isValidOrder(){
  return state.cards.every((c,i)=>c.type===(i%2===0?"number":"op"));
}

function formulaString(){
  if(!isValidOrder()) return null;
  const parts=state.cards.map(c=>c.value);
  if(state.parenRange){
    parts[state.parenRange[0]]="("+parts[state.parenRange[0]];
    parts[state.parenRange[1]]=parts[state.parenRange[1]]+")";
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

function actionFor(value){
  if(value===null)return "";
  const cls=CLASSES[state.selectedClass];
  if(value===cls.target)return `${cls.ultimate} · 終極絕招`;
  if(value<=0)return "詛咒 · 攻擊血最高";
  if(value<=9)return "抵擋 · 獲得護盾";
  if(value<=19)return "恢復／增益";
  if(value<=29)return "攻擊 · 血最高";
  return "尾刀 · 血最低";
}

function updateFormula(){
  const formula=formulaString();
  const value=evaluateFormula(formula);
  $("#formulaText").textContent=formula||"排列成：數字 → 符號 → 數字 → 符號 → 數字";
  $("#formulaResult").textContent=value===null?"—":value;
  $("#matchedAction").textContent=actionFor(value);
}

function startTimer(){
  clearInterval(state.timerId);
  $("#timer").textContent=state.seconds;
  state.timerId=setInterval(()=>{
    state.seconds--;
    $("#timer").textContent=Math.max(0,state.seconds);
    if(state.seconds<=0){
      clearInterval(state.timerId);
      if(!state.submitted){
        state.submitted=true;
        flashHint("本回合放棄");
        setTimeout(()=>showResults(),850);
      }
    }
  },1000);
}

function resetFormula(){
  state.cards=state.originalCards.map(c=>({...c}));
  state.parenSelection=[];
  state.parenRange=null;
  state.parenMode=false;
  $("#parenBtn").classList.remove("active");
  renderCards();
  updateFormula();
}

function submitAnswer(){
  if(state.submitted)return;
  const formula=formulaString();
  const result=evaluateFormula(formula);
  if(result===null)return flashHint("算式尚未完成");
  state.submitted=true;
  clearInterval(state.timerId);
  $("#submitBtn").style.opacity=".55";
  flashHint(`已送出 · 順位依完成時間決定`);
  setTimeout(()=>showResults(),900);
}

function showResults(){
  const cls=CLASSES[state.selectedClass];
  const rows=[
    {name:state.playerName,damage:124,heal:36,ult:1},
    {name:"Mika",damage:156,heal:0,ult:2},
    {name:"Kai",damage:139,heal:0,ult:1},
    {name:"Nora",damage:78,heal:112,ult:1}
  ].sort((a,b)=>b.damage-a.damage);
  $("#ranking").innerHTML=`
    <div class="rank-row header"><span>#</span><span>玩家</span><span>傷害</span><span>恢復</span><span>絕招</span></div>
    ${rows.map((r,i)=>`<div class="rank-row"><strong>${i+1}</strong><span>${r.name}${r.name===state.playerName?" · "+cls.name:""}</span><span>${r.damage}</span><span>${r.heal}</span><span>${r.ult}</span></div>`).join("")}
  `;
  $("#submitBtn").style.opacity="1";
  showScreen("results");
}

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
$("#backLobbyBtn").addEventListener("click",()=>{renderRooms();showScreen("lobby")});

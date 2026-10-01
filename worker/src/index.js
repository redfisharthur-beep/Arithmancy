const ROUND_SECONDS=60;
const MAX_ROUNDS=10;
const BASE_DAMAGE=24;
const BASE_HEAL=22;
const scaled=(base,m)=>Math.round(base*m);

const CRIT_RATES={
  warrior:.20,
  mage:.25,
  priest:.20,
  ranger:.30,
  assassin:.40,
  warlock:.25
};
const CRIT_MULTIPLIER=1.5;

const CLASS_NAMES={
  warrior:"戰士",mage:"法師",priest:"牧師",ranger:"弓手",assassin:"刺客",warlock:"術士"
};

export class Lobby {
  constructor(state,env){this.state=state;this.env=env}
  async fetch(request){
    const url=new URL(request.url);
    const rooms=(await this.state.storage.get("rooms"))||{};
    const cutoff=Date.now()-2*60*1000;
    for(const [id,room] of Object.entries(rooms)){
      if((room.updatedAt||0)<cutoff||room.started)delete rooms[id];
    }
    if(request.method==="GET"){
      await this.state.storage.put("rooms",rooms);
      return Response.json({rooms:Object.values(rooms).sort((a,b)=>b.createdAt-a.createdAt)});
    }
    if(request.method==="POST"&&url.pathname.endsWith("/upsert")){
      const room=await request.json();
      if(room?.id){
        rooms[room.id]={...room,updatedAt:room.updatedAt||Date.now()};
        if(room.started)delete rooms[room.id];
        await this.state.storage.put("rooms",rooms);
      }
      return Response.json({ok:true});
    }
    if(request.method==="POST"&&url.pathname.endsWith("/remove")){
      const {id}=await request.json();
      if(id)delete rooms[id];
      await this.state.storage.put("rooms",rooms);
      return Response.json({ok:true});
    }
    return new Response("Not found",{status:404});
  }
}

export class Room {
  constructor(state,env){
    this.state=state;this.env=env;this.sessions=new Map();
  }

  async fetch(request){
    const url=new URL(request.url);
    const upgrade=request.headers.get("Upgrade");
    if(upgrade==="websocket")return this.handleSocket();

    if(request.method==="GET"&&url.pathname.endsWith("/state")){
      let room=await this.getRoom();
      if(room?.started&&room.battle){
        room=await this.advanceBattleIfNeeded(room);
      }
      return Response.json({room});
    }

    if(request.method==="POST"&&url.pathname.endsWith("/create")){
      const body=await request.json();
      const room={
        id:body.id,ownerId:body.playerId,owner:body.name,
        createdAt:Date.now(),updatedAt:Date.now(),started:false,max:6,
        players:[{id:body.playerId,name:String(body.name||"Player").slice(0,12),classId:body.classId||"warrior"}]
      };
      await this.saveRoom(room);await this.publish(room);
      return Response.json({room});
    }

    if(request.method==="POST"&&url.pathname.endsWith("/join")){
      const body=await request.json();
      const room=await this.getRoom();
      if(!room||room.started)return Response.json({error:"ROOM_UNAVAILABLE"},{status:409});
      const existing=room.players.find(p=>p.id===body.playerId);
      if(!existing&&room.players.length>=room.max)return Response.json({error:"ROOM_FULL"},{status:409});
      if(existing){
        existing.name=String(body.name||existing.name).slice(0,12);
        existing.classId=body.classId||existing.classId;
      }else{
        room.players.push({id:body.playerId,name:String(body.name||"Player").slice(0,12),classId:body.classId||"warrior"});
      }
      room.updatedAt=Date.now();
      await this.saveRoom(room);await this.publish(room);
      this.broadcast({type:"roomState",room});
      return Response.json({room});
    }

    if(request.method==="POST"&&url.pathname.endsWith("/leave")){
      const body=await request.json();
      const room=await this.getRoom();
      if(!room||room.started)return Response.json({ok:true,room});
      room.players=room.players.filter(p=>p.id!==body.playerId);
      if(room.players.length===0){
        await this.state.storage.delete("room");
        await this.removeFromLobby(room.id);
        return Response.json({ok:true,room:null});
      }
      if(room.ownerId===body.playerId){
        room.ownerId=room.players[0].id;
        room.owner=room.players[0].name;
      }
      room.updatedAt=Date.now();
      await this.saveRoom(room);await this.publish(room);
      this.broadcast({type:"roomState",room});
      return Response.json({ok:true,room});
    }

    if(request.method==="POST"&&url.pathname.endsWith("/start")){
      const body=await request.json();
      const room=await this.getRoom();
      if(!room||room.ownerId!==body.playerId)return Response.json({error:"NOT_HOST"},{status:403});
      if(room.players.length<2||room.players.length>6)return Response.json({error:"PLAYER_COUNT"},{status:409});
      room.started=true;room.updatedAt=Date.now();
      room.battle=createBattle(room.players);
      await this.saveRoom(room);await this.publish(room);
      this.broadcast({type:"started",room});
      return Response.json({room});
    }

    if(request.method==="POST"&&url.pathname.endsWith("/submit")){
      const body=await request.json();
      let room=await this.getRoom();
      if(!room?.started||!room.battle)return Response.json({error:"BATTLE_UNAVAILABLE"},{status:409});
      room=await this.advanceBattleIfNeeded(room);
      const battle=room.battle;
      if(battle.phase!=="question")return Response.json({error:"ROUND_LOCKED",room},{status:409});

      const player=battle.players.find(p=>p.id===body.playerId);
      if(!player||!player.alive)return Response.json({error:"PLAYER_UNAVAILABLE"},{status:409});
      if(player.submitted)return Response.json({error:"ALREADY_SUBMITTED",room},{status:409});

      const formula=String(body.formula||"");
      const result=validateAndEvaluate(formula,battle.cards);
      if(result===null)return Response.json({error:"INVALID_FORMULA"},{status:400});

      const hit=battle.targets.find(t=>Math.abs(t.value-result)<0.0001);
      let actionId=hit?.id||"invalid";
      if(actionId==="ultimate"&&(player.ultimates||0)>=2)actionId="invalid";
      const submittedAt=Date.now();
      const secondBucket=Math.max(0,Math.floor((submittedAt-battle.roundStartedAt)/1000));
      player.submitted=true;
      player.submission={
        formula,result,actionId,submittedAt,secondBucket,
        tieBreak:crypto.getRandomValues(new Uint32Array(1))[0]
      };
      room.updatedAt=submittedAt;

      const alive=battle.players.filter(p=>p.alive);
      if(alive.every(p=>p.submitted)){
        resolveRound(battle);
      }

      await this.saveRoom(room);
      this.broadcast({type:"battleState",battle:room.battle});
      return Response.json({room});
    }

    return new Response("Arithmancy room",{status:200});
  }

  async advanceBattleIfNeeded(room){
    const battle=room.battle;
    const now=Date.now();
    let changed=false;

    if(battle.phase==="question"&&now>=battle.roundEndsAt){
      resolveRound(battle);
      changed=true;
    }else if(battle.phase==="resolved"&&now>=battle.nextRoundAt){
      if(battle.ended){
        battle.phase="ended";
      }else{
        startNextRound(battle);
      }
      changed=true;
    }

    if(changed){
      room.updatedAt=now;
      await this.saveRoom(room);
      this.broadcast({type:"battleState",battle});
    }
    return room;
  }

  async getRoom(){return (await this.state.storage.get("room"))||null}
  async saveRoom(room){await this.state.storage.put("room",room)}

  async publish(room){
    const lobbyId=this.env.LOBBY.idFromName("global");
    const lobby=this.env.LOBBY.get(lobbyId);
    await lobby.fetch("https://lobby.internal/upsert",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({
        id:room.id,owner:room.owner,players:room.players.length,max:room.max,
        createdAt:room.createdAt,updatedAt:room.updatedAt,started:room.started
      })
    });
  }

  async removeFromLobby(roomId){
    const lobbyId=this.env.LOBBY.idFromName("global");
    const lobby=this.env.LOBBY.get(lobbyId);
    await lobby.fetch("https://lobby.internal/remove",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({id:roomId})
    });
  }

  handleSocket(){
    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    server.accept();
    const sessionId=crypto.randomUUID();
    this.sessions.set(sessionId,server);
    server.addEventListener("close",()=>this.sessions.delete(sessionId));
    server.send(JSON.stringify({type:"connected",sessionId}));
    return new Response(null,{status:101,webSocket:client});
  }

  broadcast(payload){
    const body=JSON.stringify(payload);
    for(const ws of this.sessions.values()){try{ws.send(body)}catch{}}
  }
}

function createBattle(roomPlayers){
  const battle={
    round:1,maxRounds:MAX_ROUNDS,phase:"question",ended:false,winnerId:null,
    players:roomPlayers.map(p=>({
      id:p.id,name:p.name,classId:p.classId,hp:100,maxHp:100,guardCharges:0,effects:[],
      damage:0,healing:0,ultimates:0,alive:true,submitted:false,submission:null
    })),
    cards:[],targets:[],solutions:{},roundStartedAt:0,roundEndsAt:0,
    events:[],eventVersion:0,nextRoundAt:0
  };
  prepareQuestion(battle);
  return battle;
}

function prepareQuestion(battle){
  applyPersistentEffects(battle);
  if(checkBattleEnd(battle))return;

  let setup=null,cards=null;
  for(let attempt=0;attempt<80&&!setup;attempt++){
    cards=randomSharedCards(battle.round);
    setup=buildFiveTargets(cards);
  }
  if(!setup){
    cards=[
      {id:"f1",value:"6",type:"number"},{id:"f2",value:"+",type:"op"},
      {id:"f3",value:"3",type:"number"},{id:"f4",value:"×",type:"op"},
      {id:"f5",value:"2",type:"number"}
    ];
    setup=buildFiveTargets(cards);
  }

  battle.cards=cards;
  battle.targets=setup.targets;
  battle.solutions=setup.solutions;
  battle.phase="question";
  battle.events=[];
  battle.roundStartedAt=Date.now();
  battle.roundEndsAt=battle.roundStartedAt+ROUND_SECONDS*1000;
  battle.players.filter(p=>p.alive).forEach(p=>{p.submitted=false;p.submission=null});
}

function startNextRound(battle){
  if(battle.ended){battle.phase="ended";return}
  battle.round++;
  prepareQuestion(battle);
}

function rollCritical(actor,action){
  if(action==="guard")return false;
  const rate=CRIT_RATES[actor.classId]??.20;
  const roll=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;
  return roll<rate;
}
function critAmount(amount,critical){
  return critical?Math.round(amount*CRIT_MULTIPLIER):amount;
}

function resolveRound(battle){
  if(battle.phase!=="question")return;
  const now=Date.now();
  for(const p of battle.players){
    if(p.alive&&!p.submitted){
      p.submitted=true;
      p.submission={forfeit:true,submittedAt:now,secondBucket:ROUND_SECONDS,tieBreak:crypto.getRandomValues(new Uint32Array(1))[0]};
    }
  }

  const queue=battle.players
    .filter(p=>p.alive&&p.submission&&!p.submission.forfeit&&p.submission.actionId!=="invalid")
    .sort((a,b)=>{
      const sa=a.submission,sb=b.submission;
      if(sa.secondBucket!==sb.secondBucket)return sa.secondBucket-sb.secondBucket;
      return sa.tieBreak-sb.tieBreak;
    });

  const events=[];
  for(let i=0;i<queue.length;i++){
    const actor=queue[i];
    if(!actor.alive)continue;
    const before=snapshotPlayers(battle.players);
    const critical=rollCritical(actor,actor.submission.actionId);
    const targetIds=applyAction(battle,actor,actor.submission.actionId,critical);
    const after=snapshotPlayers(battle.players);
    events.push({
      order:i+1,actorId:actor.id,actionId:actor.submission.actionId,targetIds,critical,
      before,after,summary:buildSummary(actor,before,after)
    });
    if(checkBattleEnd(battle))break;
  }

  battle.events=events;
  battle.eventVersion++;
  if(battle.round>=battle.maxRounds)finishByRanking(battle);
  else checkBattleEnd(battle);

  battle.phase="resolved";
  battle.nextRoundAt=Date.now()+Math.max(5200,events.length*5200);
}

function applyAction(battle,actor,action,critical=false){
  if(action==="guard"){
    actor.guardCharges=Math.min(2,(actor.guardCharges||0)+1);return [actor.id];
  }
  if(action==="heal"){
    if(actor.classId==="warrior"){
      addEffect(actor,{type:"hot",remaining:2,amount:critAmount(scaled(BASE_HEAL,.7),critical),sourceId:actor.id});
    }else if(actor.classId==="priest"){
      addEffect(actor,{type:"hot",remaining:2,amount:critAmount(scaled(BASE_HEAL,1.5),critical),sourceId:actor.id});
    }else if(actor.classId==="warlock"){
      heal(actor,critAmount(scaled(BASE_HEAL,.8),critical),actor);
      addEffect(actor,{type:"hot",remaining:2,amount:scaled(BASE_HEAL,.8),sourceId:actor.id});
    }else heal(actor,critAmount(BASE_HEAL,critical),actor);
    return [actor.id];
  }
  if(action==="attack"){
    const target=highestHpEnemy(battle,actor);
    if(!target)return [];
    if(actor.classId==="mage"){
      addEffect(target,{type:"dot",remaining:2,amount:critAmount(scaled(BASE_DAMAGE,.6),critical),sourceId:actor.id});
      return [target.id];
    }
    const mult={warrior:1,priest:1,ranger:1.5,assassin:1.5,warlock:.8}[actor.classId]??1;
    dealDamage(actor,target,critAmount(scaled(BASE_DAMAGE,mult),critical));
    if(actor.classId==="warlock"&&target.alive){
      addEffect(target,{type:"dot",remaining:2,amount:scaled(BASE_DAMAGE,.8),sourceId:actor.id});
    }
    return [target.id];
  }
  if(action==="execute"){
    if(actor.classId==="mage"){
      const enemies=battle.players.filter(p=>p.alive&&p.id!==actor.id);
      const lowest=randomTied(enemies,p=>p.hp,"min");
      for(const t of enemies){
        const mult=t.id===lowest?.id?1.2:.6;
        if((t.guardCharges||0)>0){
          t.guardCharges=0;
          dealDamage(actor,t,critAmount(scaled(BASE_DAMAGE,mult*.5),critical),{ignoreGuard:true});
        }else{
          dealDamage(actor,t,critAmount(scaled(BASE_DAMAGE,mult),critical));
        }
      }
      return enemies.map(p=>p.id);
    }
    const target=lowestHpEnemy(battle,actor);
    if(!target)return [];
    const mult={warrior:1,priest:1,ranger:1.5,assassin:2,warlock:1.5,mage:1}[actor.classId]??1;
    if((target.guardCharges||0)>0){
      target.guardCharges=0;
      dealDamage(actor,target,critAmount(scaled(BASE_DAMAGE,mult*.5),critical),{ignoreGuard:true});
    }else{
      dealDamage(actor,target,critAmount(scaled(BASE_DAMAGE,mult),critical));
    }
    return [target.id];
  }
  if(action==="ultimate"){
    if((actor.ultimates||0)>=2)return [];
    actor.ultimates++;
    return applyUltimate(battle,actor,critical);
  }
  return [];
}

function applyUltimate(battle,actor,critical=false){
  const enemies=battle.players.filter(p=>p.alive&&p.id!==actor.id);
  if(actor.classId==="warrior"){actor.guardCharges=Math.min(2,(actor.guardCharges||0)+2);return [actor.id]}
  if(actor.classId==="mage"){
    const highest=randomTied(enemies,p=>p.hp,"max");
    for(const t of enemies)dealDamage(actor,t,critAmount(scaled(BASE_DAMAGE,t.id===highest?.id?1.4:.8),critical));
    return enemies.map(p=>p.id);
  }
  if(actor.classId==="priest"){
    heal(actor,critAmount(scaled(BASE_HEAL,2.5),critical),actor);actor.guardCharges=Math.min(2,(actor.guardCharges||0)+1);return [actor.id];
  }
  if(actor.classId==="ranger"){
    const target=lowestHpEnemy(battle,actor);
    if(target)dealDamage(actor,target,critAmount(scaled(BASE_DAMAGE,3),critical));
    heal(actor,critAmount(scaled(BASE_HEAL,.5),critical),actor);
    return [target?.id,actor.id].filter(Boolean);
  }
  if(actor.classId==="assassin"){
    const target=lowestHpEnemy(battle,actor);
    if(target){target.guardCharges=0;dealDamage(actor,target,critAmount(scaled(BASE_DAMAGE,2.5),critical))}
    return target?[target.id]:[];
  }
  if(actor.classId==="warlock"){
    const target=highestHpEnemy(battle,actor);
    if(target)dealDamage(actor,target,critAmount(scaled(BASE_DAMAGE,2),critical));
    heal(actor,critAmount(scaled(BASE_HEAL,.7),critical),actor);
    return [target?.id,actor.id].filter(Boolean);
  }
  return [];
}

function applyPersistentEffects(battle){
  for(const target of battle.players){
    if(!target.alive||!target.effects?.length)continue;
    for(const effect of target.effects){
      if(effect.remaining<=0)continue;
      const source=battle.players.find(p=>p.id===effect.sourceId)||target;
      if(effect.type==="dot")dealDamage(source,target,effect.amount);
      if(effect.type==="hot")heal(target,effect.amount,source);
      effect.remaining--;
    }
    target.effects=target.effects.filter(e=>e.remaining>0);
  }
}

function addEffect(target,effect){
  target.effects=target.effects||[];
  target.effects.push(effect);
}

function heal(target,amount,source){
  if(!target.alive)return 0;
  const before=target.hp;
  target.hp=Math.min(target.maxHp,target.hp+amount);
  const gained=target.hp-before;
  if(source)source.healing+=gained;
  return gained;
}

function dealDamage(actor,target,amount,options={}){
  if(!target?.alive)return 0;
  if(!options.ignoreGuard&&target.guardCharges>0){target.guardCharges--;return 0}
  const dealt=Math.min(target.hp,Math.max(1,Math.round(amount)));
  target.hp-=dealt;
  actor.damage+=dealt;
  if(target.hp<=0){target.hp=0;target.alive=false;target.guardCharges=0}
  return dealt;
}

function highestHpEnemy(battle,actor){
  return randomTied(battle.players.filter(p=>p.alive&&p.id!==actor.id),p=>p.hp,"max");
}
function lowestHpEnemy(battle,actor){
  return randomTied(battle.players.filter(p=>p.alive&&p.id!==actor.id),p=>p.hp,"min");
}
function randomTied(list,getter,mode){
  if(!list.length)return null;
  const best=mode==="max"?Math.max(...list.map(getter)):Math.min(...list.map(getter));
  const tied=list.filter(x=>getter(x)===best);
  const idx=crypto.getRandomValues(new Uint32Array(1))[0]%tied.length;
  return tied[idx];
}

function snapshotPlayers(players){
  return players.map(p=>({id:p.id,hp:p.hp,guardCharges:p.guardCharges,alive:p.alive}));
}
function buildSummary(actor,before,after){
  const parts=[];
  for(const a of after){
    const b=before.find(x=>x.id===a.id);if(!b)continue;
    if(a.hp<b.hp)parts.push(`${a.id} -${b.hp-a.hp}`);
    if(a.hp>b.hp)parts.push(`${a.id} +${a.hp-b.hp}`);
    if(a.guardCharges>b.guardCharges)parts.push(`${a.id} 抵擋+${a.guardCharges-b.guardCharges}`);
    if(a.guardCharges<b.guardCharges&&a.hp===b.hp)parts.push(`${a.id} 抵擋成功`);
  }
  return parts.join("｜");
}

function checkBattleEnd(battle){
  const alive=battle.players.filter(p=>p.alive);
  if(alive.length<=1){
    battle.ended=true;
    battle.winnerId=alive[0]?.id||rankPlayers(battle.players)[0]?.id||null;
    return true;
  }
  return false;
}
function finishByRanking(battle){
  battle.ended=true;
  battle.winnerId=rankPlayers(battle.players)[0]?.id||null;
}
function rankPlayers(players){
  return [...players].sort((a,b)=>{
    if(a.alive!==b.alive)return a.alive?-1:1;
    if(b.hp!==a.hp)return b.hp-a.hp;
    if(b.damage!==a.damage)return b.damage-a.damage;
    return b.healing-a.healing;
  });
}

function randomSharedCards(round){
  const nums=Array.from({length:3},()=>String(Math.floor(Math.random()*9)+1));
  const ops=["+","−","×","÷"];
  const raw=[...nums,ops[Math.floor(Math.random()*4)],ops[Math.floor(Math.random()*4)]];
  for(let i=raw.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[raw[i],raw[j]]=[raw[j],raw[i]]}
  return raw.map((value,i)=>({id:`q${round}-${i}-${Math.random().toString(36).slice(2,5)}`,value,type:ops.includes(value)?"op":"number"}));
}

function isValidOrder(cards){return cards.every((c,i)=>c.type===(i%2===0?"number":"op"))}
function formulaString(cards,range){
  if(!isValidOrder(cards))return null;
  const p=cards.map(c=>c.value);
  if(range){p[range[0]]="("+p[range[0]];p[range[1]]=p[range[1]]+")"}
  return p.join(" ");
}
function evaluateFormula(formula){
  if(!formula)return null;
  const safe=formula.replaceAll("−","-").replaceAll("×","*").replaceAll("÷","/").replaceAll(" ","");
  if(!/^[0-9+\-*/().]+$/.test(safe))return null;

  // Cloudflare Workers blocks eval/new Function. Parse the tiny arithmetic
  // grammar directly so room creation and server-side answer validation work.
  let i=0;
  const peek=()=>safe[i];
  const eat=ch=>peek()===ch?(i++,true):false;
  const number=()=>{
    const start=i;
    while(i<safe.length&&/[0-9.]/.test(safe[i]))i++;
    if(start===i)return null;
    const token=safe.slice(start,i);
    if(!/^\d+(?:\.\d+)?$/.test(token))return null;
    const n=Number(token);
    return Number.isFinite(n)?n:null;
  };
  const factor=()=>{
    if(eat("(")){
      const v=expression();
      if(v===null||!eat(")"))return null;
      return v;
    }
    return number();
  };
  const term=()=>{
    let v=factor();
    if(v===null)return null;
    while(peek()==="*"||peek()==="/"){
      const op=safe[i++],rhs=factor();
      if(rhs===null||(op==="/"&&rhs===0))return null;
      v=op==="*"?v*rhs:v/rhs;
    }
    return v;
  };
  const expression=()=>{
    let v=term();
    if(v===null)return null;
    while(peek()==="+"||peek()==="-"){
      const op=safe[i++],rhs=term();
      if(rhs===null)return null;
      v=op==="+"?v+rhs:v-rhs;
    }
    return v;
  };

  try{
    const v=expression();
    if(v===null||i!==safe.length||!Number.isFinite(v))return null;
    return Math.round(v*100)/100;
  }catch{return null}
}
function validateAndEvaluate(formula,cards){
  if(!formula||!Array.isArray(cards)||cards.length!==5)return null;
  const safe=String(formula).replaceAll(" ","");
  if(!/^[0-9+\-−×÷*/().]+$/.test(safe))return null;

  // Parentheses are syntax, not cards. Compare exactly the three numbers and
  // two operators that were dealt, independent of the player's local order.
  const tokens=safe.match(/\d+|[+\-−×÷*/]/g)||[];
  if(tokens.length!==5)return null;
  const normalize=x=>x==="-"||x==="−"?"−":x==="*"||x==="×"?"×":x==="/"||x==="÷"?"÷":x;
  const wanted=cards.map(c=>normalize(String(c.value))).sort().join("|");
  const got=tokens.map(x=>normalize(String(x))).sort().join("|");
  if(wanted!==got)return null;

  // A valid play must alternate number/operator/number/operator/number after
  // removing parentheses; this also prevents concatenating two number cards.
  const sequence=tokens.map(x=>/^[0-9]+$/.test(x)?"number":"op");
  if(!sequence.every((type,i)=>type===(i%2===0?"number":"op")))return null;

  return evaluateFormula(safe);
}

function permutations(arr){
  if(arr.length<=1)return[arr];
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
  const useful=allReachableFormulas(cards).filter(x=>x.value>=-20&&x.value<=60);
  if(useful.length<5)return null;
  const sorted=[...useful].sort((a,b)=>a.value-b.value);
  const picks=[];
  const indices=[0,Math.floor((sorted.length-1)*.25),Math.floor((sorted.length-1)*.5),Math.floor((sorted.length-1)*.75),sorted.length-1];
  for(const idx of indices){
    let pick=sorted[idx];
    if(picks.some(p=>p.value===pick.value))pick=sorted.find(x=>!picks.some(p=>p.value===x.value));
    if(pick)picks.push(pick);
  }
  if(picks.length<5)return null;
  const parenCandidate=useful.filter(x=>x.usesParen).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value))[0];
  if(parenCandidate&&!picks.some(p=>p.value===parenCandidate.value))picks[0]=parenCandidate;
  const ordered=[
    {id:"ultimate",entry:picks[0]},{id:"attack",entry:picks[3]},{id:"guard",entry:picks[1]},
    {id:"heal",entry:picks[2]},{id:"execute",entry:picks[4]}
  ];
  if(new Set(ordered.map(x=>x.entry.value)).size<5)return null;
  return {
    targets:ordered.map(x=>({id:x.id,value:x.entry.value})),
    solutions:Object.fromEntries(ordered.map(x=>[x.id,x.entry]))
  };
}

function jsonBody(data,status=200){return Response.json(data,{status})}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==="/health")return jsonBody({ok:true,service:"arithmancy"});

    if(url.pathname==="/api/rooms"&&request.method==="GET"){
      const id=env.LOBBY.idFromName("global");
      return env.LOBBY.get(id).fetch("https://lobby.internal/list");
    }

    if(url.pathname==="/api/rooms"&&request.method==="POST"){
      const body=await request.json();
      const roomId=body.id;
      if(!roomId)return jsonBody({error:"ROOM_ID_REQUIRED"},400);
      const id=env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch("https://room.internal/create",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
      });
    }

    const match=url.pathname.match(/^\/api\/rooms\/([^/]+)\/(state|join|leave|start|submit)$/);
    if(match){
      const [,roomId,action]=match;
      const id=env.ROOMS.idFromName(roomId);
      const init=action==="state"
        ?{method:"GET"}
        :{method:"POST",headers:{"content-type":"application/json"},body:await request.text()};
      return env.ROOMS.get(id).fetch(`https://room.internal/${action}`,init);
    }

    if(url.pathname.startsWith("/room/")){
      const roomId=url.pathname.split("/")[2]||"default";
      const id=env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

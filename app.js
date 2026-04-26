import {
  SESSION,
  subscribeTicks,
  advanceTick,
  writeTick,
  resetSession,
  setRunning,
  subscribeControl
} from "./sync.js";

const $ = (id)=>document.getElementById(id);

const els = {
  status: $("status"),
  nextIn: $("nextIn"),
  syncState: $("syncState"),
  hrStatus: $("hrStatus"),

  sessionCodeView: $("sessionCodeView"),
  roleView: $("roleView"),

  hrMine: $("hrMine"),
  countMine: $("countMine"),
  lastMine: $("lastMine"),

  countOther: $("countOther"),
  lastOther: $("lastOther"),
  lastOtherCheek: $("lastOtherCheek"),
  lastOtherSession: $("lastOtherSession"),

  mutualScore: $("mutualScore"),
  mutualBar: $("mutualBar"),
  syncScore: $("syncScore"),
  syncBar: $("syncBar"),
  varScore: $("varScore"),
  varBar: $("varBar"),
  cheekScore: $("cheekScore"),
  cheekBar: $("cheekBar"),
  syncHint: $("syncHint"),

  rankName: $("rankName"),
  rankTag: $("rankTag"),
  loveKaomoji: $("loveKaomoji"),
  loveComment: $("loveComment"),

  segRest: $("segRest"),
  segTalk: $("segTalk"),
  segSilent: $("segSilent"),
  sessionNow: $("sessionNow"),

  cheekUpBtn: $("cheekUpBtn"),
  cheekSameBtn: $("cheekSameBtn"),
  cheekDownBtn: $("cheekDownBtn"),
  cheekNow: $("cheekNow"),

  connectHRBtn: $("connectHRBtn"),
  startBtn: $("startBtn"),
  stopBtn: $("stopBtn"),
  sendBtn: $("sendBtn"),
  resetBtn: $("resetBtn"),

  logMe: $("logMe"),
  logYou: $("logYou"),
};

els.sessionCodeView.textContent = SESSION.code;
els.roleView.textContent = SESSION.role;

let isRunning = false;
let timer = null;
let remain = 0;

let sessionMode = "rest";
let cheek = 0;
let prevMutualScore = 0;

let hrDevice = null;
let hrCharacteristic = null;
let latestAutoHR = null;

let displayScores = { sync: 0, vari: 0, cheekM: 0, mutual: 0 };
let targetScores  = { sync: 0, vari: 0, cheekM: 0, mutual: 0 };
let animFrame = null;
let currentCommentBucket = -1;

// ---------- Bluetooth Heart Rate ----------
function setHRStatus(text){
  if(els.hrStatus) els.hrStatus.textContent = text;
}

function parseHeartRate(value){
  const flags = value.getUint8(0);
  const is16Bit = flags & 0x01;

  if(is16Bit){
    return value.getUint16(1, true);
  }

  return value.getUint8(1);
}

async function connectHeartRate(){
  try{
    if(!navigator.bluetooth){
      alert("このブラウザはBluetooth未対応です。HTTPSのChromeまたはEdgeで試してください。");
      setHRStatus("未対応");
      return;
    }

    setHRStatus("検索中...");
    els.connectHRBtn.disabled = true;
    els.connectHRBtn.textContent = "検索中...";

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ["heart_rate"] }
      ],
      optionalServices: ["heart_rate"]
    });

    hrDevice = device;
    setHRStatus("接続中: " + (device.name || "心拍計"));

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const characteristic = await service.getCharacteristic("heart_rate_measurement");

    hrCharacteristic = characteristic;

    await characteristic.startNotifications();

    characteristic.addEventListener("characteristicvaluechanged", (event)=>{
      const hr = parseHeartRate(event.target.value);

      if(!Number.isFinite(hr) || hr <= 0) return;

      latestAutoHR = hr;
      els.hrMine.value = hr;
      els.lastMine.textContent = hr + " bpm";

      setHRStatus("接続中: " + hr + " bpm");
      els.connectHRBtn.textContent = "心拍接続中";
    });

    device.addEventListener("gattserverdisconnected", ()=>{
      setHRStatus("切断");
      els.connectHRBtn.disabled = false;
      els.connectHRBtn.textContent = "心拍計に再接続";
      hrDevice = null;
      hrCharacteristic = null;
    });

    setHRStatus("接続成功。心拍受信待ち...");
    els.connectHRBtn.textContent = "心拍接続中";

  }catch(e){
    console.error(e);
    setHRStatus("接続失敗");
    els.connectHRBtn.disabled = false;
    els.connectHRBtn.textContent = "心拍計に接続";
    alert("心拍計の接続に失敗しました。\n\n" + e.message);
  }
}

// ---------- UI helper ----------
function setConnected(ok, msg=""){
  els.syncState.textContent = ok ? "接続中" : "未接続";
  els.syncHint.textContent = msg || (ok ? "— Syncing…" : "— Not connected");
}

function sign(x){
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

function clamp100(n){
  return Math.max(0, Math.min(100, Math.round(n)));
}

function lerp(a, b, t){
  return a + (b - a) * t;
}

function setMeter(elBar, score){
  if(!elBar) return;
  elBar.style.width = `${Math.max(0, Math.min(100, score))}%`;
}

function rankFor(score){
  const s = score;

  if(s >= 95) return ["Destiny", "— 伝説の空気"];
  if(s >= 85) return ["Crush", "— 近い、近いって"];
  if(s >= 70) return ["Sync", "— テンポが合ってる"];
  if(s >= 55) return ["Warm", "— 上がりはじめ"];
  if(s >= 40) return ["Neutral", "— 様子見"];
  if(s >= 25) return ["Awkward", "— まだ硬い"];

  return ["Quiet", "— 準備中"];
}

function kaomojiFor(score){
  const s = score;

  if(s >= 95) return "( 💖‿💖 )";
  if(s >= 85) return "(♡ˊᵕˋ♡)";
  if(s >= 70) return "(´,,•ω•,,)♡";
  if(s >= 55) return "(//ω//)";
  if(s >= 40) return "(・∀・)";
  if(s >= 25) return "(•_•;)";

  return "(・_・)";
}

function commentFor(score){
  const pick = (arr)=>arr[Math.floor(Math.random() * arr.length)];
  const s = score;

  if(s >= 95) return pick(["目が💖になってるやつ","これは…イベント発生。","完全にヒロインルート"]);
  if(s >= 85) return pick(["距離、近いって。","会話のテンポ神","空気が甘い"]);
  if(s >= 70) return pick(["いい感じに噛み合ってる","ちょいドキドキ域","シンクロしてきた"]);
  if(s >= 55) return pick(["これから上がるやつ","まだ序盤って感じ","悪くない"]);
  if(s >= 40) return pick(["様子見フェーズ","ちょっと緊張？","空気が読めてきた"]);
  if(s >= 25) return pick(["すれ違い気味？","まだウォームアップ","相手のターン待ち"]);

  return pick(["0から始めるLOVE","まず深呼吸","今日の天気の話から"]);
}

function commentBucket(score){
  if(score >= 95) return 6;
  if(score >= 85) return 5;
  if(score >= 70) return 4;
  if(score >= 55) return 3;
  if(score >= 40) return 2;
  if(score >= 25) return 1;

  return 0;
}

function updateScoreTexts(sync, vari, cheekM, mutual){
  els.syncScore.textContent = clamp100(sync);
  if(els.varScore) els.varScore.textContent = clamp100(vari);
  els.cheekScore.textContent = clamp100(cheekM);
  els.mutualScore.textContent = clamp100(mutual);

  setMeter(els.syncBar, sync);
  setMeter(els.varBar, vari);
  setMeter(els.cheekBar, cheekM);
  setMeter(els.mutualBar, mutual);

  const [rk, tag] = rankFor(mutual);
  els.rankName.textContent = rk;
  els.rankTag.textContent = tag;
  els.loveKaomoji.textContent = kaomojiFor(mutual);

  const bucket = commentBucket(mutual);
  if(bucket !== currentCommentBucket){
    currentCommentBucket = bucket;
    els.loveComment.textContent = commentFor(mutual);
  }
}

function animateScores(){
  let moving = false;

  displayScores.sync = lerp(displayScores.sync, targetScores.sync, 0.16);
  displayScores.vari = lerp(displayScores.vari, targetScores.vari, 0.16);
  displayScores.cheekM = lerp(displayScores.cheekM, targetScores.cheekM, 0.16);
  displayScores.mutual = lerp(displayScores.mutual, targetScores.mutual, 0.16);

  for(const key of ["sync", "vari", "cheekM", "mutual"]){
    if(Math.abs(displayScores[key] - targetScores[key]) < 0.2){
      displayScores[key] = targetScores[key];
    }else{
      moving = true;
    }
  }

  updateScoreTexts(displayScores.sync, displayScores.vari, displayScores.cheekM, displayScores.mutual);

  if(moving){
    animFrame = requestAnimationFrame(animateScores);
  }else{
    animFrame = null;
  }
}

function setAnimatedTargets(sync, vari, cheekM, mutual){
  targetScores.sync = clamp100(sync);
  targetScores.vari = clamp100(vari);
  targetScores.cheekM = clamp100(cheekM);
  targetScores.mutual = clamp100(mutual);

  if(animFrame === null){
    animFrame = requestAnimationFrame(animateScores);
  }
}

function spawnScoreUpHearts(diff = 3){
  const layer = document.getElementById("heartBurstLayer");
  if(!layer) return;

  const count = diff >= 15 ? 9 : diff >= 10 ? 7 : diff >= 5 ? 5 : 3;
  const symbols = ["💖", "💗", "💕", "✨", "⭐"];

  for(let i = 0; i < count; i++){
    const item = document.createElement("div");
    item.className = "heartBurst";

    const isSpark = Math.random() < 0.22;
    item.textContent = isSpark ? (Math.random() < 0.5 ? "✨" : "⭐") : symbols[Math.floor(Math.random() * 3)];

    const left = 50 + (Math.random() * 34 - 17);
    const drift = (Math.random() * 80 - 40).toFixed(0);
    const rise = (90 + Math.random() * 70).toFixed(0);
    const scale = (0.8 + Math.random() * 0.9).toFixed(2);
    const delay = (i * 0.05 + Math.random() * 0.12).toFixed(2);
    const duration = (1.2 + Math.random() * 0.8).toFixed(2);
    const rotate = (-18 + Math.random() * 36).toFixed(0);

    item.style.left = `${left}%`;
    item.style.setProperty("--driftX", `${drift}px`);
    item.style.setProperty("--riseY", `${rise}px`);
    item.style.setProperty("--burstScale", scale);
    item.style.setProperty("--burstRotate", `${rotate}deg`);
    item.style.animationDelay = `${delay}s`;
    item.style.animationDuration = `${duration}s`;
    item.style.fontSize = `${20 + Math.random() * 18}px`;

    if(isSpark){
      item.classList.add("sparkBurst");
    }

    layer.appendChild(item);
    setTimeout(() => item.remove(), (Number(duration) + Number(delay) + 0.25) * 1000);
  }
}

// ---------- segments ----------
function setSeg(active){
  sessionMode = active;
  els.sessionNow.textContent = active === "rest" ? "安静" : (active === "talk" ? "会話" : "無言");

  [els.segRest, els.segTalk, els.segSilent].forEach(b => b.classList.remove("isActive"));
  (active === "rest" ? els.segRest : active === "talk" ? els.segTalk : els.segSilent).classList.add("isActive");
}

els.segRest.onclick = ()=>setSeg("rest");
els.segTalk.onclick = ()=>setSeg("talk");
els.segSilent.onclick = ()=>setSeg("silent");
setSeg("rest");

function setCheek(v){
  cheek = v;
  els.cheekNow.textContent = v === 1 ? "上がった" : v === 0 ? "変わらない" : "下がった";

  [els.cheekUpBtn, els.cheekSameBtn, els.cheekDownBtn].forEach(b => b.classList.remove("isActive"));
  (v === 1 ? els.cheekUpBtn : v === 0 ? els.cheekSameBtn : els.cheekDownBtn).classList.add("isActive");
}

els.cheekUpBtn.onclick = ()=>setCheek(1);
els.cheekSameBtn.onclick = ()=>setCheek(0);
els.cheekDownBtn.onclick = ()=>setCheek(-1);
setCheek(0);

// ---------- scoring ----------
function computeScores(ticksObj){
  if(!ticksObj) return { sync:0, vari:0, cheekM:0, mutual:0, denom:0, nRows:0 };

  const rows = [];
  const keys = Object.keys(ticksObj).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);

  for(const k of keys){
    const item = ticksObj[String(k)];
    if(!item) continue;

    const me = item.me || null;
    const you = item.you || null;

    if(me && you){
      rows.push({
        tick: k,
        hrA: Number(me.hr),
        hrB: Number(you.hr),
        cA: Number(me.cheek),
        cB: Number(you.cheek),
      });
    }
  }

  const cheekBothUp = rows.filter(r => r.cA === 1 && r.cB === 1).length;
  const cheekM = rows.length ? (cheekBothUp / rows.length) : 0;

  if(rows.length < 2){
    return {
      sync: 0,
      vari: 0,
      cheekM: clamp100(cheekM * 100),
      mutual: 0,
      denom: 0,
      nRows: rows.length
    };
  }

  let denom = 0;
  let numer = 0;

  for(let i = 1; i < rows.length; i++){
    const dA = rows[i].hrA - rows[i - 1].hrA;
    const dB = rows[i].hrB - rows[i - 1].hrB;

    const sA = sign(dA);
    const sB = sign(dB);

    if(sA !== 0){
      denom++;
      if(sA === sB) numer++;
    }
  }

  const sync = denom ? (numer / denom) : 0;

  const hrAValues = rows.map(r => r.hrA).filter(Number.isFinite);
  const hrBValues = rows.map(r => r.hrB).filter(Number.isFinite);

  const rangeA = hrAValues.length ? Math.max(...hrAValues) - Math.min(...hrAValues) : 0;
  const rangeB = hrBValues.length ? Math.max(...hrBValues) - Math.min(...hrBValues) : 0;

  const avgRange = (rangeA + rangeB) / 2;
  const vari = Math.min(avgRange * 2, 100);

  const mutual =
    0.6 * (sync * 100) +
    0.3 * vari +
    0.1 * (cheekM * 100);

  return {
    sync: clamp100(sync * 100),
    vari: clamp100(vari),
    cheekM: clamp100(cheekM * 100),
    mutual: clamp100(mutual),
    denom,
    nRows: rows.length
  };
}

// ---------- render ----------
function renderFromTicks(ticks){
  const { sync, vari, cheekM, mutual, denom, nRows } = computeScores(ticks);

  if(mutual > prevMutualScore){
    const diff = mutual - prevMutualScore;
    spawnScoreUpHearts(diff);
  }

  prevMutualScore = mutual;

  setAnimatedTargets(sync, vari, cheekM, mutual);

  els.syncHint.textContent = nRows < 2
    ? "— まずは2回以上、両者が送信してね"
    : `— SYNC計算点数: ${denom}点（ΔA≠0の回数） / VAR: ${vari}`;

  const keys = ticks ? Object.keys(ticks).map(Number).filter(Number.isFinite).sort((a,b)=>b-a) : [];
  const show = keys.slice(0,10).reverse();

  els.logMe.innerHTML = "";
  els.logYou.innerHTML = "";

  let myCount = 0;
  let otherCount = 0;
  let myLast = null;
  let otherLast = null;

  for(const k of show){
    const item = ticks[String(k)];
    if(!item) continue;

    if(item.me){
      myCount++;
      myLast = item.me;

      const li = document.createElement("li");
      li.textContent = `#${k} hr=${item.me.hr} cheek=${item.me.cheek} mode=${item.me.mode || "-"}`;
      els.logMe.appendChild(li);
    }

    if(item.you){
      otherCount++;
      otherLast = item.you;

      const li = document.createElement("li");
      li.textContent = `#${k} hr=${item.you.hr} cheek=${item.you.cheek} mode=${item.you.mode || "-"}`;
      els.logYou.appendChild(li);
    }
  }

  els.countMine.textContent = myCount;
  els.countOther.textContent = otherCount;

  if(myLast){
    els.lastMine.textContent = myLast.hr;
  }else if(latestAutoHR){
    els.lastMine.textContent = latestAutoHR + " bpm";
  }else{
    els.lastMine.textContent = "-";
  }

  els.lastOther.textContent = otherLast ? otherLast.hr : "-";

  els.lastOtherCheek.textContent =
    otherLast ? (otherLast.cheek === 1 ? "上がった" : otherLast.cheek === 0 ? "変わらない" : "下がった") : "-";

  els.lastOtherSession.textContent =
    otherLast ? (otherLast.mode === "rest" ? "安静" : otherLast.mode === "talk" ? "会話" : "無言") : "-";
}

// ---------- send ----------
function getMyHR(){
  const v = Number(els.hrMine.value);
  if(!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v);
}

async function sendNow(){
  const hr = getMyHR();

  if(hr === null){
    alert("心拍数を入力してね（例: 78）");
    return;
  }

  try{
    setConnected(true, "— Sending…");

    const currentTick = await advanceTick();

    await writeTick(currentTick, {
      hr,
      cheek,
      mode: sessionMode,
      source: latestAutoHR ? "bluetooth_or_input" : "manual",
      measuredAt: Date.now()
    });

    els.status.textContent = "送信しました";
    setConnected(true, "— Syncing…");

  }catch(e){
    console.error(e);
    els.status.textContent = "送信失敗";
    setConnected(false, "— Error");
    alert("送信に失敗しました（Wi-Fi / Firebase / URLを確認）");
  }
}

// ---------- local timer ----------
function runLocalStart(){
  if(isRunning) return;

  isRunning = true;
  els.status.textContent = "計測中";

  remain = 10;
  els.nextIn.textContent = `${remain}s`;

  timer = setInterval(async ()=>{
    remain--;

    if(remain <= 0){
      remain = 10;

      const hr = getMyHR();

      if(hr !== null){
        await sendNow();
      }else{
        els.status.textContent = "計測中（心拍入力待ち）";
      }
    }

    els.nextIn.textContent = `${remain}s`;
  }, 1000);
}

function runLocalStop(){
  isRunning = false;

  if(timer){
    clearInterval(timer);
    timer = null;
  }

  els.status.textContent = "停止中";
  els.nextIn.textContent = "-";
}

// ---------- synced control ----------
async function startMeasure(){
  if(SESSION.role === "me"){
    await setRunning(true);
  }

  runLocalStart();
}

async function stopMeasure(){
  if(SESSION.role === "me"){
    await setRunning(false);
  }

  runLocalStop();
}

// ---------- buttons wiring ----------
els.connectHRBtn.onclick = ()=>connectHeartRate();
els.startBtn.onclick = ()=>startMeasure();
els.stopBtn.onclick = ()=>stopMeasure();
els.sendBtn.onclick = ()=>sendNow();

els.resetBtn.onclick = async ()=>{
  if(SESSION.role !== "me"){
    alert("リセットはme側だけ実行できます");
    return;
  }

  if(confirm("セッションのデータを全部消します。OK？")){
    await resetSession();

    prevMutualScore = 0;
    targetScores = { sync: 0, vari: 0, cheekM: 0, mutual: 0 };
    displayScores = { sync: 0, vari: 0, cheekM: 0, mutual: 0 };

    updateScoreTexts(0, 0, 0, 0);
    runLocalStop();

    alert("リセットしました。相手側も再読み込みしてね。");
  }
};

// ---------- subscribe ----------
updateScoreTexts(0, 0, 0, 0);
setHRStatus("未接続");
setConnected(true, "— Connecting…");

subscribeTicks((ticks)=>{
  setConnected(true, "— Syncing…");
  renderFromTicks(ticks);
});

subscribeControl((ctrl)=>{
  if(!ctrl) return;

  if(ctrl.running && !isRunning){
    runLocalStart();
  }

  if(!ctrl.running && isRunning){
    runLocalStop();
  }
});
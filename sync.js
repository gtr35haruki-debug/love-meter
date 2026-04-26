import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getDatabase, ref, set, onValue, get, remove } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDa37qvYDZsdQC6EpMqiNpUqhEXoszvjRA",
  authDomain: "lovemeter-577b4.firebaseapp.com",
  databaseURL: "https://lovemeter-577b4-default-rtdb.firebaseio.com",
  projectId: "lovemeter-577b4",
  storageBucket: "lovemeter-577b4.firebasestorage.app",
  messagingSenderId: "21237442454",
  appId: "1:21237442454:web:152aacdf897e5e8052dfb7",
  measurementId: "G-B6YJ5TVHNQ"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

function loadSession(){
  const code = (localStorage.getItem("lm_code") || "").trim().toUpperCase();
  const roleRaw = (localStorage.getItem("lm_role") || "").trim().toLowerCase();
  const role = (roleRaw === "me" || roleRaw === "you") ? roleRaw : "";

  if(!code || !role){
    throw new Error("Session not initialized (role/code missing).");
  }

  return { code, role };
}

export const SESSION = loadSession();

const base = `sessions/${SESSION.code}`;

const tickRef = ref(db, `${base}/tick`);
const ticksRef = ref(db, `${base}/ticks`);
const controlRef = ref(db, `${base}/control`);

const latestMeRef = ref(db, `${base}/me/latest`);
const latestYouRef = ref(db, `${base}/you/latest`);

export async function getTick(){
  const snap = await get(tickRef);
  return snap.exists() ? Number(snap.val()) : 0;
}

export async function advanceTick(){
  // MEだけがtickを進める
  if(SESSION.role !== "me"){
    return await getTick();
  }

  const cur = await getTick();
  const nxt = cur + 1;
  await set(tickRef, nxt);
  return nxt;
}

export async function writeTick(tick, payload){
  const t = Number(tick);
  if(!Number.isFinite(t) || t <= 0) return;

  const data = {
    ...payload,
    tick: t,
    role: SESSION.role,
    tLocal: Date.now()
  };

  await set(ref(db, `${base}/ticks/${t}/${SESSION.role}`), data);
  await set(ref(db, `${base}/${SESSION.role}/latest`), data);
}

export function subscribeTicks(cb){
  onValue(ticksRef, (snap)=>{
    cb(snap.exists() ? snap.val() : null);
  });
}

export function subscribeLatest(cb){
  onValue(latestMeRef, ()=>{});
  onValue(latestYouRef, ()=>{});

  onValue(ref(db, base), (snap)=>{
    const v = snap.exists() ? snap.val() : null;
    cb(v);
  });
}

export async function setRunning(isRunning){
  // START/STOPの司令塔はMEだけ
  if(SESSION.role !== "me") return;

  await set(controlRef, {
    running: !!isRunning,
    updatedAt: Date.now(),
    controller: "me"
  });
}

export function subscribeControl(cb){
  onValue(controlRef, (snap)=>{
    cb(snap.exists() ? snap.val() : null);
  });
}

export async function resetSession(){
  // 研究用：全部消す。MEだけ許可
  if(SESSION.role !== "me") return;
  await remove(ref(db, base));
}
// ===== 常數與狀態 =====
const DEFAULT_POOL = [
  "不能說「對」",
  "不能說「不」",
  "不能說「是」",
  "不能笑出聲",
  "不能摸頭髮",
  "不能說別人的名字",
  "不能交叉雙手",
  "不能碰手機",
  "不能用英文",
  "不能說數字",
  "不能提到工作",
  "不能說「好喝」",
  "不能疊字",
  "不能說謝謝",
  "不能提問",
  "不能說任何顏色",
  "不能說「好」",
  "不能摸臉",
  "不能說「超」",
  "不能說「真的」",
  "不能說「我覺得」",
  "不能說天氣",
  "不能說飲料名字",
  "不能說店名",
  "不能把杯子放桌上",
];

const state = {
  me: { id: uid(), name: "" },
  room: { code: "", sbUrl: "", sbKey: "" },

  connected: false,
  hostId: "", // 由 presence 即時計算，不寫入 localStorage
  players: [], // {id, name, rule?}
  pool: DEFAULT_POOL.slice(),
  lastHitAt: 0,
  lastTargetId: "",
};

const STORAGE_KEY = "forbidden_party_hostlock_v1";
function save() {
  const { hostId, ...rest } = state; // 不保存 hostId
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
}
function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    state.me.id = obj.me?.id || state.me.id;
    state.me.name = obj.me?.name || "";
    state.room = { ...state.room, ...obj.room };
    state.pool =
      Array.isArray(obj.pool) && obj.pool.length ? obj.pool : state.pool;
  } catch {}
}
load();

// ===== DOM =====
const $ = (s, el = document) => el.querySelector(s);
const views = { join: $("#view-join"), board: $("#view-board") };
const formJoin = $("#formJoin");
const inpName = $("#inpName");
const roomHint = $("#roomHint");
const hostSetup = $("#hostSetup");
const inpRoom = $("#inpRoom");
const inpSbUrl = $("#inpSbUrl");
const inpSbKey = $("#inpSbKey");
const btnSaveSetup = $("#btnSaveSetup");

const board = $("#board");
const presenceEl = $("#presence");
const roomCodeEl = $("#roomCode");
const hostBar = $("#hostBar");
const btnRedistribute = $("#btnRedistribute");
const btnReset = $("#btnReset");
const poolStat = $("#poolStat");

const inpNewRule = $("#inpNewRule");
const btnAddRule = $("#btnAddRule");
const addHint = $("#addHint");

const dlgHit = $("#dlgHit");
const hitName = $("#hitName");
const hitRule = $("#hitRule");
const btnCloseHit = $("#btnCloseHit");

const dlgGuess = $("#dlgGuess");
const inpGuess = $("#inpGuess");
const btnSubmitGuess = $("#btnSubmitGuess");
const btnSkipGuess = $("#btnSkipGuess");

const dlgResult = $("#dlgResult");
const resultTitle = $("#resultTitle");
const resultBody = $("#resultBody");
const btnCloseResult = $("#btnCloseResult");

const btnInfo = $("#btnInfo");
const dlgInfo = $("#dlgInfo");
const btnCloseInfo = $("#btnCloseInfo");

const dlgReset = $("#dlgReset");
const btnReloadNow = $("#btnReloadNow");

// ===== Supabase Realtime =====
let supabaseClient = null;
let channel = null;
let presence = {}; // presence cache

// ===== URL 參數初始化 =====
function initFromUrl() {
  const u = new URL(location.href);
  const url = u.searchParams.get("sb");
  const key = u.searchParams.get("key");
  const code = u.searchParams.get("room");
  if (url) state.room.sbUrl = decodeURIComponent(url);
  if (key) state.room.sbKey = decodeURIComponent(key);
  if (code) state.room.code = code;

  const ready = !!(state.room.sbUrl && state.room.sbKey && state.room.code);
  hostSetup.classList.toggle("hidden", ready);
  roomHint.textContent = ready
    ? `你將加入房間：${state.room.code}`
    : "主持人尚未設定房間；請用帶參數網址，或由你填寫下方主持人設定。";
  inpRoom.value = state.room.code || "";
  inpSbUrl.value = state.room.sbUrl || "";
  inpSbKey.value = state.room.sbKey || "";
}
initFromUrl();

btnSaveSetup.addEventListener("click", () => {
  state.room.code = inpRoom.value.trim() || state.room.code;
  state.room.sbUrl = inpSbUrl.value.trim() || state.room.sbUrl;
  state.room.sbKey = inpSbKey.value.trim() || state.room.sbKey;
  save();
  alert("已儲存主持人設定。建議把 ?sb=&key=&room= 參數加到網址分享。");
  initFromUrl();
});

// ===== Host 計算工具（以 presence 內 id 字典序最小者為 Host）=====
function calcHostId() {
  try {
    const st = channel?.presenceState?.() || {};
    const ids = Object.values(st)
      .flat()
      .map((m) => m.id)
      .filter(Boolean)
      .sort();
    return ids[0] || "";
  } catch {
    return "";
  }
}
function amIHost() {
  return state.me.id && state.hostId && state.me.id === state.hostId;
}
function updateHostUI() {
  // ✅ 以 body 類別控制可見性（CSS 已預設隱藏 hostbar）
  document.body.classList.toggle("is-host", amIHost());
}

// ===== UI =====
function showView(key) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[key].classList.add("active");
}
function renderBoard() {
  board.innerHTML = "";
  state.players.forEach((p) => {
    const showRule =
      p.id === state.me.id ? "（你的禁令已隱藏）" : p.rule || "（等待分配…）";
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="name">${p.name}${p.id === state.me.id ? "（你）" : ""}</div>
      <div class="rule ${p.id === state.me.id ? "muted" : ""}">${showRule}</div>
    `;

    // Host 專用：單人重抽（只在主持人端渲染 chip）
    if (amIHost()) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = "重抽";
      chip.title = "替此人重新分配禁令";
      chip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        reassignOneAndBroadcast(p.id);
      });
      card.appendChild(chip);
    }

    // 抓到犯規：點別人的卡片才有效
    card.addEventListener("click", () => {
      if (p.id === state.me.id) return;
      if (Date.now() - state.lastHitAt < 900) return;
      state.lastHitAt = Date.now();
      save();
      send({
        t: "VIOLATION",
        playerId: p.id,
        actorId: state.me.id,
        ts: Date.now(),
      });
      flashCard(p.id);
    });

    board.appendChild(card);
  });
  roomCodeEl.textContent = state.room.code || "—";
  poolStat.textContent = `禁令池：${state.pool.length} 條`;
  updateHostUI(); // 保證 host UI 正確
}
btnInfo.addEventListener("click", () => dlgInfo.showModal());
btnCloseInfo.addEventListener("click", () => dlgInfo.close());
btnCloseHit.addEventListener("click", () => dlgHit.close());
btnCloseResult.addEventListener("click", () => dlgResult.close());
btnReloadNow.addEventListener("click", () => hardReload());

// 卡片閃紅動畫
function flashCard(id) {
  const el = board.querySelector(`.card[data-id="${id}"]`);
  if (!el) return;
  el.classList.add("violation");
  setTimeout(() => el.classList.remove("violation"), 950);
}

// ===== 入場流程 =====
formJoin.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = (inpName.value || "").trim();
  if (!name) return;
  state.me.name = name;
  save();

  if (!state.room.sbUrl || !state.room.sbKey || !state.room.code) {
    alert("缺少房間設定。請向主持人索取帶參數的網址，或在下方填寫主持人設定。");
    return;
  }
  await connect();

  // 上線後：自報姓名、請求全量
  send({ t: "ADD_SELF", player: { id: state.me.id, name: state.me.name } });
  upsertPlayer({ id: state.me.id, name: state.me.name });
  send({ t: "REQUEST_FULL" });

  showView("board");
  updateHostUI();
  renderBoard();
});

// ===== 連線 / Presence / 廣播 =====
async function connect() {
  if (!supabaseClient)
    supabaseClient = window.supabase.createClient(
      state.room.sbUrl,
      state.room.sbKey
    );
  if (channel) await channel.unsubscribe();

  channel = supabaseClient.channel(`room:${state.room.code}`, {
    config: { broadcast: { ack: true }, presence: { key: state.me.id } },
  });
  channel.on("presence", { event: "sync" }, onPresenceSync);
  channel.on("broadcast", { event: "evt" }, ({ payload }) =>
    onMessage(payload)
  );

  await channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      state.connected = true;
      save();
      channel.track({
        id: state.me.id,
        name: state.me.name,
        joinedAt: Date.now(),
      });
    }
  });
}

function onPresenceSync() {
  const st = channel.presenceState();
  presence = st;
  const metas = Object.values(st).flat();

  // 全員把 presence 名單 upsert 到本地，立即互相可見
  metas.forEach((m) => upsertPlayer({ id: m.id, name: m.name || "玩家" }));

  // 由 presence 即時計算 hostId（id 字典序最小者）
  const newHostId = calcHostId();
  if (newHostId && newHostId !== state.hostId) {
    state.hostId = newHostId; // 不存 localStorage
  }

  // 在線顯示
  const names = metas.map((m) => m.name || "").filter(Boolean);
  presenceEl.textContent = names.join("、") || "—";

  // 只有主持人才會觸發自動分配
  if (amIHost()) assignRulesIfNeeded();

  updateHostUI();
  renderBoard();
}

// ===== 規則分配 =====
function assignRulesIfNeeded() {
  const used = new Set(state.players.filter((p) => p.rule).map((p) => p.rule));
  const available = state.pool.filter((r) => !used.has(r));
  const need = state.players.filter((p) => !p.rule);

  need.forEach((p, i) => {
    const rule = available[i] ?? fallbackRule(p);
    p.rule = rule;
    send({ t: "ASSIGN_RULE", id: p.id, rule });
    upsertPlayer({ id: p.id, rule });
  });
  save();
  renderBoard();
}

// Host：全員重分配
btnRedistribute.addEventListener("click", () => {
  if (!amIHost()) return;
  reassignAllAndBroadcast();
});
function reassignAllAndBroadcast() {
  const mapping = buildNewMappingForPlayers(state.players);
  mapping.forEach((m) => upsertPlayer({ id: m.id, rule: m.rule }));
  save();
  renderBoard();
  send({ t: "ASSIGN_BULK", mapping });
}

// ✅ Host：重新開始（清房）
btnReset.addEventListener("click", () => {
  if (!amIHost()) return;
  const ok = confirm("確定要重新開始？這會把所有玩家請出房間，並刷新頁面。");
  if (!ok) return;
  // 廣播重置事件
  send({ t: "RESET", by: state.me.id, at: Date.now() });
  // 稍等 150ms 讓訊息送達，再本機重載
  setTimeout(() => hardReload(), 150);
});

// ===== 新增禁令（任何人） =====
btnAddRule.addEventListener("click", () => {
  const text = (inpNewRule.value || "").trim();
  if (!text) return showAddHint("請輸入內容");
  if (text.length > 60) return showAddHint("太長了（最多 60 字）");
  if (!state.pool.includes(text)) {
    state.pool.push(text);
    save();
  }
  showAddHint("已送出，等待同步");
  inpNewRule.value = "";
  send({ t: "SUGGEST_RULE", text, from: state.me.id });
});
function showAddHint(msg) {
  addHint.textContent = msg;
  setTimeout(() => (addHint.textContent = ""), 1500);
}

// ===== 廣播封裝 =====
function send(payload) {
  if (channel) channel.send({ type: "broadcast", event: "evt", payload });
}

// ===== 訊息處理 =====
function onMessage(msg) {
  switch (msg.t) {
    case "ADD_SELF":
      upsertPlayer(msg.player);
      renderBoard();
      break;

    case "REQUEST_FULL":
      send({ t: "FULL", players: state.players, pool: state.pool });
      break;

    case "FULL": {
      (msg.players || []).forEach(upsertPlayer);
      if (Array.isArray(msg.pool))
        state.pool = unique([...state.pool, ...msg.pool]);
      updateHostUI();
      renderBoard();
      break;
    }

    // 分配相關
    case "ASSIGN_RULE":
      upsertPlayer({ id: msg.id, rule: msg.rule });
      renderBoard();
      break;

    case "ASSIGN_BULK":
      (msg.mapping || []).forEach((m) =>
        upsertPlayer({ id: m.id, rule: m.rule })
      );
      renderBoard();
      break;

    // 禁令池：建議 → Host 同步
    case "SUGGEST_RULE":
      if (amIHost()) {
        const t = (msg.text || "").trim();
        if (t && !state.pool.includes(t)) {
          state.pool.push(t);
          save();
          send({ t: "POOL_SYNC", pool: state.pool });
        }
      }
      break;

    case "POOL_SYNC":
      if (Array.isArray(msg.pool)) {
        state.pool = unique(msg.pool);
        save();
        renderBoard();
      }
      break;

    // 違規 & 猜題
    case "VIOLATION": {
      const { playerId, actorId } = msg;
      flashCard(playerId);

      // 旁觀者：顯示違規彈窗（含禁令）
      if (state.me.id !== actorId && state.me.id !== playerId) {
        const p = state.players.find((x) => x.id === playerId);
        if (p) {
          hitName.textContent = p.name;
          hitRule.textContent = p.rule || "（禁令未同步）";
          if (dlgHit.open) dlgHit.close();
          dlgHit.showModal();
        }
      }
      // 犯規者：顯示猜題彈窗（不顯示禁令）
      if (state.me.id === playerId) {
        state.lastTargetId = playerId;
        save();
        inpGuess.value = "";
        if (dlgGuess.open) dlgGuess.close();
        dlgGuess.showModal();
      }
      break;
    }

    // ✅ 收到重置：顯示提示並刷新
    case "RESET": {
      if (dlgReset.open) dlgReset.close();
      dlgReset.showModal();
      // 自動刷新（保留 URL 參數）
      setTimeout(() => hardReload(), 1200);
      break;
    }

    case "GUESS":
      if (amIHost()) {
        const { playerId, text } = msg;
        const p = state.players.find((x) => x.id === playerId);
        if (!p || !p.rule) return;
        const ok = fuzzyMatch(text, p.rule);
        send({ t: "GUESS_RESULT", playerId, ok, guess: text });
      }
      break;

    case "GUESS_RESULT": {
      const { playerId, ok } = msg;
      const p = state.players.find((x) => x.id === playerId);
      resultTitle.textContent = ok ? "猜對了！" : "可惜猜錯～";
      resultBody.textContent = ok
        ? `${p?.name || "他"} 猜對了！其他人喝一杯 🍻`
        : `${p?.name || "他"} 還沒猜中，繼續觀察吧。`;
      if (dlgResult.open) dlgResult.close();
      dlgResult.showModal();
      break;
    }
  }
}

// ===== 重新載入（清理本地狀態後重整） =====
function hardReload() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  try {
    channel?.unsubscribe();
  } catch {}
  location.reload(); // 保留 URL 參數（含 sb/key/room）
}

// 犯規者提交猜測
btnSubmitGuess.addEventListener("click", (e) => {
  e.preventDefault();
  const text = (inpGuess.value || "").trim();
  dlgGuess.close();
  if (!state.lastTargetId || !text) return;
  send({ t: "GUESS", playerId: state.lastTargetId, text, who: state.me.id });
});
btnSkipGuess.addEventListener("click", () => dlgGuess.close());

// ===== 資料操作 / 工具 =====
function upsertPlayer(partial) {
  const idx = state.players.findIndex((p) => p.id === partial.id);
  if (idx === -1) {
    state.players.push({
      id: partial.id,
      name: partial.name || "玩家",
      rule: partial.rule || "",
    });
  } else {
    state.players[idx] = { ...state.players[idx], ...partial };
  }
  save();
}
function fallbackRule(p) {
  const idx = Math.abs(hashCode(p.id)) % DEFAULT_POOL.length;
  return DEFAULT_POOL[idx];
}
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function unique(arr) {
  return Array.from(new Set(arr));
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 簡易模糊比對
function fuzzyMatch(a, b) {
  const norm = (s) =>
    (s || "")
      .replace(/[，。！？、．・・]/g, " ")
      .replace(/[「」『』“”"']/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  const x = norm(a),
    y = norm(b);
  if (x.length < 2) return false;
  return y.includes(x) || x.includes(y);
}

// ===== 初始 =====
showView("join");
renderBoard();

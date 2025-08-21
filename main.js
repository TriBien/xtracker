/* ================= Utilities & Storage ================= */
const DB_NAME = "GoalTrackerDB_v2";
const DB_VERSION = 2;
let db;

const openDB = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains("goals")) {
        db.createObjectStore("goals", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("history")) {
        const h = db.createObjectStore("history", { keyPath: "date" }); // YYYY-MM-DD
        h.createIndex("byDate", "date");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "k" }); // streak, badges, lastOpen
      }
    };
  });

const tx = (name, mode = "readonly") =>
  db.transaction(name, mode).objectStore(name);
const put = (store, obj) => tx(store, "readwrite").put(obj);
const get = (store, key) =>
  new Promise((res) => {
    const r = tx(store).get(key);
    r.onsuccess = () => res(r.result || null);
  });
const getAll = (store) =>
  new Promise((res) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result || []);
  });

const fmt = (d) =>
  new Date(d).toLocaleString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
const todayStr = () => fmt(new Date());
const fmtDisplay = (d) => new Date(d).toLocaleDateString("en-GB"); // dd/mm/yyyy

/* ================= Quotes ================= */
const QUOTES = [
  ["Small steps daily beat rare sprints.", "Consistency"],
  ["You don’t have to be perfect, just better than yesterday.", "Progress"],
  [
    "Discipline is choosing what you want now vs. what you want most.",
    "Discipline",
  ],
  ["Action breeds motivation; start, then momentum follows.", "Momentum"],
  ["Win the day. Tomorrow starts here.", "Focus"],
  ["Your future self is quietly cheering for you.", "Self"],
  ["Streaks build identity. Identity sustains streaks.", "Identity"],
  ["Make it easy to start; hard to quit.", "Design"],
  ["Done today > perfect tomorrow.", "Bias to action"],
  ["Tiny wins compound into big outcomes.", "Compounding"],
];
function quoteOfDay() {
  const seed = Number(todayStr().replaceAll("-", ""));
  const idx = seed % QUOTES.length;
  const [q, tag] = QUOTES[idx];
  return `“${q}” — <em>${tag}</em>`;
}

/* ================= Confetti (tiny) ================= */
(function () {
  const c = document.getElementById("fx");
  const ctx = c.getContext("2d");
  let w = innerWidth,
    h = innerHeight;
  c.width = w;
  c.height = h;
  addEventListener("resize", () => {
    w = innerWidth;
    h = innerHeight;
    c.width = w;
    c.height = h;
  });
  let pieces = [];
  function spawn(n = 80) {
    for (let i = 0; i < n; i++) {
      pieces.push({
        x: Math.random() * w,
        y: -10 - (Math.random() * h) / 2,
        s: 2 + Math.random() * 4,
        vy: 2 + Math.random() * 3,
        vx: (Math.random() - 0.5) * 2,
        a: Math.random() * Math.PI * 2,
      });
    }
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    pieces.forEach((p) => {
      p.y += p.vy;
      p.x += p.vx;
      p.a += 0.1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = `hsl(${(p.x + p.y) % 360}deg 90% 60%)`;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 1.6);
      ctx.restore();
    });
    pieces = pieces.filter((p) => p.y < h + 20);
    requestAnimationFrame(draw);
  }
  draw();
  window.confetti = () => spawn(120);
})();

/* ================= Badges ================= */
const ALL_BADGES = {
  FIRST_CHECK: {
    id: "FIRST_CHECK",
    name: "First Check ✅",
    tip: "You checked a task!",
  },
  FIRST_100: {
    id: "FIRST_100",
    name: "First 100% Day 💯",
    tip: "Completed all TODOs today",
  },
  STREAK_3: {
    id: "STREAK_3",
    name: "3-Day Streak 🔥",
    tip: "Three days in a row",
  },
  STREAK_7: {
    id: "STREAK_7",
    name: "7-Day Streak 🚀",
    tip: "Seven days in a row",
  },
  HALFWAY: {
    id: "HALFWAY",
    name: "Halfway ⭐",
    tip: "You passed 50% of your total days",
  },
  GOAL_DONE: {
    id: "GOAL_DONE",
    name: "Deadline Crusher 🏁",
    tip: "Marked the goal complete",
  },
};
async function awardBadge(id) {
  const meta = (await get("meta", "badges")) || { k: "badges", v: [] };
  if (!meta.v.includes(id)) {
    meta.v.push(id);
    await put("meta", meta);
    renderBadges();
  }
}

/* ================= Progress Logic ================= */
function datesBetween(startStr, endStr) {
  const out = [];
  let d = new Date(startStr);
  const end = new Date(endStr);
  while (d <= end) {
    out.push(fmt(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}
async function ensureMissedDaysMarked(goal) {
  // Fill any gaps from last history date to yesterday as 0-done days
  const hist = await getAll("history");
  const byDate = Object.fromEntries(hist.map((h) => [h.date, h]));
  const all = datesBetween(
    goal.startDate,
    Math.min(new Date(), new Date(goal.deadline))
  );
  // up to yesterday (if today missing it will be created on open)
  const today = todayStr();
  for (const d of all) {
    if (d >= today) break;
    if (!byDate[d]) {
      await put("history", {
        date: d,
        completedCount: 0,
        totalCount: goal.tasks.length,
        allDone: false,
      });
    }
  }
}
async function computeOverall(goal) {
  const hist = await getAll("history");
  const range = datesBetween(goal.startDate, goal.deadline);
  const totalDays = range.length;
  const doneDays = hist.filter(
    (h) => h.allDone && h.date >= goal.startDate && h.date <= goal.deadline
  ).length;
  const pct = Math.round((doneDays / Math.max(1, totalDays)) * 100);
  return { totalDays, doneDays, pct };
}
async function updateStreak() {
  const metaL = (await get("meta", "streak")) || { k: "streak", v: 0 };
  const hist = await getAll("history");
  const set = new Set(hist.filter((h) => h.allDone).map((h) => h.date));

  // count backwards from today
  let d = new Date();
  let count = 0;

  // check if today done
  const doneToday = set.has(fmt(new Date()));

  // if today is not done, count backward from yesterday
  if (!doneToday) {
    d.setDate(d.getDate() - 1);
  }

  while (set.has(fmt(d))) {
    count++;
    d.setDate(d.getDate() - 1);
  }

  metaL.v = count;
  await put("meta", metaL);
  if (count >= 7) await awardBadge("STREAK_7");
  else if (count >= 3) await awardBadge("STREAK_3");
  renderStreak();
}
async function renderStreak() {
  const s = (await get("meta", "streak"))?.v || 0;
  document.getElementById("streakPill").textContent = `🔥 Streak: ${s}`;
}

/* ================= UI Elements ================= */
const els = {
  setup: document.getElementById("setup"),
  tracking: document.getElementById("tracking"),
  history: document.getElementById("history"),
  quoteText: document.getElementById("quoteText"),
  goalNamePill: document.getElementById("goalNamePill"),
  dateLine: document.getElementById("dateLine"),
  todoList: document.getElementById("todoList"),
  todayFill: document.getElementById("todayFill"),
  todayPct: document.getElementById("todayPct"),
  overallFill: document.getElementById("overallFill"),
  overallPct: document.getElementById("overallPct"),
  historyList: document.getElementById("historyList"),
  badgesWrap: document.getElementById("badgesWrap"),
  badgeHint: document.getElementById("badgeHint"),
  // inputs & buttons
  goal: document.getElementById("goal"),
  tasks: document.getElementById("tasks"),
  deadline: document.getElementById("deadline"),
  startDate: document.getElementById("startDate"),
  startBtn: document.getElementById("startBtn"),
  navSetup: document.getElementById("navSetup"),
  navTrack: document.getElementById("navTrack"),
  navHistory: document.getElementById("navHistory"),
  markAll: document.getElementById("markAll"),
  completeGoal: document.getElementById("completeGoal"),
};

// --- Nav active helper ---
const navButtons = [els.navSetup, els.navTrack, els.navHistory];
function setActiveNav(btn) {
  navButtons.forEach((b) => b.classList.toggle("active", b === btn));
}

function show(section) {
  els.setup.classList.add("hidden");
  els.tracking.classList.add("hidden");
  els.history.classList.add("hidden");
  section.classList.remove("hidden");
}

/* ================= Rendering ================= */
async function loadTracking(goal) {
  await ensureMissedDaysMarked(goal);

  show(els.tracking);

  els.goalNamePill.textContent =
    goal.title || "Build your streak. Beat your goal";
  els.dateLine.textContent = `Deadline: ${fmtDisplay(goal.deadline)}`;

  // prepare today's record
  const today = todayStr();
  let rec = await get("history", today);

  if (!rec) {
    rec = {
      date: today,
      completedCount: 0,
      totalCount: goal.tasks.length,
      allDone: false,
    };
    await put("history", rec);
  }

  // render todos with check state from today's rec
  els.todoList.innerHTML = "";
  for (let i = 0; i < goal.tasks.length; i++) {
    const t = goal.tasks[i];
    const checked = (rec.checkedIndices || []).includes(i);
    const item = document.createElement("div");
    item.className = "todo" + (checked ? " done" : "");

    item.innerHTML = `
    <div class="title">${t}</div>
    <input type="checkbox" ${
      checked ? "checked" : ""
    } aria-label="check ${t}" />
  `;

    const box = item.querySelector("input");

    // function to toggle state (used by both checkbox and whole item)
    const toggle = async (forceCheck = null) => {
      let idxs = new Set(rec.checkedIndices || []);
      const nowChecked = forceCheck !== null ? forceCheck : !box.checked;
      box.checked = nowChecked;

      if (nowChecked) {
        idxs.add(i);
        window.confetti();
        item.classList.add("done");
        await awardBadge("FIRST_CHECK");
      } else {
        idxs.delete(i);
        item.classList.remove("done");
      }

      rec.checkedIndices = [...idxs];
      rec.completedCount = rec.checkedIndices.length;
      rec.allDone = rec.completedCount === rec.totalCount;
      await put("history", rec);

      if (rec.allDone) {
        window.confetti();
        await awardBadge("FIRST_100");
      }

      await updateTodayProgress(goal, rec);
      await updateOverall(goal);
      await updateStreak();
    };

    // clicking checkbox still works
    box.onchange = () => toggle(box.checked);

    // clicking anywhere on the todo (except directly on checkbox) toggles
    item.addEventListener("click", (e) => {
      if (e.target !== box) toggle();
    });

    els.todoList.appendChild(item);
  }

  // buttons
  els.markAll.onclick = async () => {
    rec.checkedIndices = Array.from({ length: goal.tasks.length }, (_, i) => i);
    rec.completedCount = goal.tasks.length;
    rec.allDone = true;
    await put("history", rec);
    // check all boxes visually
    [...els.todoList.querySelectorAll(".todo")].forEach((d, i) => {
      d.classList.add("done");
      d.querySelector("input").checked = true;
    });
    window.confetti();
    await awardBadge("FIRST_100");
    await updateTodayProgress(goal, rec);
    await updateOverall(goal);
    await updateStreak();
  };

  els.completeGoal.onclick = async () => {
    const g = await get("goals", "current");
    if (!g) return;
    g.completed = true;
    await put("goals", g);
    window.confetti();
    await awardBadge("GOAL_DONE");
    alert("🎉 Goal marked complete! Fantastic work!");
  };

  await updateTodayProgress(goal, rec);
  await updateOverall(goal);
  await updateStreak();
  renderBadges();
}

async function updateTodayProgress(goal, rec) {
  const pct = Math.round(
    (rec.completedCount / Math.max(1, goal.tasks.length)) * 100
  );
  els.todayPct.textContent = pct + "%";
  els.todayFill.style.width = pct + "%";
}

async function updateOverall(goal) {
  const { totalDays, doneDays, pct } = await computeOverall(goal);
  els.overallPct.textContent = `${pct}% (${doneDays}/${totalDays} days)`;
  els.overallFill.style.width = pct + "%";
  // Halfway badge when reaching >= 50% of total days completed
  if (totalDays > 0 && doneDays / totalDays >= 0.5) {
    await awardBadge("HALFWAY");
  }
}

async function renderBadges() {
  const have = (await get("meta", "badges"))?.v || [];
  els.badgesWrap.innerHTML = "";
  const order = [
    "FIRST_CHECK",
    "FIRST_100",
    "STREAK_3",
    "STREAK_7",
    "HALFWAY",
    "GOAL_DONE",
  ];
  order.forEach((id) => {
    const def = ALL_BADGES[id];
    const active = have.includes(id);
    const div = document.createElement("div");
    div.className = "badge";
    div.style.opacity = active ? "1" : ".35";
    div.title = def.tip + (active ? "" : " (locked)");
    div.innerHTML = `${active ? "🏅" : "🔒"} ${def.name}`;
    els.badgesWrap.appendChild(div);
  });

  if (els.badgeHint) {
    els.badgeHint.textContent = have.length
      ? `Earned ${have.length} badge${have.length > 1 ? "s" : ""}`
      : "Earn badges by staying consistent";
  }
}

/* ================= History ================= */
async function renderHistory() {
  show(els.history);
  const goal = await get("goals", "current");
  const hist = (await getAll("history"))
    .filter(
      (h) => !goal || (h.date >= goal.startDate && h.date <= goal.deadline)
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  els.historyList.innerHTML = "";
  if (hist.length === 0) {
    const div = document.createElement("div");
    div.className = "muted";
    div.textContent = "No history yet.";
    els.historyList.appendChild(div);
    return;
  }
  hist.forEach((h) => {
    const div = document.createElement("div");
    div.className = "todo";
    const pct = Math.round(
      (h.completedCount / Math.max(1, h.totalCount)) * 100
    );
    div.innerHTML = `
      <div>
        <div class="title">${fmtDisplay(h.date)}</div>
        <small class="muted">${h.completedCount}/${
      h.totalCount
    } tasks · ${pct}%</small>
      </div>
      <span class="pill" style="${
        h.allDone
          ? "background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35);color:#d1fae5"
          : "background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.35);color:#ffe4e6"
      }">
        ${h.allDone ? "Completed" : "Missed"}
      </span>
    `;
    els.historyList.appendChild(div);
  });
}

/* ================= Navigation ================= */
async function loadSetupForm() {
  const goal = await get("goals", "current");
  if (goal) {
    els.goal.value = goal.title;
    els.tasks.value = goal.tasks.join("\n");
    els.startDate.value = goal.startDate;
    els.deadline.value = goal.deadline;
    els.startBtn.textContent = "Update";
  } else {
    // set sensible defaults
    const t = todayStr();
    els.goal.value = "";
    els.tasks.value = "";
    els.startDate.value = t;
    const d = new Date();
    d.setDate(d.getDate() + 14);
    els.deadline.value = fmt(d);
  }
}

els.navSetup.onclick = async () => {
  await loadSetupForm();
  setActiveNav(els.navSetup);
  show(els.setup);
};

els.navTrack.onclick = async () => {
  setActiveNav(els.navTrack);
  const goal = await get("goals", "current");
  if (goal && !goal.completed) {
    loadTracking(goal);
  } else {
    show(els.setup);
  }
};

els.navHistory.onclick = async () => {
  setActiveNav(els.navHistory);
  await renderHistory();
};

/* ================= Start / Init ================= */
els.quoteText.innerHTML = quoteOfDay();

els.startBtn.onclick = async () => {
  const title = els.goal.value.trim();
  const tasks = els.tasks.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const deadline = els.deadline.value;
  let start = els.startDate.value;

  if (!title || !tasks.length || !deadline) {
    alert("Please fill Goal, Tasks, and Deadline.");
    return;
  }
  if (!start) start = todayStr();
  if (new Date(start) > new Date(deadline)) {
    alert("Start date must be before or same as deadline.");
    return;
  }

  const goalObj = {
    id: "current",
    title,
    tasks,
    deadline: fmt(deadline),
    startDate: fmt(start),
    completed: false,
  };

  await put("goals", goalObj);

  // ensure today's record is aligned with updated tasks
  const today = todayStr();
  let rec = await get("history", today);
  if (!rec || rec.totalCount !== goalObj.tasks.length) {
    rec = {
      date: today,
      completedCount: 0,
      totalCount: goalObj.tasks.length,
      allDone: false,
      checkedIndices: [],
    };
    await put("history", rec);
  }

  // re-calc progress
  await updateTodayProgress(goalObj, rec);
  await updateOverall(goalObj);
  await updateStreak();

  await loadTracking(goalObj);
  setActiveNav(els.navTrack);
};

(async function init() {
  await openDB();
  // show current goal or setup
  const goal = await get("goals", "current");
  // set default dates
  const t = todayStr();
  els.startDate.value = t;
  const d = new Date();
  d.setDate(d.getDate() + 14);
  els.deadline.value = fmt(d);

  if (goal && !goal.completed) {
    loadTracking(goal);
    setActiveNav(els.navTrack);
  } else {
    show(els.setup);
    setActiveNav(els.navSetup);
  }
})();

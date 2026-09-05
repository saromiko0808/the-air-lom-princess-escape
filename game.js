(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const screens = {
    loading: $("#loadingScreen"),
    start: $("#startScreen"),
    game: $("#gameScreen"),
    result: $("#resultScreen")
  };

  const canvas = $("#gameCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const ASSET_PATHS = {
    lom: "assets/lom.png",
    princess: "assets/princess.png",
    pair: "assets/lom-princess.png",
    lomSkill: "assets/lom-skill.png",
    princessPortrait: "assets/princess-portrait.png",
    din: "assets/din.png",
    nam: "assets/nam.png",
    fai: "assets/fai.png",
    bua: "assets/bua.png",
    wine: "assets/medicine-wine.png",
    treehouse: "assets/treehouse.png",
    ending: "assets/secret-ending.png"
  };

  const LEVELS = [
    { title: "初遇追兵", mission: "帶公主撐過第一波追兵", duration: 20, enemy: 2.6, arrow: 4.8, speed: 74, aid: 12.5 },
    { title: "密林暗箭", mission: "留意從畫面外射來的暗箭", duration: 21, enemy: 2.35, arrow: 4.0, speed: 80, aid: 12 },
    { title: "海風迷途", mission: "找到姊妹援助，別讓公主落單", duration: 22, enemy: 2.15, arrow: 3.7, speed: 86, aid: 11.5 },
    { title: "酸毒粉出沒", mission: "毒箭會讓 Lom 暫時減速", duration: 23, enemy: 2.0, arrow: 3.25, speed: 91, aid: 11 },
    { title: "樹屋喘息", mission: "與公主一起停在樹屋入口 2 秒", duration: 24, enemy: 1.85, arrow: 3.0, speed: 97, aid: 10.5 },
    { title: "姊妹援護", mission: "收集 Din、Nam、Fai 的援助", duration: 25, enemy: 1.72, arrow: 2.75, speed: 102, aid: 9.5 },
    { title: "公主醉顛顛", mission: "公主誤喝藥酒時，靠近並抱住她", duration: 26, enemy: 1.6, arrow: 2.55, speed: 107, aid: 9.5 },
    { title: "暗箭連發", mission: "箭雨變快了，善用岩石護盾", duration: 27, enemy: 1.5, arrow: 2.2, speed: 113, aid: 9 },
    { title: "風暴包圍", mission: "追兵從四面出現，別停在角落", duration: 28, enemy: 1.35, arrow: 2.0, speed: 119, aid: 8.5 },
    { title: "THE AIR 終章", mission: "最後一段路，把公主平安帶回家", duration: 30, enemy: 1.22, arrow: 1.75, speed: 126, aid: 8 }
  ];

  const STORE_KEY = "theAirLomEscape_v1";
  const defaultProgress = { unlocked: 1, lastLevel: 1, stars: {} };
  let progress = loadProgress();
  let images = {};
  let currentLevel = 0;
  let state = null;
  let frameId = 0;
  let sessionToken = 0;
  let soundOn = true;
  let audioCtx = null;
  let toastTimer = 0;
  let messageTimer = 0;

  const input = { x: 0, y: 0, keys: new Set(), pointerId: null };
  const TAUNTS = ["造謠", "斷章", "帶風向", "酸言", "暗箭"];

  function loadProgress() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      return { ...defaultProgress, ...(parsed || {}), stars: { ...(parsed?.stars || {}) } };
    } catch (_) {
      return { ...defaultProgress, stars: {} };
    }
  }

  function saveProgress() {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  }

  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => node.classList.toggle("is-hidden", key !== name));
  }

  function preloadAssets() {
    const entries = Object.entries(ASSET_PATHS);
    let done = 0;
    return Promise.all(entries.map(([key, src]) => new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = src;
      function finish(ok) {
        done += 1;
        images[key] = ok ? img : null;
        $("#loadingBar").style.width = `${(done / entries.length) * 100}%`;
        $("#loadingText").textContent = `載入圖片 ${done} / ${entries.length}`;
        resolve();
      }
    })));
  }

  function buildLevelSelect() {
    const wrap = $("#levelSelect");
    wrap.innerHTML = "";
    LEVELS.forEach((_, index) => {
      const level = index + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "level-dot";
      button.disabled = level > progress.unlocked;
      const stars = progress.stars[level] || 0;
      button.innerHTML = `${level}<small>${stars ? "★".repeat(stars) : level <= progress.unlocked ? "未完成" : "鎖定"}</small>`;
      button.addEventListener("click", () => startLevel(index));
      wrap.appendChild(button);
    });

    const hasProgress = progress.unlocked > 1 || Object.keys(progress.stars).length > 0;
    $("#continueBtn").classList.toggle("is-hidden", !hasProgress);
    $("#continueBtn").textContent = `繼續第 ${Math.min(progress.lastLevel, progress.unlocked)} 關`;
  }

  function initAudio() {
    if (!audioCtx) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) audioCtx = new Audio();
    }
    if (audioCtx?.state === "suspended") audioCtx.resume();
  }

  function tone(freq, duration = .12, type = "sine", volume = .035, delay = 0) {
    if (!soundOn || !audioCtx) return;
    const start = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + duration + .02);
  }

  function sfx(kind) {
    if (kind === "hit") {
      tone(150, .22, "sawtooth", .05);
      tone(95, .25, "square", .025, .04);
    } else if (kind === "aid") {
      tone(520, .1, "sine", .04);
      tone(690, .12, "sine", .04, .09);
      tone(880, .18, "sine", .035, .18);
    } else if (kind === "tree") {
      tone(392, .18, "sine", .04);
      tone(523, .2, "sine", .04, .12);
      tone(784, .3, "sine", .035, .24);
    } else if (kind === "drunk") {
      tone(320, .14, "triangle", .05);
      tone(245, .14, "triangle", .04, .12);
      tone(370, .2, "triangle", .04, .24);
    } else if (kind === "complete") {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, .25, "sine", .045, i * .11));
    } else if (kind === "shield") {
      tone(760, .12, "sine", .035);
    }
  }

  function toggleSound() {
    soundOn = !soundOn;
    $("#soundBtn").classList.toggle("is-muted", !soundOn);
    $("#gameSoundBtn").classList.toggle("is-muted", !soundOn);
    $("#soundBtn").textContent = soundOn ? "♪" : "×";
    $("#gameSoundBtn").textContent = soundOn ? "♪" : "×";
    if (soundOn) initAudio();
  }

  function showToast(imageKey, title, message, seconds = 2.1) {
    clearTimeout(toastTimer);
    const toast = $("#eventToast");
    $("#eventImage").src = ASSET_PATHS[imageKey] || ASSET_PATHS.din;
    $("#eventTitle").textContent = title;
    $("#eventMessage").textContent = message;
    toast.classList.remove("is-hidden");
    toastTimer = setTimeout(() => toast.classList.add("is-hidden"), seconds * 1000);
  }

  function showCenter(text, seconds = 1.3) {
    clearTimeout(messageTimer);
    const box = $("#centerMessage");
    box.textContent = text;
    box.classList.remove("is-hidden");
    messageTimer = setTimeout(() => box.classList.add("is-hidden"), seconds * 1000);
  }

  function blankState(levelIndex) {
    const level = LEVELS[levelIndex];
    return {
      running: false,
      finished: false,
      elapsed: 0,
      remaining: level.duration,
      hearts: 4,
      hits: 0,
      dodged: 0,
      shield: 0,
      invincible: 0,
      poison: 0,
      drunk: 0,
      faint: 0,
      enemyClock: 0,
      arrowClock: 0,
      aidClock: -4,
      entities: [],
      projectiles: [],
      pickups: [],
      wind: Array.from({ length: 26 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        len: 18 + Math.random() * 45,
        speed: 25 + Math.random() * 55,
        alpha: .12 + Math.random() * .18
      })),
      player: { x: W * .42, y: H * .66, r: 34, dirX: 0, dirY: -1 },
      princess: { x: W * .57, y: H * .75, r: 32, vx: 0, vy: 0 },
      tree: {
        x: 145 + Math.random() * 430,
        y: 270 + Math.random() * 310,
        visible: false,
        used: false,
        stay: 0,
        appearAt: level.duration * (.3 + Math.random() * .14)
      },
      wine: {
        visible: false,
        used: false,
        x: 120 + Math.random() * 480,
        y: 260 + Math.random() * 430,
        appearAt: level.duration * (.35 + Math.random() * .25),
        willAppear: levelIndex === 6 || (levelIndex >= 2 && Math.random() < .28)
      },
      lastTime: performance.now(),
      token: sessionToken
    };
  }

  function startLevel(levelIndex) {
    initAudio();
    sessionToken += 1;
    cancelAnimationFrame(frameId);
    currentLevel = Math.max(0, Math.min(LEVELS.length - 1, levelIndex));
    progress.lastLevel = currentLevel + 1;
    saveProgress();
    state = blankState(currentLevel);
    state.token = sessionToken;
    input.keys.clear();
    input.x = 0;
    input.y = 0;
    resetJoystick();
    $("#levelKicker").textContent = `第 ${currentLevel + 1} 關`;
    $("#levelTitle").textContent = LEVELS[currentLevel].title;
    $("#missionText").textContent = LEVELS[currentLevel].mission;
    $("#hugBtn").classList.add("is-hidden");
    $("#eventToast").classList.add("is-hidden");
    $("#treeProgress").classList.add("is-hidden");
    updateHud();
    showScreen("game");
    draw();
    frameId = requestAnimationFrame(loop);
    countdown(3, state.token);
  }

  function countdown(number, token) {
    if (!state || token !== state.token) return;
    if (number > 0) {
      showCenter(String(number), .72);
      setTimeout(() => countdown(number - 1, token), 760);
    } else {
      showCenter("帶公主逃！", .9);
      state.running = true;
      state.lastTime = performance.now();
    }
  }

  function loop(now) {
    if (!state || state.token !== sessionToken) return;
    const dt = Math.min(.034, Math.max(0, (now - state.lastTime) / 1000));
    state.lastTime = now;
    if (state.running && !state.finished) update(dt);
    draw();
    if (!state.finished) frameId = requestAnimationFrame(loop);
  }

  function update(dt) {
    const level = LEVELS[currentLevel];
    state.elapsed += dt;
    state.remaining = Math.max(0, level.duration - state.elapsed);
    state.enemyClock += dt;
    state.arrowClock += dt;
    state.aidClock += dt;
    state.shield = Math.max(0, state.shield - dt);
    state.invincible = Math.max(0, state.invincible - dt);
    state.poison = Math.max(0, state.poison - dt);
    state.faint = Math.max(0, state.faint - dt);

    updateWind(dt);
    updatePlayer(dt);
    updatePrincess(dt);

    if (state.enemyClock >= level.enemy) {
      state.enemyClock -= level.enemy;
      spawnEnemy();
      if (currentLevel >= 8 && Math.random() < .2) spawnEnemy();
    }
    if (state.arrowClock >= level.arrow) {
      state.arrowClock -= level.arrow;
      spawnArrow();
      if (currentLevel >= 7 && Math.random() < .28) {
        const token = state.token;
        setTimeout(() => state?.running && state.token === token && spawnArrow(), 380);
      }
    }
    if (currentLevel >= 1 && state.aidClock >= level.aid) {
      state.aidClock = 0;
      spawnAid();
    }

    if (!state.tree.visible && state.elapsed >= state.tree.appearAt) {
      state.tree.visible = true;
      showCenter("秘密樹屋出現了！", 1.2);
    }
    if (state.wine.willAppear && !state.wine.visible && !state.wine.used && state.elapsed >= state.wine.appearAt) {
      state.wine.visible = true;
      showToast("bua", "Bua 路過", "等等！那個不是給公主喝的！", 2.6);
    }

    updateEnemies(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    processCollisions(dt);
    updateHud();

    if (state.remaining <= 0) completeLevel();
  }

  function updateWind(dt) {
    state.wind.forEach((w) => {
      w.x += w.speed * dt;
      w.y -= w.speed * .18 * dt;
      if (w.x > W + 60) { w.x = -60; w.y = Math.random() * H; }
      if (w.y < -10) w.y = H + 10;
    });
  }

  function updatePlayer(dt) {
    let dx = input.x;
    let dy = input.y;
    if (input.keys.has("arrowleft") || input.keys.has("a")) dx -= 1;
    if (input.keys.has("arrowright") || input.keys.has("d")) dx += 1;
    if (input.keys.has("arrowup") || input.keys.has("w")) dy -= 1;
    if (input.keys.has("arrowdown") || input.keys.has("s")) dy += 1;
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }
    const speed = 285 * (state.poison > 0 ? .68 : 1);
    state.player.x += dx * speed * dt;
    state.player.y += dy * speed * dt;
    state.player.x = clamp(state.player.x, 48, W - 48);
    state.player.y = clamp(state.player.y, 130, H - 65);
    if (Math.hypot(dx, dy) > .1) {
      state.player.dirX = dx;
      state.player.dirY = dy;
    }
  }

  function updatePrincess(dt) {
    const p = state.princess;
    if (state.drunk > 0) {
      state.drunk = Math.max(0, state.drunk - dt);
      if (!p.vx && !p.vy) {
        const angle = Math.random() * Math.PI * 2;
        p.vx = Math.cos(angle) * 230;
        p.vy = Math.sin(angle) * 230;
      }
      p.vx += Math.sin(state.elapsed * 8) * 140 * dt;
      p.vy += Math.cos(state.elapsed * 6.5) * 120 * dt;
      const speed = Math.hypot(p.vx, p.vy) || 1;
      if (speed > 285) { p.vx = p.vx / speed * 285; p.vy = p.vy / speed * 285; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 45 || p.x > W - 45) p.vx *= -1;
      if (p.y < 135 || p.y > H - 60) p.vy *= -1;
      p.x = clamp(p.x, 45, W - 45);
      p.y = clamp(p.y, 135, H - 60);
      if (state.drunk === 0) {
        p.vx = 0;
        p.vy = 0;
        state.faint = 2.6;
        $("#hugBtn").classList.add("is-hidden");
        showCenter("公主醉倒了，保護她！", 1.8);
      }
      return;
    }
    if (state.faint > 0) return;
    const offsetX = Math.abs(state.player.dirX) > .1 ? -state.player.dirX * 72 : 64;
    const offsetY = Math.abs(state.player.dirY) > .1 ? -state.player.dirY * 58 : 46;
    const targetX = clamp(state.player.x + offsetX, 48, W - 48);
    const targetY = clamp(state.player.y + offsetY, 135, H - 65);
    const follow = Math.min(1, dt * 5.2);
    p.x += (targetX - p.x) * follow;
    p.y += (targetY - p.y) * follow;
  }

  function spawnEnemy() {
    const side = Math.floor(Math.random() * 4);
    const pos = edgePosition(side, 45);
    const toxic = currentLevel >= 3 && Math.random() < .28;
    state.entities.push({
      x: pos.x,
      y: pos.y,
      r: toxic ? 30 : 32,
      kind: toxic ? "toxic" : "assassin",
      life: toxic ? 8.5 : 12,
      pulse: Math.random() * Math.PI * 2,
      shoot: toxic ? 1 + Math.random() * .9 : 0
    });
  }

  function spawnArrow(fromEntity = null) {
    const pos = fromEntity || edgePosition(Math.floor(Math.random() * 4), 25);
    const target = state.drunk > 0 ? state.player : state.princess;
    const angle = Math.atan2(target.y - pos.y, target.x - pos.x);
    const speed = 235 + currentLevel * 15 + Math.random() * 42;
    state.projectiles.push({
      x: pos.x,
      y: pos.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 13,
      life: 5.5,
      label: TAUNTS[Math.floor(Math.random() * TAUNTS.length)],
      acid: currentLevel >= 3 && Math.random() < .58
    });
  }

  function spawnAid() {
    const kinds = ["din", "nam", "fai"];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    state.pickups.push({
      kind,
      x: 100 + Math.random() * (W - 200),
      y: 225 + Math.random() * (H - 360),
      r: 36,
      life: 7.5,
      phase: Math.random() * Math.PI * 2
    });
  }

  function edgePosition(side, pad) {
    if (side === 0) return { x: -pad, y: 155 + Math.random() * (H - 230) };
    if (side === 1) return { x: W + pad, y: 155 + Math.random() * (H - 230) };
    if (side === 2) return { x: 55 + Math.random() * (W - 110), y: 110 - pad };
    return { x: 55 + Math.random() * (W - 110), y: H + pad };
  }

  function updateEnemies(dt) {
    const target = state.drunk > 0 ? state.player : state.princess;
    state.entities.forEach((e) => {
      e.life -= dt;
      e.pulse += dt * 3;
      if (e.kind === "assassin") {
        const angle = Math.atan2(target.y - e.y, target.x - e.x);
        const speed = LEVELS[currentLevel].speed;
        e.x += Math.cos(angle) * speed * dt;
        e.y += Math.sin(angle) * speed * dt;
      } else {
        const d = distance(e, target);
        if (d > 310) {
          const angle = Math.atan2(target.y - e.y, target.x - e.x);
          e.x += Math.cos(angle) * LEVELS[currentLevel].speed * .52 * dt;
          e.y += Math.sin(angle) * LEVELS[currentLevel].speed * .52 * dt;
        }
        e.shoot -= dt;
        if (e.shoot <= 0) {
          spawnArrow(e);
          e.shoot = 2.4 - Math.min(.8, currentLevel * .07) + Math.random() * .7;
        }
      }
    });
    state.entities = state.entities.filter((e) => !e.dead && e.life > 0);
  }

  function updateProjectiles(dt) {
    state.projectiles.forEach((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    });
    const before = state.projectiles.length;
    state.projectiles = state.projectiles.filter((p) => !p.dead && p.life > 0 && p.x > -90 && p.x < W + 90 && p.y > 40 && p.y < H + 90);
    state.dodged += Math.max(0, before - state.projectiles.length);
  }

  function updatePickups(dt) {
    state.pickups.forEach((p) => { p.life -= dt; p.phase += dt * 3; });
    state.pickups = state.pickups.filter((p) => !p.dead && p.life > 0);
  }

  function processCollisions(dt) {
    for (const e of state.entities) {
      if (state.drunk > 0 && distance(e, state.princess) < e.r + state.princess.r) {
        e.dead = true;
        state.dodged += 1;
        showCenter("公主：誰敢追 Lom！", .8);
        sfx("shield");
      } else if (distance(e, state.player) < e.r + state.player.r || distance(e, state.princess) < e.r + state.princess.r) {
        e.dead = true;
        takeHit(e.kind === "toxic");
      }
    }

    for (const p of state.projectiles) {
      if (state.drunk > 0 && distance(p, state.princess) < p.r + state.princess.r) {
        p.dead = true;
        state.dodged += 1;
      } else if (distance(p, state.player) < p.r + state.player.r || distance(p, state.princess) < p.r + state.princess.r) {
        p.dead = true;
        takeHit(p.acid);
      }
    }

    for (const p of state.pickups) {
      if (distance(p, state.player) < p.r + state.player.r || distance(p, state.princess) < p.r + state.princess.r) {
        p.dead = true;
        activateAid(p.kind);
      }
    }

    if (state.wine.visible && !state.wine.used && distance(state.wine, state.princess) < 60) {
      state.wine.used = true;
      state.wine.visible = false;
      state.drunk = 6;
      state.princess.vx = 0;
      state.princess.vy = 0;
      $("#hugBtn").classList.remove("is-hidden");
      showToast("princessPortrait", "公主喝到藥酒！", "醉顛顛暴走中——快靠近抱住她！", 3.2);
      showCenter("公主進入無敵暴走！", 1.4);
      sfx("drunk");
    }

    handleTreehouse(dt);
  }

  function takeHit(acid) {
    if (state.invincible > 0 || state.drunk > 0) return;
    if (state.shield > 0) {
      state.shield = Math.max(0, state.shield - 1.5);
      showCenter("護盾擋下攻擊！", .75);
      sfx("shield");
      return;
    }
    state.hearts -= 1;
    state.hits += 1;
    state.invincible = 1.25;
    if (acid) state.poison = 4.2;
    showCenter(acid ? "中了酸毒暗箭，暫時減速！" : "小心追兵！", 1.05);
    sfx("hit");
    if (state.hearts <= 0) gameOver();
  }

  function activateAid(kind) {
    if (kind === "din") {
      state.shield = Math.max(state.shield, 5.5);
      showToast("din", "Din · 岩石護盾", "5 秒內替 Lom 與公主擋下攻擊");
    } else if (kind === "nam") {
      state.hearts = Math.min(4, state.hearts + 1);
      state.poison = 0;
      showToast("nam", "Nam · 水之療癒", "解除毒性並恢復 1 顆愛心");
    } else {
      const cleared = state.entities.length + state.projectiles.length;
      state.entities = [];
      state.projectiles = [];
      state.invincible = Math.max(state.invincible, 1.2);
      state.dodged += cleared;
      showToast("fai", "Fai · 火焰開路", "清除畫面上的追兵與暗箭");
    }
    sfx("aid");
  }

  function handleTreehouse(dt) {
    const tree = state.tree;
    if (!tree.visible || tree.used) {
      $("#treeProgress").classList.add("is-hidden");
      return;
    }
    const entrance = { x: tree.x + 34, y: tree.y + 68 };
    const together = distance(state.player, entrance) < 105 && distance(state.princess, entrance) < 115;
    if (together) {
      tree.stay += dt;
      const wrap = $("#treeProgress");
      wrap.classList.remove("is-hidden");
      wrap.querySelector("span").style.width = `${Math.min(100, tree.stay / 2 * 100)}%`;
      if (tree.stay >= 2) {
        tree.used = true;
        tree.stay = 0;
        state.poison = 0;
        if (state.drunk > 0) calmPrincess(true);
        if (state.hearts < 4) {
          state.hearts += 1;
          showCenter("秘密樹屋：恢復 1 顆愛心 ♥", 1.7);
        } else {
          state.shield = Math.max(state.shield, 4);
          showCenter("生命已滿：獲得樹屋護盾！", 1.7);
        }
        showToast("bua", "安全休息一下", "追兵進不來，但時間仍在倒數", 2.4);
        sfx("tree");
      }
    } else {
      tree.stay = Math.max(0, tree.stay - dt * 1.5);
      $("#treeProgress").classList.add("is-hidden");
    }
  }

  function calmPrincess(fromTree = false) {
    if (!state || state.drunk <= 0) return;
    state.drunk = 0;
    state.faint = 0;
    state.princess.vx = 0;
    state.princess.vy = 0;
    state.shield = Math.max(state.shield, 2.5);
    $("#hugBtn").classList.add("is-hidden");
    showCenter(fromTree ? "在樹屋裡冷靜下來了 ♥" : "Lom 抱住公主，她冷靜下來了 ♥", 1.8);
    sfx("aid");
  }

  function tryHug() {
    if (!state || state.drunk <= 0) return;
    if (distance(state.player, state.princess) <= 125) calmPrincess(false);
    else showCenter("再靠近公主一點！", .85);
  }

  function updateHud() {
    if (!state) return;
    $("#timeValue").textContent = Math.ceil(state.remaining);
    $("#heartValue").textContent = "♥".repeat(Math.max(0, state.hearts)) + "♡".repeat(Math.max(0, 4 - state.hearts));
    $("#shieldValue").textContent = state.shield > 0 ? `${state.shield.toFixed(1)}s` : "—";
    if (state.poison > 0) $("#missionText").textContent = `酸毒影響中 ${Math.ceil(state.poison)} 秒 · 移動速度下降`;
    else if (state.drunk > 0) $("#missionText").textContent = `公主暴走中 ${Math.ceil(state.drunk)} 秒 · 靠近後按「抱住公主」`;
    else if (state.faint > 0) $("#missionText").textContent = `公主醉倒 ${Math.ceil(state.faint)} 秒 · Lom 快守住她`;
    else $("#missionText").textContent = LEVELS[currentLevel].mission;
  }

  function completeLevel() {
    if (!state || state.finished) return;
    state.finished = true;
    state.running = false;
    const stars = state.hearts === 4 && state.hits === 0 ? 3 : state.hearts >= 2 ? 2 : 1;
    const levelNumber = currentLevel + 1;
    progress.stars[levelNumber] = Math.max(progress.stars[levelNumber] || 0, stars);
    progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length, levelNumber + 1));
    progress.lastLevel = Math.min(LEVELS.length, levelNumber + 1);
    saveProgress();
    sfx("complete");
    setTimeout(() => showResult(true, stars), 550);
  }

  function gameOver() {
    if (!state || state.finished) return;
    state.finished = true;
    state.running = false;
    setTimeout(() => showResult(false, 0), 450);
  }

  function showResult(won, stars) {
    showScreen("result");
    const levelNumber = currentLevel + 1;
    const finalLevel = won && levelNumber === LEVELS.length;
    const totalStars = Object.values(progress.stars).reduce((sum, n) => sum + n, 0);
    $("#resultBadge").textContent = won ? finalLevel ? "全十關完成" : `第 ${levelNumber} 關過關` : "護送失敗";
    $("#resultStars").textContent = won ? "★".repeat(stars) + "☆".repeat(3 - stars) : "☆☆☆";
    $("#resultTitle").textContent = won ? finalLevel ? "風終於停了" : "成功護送公主！" : "Lom，再試一次！";

    if (finalLevel && totalStars >= 24) {
      $("#resultText").textContent = "隱藏結局解鎖：一路上的守護，公主一直都知道。";
      $("#resultImage").src = ASSET_PATHS.ending;
      $("#resultImage").style.objectFit = "cover";
    } else if (finalLevel) {
      $("#resultText").textContent = `完成全部關卡！目前共 ${totalStars} 顆星，累積 24 顆可解鎖隱藏結局。`;
      $("#resultImage").src = ASSET_PATHS.pair;
      $("#resultImage").style.objectFit = "contain";
    } else if (won) {
      $("#resultText").textContent = state.hits === 0 ? "Lom 完美閃過所有攻擊，公主平安無事。" : "雖然遇到驚險，Lom 還是把公主安全帶走了。";
      $("#resultImage").src = ASSET_PATHS.pair;
      $("#resultImage").style.objectFit = "contain";
    } else {
      $("#resultText").textContent = "靠近姊妹援助或躲進秘密樹屋，可以讓下一次逃亡更順利。";
      $("#resultImage").src = ASSET_PATHS.lomSkill;
      $("#resultImage").style.objectFit = "cover";
    }

    $("#resultStats").innerHTML = `<span>剩餘生命 ${Math.max(0, state.hearts)}／4</span><span>閃避 ${state.dodged} 次</span>`;
    const next = $("#nextBtn");
    next.classList.toggle("is-hidden", !won || finalLevel);
    if (won && !finalLevel) next.textContent = `前往第 ${levelNumber + 1} 關`;
    $("#retryBtn").textContent = won ? "再玩一次這關" : "重新挑戰";
    buildLevelSelect();
  }

  function draw() {
    if (!state) return;
    drawBackground();
    if (state.tree.visible) drawTreehouse();
    if (state.wine.visible && !state.wine.used) drawWine();
    state.pickups.forEach(drawPickup);
    state.entities.forEach(drawEnemy);
    state.projectiles.forEach(drawArrow);
    drawCharacters();
    if (!state.running && !state.finished) {
      ctx.fillStyle = "rgba(7,28,27,.16)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const hueShift = currentLevel * 3;
    g.addColorStop(0, currentLevel >= 8 ? "#27415c" : "#387b6a");
    g.addColorStop(.48, currentLevel >= 8 ? "#36595a" : "#5d8d6a");
    g.addColorStop(1, currentLevel >= 8 ? "#b48a62" : "#d1ae72");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = .18;
    ctx.fillStyle = `hsl(${44 + hueShift} 55% 73%)`;
    ctx.beginPath();
    ctx.moveTo(-40, H);
    ctx.bezierCurveTo(100, 730, 245, 820, 350, 610);
    ctx.bezierCurveTo(475, 360, 600, 510, 770, 240);
    ctx.lineTo(770, H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.lineWidth = 3;
    state.wind.forEach((w) => {
      ctx.globalAlpha = w.alpha;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      ctx.lineTo(w.x + w.len, w.y - w.len * .18);
      ctx.stroke();
    });
    ctx.restore();

    ctx.fillStyle = "rgba(9,46,40,.18)";
    for (let i = 0; i < 9; i += 1) {
      const x = (i * 103 + currentLevel * 31) % W;
      const y = 170 + (i % 3) * 270;
      ctx.beginPath();
      ctx.arc(x, y, 34 + (i % 4) * 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTreehouse() {
    const t = state.tree;
    ctx.save();
    ctx.globalAlpha = t.used ? .42 : 1;
    const size = 230;
    ctx.shadowColor = t.used ? "transparent" : "rgba(255,210,80,.7)";
    ctx.shadowBlur = t.used ? 0 : 24;
    drawImageContain(images.treehouse, t.x - size / 2, t.y - size / 2, size, size, "樹屋");
    ctx.restore();
    if (!t.used) {
      ctx.fillStyle = "rgba(255,244,185,.93)";
      roundRect(ctx, t.x - 63, t.y + 102, 126, 30, 15);
      ctx.fill();
      ctx.fillStyle = "#5f4722";
      ctx.font = "800 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("秘密樹屋 ♥", t.x, t.y + 123);
    }
  }

  function drawWine() {
    const w = state.wine;
    ctx.save();
    ctx.translate(0, Math.sin(state.elapsed * 4) * 6);
    ctx.beginPath();
    ctx.arc(w.x, w.y, 54, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,244,190,.9)";
    ctx.fill();
    ctx.strokeStyle = "#d88b3b";
    ctx.lineWidth = 5;
    ctx.stroke();
    drawImageContain(images.wine, w.x - 37, w.y - 45, 74, 88, "藥酒");
    drawCircleImage(images.bua, w.x + 48, w.y - 48, 28, "Bua");
    ctx.restore();
  }

  function drawPickup(p) {
    const y = p.y + Math.sin(p.phase) * 8;
    ctx.save();
    ctx.shadowColor = "rgba(255,220,100,.75)";
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(p.x, y, p.r + 8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,248,214,.9)";
    ctx.fill();
    ctx.shadowBlur = 0;
    drawCircleImage(images[p.kind], p.x, y, p.r, p.kind.toUpperCase());
    ctx.restore();
  }

  function drawEnemy(e) {
    const toxic = e.kind === "toxic";
    ctx.save();
    ctx.translate(e.x, e.y);
    const pulse = 1 + Math.sin(e.pulse) * .06;
    ctx.scale(pulse, pulse);
    ctx.shadowColor = toxic ? "rgba(122,50,142,.6)" : "rgba(80,10,20,.55)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    ctx.fillStyle = toxic ? "#6c397b" : "#40272b";
    ctx.fill();
    ctx.strokeStyle = toxic ? "#e3a4f0" : "#d66c62";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "900 20px sans-serif";
    ctx.fillText(toxic ? "☠" : "⚔", 0, 3);
    ctx.font = "800 13px sans-serif";
    ctx.fillText(toxic ? "酸毒粉" : "追兵", 0, 21);
    ctx.restore();
  }

  function drawArrow(p) {
    const angle = Math.atan2(p.vy, p.vx);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.strokeStyle = p.acid ? "#d7f366" : "#f3dfbb";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(18, 0);
    ctx.stroke();
    ctx.fillStyle = p.acid ? "#b5db38" : "#df8c55";
    ctx.beginPath();
    ctx.moveTo(27, 0);
    ctx.lineTo(12, -9);
    ctx.lineTo(12, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(44,24,41,.78)";
    ctx.font = "800 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.label, p.x, p.y - 17);
  }

  function drawCharacters() {
    const pl = state.player;
    const pr = state.princess;
    const blink = state.invincible > 0 && Math.floor(state.invincible * 12) % 2 === 0;
    const sort = [
      { who: "lom", x: pl.x, y: pl.y, w: 98, h: 178, alpha: blink ? .35 : 1 },
      { who: "princess", x: pr.x, y: pr.y, w: 94, h: 176, alpha: blink ? .35 : 1 }
    ].sort((a, b) => a.y - b.y);

    sort.forEach((c) => {
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.shadowColor = "rgba(0,0,0,.38)";
      ctx.shadowBlur = 15;
      ctx.shadowOffsetY = 9;
      drawImageContain(images[c.who], c.x - c.w / 2, c.y - c.h + 34, c.w, c.h, c.who === "lom" ? "Lom" : "公主");
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y + 26, 34, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,.2)";
      ctx.fill();
      ctx.restore();
    });

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "900 15px sans-serif";
    labelTag(pl.x, pl.y - 154, "LOM", "#173f3b");
    labelTag(pr.x, pr.y - 151, state.drunk > 0 ? "公主 ♨" : "公主", state.drunk > 0 ? "#b74356" : "#8c3f63");
    ctx.restore();

    if (state.shield > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,225,120,.9)";
      ctx.lineWidth = 7;
      ctx.shadowColor = "#ffe175";
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(pl.x, pl.y - 48, 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (state.drunk > 0) {
      ctx.save();
      ctx.fillStyle = "#fff7bc";
      ctx.font = "900 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("@  ✦  @", pr.x, pr.y - 178);
      ctx.restore();
    }
  }

  function labelTag(x, y, text, color) {
    ctx.font = "900 15px sans-serif";
    const width = Math.max(55, ctx.measureText(text).width + 22);
    ctx.fillStyle = color;
    roundRect(ctx, x - width / 2, y - 18, width, 27, 14);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, x, y + 1);
  }

  function drawCircleImage(img, x, y, radius, fallback) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
    if (img?.complete && img.naturalWidth) {
      const scale = Math.max(radius * 2 / img.naturalWidth, radius * 2 / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    } else {
      ctx.fillStyle = "#315f55";
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${Math.max(12, radius * .42)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(fallback, x, y + 5);
    }
    ctx.restore();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawImageContain(img, x, y, w, h, fallback) {
    if (img?.complete && img.naturalWidth) {
      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = "rgba(255,255,255,.85)";
      roundRect(ctx, x, y, w, h, 18);
      ctx.fill();
      ctx.fillStyle = "#173f3b";
      ctx.font = "900 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(fallback, x + w / 2, y + h / 2);
    }
  }

  function roundRect(context, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    context.beginPath();
    context.moveTo(x + rr, y);
    context.arcTo(x + w, y, x + w, y + h, rr);
    context.arcTo(x + w, y + h, x, y + h, rr);
    context.arcTo(x, y + h, x, y, rr);
    context.arcTo(x, y, x + w, y, rr);
    context.closePath();
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function resetJoystick() {
    input.pointerId = null;
    input.x = 0;
    input.y = 0;
    $("#joystickKnob").style.transform = "translate(0px, 0px)";
  }

  function updateJoystick(event) {
    const joy = $("#joystick");
    const rect = joy.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = event.clientX - cx;
    let dy = event.clientY - cy;
    const max = rect.width * .31;
    const length = Math.hypot(dx, dy);
    if (length > max) { dx = dx / length * max; dy = dy / length * max; }
    input.x = dx / max;
    input.y = dy / max;
    $("#joystickKnob").style.transform = `translate(${dx}px, ${dy}px)`;
  }

  $("#joystick").addEventListener("pointerdown", (event) => {
    input.pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });
  $("#joystick").addEventListener("pointermove", (event) => {
    if (event.pointerId === input.pointerId) updateJoystick(event);
  });
  $("#joystick").addEventListener("pointerup", resetJoystick);
  $("#joystick").addEventListener("pointercancel", resetJoystick);

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "w", "a", "s", "d", " "].includes(key)) event.preventDefault();
    if (key === " ") tryHug();
    input.keys.add(key);
  }, { passive: false });
  window.addEventListener("keyup", (event) => input.keys.delete(event.key.toLowerCase()));

  $("#startBtn").addEventListener("click", () => startLevel(0));
  $("#continueBtn").addEventListener("click", () => startLevel(Math.min(progress.lastLevel, progress.unlocked) - 1));
  $("#soundBtn").addEventListener("click", toggleSound);
  $("#gameSoundBtn").addEventListener("click", toggleSound);
  $("#hugBtn").addEventListener("click", tryHug);
  $("#homeBtn").addEventListener("click", () => {
    sessionToken += 1;
    cancelAnimationFrame(frameId);
    buildLevelSelect();
    showScreen("start");
  });
  $("#nextBtn").addEventListener("click", () => startLevel(Math.min(LEVELS.length - 1, currentLevel + 1)));
  $("#retryBtn").addEventListener("click", () => startLevel(currentLevel));
  $("#resultHomeBtn").addEventListener("click", () => { buildLevelSelect(); showScreen("start"); });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state) state.lastTime = performance.now();
  });

  preloadAssets().then(() => {
    buildLevelSelect();
    setTimeout(() => showScreen("start"), 220);
  });
})();

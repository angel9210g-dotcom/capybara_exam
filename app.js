const $ = (selector) => document.querySelector(selector);

const mapScreen = $("#map-screen");
const gameScreen = $("#game-screen");
const tutorial = $("#tutorial");
const countdown = $("#countdown");
const countdownNumber = $("#countdown-number");
const result = $("#result");
const holesGrid = $("#holes-grid");
const timerEl = $("#timer");
const questionEl = $("#question");
const heartsEl = $("#hearts");
const scoreEl = $("#score");
const feedbackEl = $("#feedback");
const hammerEl = $("#hammer");
const backgroundMusic = $("#background-music");

const MUSIC_VOLUME = {
  tutorial: 0.12,
  countdown: 0.18,
  playing: 0.22,
  result: 0.08,
};

const LEVEL = {
  id: 1,
  duration: 80,
  targetScore: 10,
  maxLives: 5,
  factors: [2, 3, 4, 5],
  visibleTargets: [2, 3],
  waveDuration: 2200,
};

const tutorialSlides = [
  {
    title: "歡迎來到花園練習場！",
    copy: "先看畫面上方的乘法題目，再敲下拿著正確答案的卡皮巴拉。",
  },
  {
    title: "小心不要敲錯囉！",
    copy: "敲錯答案會少一顆愛心。一局有 5 顆愛心，答錯後仍能繼續找正確答案。",
  },
  {
    title: "80 秒完成 10 題",
    copy: "時間內答對 10 題就過關！可以用滑鼠點擊，也可以直接用手指觸碰。準備好了嗎？",
  },
];

const state = {
  phase: "map",
  score: 0,
  lives: LEVEL.maxLives,
  question: null,
  deadline: 0,
  timerId: null,
  waveId: null,
  inputLocked: false,
  soundOn: localStorage.getItem("capySound") !== "off",
  tutorialIndex: 0,
  hiddenAt: null,
  recentQuestions: [],
  waveToken: 0,
};

let audioContext = null;

backgroundMusic.volume = MUSIC_VOLUME.tutorial;

async function playBackgroundMusic(volume = MUSIC_VOLUME.playing, restart = false) {
  if (!state.soundOn) return;
  backgroundMusic.volume = volume;
  if (restart) backgroundMusic.currentTime = 0;
  try {
    await backgroundMusic.play();
  } catch (error) {
    // iPad 與部分瀏覽器會在第一次使用者手勢前阻擋播放；下一次點擊會再次啟動。
    if (error?.name !== "NotAllowedError") console.warn("背景音樂播放失敗", error);
  }
}

function pauseBackgroundMusic(reset = false) {
  backgroundMusic.pause();
  if (reset) backgroundMusic.currentTime = 0;
}

function currentMusicVolume() {
  if (state.phase === "tutorial") return MUSIC_VOLUME.tutorial;
  if (state.phase === "countdown" || state.phase === "game") return MUSIC_VOLUME.countdown;
  if (state.phase === "playing") return MUSIC_VOLUME.playing;
  if (state.phase === "result") return MUSIC_VOLUME.result;
  return 0;
}

function ensureAudio() {
  if (!state.soundOn) return null;
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) audioContext = new Context();
  }
  if (audioContext?.state === "suspended") audioContext.resume();
  return audioContext;
}

function tone(frequency, duration = 0.12, type = "sine", delay = 0) {
  const context = ensureAudio();
  if (!context) return;
  const start = context.currentTime + delay;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

function playSound(name) {
  if (!state.soundOn) return;
  if (name === "pop") tone(280, 0.08, "sine");
  if (name === "wrong") {
    tone(170, 0.16, "square");
    tone(135, 0.19, "square", 0.08);
  }
  if (name === "correct") {
    tone(560, 0.12, "sine");
    tone(760, 0.16, "sine", 0.1);
  }
  if (name === "win") {
    [520, 660, 780, 1040].forEach((freq, index) => tone(freq, 0.18, "triangle", index * 0.11));
  }
}

function setSound(on) {
  state.soundOn = on;
  localStorage.setItem("capySound", on ? "on" : "off");
  [$("#sound-toggle"), $("#game-sound-toggle")].forEach((button) => {
    button.textContent = on ? "🔊" : "🔇";
    button.setAttribute("aria-label", on ? "關閉音效" : "開啟音效");
    button.setAttribute("aria-pressed", String(on));
  });
  if (!on) {
    pauseBackgroundMusic();
  } else {
    const volume = currentMusicVolume();
    if (volume > 0) void playBackgroundMusic(volume);
  }
}

function buildHoles() {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 9; index += 1) {
    const hole = document.createElement("button");
    hole.className = "hole";
    hole.type = "button";
    hole.dataset.index = String(index);
    hole.setAttribute("aria-label", `第 ${index + 1} 個洞口，目前沒有卡皮巴拉`);
    hole.innerHTML = `
      <span class="capy-target">
        <img class="capy-image" src="./assets/capy-pop.png" alt="" draggable="false" />
        <span class="answer-card"></span>
      </span>
    `;
    hole.addEventListener("pointerdown", (event) => {
      moveHammer(event.clientX, event.clientY, true);
      hitHole(hole);
    });
    fragment.appendChild(hole);
  }
  holesGrid.appendChild(fragment);
}

function setActiveScreen(name) {
  mapScreen.classList.toggle("is-active", name === "map");
  gameScreen.classList.toggle("is-active", name === "game");
  state.phase = name;
}

function showTutorial() {
  state.phase = "tutorial";
  state.tutorialIndex = 0;
  renderTutorial();
  tutorial.hidden = false;
  void playBackgroundMusic(MUSIC_VOLUME.tutorial, true);
  $("#next-tutorial").focus();
}

function renderTutorial() {
  const slide = tutorialSlides[state.tutorialIndex];
  $("#tutorial-title").textContent = slide.title;
  $("#tutorial-copy").textContent = slide.copy;
  $("#next-tutorial").textContent = state.tutorialIndex === tutorialSlides.length - 1 ? "開始挑戰" : "下一步";
  $("#tutorial-dots").innerHTML = tutorialSlides
    .map((_, index) => `<span class="dialog-dot ${index === state.tutorialIndex ? "is-active" : ""}"></span>`)
    .join("");
}

function nextTutorial() {
  if (state.tutorialIndex < tutorialSlides.length - 1) {
    state.tutorialIndex += 1;
    renderTutorial();
    playSound("pop");
    return;
  }
  tutorial.hidden = true;
  startCountdown();
}

async function startCountdown() {
  setActiveScreen("game");
  state.phase = "countdown";
  void playBackgroundMusic(MUSIC_VOLUME.countdown);
  resetBoard();
  countdown.hidden = false;
  for (const value of [3, 2, 1]) {
    countdownNumber.textContent = String(value);
    countdownNumber.style.animation = "none";
    void countdownNumber.offsetWidth;
    countdownNumber.style.animation = "";
    tone(360 + value * 70, 0.12, "triangle");
    await wait(720);
  }
  countdownNumber.textContent = "GO!";
  tone(780, 0.18, "triangle");
  await wait(430);
  countdown.hidden = true;
  beginRound();
}

function resetBoard() {
  clearTimers();
  state.score = 0;
  state.lives = LEVEL.maxLives;
  state.question = null;
  state.inputLocked = true;
  state.recentQuestions = [];
  state.waveToken += 1;
  renderHud();
  clearWave(true);
}

function beginRound() {
  state.phase = "playing";
  backgroundMusic.volume = MUSIC_VOLUME.playing;
  if (backgroundMusic.paused) void playBackgroundMusic(MUSIC_VOLUME.playing);
  state.inputLocked = false;
  state.deadline = performance.now() + LEVEL.duration * 1000;
  nextQuestion();
  updateTimer();
  state.timerId = window.setInterval(updateTimer, 100);
}

function updateTimer() {
  if (state.phase !== "playing") return;
  const remaining = Math.max(0, state.deadline - performance.now());
  const seconds = Math.ceil(remaining / 1000);
  timerEl.querySelector("strong").textContent = String(seconds);
  timerEl.classList.toggle("is-low", seconds <= 10);
  timerEl.setAttribute("aria-label", `剩餘 ${seconds} 秒`);
  if (remaining <= 0) endRound(false, "時間到了");
}

function nextQuestion() {
  if (state.phase !== "playing") return;
  state.inputLocked = false;
  state.question = createQuestion();
  questionEl.textContent = `${state.question.a} × ${state.question.b} = ?`;
  spawnWave();
}

function createQuestion() {
  let candidate;
  let key;
  let attempts = 0;
  do {
    const a = sample(LEVEL.factors);
    const b = randomInt(2, 9);
    candidate = { a, b, answer: a * b };
    key = `${a}x${b}`;
    attempts += 1;
  } while (state.recentQuestions.includes(key) && attempts < 20);

  state.recentQuestions.push(key);
  if (state.recentQuestions.length > 8) state.recentQuestions.shift();
  return candidate;
}

function buildAnswers(correct, count) {
  const answers = new Set([correct]);
  const nearby = [-9, -8, -7, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 7, 8, 9]
    .map((delta) => correct + delta)
    .filter((value) => value >= 4 && value <= 81);

  while (answers.size < count && nearby.length) {
    const index = randomInt(0, nearby.length - 1);
    answers.add(nearby.splice(index, 1)[0]);
  }
  while (answers.size < count) answers.add(randomInt(4, 81));
  return shuffle([...answers]);
}

function spawnWave() {
  if (state.phase !== "playing" || state.inputLocked) return;
  const token = ++state.waveToken;
  clearWave(true);
  const targetCount = randomInt(LEVEL.visibleTargets[0], LEVEL.visibleTargets[1]);
  const indices = shuffle([...Array(9).keys()]).slice(0, targetCount);
  const answers = buildAnswers(state.question.answer, targetCount);

  indices.forEach((holeIndex, position) => {
    const hole = holesGrid.children[holeIndex];
    const answer = answers[position];
    hole.dataset.answer = String(answer);
    hole.dataset.active = "true";
    hole.querySelector(".answer-card").textContent = String(answer);
    hole.querySelector(".capy-image").src = "./assets/capy-pop.png";
    hole.setAttribute("aria-label", `答案 ${answer} 的卡皮巴拉`);
    window.setTimeout(() => {
      if (state.phase !== "playing" || token !== state.waveToken) return;
      hole.classList.add("is-active");
      playSound("pop");
    }, position * 115);
  });

  state.waveId = window.setTimeout(() => {
    if (state.phase !== "playing" || token !== state.waveToken || state.inputLocked) return;
    clearWave();
    state.waveId = window.setTimeout(spawnWave, 300);
  }, LEVEL.waveDuration);
}

function hitHole(hole) {
  if (state.phase !== "playing" || state.inputLocked || hole.dataset.active !== "true") return;
  const answer = Number(hole.dataset.answer);
  hole.dataset.active = "false";

  if (answer === state.question.answer) {
    state.inputLocked = true;
    state.score += 1;
    hole.classList.add("is-correct");
    showFeedback("答對了！", false);
    playSound("correct");
    renderHud();
    if (state.score >= LEVEL.targetScore) {
      window.setTimeout(() => endRound(true, "完成 10 題"), 520);
    } else {
      window.setTimeout(() => {
        clearWave(true);
        nextQuestion();
      }, 620);
    }
    return;
  }

  state.lives -= 1;
  hole.classList.add("is-hit");
  hole.querySelector(".capy-image").src = "./assets/capy-hit.png";
  showFeedback("哎呀，答案不是這個！", true);
  playSound("wrong");
  renderHud();
  if (state.lives <= 0) {
    state.inputLocked = true;
    window.setTimeout(() => endRound(false, "愛心用完了"), 620);
  } else {
    window.setTimeout(() => {
      hole.classList.add("is-hiding");
    }, 420);
  }
}

function clearWave(immediate = false) {
  window.clearTimeout(state.waveId);
  [...holesGrid.children].forEach((hole) => {
    if (!immediate && hole.classList.contains("is-active")) hole.classList.add("is-hiding");
    const clear = () => {
      hole.className = "hole";
      hole.dataset.active = "false";
      hole.dataset.answer = "";
      hole.querySelector(".answer-card").textContent = "";
      hole.querySelector(".capy-image").src = "./assets/capy-pop.png";
      hole.setAttribute("aria-label", `第 ${Number(hole.dataset.index) + 1} 個洞口，目前沒有卡皮巴拉`);
    };
    if (immediate) clear();
    else window.setTimeout(clear, 250);
  });
}

function renderHud() {
  scoreEl.querySelector("strong").textContent = `${state.score}/${LEVEL.targetScore}`;
  scoreEl.setAttribute("aria-label", `已答對 ${state.score} 題，共 ${LEVEL.targetScore} 題`);
  heartsEl.innerHTML = [...Array(LEVEL.maxLives)]
    .map((_, index) => `<span class="heart ${index >= state.lives ? "is-lost" : ""}" aria-hidden="true">❤</span>`)
    .join("");
  heartsEl.setAttribute("aria-label", `剩餘 ${state.lives} 滴血`);
}

function showFeedback(message, wrong) {
  feedbackEl.textContent = message;
  feedbackEl.classList.toggle("is-wrong", wrong);
  feedbackEl.classList.add("is-visible");
  window.clearTimeout(showFeedback.timeout);
  showFeedback.timeout = window.setTimeout(() => feedbackEl.classList.remove("is-visible"), 850);
}

function endRound(success, reason) {
  if (state.phase !== "playing") return;
  const secondsLeft = Math.max(0, Math.ceil((state.deadline - performance.now()) / 1000));
  state.phase = "result";
  backgroundMusic.volume = MUSIC_VOLUME.result;
  state.inputLocked = true;
  clearTimers();
  clearWave();
  timerEl.classList.remove("is-low");

  $("#result-icon").textContent = success ? "🏆" : "☁️";
  $("#result-title").textContent = success ? "成功過關！" : "挑戰失敗";
  $("#result-copy").textContent = success
    ? "太棒了！你已經完成第一關的九九乘法挑戰。"
    : `${reason}，先回主地圖休息一下，再來挑戰吧！`;
  $("#result-stats").innerHTML = `
    <div class="stat"><strong>${state.score}</strong><span>答對題數</span></div>
    <div class="stat"><strong>${state.lives}</strong><span>剩餘愛心</span></div>
    <div class="stat"><strong>${secondsLeft}</strong><span>剩餘秒數</span></div>
  `;
  $("#retry-button").hidden = !success;
  result.hidden = false;
  if (success) {
    localStorage.setItem("capyLevel1Complete", "true");
    playSound("win");
    $("#result-map-button").focus();
  } else {
    window.setTimeout(() => {
      if (!result.hidden && state.phase === "result") goToMap();
    }, 2600);
  }
}

function clearTimers() {
  window.clearInterval(state.timerId);
  window.clearTimeout(state.waveId);
  state.timerId = null;
  state.waveId = null;
}

function goToMap() {
  clearTimers();
  pauseBackgroundMusic(true);
  tutorial.hidden = true;
  countdown.hidden = true;
  result.hidden = true;
  feedbackEl.classList.remove("is-visible");
  setActiveScreen("map");
  $("#start-level-button").focus();
}

function moveHammer(x, y, swing = false) {
  hammerEl.style.left = `${x}px`;
  hammerEl.style.top = `${y}px`;
  if (matchMedia("(pointer: coarse)").matches) {
    hammerEl.classList.add("is-touching");
    window.clearTimeout(moveHammer.touchTimeout);
    moveHammer.touchTimeout = window.setTimeout(() => hammerEl.classList.remove("is-touching"), 420);
  }
  if (swing) {
    hammerEl.classList.remove("is-swinging");
    void hammerEl.offsetWidth;
    hammerEl.classList.add("is-swinging");
  }
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sample(items) {
  return items[randomInt(0, items.length - 1)];
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

$("#start-level-button").addEventListener("click", showTutorial);
document.querySelector(".level-1").addEventListener("click", showTutorial);
$("#next-tutorial").addEventListener("click", nextTutorial);
$("#skip-tutorial").addEventListener("click", () => {
  tutorial.hidden = true;
  startCountdown();
});
$("#map-button").addEventListener("click", goToMap);
$("#result-map-button").addEventListener("click", goToMap);
$("#retry-button").addEventListener("click", () => {
  result.hidden = true;
  startCountdown();
});
$("#sound-toggle").addEventListener("click", () => setSound(!state.soundOn));
$("#game-sound-toggle").addEventListener("click", () => setSound(!state.soundOn));

gameScreen.addEventListener("pointermove", (event) => moveHammer(event.clientX, event.clientY));
gameScreen.addEventListener("pointerdown", (event) => moveHammer(event.clientX, event.clientY, true));
gameScreen.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.phase === "playing") {
    state.hiddenAt = performance.now();
    window.clearInterval(state.timerId);
    window.clearTimeout(state.waveId);
    pauseBackgroundMusic();
  } else if (!document.hidden && state.phase === "playing" && state.hiddenAt !== null) {
    state.deadline += performance.now() - state.hiddenAt;
    state.hiddenAt = null;
    state.timerId = window.setInterval(updateTimer, 100);
    spawnWave();
    void playBackgroundMusic(MUSIC_VOLUME.playing);
  }
});

buildHoles();
setSound(state.soundOn);
renderHud();

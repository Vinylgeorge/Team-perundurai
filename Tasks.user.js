// ==UserScript==
// @name        MTurk Task - Local Python Multi-Server API (No Firebase)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       GM_xmlhttpRequest
// @connect     localhost
// @connect     192.227.124.173
// @connect     *
// @version     5.0
// @updateURL   https://github.com/mavericpartha/lokesh/raw/refs/heads/main/Tasks.user.js
// @downloadURL https://github.com/mavericpartha/lokesh/raw/refs/heads/main/Tasks.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- CHANGE THIS to your Python server's IP if MTurk runs on a different machine ----
  const API_BASE = "http://192.227.124.173:8000";
  const TIMER_STATE_PREFIX = "mturk_hit_timer_state::";

  let currentServer = null;
  let workerToUser = {};
  let userToWorkers = {};

  // --- API helpers ---

  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: method,
          url: API_BASE + path,
          headers: { "Content-Type": "application/json" },
          data: body !== undefined ? JSON.stringify(body) : undefined,
          responseType: "json",
          timeout: 15000,
          onload: function(resp) {
            if (resp.status >= 200 && resp.status < 300) {
              let data = resp.response;
              if (typeof data === "string") { try { data = JSON.parse(data); } catch(_){} }
              resolve(data);
            } else {
              reject(new Error("API " + resp.status + ": " + (resp.responseText || "").slice(0, 200)));
            }
          },
          onerror: function(resp) {
            reject(new Error("Connection failed to " + API_BASE + path + " - Is the Python server running?"));
          },
          ontimeout: function() {
            reject(new Error("Timeout connecting to " + API_BASE + path));
          }
        });
      } else {
        fetch(API_BASE + path, {
          method: method,
          headers: { "Content-Type": "application/json" },
          body: body !== undefined ? JSON.stringify(body) : undefined
        })
        .then(function(r) {
          if (!r.ok) throw new Error("API " + r.status);
          return r.json();
        })
        .then(resolve)
        .catch(reject);
      }
    });
  }

  // --- DOM helpers ---

  function getWorkerId() {
    const el = document.querySelector(".me-bar span.text-uppercase span");
    if (!el) return null;
    const txt = el.textContent.replace(/^Copied/i, "").trim();
    const match = txt.match(/A[A-Z0-9]{12,}/);
    return match ? match[0] : txt;
  }

  // --- Auto-detect server + load user map ---

  async function detectServerAndLoadMap() {
    const workerId = getWorkerId();
    if (!workerId) {
      console.warn("[AB2] Could not read worker ID from page");
      return;
    }
    try {
      const det = await api("GET", "/api/detect-server?workerId=" + encodeURIComponent(workerId));
      currentServer = det.server;
      console.log("[AB2] Detected server:", currentServer, "for worker:", workerId);
    } catch (err) {
      console.warn("[AB2] Server detection failed, defaulting to server1:", err.message || err);
      currentServer = "server1";
    }
    try {
      const data = await api("GET", "/api/user-map?server=" + currentServer);
      workerToUser = data.workerToUser || {};
      userToWorkers = data.userToWorkers || {};
      console.log("[AB2] Loaded user map for", currentServer + ":", Object.keys(workerToUser).length, "entries");
    } catch (err) {
      console.error("[AB2] Failed to load user map:", err.message || err);
    }
  }

  // --- More DOM helpers ---

  function parseReward() {
    let reward = 0.0;
    const label = Array.from(document.querySelectorAll(".detail-bar-label"))
      .find(el => el.textContent.includes("Reward"));
    if (label) {
      const valEl = label.nextElementSibling;
      if (valEl) {
        const match = valEl.innerText.match(/\$([0-9.]+)/);
        if (match) reward = parseFloat(match[1]);
      }
    }
    return reward;
  }

  function parseDurationToSeconds(raw) {
    const text = String(raw || "").toLowerCase();
    let total = 0;
    const day = text.match(/(\d+)\s*(day|days|d)\b/);
    const hr  = text.match(/(\d+)\s*(hour|hours|hr|hrs|h)\b/);
    const min = text.match(/(\d+)\s*(minute|minutes|min|mins|m)\b/);
    const sec = text.match(/(\d+)\s*(second|seconds|sec|secs|s)\b/);
    if (day) total += parseInt(day[1], 10) * 86400;
    if (hr)  total += parseInt(hr[1], 10)  * 3600;
    if (min) total += parseInt(min[1], 10) * 60;
    if (sec) total += parseInt(sec[1], 10);
    return total || null;
  }

  function parseTimeAllottedSeconds() {
    const label = Array.from(document.querySelectorAll(".detail-bar-label"))
      .find(el => /time\s*allotted/i.test(el.textContent || ""));
    if (!label) return null;
    const valEl = label.nextElementSibling;
    if (!valEl) return null;
    return parseDurationToSeconds(valEl.innerText || valEl.textContent || "");
  }

  function collectTaskHit() {
    const assignmentId = new URLSearchParams(window.location.search).get("assignment_id");
    if (!assignmentId) return null;

    const workerId = getWorkerId();
    const user = workerToUser[workerId] || "Unknown";

    return {
      assignmentId,
      server: currentServer,
      workerId,
      user,
      requester: document.querySelector(".detail-bar-value a[href*='/requesters/']")?.innerText || "",
      title: document.querySelector(".task-project-title")?.innerText || document.title,
      reward: parseReward(),
      timeAllottedSeconds: parseTimeAllottedSeconds(),
      acceptedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      url: window.location.href,
      status: "active"
    };
  }

  // --- Messaging (scoped to currentServer) ---

  async function sendLiveMessageToAllUsers(text, hit) {
    const fromId = hit.workerId || "UNKNOWN";
    const data = await api("POST", "/api/messages", { fromId, text, server: currentServer });
    return data.sent || 0;
  }

  async function sendLiveMessageToUserNumber(userNumber, text, hit) {
    const fromId = hit.workerId || "UNKNOWN";
    const data = await api("POST", "/api/messages", {
      fromId, text, server: currentServer,
      toUserNumber: String(userNumber).trim()
    });
    return data.sent || 0;
  }

  // --- Timer state (localStorage) ---

  function getTimerStateKey(assignmentId) {
    return TIMER_STATE_PREFIX + assignmentId;
  }

  function loadTimerState(assignmentId) {
    try {
      const raw = localStorage.getItem(getTimerStateKey(assignmentId));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveTimerState(assignmentId, state) {
    try {
      localStorage.setItem(getTimerStateKey(assignmentId), JSON.stringify(state));
    } catch (_) {}
  }

  // --- Shadow Panel (floating HIT helper) ---

  let shadowPanel = null;
  let shadowTimerInterval = null;
  let shadowMinimized = false;

  function createShadowPanel(hit) {
    if (!hit || shadowPanel) return;

    const assignmentId = hit.assignmentId || "";
    const reward = (hit.reward || 0).toFixed(2);
    const user = hit.user || "Unknown";
    const server = currentServer || "?";
    const title = (hit.title || "Untitled HIT").slice(0, 60);
    const requester = (hit.requester || "Unknown").slice(0, 40);

    const panel = document.createElement("div");
    panel.id = "ab2-shadow-panel";
    panel.innerHTML = `
      <style>
        #ab2-shadow-panel {
          position: fixed; bottom: 16px; right: 16px; z-index: 2147483646;
          width: 320px; font-family: 'Segoe UI', system-ui, sans-serif;
          background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
          border: 1px solid #6366f1; border-radius: 14px;
          box-shadow: 0 8px 40px rgba(99,102,241,.35), 0 0 0 1px rgba(99,102,241,.15);
          color: #e2e8f0; overflow: hidden;
          transition: width .25s, height .25s, opacity .2s;
          user-select: none;
        }
        #ab2-shadow-panel.minimized {
          width: 52px; height: 52px !important; border-radius: 50%;
          cursor: pointer; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
        }
        #ab2-shadow-panel.minimized .sp-body { display: none; }
        #ab2-shadow-panel.minimized .sp-header { display: none; }
        #ab2-shadow-panel.minimized .sp-mini-icon { display: flex; }

        .sp-mini-icon {
          display: none; align-items: center; justify-content: center;
          width: 100%; height: 100%; font-size: 22px; cursor: pointer;
        }

        .sp-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; background: rgba(99,102,241,.15);
          border-bottom: 1px solid rgba(99,102,241,.25); cursor: move;
        }
        .sp-header .sp-title { font-size: 12px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: #a5b4fc; }
        .sp-header .sp-btns { display: flex; gap: 6px; }
        .sp-header .sp-btn-icon {
          width: 24px; height: 24px; border: none; border-radius: 6px;
          background: rgba(255,255,255,.08); color: #94a3b8; cursor: pointer;
          font-size: 14px; display: flex; align-items: center; justify-content: center;
          transition: background .15s, color .15s;
        }
        .sp-header .sp-btn-icon:hover { background: rgba(255,255,255,.18); color: #fff; }

        .sp-body { padding: 12px 14px; }

        .sp-info-grid {
          display: grid; grid-template-columns: auto 1fr; gap: 3px 10px;
          font-size: 11.5px; margin-bottom: 10px;
        }
        .sp-info-grid .sp-label { color: #64748b; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; padding-top: 1px; }
        .sp-info-grid .sp-val { color: #e2e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sp-info-grid .sp-val.reward { color: #4ade80; font-weight: 700; font-size: 13px; }

        .sp-timer-bar {
          background: #1e293b; border-radius: 8px; height: 28px; position: relative;
          overflow: hidden; margin-bottom: 10px; border: 1px solid #334155;
        }
        .sp-timer-fill {
          height: 100%; border-radius: 8px; transition: width 1s linear, background .5s;
          background: #22c55e;
        }
        .sp-timer-fill.warning { background: #eab308; }
        .sp-timer-fill.danger { background: #ef4444; }
        .sp-timer-text {
          position: absolute; inset: 0; display: flex; align-items: center;
          justify-content: center; font-size: 12px; font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,.6);
        }

        .sp-actions { display: flex; gap: 6px; }
        .sp-actions button {
          flex: 1; padding: 8px 0; border: none; border-radius: 8px;
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: filter .15s, transform .1s; letter-spacing: .02em;
        }
        .sp-actions button:active { transform: scale(.97); }
        .sp-btn-submit { background: linear-gradient(135deg, #16a34a, #22c55e); color: #fff; }
        .sp-btn-submit:hover { filter: brightness(1.15); }
        .sp-btn-return { background: linear-gradient(135deg, #dc2626, #ef4444); color: #fff; }
        .sp-btn-return:hover { filter: brightness(1.15); }
        .sp-btn-close { background: #334155; color: #94a3b8; }
        .sp-btn-close:hover { background: #475569; color: #fff; }

        .sp-status { font-size: 10px; color: #64748b; text-align: center; margin-top: 8px; }
        .sp-status .server-tag { color: #818cf8; font-weight: 600; }
      </style>

      <div class="sp-mini-icon" id="ab2-sp-expand">&#9889;</div>

      <div class="sp-header" id="ab2-sp-drag">
        <span class="sp-title">&#9889; HIT Shadow</span>
        <div class="sp-btns">
          <button class="sp-btn-icon" id="ab2-sp-minimize" title="Minimize">&#8722;</button>
        </div>
      </div>

      <div class="sp-body">
        <div class="sp-info-grid">
          <span class="sp-label">User</span>    <span class="sp-val">${user}</span>
          <span class="sp-label">Requester</span><span class="sp-val">${requester}</span>
          <span class="sp-label">Title</span>   <span class="sp-val" title="${hit.title || ""}">${title}</span>
          <span class="sp-label">Reward</span>  <span class="sp-val reward">$${reward}</span>
        </div>

        <div class="sp-timer-bar">
          <div class="sp-timer-fill" id="ab2-sp-fill" style="width:0%"></div>
          <div class="sp-timer-text" id="ab2-sp-time">--:--</div>
        </div>

        <div class="sp-actions">
          <button class="sp-btn-submit" id="ab2-sp-submit">&#10004; Submit</button>
          <button class="sp-btn-return" id="ab2-sp-return">&#10006; Return</button>
        </div>

        <div class="sp-status">
          <span class="server-tag">${server}</span> &middot; ${assignmentId.slice(0, 16)}&hellip;
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    shadowPanel = panel;

    // --- Dragging ---
    const dragHandle = panel.querySelector("#ab2-sp-drag");
    let isDragging = false, dragX = 0, dragY = 0;
    dragHandle.addEventListener("mousedown", function (e) {
      isDragging = true;
      dragX = e.clientX - panel.getBoundingClientRect().left;
      dragY = e.clientY - panel.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!isDragging) return;
      panel.style.left = (e.clientX - dragX) + "px";
      panel.style.top = (e.clientY - dragY) + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    });
    document.addEventListener("mouseup", function () { isDragging = false; });

    // --- Minimize / Expand ---
    panel.querySelector("#ab2-sp-minimize").addEventListener("click", function () {
      shadowMinimized = true;
      panel.classList.add("minimized");
    });
    panel.querySelector("#ab2-sp-expand").addEventListener("click", function () {
      shadowMinimized = false;
      panel.classList.remove("minimized");
    });

    // --- Submit button ---
    panel.querySelector("#ab2-sp-submit").addEventListener("click", function () {
      const submitBtn = document.querySelector("#submitButton")
        || document.querySelector("button[type='submit']")
        || document.querySelector("[data-testid='submit-button']")
        || document.querySelector("input[type='submit']")
        || Array.from(document.querySelectorAll("button")).find(
             b => /submit/i.test(b.textContent) && b.offsetParent !== null
           );
      if (submitBtn) {
        submitBtn.click();
      } else {
        alert("Submit button not found on this page. Please submit manually.");
      }
    });

    // --- Return button ---
    panel.querySelector("#ab2-sp-return").addEventListener("click", function () {
      if (!confirm("Return this HIT? You will lose any work done.")) return;
      const returnLink = document.querySelector("a[href*='/return']")
        || document.querySelector("[data-testid='return-button']")
        || Array.from(document.querySelectorAll("a, button")).find(
             el => /return\s*hit/i.test(el.textContent) && el.offsetParent !== null
           );
      if (returnLink) {
        returnLink.click();
      } else {
        window.location.href = "https://worker.mturk.com/tasks";
      }
    });

    // --- Live timer countdown ---
    startShadowTimer(hit);
  }

  function startShadowTimer(hit) {
    if (shadowTimerInterval) clearInterval(shadowTimerInterval);
    const maxSec = hit.timeAllottedSeconds || 0;
    if (!maxSec) return;

    const acceptedMs = new Date(hit.acceptedAt).getTime();
    const fillEl = document.getElementById("ab2-sp-fill");
    const timeEl = document.getElementById("ab2-sp-time");
    if (!fillEl || !timeEl) return;

    function updateTimer() {
      const elapsedSec = Math.max(0, (Date.now() - acceptedMs) / 1000);
      const remainSec = Math.max(0, maxSec - elapsedSec);
      const pct = Math.min(100, (elapsedSec / maxSec) * 100);

      const m = Math.floor(remainSec / 60);
      const s = Math.floor(remainSec % 60);
      const h = Math.floor(m / 60);
      const mm = m % 60;

      timeEl.textContent = h > 0
        ? h + "h " + String(mm).padStart(2, "0") + "m " + String(s).padStart(2, "0") + "s"
        : String(mm).padStart(2, "0") + ":" + String(s).padStart(2, "0");

      fillEl.style.width = pct + "%";
      fillEl.className = "sp-timer-fill" + (pct > 80 ? " danger" : pct > 60 ? " warning" : "");

      if (remainSec <= 0) {
        timeEl.textContent = "EXPIRED";
        fillEl.style.width = "100%";
        fillEl.className = "sp-timer-fill danger";
      }
    }

    updateTimer();
    shadowTimerInterval = setInterval(updateTimer, 1000);
  }

  // --- Timer alert dialog ---

  function showTimeAlertDialog(hit, state, elapsedSec, maxSec, onSnooze, onIgnore) {
    const old = document.getElementById("ab2-time-alert");
    if (old) old.remove();

    const pct = Math.round((elapsedSec / maxSec) * 100);
    const overlay = document.createElement("div");
    overlay.id = "ab2-time-alert";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2147483647;display:flex;align-items:center;justify-content:center;";

    const box = document.createElement("div");
    box.style.cssText = "width:560px;max-width:92vw;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:12px;padding:16px;font-family:Arial,sans-serif;";
    box.innerHTML =
      "<div style='font-size:18px;font-weight:700;margin-bottom:8px;'>HIT Timer Alert [" + (currentServer || "?") + "]</div>" +
      "<div style='font-size:13px;line-height:1.45;margin-bottom:10px;'>" +
        "Assignment: <b>" + hit.assignmentId + "</b><br>" +
        "Title: " + (hit.title || "Untitled HIT") + "<br>" +
        "Elapsed: " + Math.round(elapsedSec) + "s of " + Math.round(maxSec) + "s (" + pct + "%)" +
      "</div>" +
      "<textarea id='ab2-alert-msg' style='width:100%;height:90px;border-radius:8px;border:1px solid #475569;background:#020617;color:#e2e8f0;padding:8px;'>HIT timer alert: Assignment " + hit.assignmentId + " reached " + pct + "% of max time.</textarea>" +
      "<div style='margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;'>" +
        "<label style='font-size:12px;'>User number:</label>" +
        "<input id='ab2-target-user' type='text' placeholder='e.g. 226' style='width:140px;border-radius:8px;border:1px solid #475569;background:#020617;color:#e2e8f0;padding:8px;' />" +
        "<button id='ab2-sendone-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#0ea5e9;color:#fff;cursor:pointer;'>Send to Specific User</button>" +
      "</div>" +
      "<div style='display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;'>" +
        "<button id='ab2-snooze-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;'>Snooze (+10%)</button>" +
        "<button id='ab2-ignore-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#dc2626;color:#fff;cursor:pointer;'>Ignore</button>" +
        "<button id='ab2-sendall-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#16a34a;color:#fff;cursor:pointer;'>Send Message to All</button>" +
        "<button id='ab2-close-btn' style='padding:8px 12px;border:0;border-radius:8px;background:#475569;color:#fff;cursor:pointer;'>Close</button>" +
      "</div>" +
      "<div id='ab2-alert-status' style='margin-top:10px;font-size:12px;color:#93c5fd;'></div>";

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const statusEl = box.querySelector("#ab2-alert-status");
    let dialogClosed = false;
    let autoCloseTimer = null;

    function closeDialogForCurrentAlertOnly() {
      if (dialogClosed) return;
      dialogClosed = true;
      state.nextThresholdPct = Math.min((state.nextThresholdPct || 0.5) + 0.1, 5);
      state.dialogOpen = false;
      saveTimerState(hit.assignmentId, state);
      if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
      overlay.remove();
    }

    function closeDialogOnly() {
      if (dialogClosed) return;
      dialogClosed = true;
      state.dialogOpen = false;
      saveTimerState(hit.assignmentId, state);
      if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
      overlay.remove();
    }

    box.querySelector("#ab2-snooze-btn").onclick = function () {
      onSnooze();
      closeDialogOnly();
    };
    box.querySelector("#ab2-ignore-btn").onclick = function () {
      onIgnore();
      closeDialogOnly();
    };
    box.querySelector("#ab2-close-btn").onclick = function () {
      closeDialogForCurrentAlertOnly();
    };
    box.querySelector("#ab2-sendall-btn").onclick = async function () {
      try {
        const txt = (box.querySelector("#ab2-alert-msg").value || "").trim();
        if (!txt) return;
        statusEl.textContent = "Sending to all users on " + currentServer + "...";
        const n = await sendLiveMessageToAllUsers(txt, hit);
        statusEl.textContent = "Sent to " + n + " users.";
      } catch (e) {
        statusEl.textContent = "Send failed: " + (e && e.message ? e.message : e);
      }
    };
    box.querySelector("#ab2-sendone-btn").onclick = async function () {
      try {
        const txt = (box.querySelector("#ab2-alert-msg").value || "").trim();
        const userNo = (box.querySelector("#ab2-target-user").value || "").trim();
        if (!txt) return;
        statusEl.textContent = "Sending to user " + userNo + " on " + currentServer + "...";
        const n = await sendLiveMessageToUserNumber(userNo, txt, hit);
        statusEl.textContent = "Sent to " + n + " user worker(s).";
      } catch (e) {
        statusEl.textContent = "Send failed: " + (e && e.message ? e.message : e);
      }
    };

    autoCloseTimer = setTimeout(() => {
      closeDialogForCurrentAlertOnly();
    }, 10000);
  }

  // --- Time monitor ---

  function startTimeMonitor(hit) {
    if (!hit || !hit.assignmentId || !hit.timeAllottedSeconds || hit.timeAllottedSeconds <= 0) return;
    let state = loadTimerState(hit.assignmentId);
    if (!state) {
      state = {
        acceptedAt: hit.acceptedAt,
        nextThresholdPct: 0.5,
        ignored: false,
        dialogOpen: false
      };
      saveTimerState(hit.assignmentId, state);
    }

    const tick = () => {
      if (state.ignored) return;
      const acceptedMs = new Date(state.acceptedAt).getTime();
      if (!acceptedMs) return;
      const elapsedSec = Math.max(0, (Date.now() - acceptedMs) / 1000);
      const pct = elapsedSec / hit.timeAllottedSeconds;
      if (pct >= state.nextThresholdPct && !state.dialogOpen) {
        state.dialogOpen = true;
        saveTimerState(hit.assignmentId, state);
        showTimeAlertDialog(
          hit, state, elapsedSec, hit.timeAllottedSeconds,
          () => {
            state.nextThresholdPct = Math.min(state.nextThresholdPct + 0.1, 5);
            state.dialogOpen = false;
            saveTimerState(hit.assignmentId, state);
          },
          () => {
            state.ignored = true;
            state.dialogOpen = false;
            saveTimerState(hit.assignmentId, state);
          }
        );
      }
    };

    tick();
    setInterval(tick, 5000);
  }

  // --- Post task ---

  async function postTask(hit) {
    if (!hit) hit = collectTaskHit();
    if (!hit) return;
    try {
      const resp = await api("POST", "/api/hits", hit);
      console.log("[AB2] Posted HIT:", hit.assignmentId, "Server:", resp.server, "User:", hit.user, "Reward:", hit.reward);
    } catch (err) {
      console.warn("[AB2] Failed to post HIT:", err.message || err);
    }
  }

  // --- Initialize ---

  window.addEventListener("load", async () => {
    console.log("[AB2] Connecting to API at", API_BASE);
    await detectServerAndLoadMap();
    const hit = collectTaskHit();
    await postTask(hit);
    createShadowPanel(hit);
    startTimeMonitor(hit);

    try {
      const recentHits = await api("GET", "/api/hits?server=" + currentServer);
      console.log("[AB2] Recent hits on", currentServer, "(last 24h):", recentHits.length);
    } catch (err) {
      console.warn("[AB2] 24h hits read failed:", err.message || err);
    }
  });

  window.__AB2__ = Object.assign({}, window.__AB2__ || {}, {
    api,
    detectServerAndLoadMap,
    getCurrentServer: () => currentServer
  });
})();

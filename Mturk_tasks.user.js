// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant        none
// @version     4.5
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(function () {
  'use strict';

  const s = document.createElement("script");
  s.type = "module";
  s.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, setDoc, doc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

     // --- 🔥 Firebase Config ---
    const firebaseConfig = {
      apiKey: "AIzaSyC57W83XkxdvM2aMQK8GIRYR2SJH1ORdfQ",
      authDomain: "mturk-tasks-72994.firebaseapp.com",
      projectId: "mturk-tasks-72994",
      storageBucket: "mturk-tasks-72994.firebasestorage.app",
      messagingSenderId: "305467873275",
      appId: "1:305467873275:web:7b96048865c5305df1dd5e"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // --- 📋 Google Sheet User Mapping ---
    const SHEET_CSV = "https://docs.google.com/spreadsheets/d/1oyR6URA8qOmg6Zo90Df4w1h5lckOmjVC_9JrE-AXouM/export?format=csv&gid=0";
    const workerToUser = {};
    const userToWorkers = {};
    const TIMER_STATE_PREFIX = "mturk_hit_timer_state::";

    function parseCsvLine(line) {
      const out = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out;
    }

    function normalizeHeader(h) {
      return String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    async function loadUserMap() {
      try {
        const res = await fetch(SHEET_CSV, { cache: "no-store" });
        const text = await res.text();
        const lines = text.split(/\\r?\\n/).filter(l => l.trim().length > 0);
        if (!lines.length) return;
        const headers = parseCsvLine(lines[0]).map(normalizeHeader);
        const widIdx = headers.findIndex(h => h === "workerid");
        const userIdx = headers.findIndex(h => h === "user");

        if (widIdx === -1 || userIdx === -1) {
          console.warn("⚠️ Missing workerid or user column in sheet header:", headers);
          return;
        }

        for (let i = 1; i < lines.length; i++) {
          const parts = parseCsvLine(lines[i]).map(v => String(v || "").trim());
          const wid = parts[widIdx]?.replace(/^\\uFEFF/, "").trim().toUpperCase();
          const usr = parts[userIdx]?.trim();
          if (/^A[A-Z0-9]{12,}$/.test(wid)) {
            workerToUser[wid] = usr || "";
            const userKey = String(usr || "").trim();
            if (userKey) {
              if (!userToWorkers[userKey]) userToWorkers[userKey] = [];
              userToWorkers[userKey].push(wid);
            }
          }
        }

        console.log("✅ Loaded user map:", Object.keys(workerToUser).length, "entries");
      } catch (err) {
        console.error("❌ Failed to load user map:", err);
      }
    }

    // --- 🧩 Helpers ---
    function getWorkerId() {
      const el = document.querySelector(".me-bar span.text-uppercase span");
      if (!el) return null;
      const txt = el.textContent.replace(/^Copied/i, "").trim();
      const match = txt.match(/A[A-Z0-9]{12,}/);
      return match ? match[0] : txt;
    }

    function parseReward() {
      let reward = 0.0;
      const label = Array.from(document.querySelectorAll(".detail-bar-label"))
        .find(el => el.textContent.includes("Reward"));
      if (label) {
        const valEl = label.nextElementSibling;
        if (valEl) {
          const match = valEl.innerText.match(/\\$([0-9.]+)/);
          if (match) reward = parseFloat(match[1]);
        }
      }
      return reward;
    }

    function parseDurationToSeconds(raw) {
      const text = String(raw || "").toLowerCase();
      let total = 0;
      const day = text.match(/(\\d+)\\s*(day|days|d)\\b/);
      const hr = text.match(/(\\d+)\\s*(hour|hours|hr|hrs|h)\\b/);
      const min = text.match(/(\\d+)\\s*(minute|minutes|min|mins|m)\\b/);
      const sec = text.match(/(\\d+)\\s*(second|seconds|sec|secs|s)\\b/);
      if (day) total += parseInt(day[1], 10) * 86400;
      if (hr) total += parseInt(hr[1], 10) * 3600;
      if (min) total += parseInt(min[1], 10) * 60;
      if (sec) total += parseInt(sec[1], 10);
      return total || null;
    }

    function parseTimeAllottedSeconds() {
      const label = Array.from(document.querySelectorAll(".detail-bar-label"))
        .find(el => /time\\s*allotted/i.test(el.textContent || ""));
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
        workerId,
        user,
        requester: document.querySelector(".detail-bar-value a[href*='/requesters/']")?.innerText || "",
        title: document.querySelector(".task-project-title")?.innerText || document.title,
        reward: parseReward(),
        timeAllottedSeconds: parseTimeAllottedSeconds(),
        acceptedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),  // 🔥 TTL field — Firestore auto-deletes after 10m
        url: window.location.href,
        status: "active"
      };
    }

    function safeThreadId(a, b) {
      return [a, b].sort((x, y) => x.localeCompare(y)).join("__");
    }

    async function sendLiveMessageToAllUsers(text, hit) {
      const fromId = hit.workerId || "UNKNOWN";
      const fromName = workerToUser[fromId] || hit.user || fromId;
      const toIds = Object.keys(workerToUser).filter(id => id && id !== fromId);
      let sent = 0;
      for (const toId of toIds) {
        const threadId = safeThreadId(fromId, toId);
        await addDoc(collection(db, "threads", threadId, "messages"), {
          fromId: fromId,
          fromName: fromName,
          toId: toId,
          text: text,
          createdAt: serverTimestamp()
        });
        await setDoc(doc(db, "threads", threadId), {
          users: [fromId, toId],
          updatedAt: serverTimestamp(),
          lastText: text.slice(0, 140),
          lastFrom: fromId
        }, { merge: true });
        sent++;
      }
      return sent;
    }

    async function sendLiveMessageToUserNumber(userNumber, text, hit) {
      const targetKey = String(userNumber || "").trim();
      if (!targetKey) throw new Error("User number is required.");
      const fromId = hit.workerId || "UNKNOWN";
      const fromName = workerToUser[fromId] || hit.user || fromId;
      const targetWorkers = Array.from(new Set(userToWorkers[targetKey] || [])).filter(id => id && id !== fromId);
      if (!targetWorkers.length) throw new Error("No worker found for user number: " + targetKey);

      let sent = 0;
      for (const toId of targetWorkers) {
        const threadId = safeThreadId(fromId, toId);
        await addDoc(collection(db, "threads", threadId, "messages"), {
          fromId: fromId,
          fromName: fromName,
          toId: toId,
          text: text,
          createdAt: serverTimestamp()
        });
        await setDoc(doc(db, "threads", threadId), {
          users: [fromId, toId],
          updatedAt: serverTimestamp(),
          lastText: text.slice(0, 140),
          lastFrom: fromId
        }, { merge: true });
        sent++;
      }
      return sent;
    }

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
        "<div style='font-size:18px;font-weight:700;margin-bottom:8px;'>HIT Timer Alert</div>" +
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
        if (autoCloseTimer) {
          clearTimeout(autoCloseTimer);
          autoCloseTimer = null;
        }
        overlay.remove();
      }

      function closeDialogOnly() {
        if (dialogClosed) return;
        dialogClosed = true;
        state.dialogOpen = false;
        saveTimerState(hit.assignmentId, state);
        if (autoCloseTimer) {
          clearTimeout(autoCloseTimer);
          autoCloseTimer = null;
        }
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
          statusEl.textContent = "Sending to all users...";
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
          statusEl.textContent = "Sending to user " + userNo + "...";
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

    // --- 🚀 Post Task (no deleteDoc needed) ---
    async function postTask(hit) {
      if (!hit) hit = collectTaskHit();
      if (!hit) return;
      await setDoc(doc(db, "hits", hit.assignmentId), hit, { merge: true });
      console.log("✅ Posted HIT:", hit.assignmentId, "User:", hit.user, "Reward:", hit.reward, "| TTL set for 10m");
    }

    // --- 🏁 Initialize ---
    window.addEventListener("load", async () => {
      await loadUserMap();
      const hit = collectTaskHit();
      await postTask(hit);
      startTimeMonitor(hit);
    });
  `;
  document.head.appendChild(s);
})();

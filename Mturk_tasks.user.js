// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @match       https://worker.mturk.com/tasks
// @grant       GM_xmlhttpRequest
// @version     3.4
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(async function () {
  'use strict';

  // ---------- FIREBASE ----------
  const firebaseConfig = {
    apiKey: "AIzaSyD_FH-65A526z8g9iGhSYKulS4yiv5e6Ys",
    authDomain: "mturk-monitor.firebaseapp.com",
    projectId: "mturk-monitor",
    storageBucket: "mturk-monitor.firebasestorage.app",
    messagingSenderId: "285174080989",
    appId: "1:285174080989:web:e1f607e6a5f80463278234"
  };

  // Load Firebase SDK (app + firestore)
  async function loadFirebase() {
    if (window.firebase) return;
    await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js";
      s.onload = resolve;
      document.head.appendChild(s);
    });
    await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js";
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  async function initDB() {
    await loadFirebase();
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    return firebase.firestore();
  }

  // ---------- HELPERS ----------
  function parseReward() {
    try {
      const rewardEl = [...document.querySelectorAll(".detail-bar-value")]
        .find(e => /\$/.test(e.innerText));
      if (rewardEl) {
        const num = parseFloat(rewardEl.innerText.replace(/[^0-9.]/g, ""));
        return isNaN(num) ? 0 : num;
      }
    } catch (e) {}
    return 0;
  }

  function findWorkerId() {
    const headerId = document.querySelector(".me-bar .text-uppercase span")?.innerText.trim() || "";
    return headerId.replace(/^COPIED\s+/i, "");
  }

  function scrapeHitInfo() {
    const requester = document.querySelector(".detail-bar-value a[href*='/requesters']")?.innerText.trim() || "Unknown";
    const title = document.querySelector(".task-project-title")?.innerText.trim() || document.title;
    const reward = parseReward();

    const workerId = findWorkerId();
    const username = document.querySelector(".me-bar a[href='/account']")?.innerText.trim() || "";
    const assignmentId = new URLSearchParams(window.location.search).get("assignment_id") || `task-${Date.now()}`;
    const url = window.location.href;

    let timeRemainingSeconds = null;
    const timer = document.querySelector("[data-react-class*='CompletionTimer']");
    if (timer?.getAttribute("data-react-props")) {
      try {
        const props = JSON.parse(timer.getAttribute("data-react-props"));
        timeRemainingSeconds = props.timeRemainingInSeconds;
      } catch (e) {}
    }

    return {
      assignmentId,
      requester,
      title,
      reward,
      workerId,
      username,
      acceptedAt: new Date().toISOString(),
      url,
      status: "accepted",
      timeRemainingSeconds,
      updatedAt: new Date().toISOString()
    };
  }

  // ---------- FIRESTORE OPS ----------
  async function saveHit(db, hit) {
    await db.collection("history").doc(hit.assignmentId).set(hit, { merge: true });
    console.log("[Firestore] ✅ Saved HIT", hit.assignmentId);
  }

  async function updateHitStatus(db, assignmentId, status) {
    await db.collection("history").doc(assignmentId)
      .set({ status, updatedAt: new Date().toISOString() }, { merge: true });
    console.log(`[Firestore] 🗑️ ${assignmentId} → ${status}`);
  }

  async function removeMissingFromQueue(db, currentIds) {
    const snap = await db.collection("history").get();
    snap.forEach(doc => {
      const d = doc.data();
      if (d.status === "accepted" && !currentIds.includes(d.assignmentId)) {
        updateHitStatus(db, d.assignmentId, "removed_from_queue");
      }
    });
  }

  // ---------- PAGE LOGIC ----------
  async function handleTaskPage() {
    const db = await initDB();
    const hit = scrapeHitInfo();
    if (hit && hit.assignmentId) {
      await saveHit(db, hit);

      if (hit.timeRemainingSeconds) {
        setTimeout(() => updateHitStatus(db, hit.assignmentId, "expired"), hit.timeRemainingSeconds * 1000);
      }

      const forms = document.querySelectorAll("form[action*='/submit'], form[action*='/return']");
      forms.forEach(f => {
        f.addEventListener("submit", () => {
          const reason = f.action.includes("/return") ? "returned" : "submitted";
          updateHitStatus(db, hit.assignmentId, reason);
        });
      });
    }
  }

  async function handleQueuePage() {
    const db = await initDB();
    // Extract assignment IDs from queue table rows
    const ids = [];
    document.querySelectorAll("a[href*='assignment_id=']").forEach(a => {
      const m = a.href.match(/assignment_id=([^&]+)/);
      if (m) ids.push(m[1]);
    });

    await removeMissingFromQueue(db, ids);
    console.log("[Firestore] 🔄 Synced queue, active IDs:", ids);
  }

  // ---------- INIT ----------
  if (location.pathname.startsWith("/projects/") && location.pathname.includes("/tasks/")) {
    window.addEventListener("load", handleTaskPage);
  } else if (location.pathname === "/tasks") {
    window.addEventListener("load", handleQueuePage);
  }
})();

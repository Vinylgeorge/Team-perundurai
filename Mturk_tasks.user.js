// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @match       https://worker.mturk.com/tasks
// @grant        none
// @run-at       document-idle
// @version     3.7
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(function() {
  'use strict';

  /** 🔧 Your Firebase Config */
  const firebaseConfig = {
    apiKey: "AIzaSyD_FH-65A526z8g9iGhSYKulS4yiv5e6Ys",
    authDomain: "mturk-monitor.firebaseapp.com",
    projectId: "mturk-monitor",
    storageBucket: "mturk-monitor.firebasestorage.app",
    messagingSenderId: "285174080989",
    appId: "1:285174080989:web:e1f607e6a5f80463278234"
  };

  /** 🔧 Firebase loader */
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

  let db = null;
  async function initDB() {
    await loadFirebase();
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    if (!db) db = firebase.firestore();
    return db;
  }

  /** 🔧 Firestore helpers */
  async function saveHit(hit) {
    const ref = db.collection("hits").doc(hit.assignmentId);
    await ref.set(hit, { merge: true });
  }

  async function deleteHit(assignmentId) {
    const ref = db.collection("hits").doc(assignmentId);
    await ref.delete().catch(() => {});
  }

  /** 🔧 Parse helpers */
  function parseReward(rewardStr) {
    if (!rewardStr) return 0;
    return parseFloat(rewardStr.replace(/[^0-9.]/g, "")) || 0;
  }

  /** 📌 Handle Project Task Pages (/projects/*/tasks/*) */
  async function handleTaskPage() {
    const assignmentIdMatch = location.href.match(/assignment_id=([^&]+)/);
    const hitIdMatch = location.href.match(/hitId=([^&]+)/);
    if (!assignmentIdMatch || !hitIdMatch) return;

    const assignmentId = assignmentIdMatch[1];
    const hitId = hitIdMatch[1];

    const titleEl = document.querySelector(".task-project-title");
    const requesterEl = document.querySelector(".detail-bar-value a[href*='/requesters']");
    const rewardEl = document.querySelector(".detail-bar-value");
    const rewardStr = rewardEl ? rewardEl.textContent.trim() : "$0.00";

    const hit = {
      assignmentId,
      hitId,
      title: titleEl ? titleEl.textContent.trim() : "Unknown",
      requester: requesterEl ? requesterEl.textContent.trim() : "Unknown",
      reward: parseReward(rewardStr),
      acceptedAt: new Date().toISOString(),
      status: "accepted"
    };

    await saveHit(hit);

    /** Cleanup on submit or return */
    const returnBtn = document.querySelector("form[action*='return'] button[type=submit]");
    if (returnBtn) {
      returnBtn.addEventListener("click", () => {
        deleteHit(assignmentId);
      });
    }

    const submitForm = document.querySelector("form[action*='/submit']");
    if (submitForm) {
      submitForm.addEventListener("submit", () => {
        deleteHit(assignmentId);
      });
    }
  }

  /** 📌 Handle Queue Page (/tasks) */
  async function handleQueuePage() {
    // Get assignment IDs currently in queue
    const queueTable = document.querySelector("div[data-react-class*='TaskQueueTable']");
    if (!queueTable) return;

    // React props hack: Firestore pruning based on queue contents
    const bodyData = queueTable.getAttribute("data-react-props");
    if (!bodyData) return;

    let parsed;
    try {
      parsed = JSON.parse(bodyData);
    } catch (e) {
      console.warn("Failed to parse queue data:", e);
      return;
    }

    const activeIds = new Set();
    if (parsed.bodyData) {
      parsed.bodyData.forEach((row) => {
        if (row && row.assignmentId) activeIds.add(row.assignmentId);
      });
    }

    // Prune old Firestore entries not in active queue
    const snap = await db.collection("hits").get();
    snap.forEach(async (doc) => {
      if (!activeIds.has(doc.id)) {
        await deleteHit(doc.id);
      }
    });
  }

  /** 📌 Bootstrap */
  async function bootstrap() {
    await initDB();

    if (location.pathname.startsWith("/projects/") && location.pathname.includes("/tasks/")) {
      await handleTaskPage();
    } else if (location.pathname === "/tasks") {
      await handleQueuePage();
    }
  }

  window.addEventListener("load", bootstrap);

})();

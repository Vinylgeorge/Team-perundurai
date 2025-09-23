// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       GM_xmlhttpRequest
// @version     3.2
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(function () {
  'use strict';

  const script = document.createElement("script");
  script.type = "module";
  script.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, setDoc, doc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    // 🔑 Firebase Config
    const firebaseConfig = {
      apiKey: "AIzaSyD_FH-65A526z8g9iGhSYKulS4yiv5e6Ys",
      authDomain: "mturk-monitor.firebaseapp.com",
      projectId: "mturk-monitor",
      storageBucket: "mturk-monitor.firebasestorage.app",
      messagingSenderId: "285174080989",
      appId: "1:285174080989:web:e1f607e6a5f80463278234"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    // -------------- HELPERS --------------
    function parseReward() {
      const rewardLabel = Array.from(document.querySelectorAll(".detail-bar-label"))
        .find(el => el.innerText.trim().toLowerCase() === "reward");
      if (rewardLabel) {
        const valEl = rewardLabel.parentElement.querySelector(".detail-bar-value");
        if (valEl) {
          const num = parseFloat(valEl.innerText.replace(/[^0-9.]/g, ""));
          if (!isNaN(num)) return num;
        }
      }
      return 0;
    }

    function scrapeHitInfo() {
      const assignmentId = new URLSearchParams(window.location.search).get("assignment_id") || "unknown";
      if (assignmentId === "unknown") return null;

      const requester = document.querySelector(".detail-bar-value a[href*='/requesters']")?.innerText.trim() || "Unknown";
      const title = document.querySelector(".task-project-title")?.innerText.trim() || document.title;
      const reward = parseReward();

      let workerId = document.querySelector(".me-bar .text-uppercase span")?.innerText.trim() || "unknown";
      workerId = workerId.replace(/^COPIED\\s+/i, "");

      const acceptedAt = new Date().toISOString();

      return { assignmentId, requester, title, reward, workerId, acceptedAt, status: "accepted" };
    }

    async function saveHit(hit) {
      await setDoc(doc(db, "hits", hit.assignmentId), hit);
      await setDoc(doc(db, "history", hit.assignmentId), hit);
      console.log("✅ Saved HIT:", hit.assignmentId);
    }

    async function syncQueue() {
      const activeIds = new Set();

      // extract assignmentIds from queue page
      document.querySelectorAll("a[href*='assignment_id=']").forEach(a => {
        const m = a.href.match(/assignment_id=([^&]+)/);
        if (m) activeIds.add(m[1]);
      });

      console.log("📋 Active HITs in MTurk queue:", [...activeIds]);

      // get all hits from Firestore
      const snap = await getDocs(collection(db, "hits"));
      for (const d of snap.docs) {
        if (!activeIds.has(d.id)) {
          await deleteDoc(doc(db, "hits", d.id));
          await setDoc(doc(db, "history", d.id), {
            assignmentId: d.id,
            status: "submitted/returned/expired",
            removedAt: new Date().toISOString()
          }, { merge: true });
          console.log("🗑️ Removed stale HIT:", d.id);
        }
      }
    }

    // -------------- ROUTING --------------
    if (location.pathname.startsWith("/projects/") && location.pathname.includes("/tasks/")) {
      // On HIT page → capture
      const hit = scrapeHitInfo();
      if (hit) saveHit(hit);
    }

    if (location.pathname === "/tasks") {
      // On queue page → sync once
      syncQueue();
    }
  `;
  document.head.appendChild(script);
})();

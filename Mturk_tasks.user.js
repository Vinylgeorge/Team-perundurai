// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant        none
// @version     3.8
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(function () {
  'use strict';

  const script = document.createElement("script");
  script.type = "module";
  script.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, collection, getDocs, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

    async function cleanupQueue() {
      try {
        // 1. Get assignmentIds currently visible in MTurk queue page
        const activeIds = new Set();
        document.querySelectorAll("a[href*='assignment_id=']").forEach(a => {
          const m = a.href.match(/assignment_id=([^&]+)/);
          if (m) activeIds.add(m[1]);
        });

        console.log("📋 Active HITs in MTurk:", [...activeIds]);

        // 2. Get all Firestore hits
        const snap = await getDocs(collection(db, "hits"));
        for (const d of snap.docs) {
          const data = d.data();
          if (!activeIds.has(data.assignmentId)) {
            // 3. Remove missing ones from Firestore
            await deleteDoc(doc(db, "hits", d.id));
            console.log("🗑️ Removed from Firestore (not in queue):", d.id);
          }
        }
      } catch (err) {
        console.error("❌ Cleanup failed:", err);
      }
    }

    // Run every 15s
    setInterval(cleanupQueue, 15000);
    cleanupQueue();
  `;
  document.head.appendChild(script);
})();

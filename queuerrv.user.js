// ==UserScript==
// @name        MTurk Queue Sync → Firestore
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/tasks*
// @grant       none
// @version     1.0
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/queuerrv.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/queuerrv.user.js
// ==/UserScript==

(function () {
  'use strict';

  const script = document.createElement("script");
  script.type = "module";
  script.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, collection, getDocs, deleteDoc, setDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
          // remove from hits + mark in history
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

    // run once on load
    syncQueue();
  `;
  document.head.appendChild(script);
})();

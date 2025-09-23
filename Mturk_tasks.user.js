// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       GM_xmlhttpRequest
// @version     3.0
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(async function () {
  'use strict';

  // Load Firebase SDK dynamically
  const script = document.createElement("script");
  script.type = "module";
  script.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

    function scrapeHitInfo() {
      const assignmentId = new URLSearchParams(window.location.search).get('assignment_id') || \`task-\${Date.now()}\`;
      const requester = document.querySelector(".detail-bar-value a[href*='/requesters']")?.innerText.trim() || "Unknown";
      const title = document.querySelector('.task-project-title')?.innerText.trim() || document.title;
      const reward = parseFloat(document.querySelector(".detail-bar-value")?.innerText.replace(/[^0-9.]/g, '') || 0);
      const workerId = document.querySelector(".me-bar .text-uppercase span")?.innerText.trim() || "unknown";

      // Time remaining
      let timeRemainingSeconds = null;
      const timer = document.querySelector("[data-react-class*='CompletionTimer']");
      if (timer?.getAttribute("data-react-props")) {
        try {
          const props = JSON.parse(timer.getAttribute("data-react-props"));
          timeRemainingSeconds = props.timeRemainingInSeconds;
        } catch {}
      }

      return {
        assignmentId,
        requester,
        title,
        reward,
        workerId,
        acceptedAt: new Date().toISOString(),
        timeRemainingSeconds
      };
    }

    async function saveHit(hit) {
      await setDoc(doc(db, "hits", hit.assignmentId), hit);
      console.log("✅ HIT saved to Firestore:", hit);

      // Auto-expire
      if (hit.timeRemainingSeconds) {
        setTimeout(async () => {
          await deleteDoc(doc(db, "hits", hit.assignmentId));
          console.log("🗑️ HIT expired:", hit.assignmentId);
        }, hit.timeRemainingSeconds * 1000);
      }
    }

    async function removeHit(assignmentId, reason = "Removed") {
      await deleteDoc(doc(db, "hits", assignmentId));
      console.log(\`🗑️ \${reason} HIT:\`, assignmentId);
    }

    const hit = scrapeHitInfo();
    if (hit) {
      await saveHit(hit);

      // Watch forms (submit or return)
      const forms = document.querySelectorAll("form[action*='/submit'], form[action*='/return'], form[action*='/tasks/']");
      forms.forEach(f => {
        f.addEventListener("submit", () => {
          removeHit(hit.assignmentId, "Submitted/Returned");
        });
      });
    }
  `;
  document.head.appendChild(script);
})();

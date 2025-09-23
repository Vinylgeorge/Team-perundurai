// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       GM_xmlhttpRequest
// @version     3.1
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(async function () {
  'use strict';

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
      const assignmentId =
        new URLSearchParams(window.location.search).get("assignment_id") ||
        \`task-\${Date.now()}\`;

      const requester =
        document.querySelector(".detail-bar-value a[href*='/requesters']")
          ?.innerText.trim() || "Unknown";

      const title =
        document.querySelector(".task-project-title")?.innerText.trim() ||
        document.title;

      // ✅ Numeric reward only
      let reward = 0;
      try {
        const rewardText =
          document.querySelector(".detail-bar-value")?.innerText || "";
        reward = parseFloat(rewardText.replace(/[^0-9.]/g, "")) || 0;
      } catch {}

      // ✅ Worker ID (cleaned)
      let workerId =
        document.querySelector(".me-bar .text-uppercase span")?.innerText.trim() ||
        "unknown";
      workerId = workerId.replace(/^COPIED\\s+/i, "");

      // ⏳ Time Remaining
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
        timeRemainingSeconds,
        status: "accepted" // default when accepted
      };
    }

    async function saveHit(hit) {
      // Save to active queue
      await setDoc(doc(db, "hits", hit.assignmentId), hit);

      // Save to history (append/update)
      await setDoc(doc(db, "history", hit.assignmentId), hit);

      console.log("✅ HIT saved:", hit.assignmentId);

      // Auto-expire
      if (hit.timeRemainingSeconds) {
        setTimeout(async () => {
          await deleteDoc(doc(db, "hits", hit.assignmentId));
          await setDoc(doc(db, "history", hit.assignmentId), {
            ...hit,
            status: "expired",
            removedAt: new Date().toISOString()
          });
          console.log("🗑️ HIT expired:", hit.assignmentId);
        }, hit.timeRemainingSeconds * 1000);
      }
    }

    async function removeHit(assignmentId, status = "removed") {
      await deleteDoc(doc(db, "hits", assignmentId));
      await setDoc(doc(db, "history", assignmentId), {
        assignmentId,
        status,
        removedAt: new Date().toISOString()
      }, { merge: true });
      console.log(\`🗑️ HIT \${status}:\`, assignmentId);
    }

    const hit = scrapeHitInfo();
    if (hit) {
      await saveHit(hit);

      // Watch for submit/return
      const forms = document.querySelectorAll("form[action*='/submit'], form[action*='/return']");
      forms.forEach(f => {
        f.addEventListener("submit", () => {
          removeHit(hit.assignmentId, "submitted/returned");
        });
      });
    }
  `;
  document.head.appendChild(script);
})();

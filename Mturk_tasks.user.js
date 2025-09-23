// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant        none
// @version     4.0
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(async function () {
  'use strict';

  // Dynamically load Firebase SDK
  const script = document.createElement("script");
  script.type = "module";
  script.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

    // 🔑 Your Firebase Config
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

    // ---------- Scraper ----------
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

      // ✅ Reward: numeric only (remove $ and text)
      let reward = 0;
      try {
        const rewardText =
          document.querySelector(".detail-bar-value")?.innerText || "";
        reward = parseFloat(rewardText.replace(/[^0-9.]/g, "")) || 0;
      } catch {
        reward = 0;
      }

      // ✅ Worker ID: remove "COPIED " prefix
      let workerId =
        document.querySelector(".me-bar .text-uppercase span")?.innerText.trim() ||
        "unknown";
      workerId = workerId.replace(/^COPIED\\s+/i, "");

      // ⏳ Time remaining
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
        reward,  // numeric value
        workerId, // cleaned ID
        acceptedAt: new Date().toISOString(),
        timeRemainingSeconds
      };
    }

    // ---------- Save HIT ----------
    async function saveHit(hit) {
      await setDoc(doc(db, "hits", hit.assignmentId), hit);
      console.log("✅ HIT saved to Firestore:", hit);

      // Auto-expire cleanup
      if (hit.timeRemainingSeconds) {
        setTimeout(async () => {
          await deleteDoc(doc(db, "hits", hit.assignmentId));
          console.log("🗑️ HIT expired:", hit.assignmentId);
        }, hit.timeRemainingSeconds * 1000);
      }
    }

    // ---------- Remove HIT ----------
    async function removeHit(assignmentId, reason = "Removed") {
      await deleteDoc(doc(db, "hits", assignmentId));
      console.log(\`🗑️ \${reason} HIT:\`, assignmentId);
    }

    // ---------- Run ----------
    const hit = scrapeHitInfo();
    if (hit) {
      await saveHit(hit);

      // Listen for form submissions (Submit / Return)
      const forms = document.querySelectorAll(
        "form[action*='/submit'], form[action*='/return'], form[action*='/tasks/']"
      );
      forms.forEach(f => {
        f.addEventListener("submit", () => {
          removeHit(hit.assignmentId, "Submitted/Returned");
        });
      });
    }
  `;
  document.head.appendChild(script);
})();

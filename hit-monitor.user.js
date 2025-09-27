// ==UserScript==
// @name        MTurk Task → Firestore + User Mapping (TTL Auto-Expire 10m)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       none
// @version     1.0
// @updateURL    https://github.com/Vinylgeorge/Team-perundurai/raw/refs/heads/main/hit-monitor.user.js
// @downloadURL  https://github.com/Vinylgeorge/Team-perundurai/raw/refs/heads/main/hit-monitor.user.js
// ==/UserScript==

(function () {
  'use strict';

  const s = document.createElement("script");
  s.type = "module";
  s.textContent = `
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getFirestore, setDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

    async function loadUserMap() {
      try {
        const res = await fetch(SHEET_CSV, { cache: "no-store" });
        const text = await res.text();
        const lines = text.split(/\\r?\\n/).filter(l => l.trim().length > 0);

        const sep = (lines[0].includes(";") && !lines[0].includes(",")) ? ";" : ",";
        const headers = lines[0].split(sep).map(h => h.trim().toLowerCase());
        const widIdx = headers.findIndex(h => h.replace(/\\s+/g, "") === "workerid");
        const userIdx = headers.findIndex(h => h.replace(/\\s+/g, "") === "user");

        if (widIdx === -1 || userIdx === -1) {
          console.warn("⚠️ Missing workerid or user column in sheet header:", headers);
          return;
        }

        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(sep).map(v => v.trim());
          const wid = parts[widIdx]?.replace(/^\\uFEFF/, "").trim();
          const usr = parts[userIdx]?.trim();
          if (/^A[A-Z0-9]{12,}$/.test(wid)) workerToUser[wid] = usr || "";
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
        acceptedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),  // 🔥 TTL field — Firestore auto-deletes after 10m
        url: window.location.href,
        status: "active"
      };
    }

    // --- 🚀 Post Task (no deleteDoc needed) ---
    async function postTask() {
      const hit = collectTaskHit();
      if (!hit) return;
      await setDoc(doc(db, "hits", hit.assignmentId), hit, { merge: true });
      console.log("✅ Posted HIT:", hit.assignmentId, "User:", hit.user, "Reward:", hit.reward, "| TTL set for 10m");
    }

    // --- 🏁 Initialize ---
    window.addEventListener("load", async () => {
      await loadUserMap();
      await postTask();
    });
  `;
  document.head.appendChild(s);
})();

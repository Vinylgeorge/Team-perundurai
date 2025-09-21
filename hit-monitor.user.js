// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + Captcha Alert)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       GM_xmlhttpRequest
// @version     2.0
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/hit-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/hit-monitor.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BIN_ID = "68c89a4fd0ea881f407f25c0";   // your JSONBin Bin ID
  const API_KEY = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm";
  const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

  async function fetchExistingBin() {
    try {
      const headers = API_KEY ? { "X-Master-Key": API_KEY } : {};
      const res = await fetch(BIN_URL, { headers, cache: "no-store" });
      if (!res.ok) return [];
      const js = await res.json();
      let hits = js?.record ?? js;
      if (hits && hits.record) hits = hits.record;
      return Array.isArray(hits) ? hits : [];
    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Could not fetch existing bin:", err);
      return [];
    }
  }

  async function saveBin(records) {
    GM_xmlhttpRequest({
      method: "PUT",
      url: BIN_URL,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      data: JSON.stringify({ record: records }),
      onload: r => console.log("[MTurk→JSONBin] ✅ Bin updated, total:", records.length),
      onerror: e => console.error("[MTurk→JSONBin] ❌ Error:", e)
    });
  }

  async function saveHit(newHit) {
    const existing = await fetchExistingBin();
    if (!Array.isArray(existing)) return;

    let merged = existing.filter(r => r.assignmentId !== newHit.assignmentId);
    merged.push(newHit);

    await saveBin(merged);
  }

  async function removeHit(assignmentId) {
    const existing = await fetchExistingBin();
    if (!Array.isArray(existing)) return;

    let merged = existing.filter(r => r.assignmentId !== assignmentId);
    await saveBin(merged);
    console.log("[MTurk→JSONBin] 🗑️ Removed HIT:", assignmentId);
  }

  async function cleanupExpired() {
    const existing = await fetchExistingBin();
    if (!Array.isArray(existing)) return;

    const now = Date.now();
    let stillValid = existing.filter(r => {
      if (!r.timeRemainingSeconds || !r.acceptedAt) return true;
      const acceptedAt = new Date(r.acceptedAt).getTime();
      const expiresAt = acceptedAt + r.timeRemainingSeconds * 1000;
      return expiresAt > now;
    });

    if (stillValid.length !== existing.length) {
      console.log(`[MTurk→JSONBin] 🧹 Cleaned up ${existing.length - stillValid.length} expired HIT(s)`);
      await saveBin(stillValid);
    }
  }

  function scrapeHitInfo() {
    try {
      const requester = document.querySelector(".detail-bar-value a[href*='/requesters']")?.innerText.trim() || "Unknown";
      const title = document.querySelector(".task-project-title")?.innerText.trim() || document.title;
      let rewardText = document.querySelector(".detail-bar-value")?.innerText.trim() || "0";
      rewardText = rewardText.replace(/[^0-9.]/g, "");

      const workerId = document.querySelector(".me-bar span.text-uppercase span")?.innerText.trim() || "";
      const username = document.querySelector(".me-bar a[href='/account']")?.innerText.trim() || "";
      const assignmentId = new URLSearchParams(window.location.search).get("assignment_id") || "";
      const url = window.location.href;

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
        reward: parseFloat(rewardText) || 0,
        workerId,
        username,
        acceptedAt: new Date().toISOString(),
        url,
        timeRemainingSeconds
      };
    } catch (err) {
      console.error("[MTurk→JSONBin] ❌ Scrape failed:", err);
      return null;
    }
  }

  function detectCaptcha() {
    const captcha = document.querySelector("iframe[src*='captcha'], input[name='captcha'], .g-recaptcha");
    if (captcha) {
      console.log("[MTurk→JSONBin] ⚠️ Captcha detected");
      const w = window.open("", "captchaAlert", "width=300,height=150");
      if (w) {
        w.document.write("<h3 style='font-family:sans-serif;color:red;text-align:center;'>⚠️ CAPTCHA detected! ⚠️</h3>");
        setTimeout(() => w.close(), 5000);
      }
    }
  }

  function hookFormSubmissions(assignmentId) {
    const forms = document.querySelectorAll("form[action*='/submit'], form[action*='/return'], form[action*='/tasks']");
    forms.forEach(f => {
      f.addEventListener("submit", () => removeHit(assignmentId));
    });
  }

  function run() {
    cleanupExpired();
    detectCaptcha();

    const hit = scrapeHitInfo();
    if (hit && hit.assignmentId) {
      saveHit(hit);

      if (hit.timeRemainingSeconds) {
        setTimeout(() => removeHit(hit.assignmentId), hit.timeRemainingSeconds * 1000);
      }

      hookFormSubmissions(hit.assignmentId);
    }
  }

  window.addEventListener("load", run);
})();

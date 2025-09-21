// ==UserScript==
// @name        MTurk Accepted HITs → JSONBin (Auto-Prune + Cleanup + CAPTCHA Popup)
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/projects/*/tasks/*
// @grant       GM_xmlhttpRequest
// @version     2.8
// @updateURL    https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// @downloadURL  https://raw.githubusercontent.com/Vinylgeorge/Team-perundurai/refs/heads/main/Mturk_tasks.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BIN_ID = "68c88afcd0ea881f407f17fd";   // your JSONBin Bin ID
  const API_KEY = "$2a$10$tGWSdPOsZbt7ecxcUqPwaOPrtBrw84TrZQDZtPvWN5Hpm595sHtUm";
  const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

  const BACKGROUND_CLEANUP_MS = 5 * 60 * 1000; // 5 minutes
  const SAVE_INTERVAL_MS = 15 * 1000; // 15 seconds
  const CAPTCHA_CHECK_MS = 15 * 1000; // 15 seconds

  let captchaPopup = null;

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

  async function saveBin(records, logAction = "Updated") {
    GM_xmlhttpRequest({
      method: "PUT",
      url: BIN_URL,
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      data: JSON.stringify({ record: records }),
      onload: r => console.log(`[MTurk→JSONBin] ✅ ${logAction}. Total: ${records.length}`),
      onerror: e => console.error("[MTurk→JSONBin] ❌ Error:", e)
    });
  }

  async function saveHit(newHit) {
    const existing = await fetchExistingBin();
    if (!Array.isArray(existing)) return;

    // remove old copy of this assignmentId
    let merged = existing.filter(r => r.assignmentId !== newHit.assignmentId);

    // add fresh
    merged.push(newHit);

    await saveBin(merged, `Saved HIT ${newHit.assignmentId}`);
  }

  async function removeHit(assignmentId, reason = 'Removed') {
    const existing = await fetchExistingBin();
    if (!Array.isArray(existing)) return;

    const filtered = existing.filter(r => r.assignmentId !== assignmentId);
    await saveBin(filtered, `${reason}: ${assignmentId}`);
    console.log(`[MTurk→JSONBin] 🗑️ ${reason} HIT: ${assignmentId}`);
  }

  async function cleanupExpired() {
    const existing = await fetchExistingBin();
    if (!Array.isArray(existing)) return;

    const now = Date.now();
    const stillValid = existing.filter(r => {
      if (!r.timeRemainingSeconds || !r.acceptedAt) return true;
      const acceptedAt = new Date(r.acceptedAt).getTime();
      const expiresAt = acceptedAt + r.timeRemainingSeconds * 1000;
      return expiresAt > now;
    });

    if (stillValid.length !== existing.length) {
      console.log(`[MTurk→JSONBin] 🧹 Cleaned up ${existing.length - stillValid.length} expired HIT(s)`);
      await saveBin(stillValid, 'Cleanup expired');
    }
  }

  function parseReward() {
    // Prefer modal props if present
    try {
      const rewardNode = document.querySelector("[data-react-class*='ShowModal']");
      if (rewardNode) {
        const props = JSON.parse(rewardNode.getAttribute('data-react-props'));
        const val = props?.modalOptions?.monetaryReward?.amountInDollars;
        if (typeof val === 'number') return val; // numeric
      }
    } catch (e) { /* ignore */ }

    // Fallback: find text that looks like $X.XX and return numeric
    try {
      const el = Array.from(document.querySelectorAll('.detail-bar-value')).find(e => /\$?\d/.test(e.innerText));
      if (el) {
        const txt = el.innerText.trim();
        const num = parseFloat(txt.replace(/[^0-9.]/g, ''));
        if (!Number.isNaN(num)) return num;
      }
    } catch (e) { /* ignore */ }

    return 0;
  }

  function findWorkerId() {
    // Header first
    const headerId = document.querySelector('.me-bar .text-uppercase span')?.innerText.trim() || '';
    if (headerId) return headerId.replace(/^COPIED\s+/i, '');

    // Fallback to iframe src or forms
    const iframeSrc = document.querySelector('iframe')?.src || '';
    const m = iframeSrc.match(/workerId=([^&]+)/);
    if (m) return m[1];

    // fallback to query param
    const wqp = new URLSearchParams(window.location.search).get('workerId');
    if (wqp) return wqp;

    return '';
  }

  function scrapeHitInfo() {
    try {
      const requester = document.querySelector(".detail-bar-value a[href*='/requesters']")?.innerText.trim() || 'Unknown';
      const title = document.querySelector('.task-project-title')?.innerText.trim() || document.title;
      const reward = parseReward();

      const workerId = findWorkerId();
      const username = document.querySelector(".me-bar a[href='/account']")?.innerText.trim() || '';
      const assignmentId = new URLSearchParams(window.location.search).get('assignment_id') || `task-${Date.now()}`;
      const url = window.location.href;

      // Time remaining in seconds if visible
      let timeRemainingSeconds = null;
      const timer = document.querySelector("[data-react-class*='CompletionTimer']");
      if (timer?.getAttribute('data-react-props')) {
        try {
          const props = JSON.parse(timer.getAttribute('data-react-props'));
          timeRemainingSeconds = props.timeRemainingInSeconds;
        } catch (e) { /* ignore */ }
      }

      return {
        assignmentId,
        requester,
        title,
        reward, // numeric
        workerId,
        username,
        acceptedAt: new Date().toISOString(),
        url,
        timeRemainingSeconds,
        updatedAt: new Date().toISOString()
      };
    } catch (err) {
      console.error('[MTurk→JSONBin] ❌ Scrape failed:', err);
      return null;
    }
  }

 
  async function runOnce() {
    // Save current HIT
    const hit = scrapeHitInfo();
    if (hit && hit.assignmentId) {
      await saveHit(hit);

      // schedule prune for this hit if timeRemainingSeconds present
      if (hit.timeRemainingSeconds) {
        setTimeout(() => removeHit(hit.assignmentId, 'Expired (timer)'), hit.timeRemainingSeconds * 1000);
      }

      // watch forms for submit/return
      const forms = document.querySelectorAll("form[action*='/submit'], form[action*='/return'], form[action*='/tasks/']");
      forms.forEach(f => {
        f.addEventListener('submit', () => {
          removeHit(hit.assignmentId, 'Submitted/Returned');
        });
      });
    }
  }

  // initial cleanup on load
  window.addEventListener('load', () => {
    cleanupExpired();
    runOnce();
    checkCaptchaOnPage();
  });

  // periodic save (keeps record fresh)
  setInterval(runOnce, SAVE_INTERVAL_MS);

  // background cleanup every 5 minutes
  setInterval(cleanupExpired, BACKGROUND_CLEANUP_MS);

  // captcha periodic check
  setInterval(checkCaptchaOnPage, CAPTCHA_CHECK_MS);

})();

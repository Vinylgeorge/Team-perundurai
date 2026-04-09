// ==UserScript==
// @name        MTurk Dashboard Scraper -Local API
// @namespace   Violentmonkey Scripts
// @match       https://worker.mturk.com/dashboard*
// @match       https://worker.mturk.com/status_details/*
// @match       https://worker.mturk.com/earnings*
// @grant       GM_xmlhttpRequest
// @connect     localhost
// @connect     192.227.99.48
// @connect     *
// @version     5.0
// @run-at      document-idle
// @updateURL    https://github.com/Vinylgeorge/Team-perundurai/raw/refs/heads/main/Dashboard.user.js
// @downloadURL  https://github.com/Vinylgeorge/Team-perundurai/raw/refs/heads/main/Dashboard.user.js
// ==/UserScript==

(function () {
  'use strict';

  const API_BASE = "http://192.227.99.48:8000";

  function api(method, path, body) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method, url: API_BASE + path,
          headers: { "Content-Type": "application/json" },
          data: body !== undefined ? JSON.stringify(body) : undefined,
          responseType: "json", timeout: 15000,
          onload: function (r) {
            if (r.status >= 200 && r.status < 300) {
              let d = r.response;
              if (typeof d === "string") { try { d = JSON.parse(d); } catch (_) {} }
              resolve(d);
            } else { reject(new Error("API " + r.status)); }
          },
          onerror: function () { reject(new Error("Network error")); },
          ontimeout: function () { reject(new Error("Timeout")); }
        });
      } else {
        fetch(API_BASE + path, {
          method, headers: { "Content-Type": "application/json" },
          body: body !== undefined ? JSON.stringify(body) : undefined
        }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(resolve).catch(reject);
      }
    });
  }

  function getWorkerId() {
    const el = document.querySelector(".me-bar span.text-uppercase span");
    if (!el) return null;
    const txt = el.textContent.replace(/^Copied/i, "").trim();
    const m = txt.match(/A[A-Z0-9]{12,}/);
    return m ? m[0] : txt;
  }

  function getWorkerName() {
    const link = document.querySelector('a[href="/account"]');
    return link ? link.textContent.trim() : "";
  }

  function getReactProps(selector) {
    const els = document.querySelectorAll("[data-react-props]");
    for (const el of els) {
      const cls = el.getAttribute("data-react-class") || "";
      if (cls.includes(selector)) {
        try { return JSON.parse(el.getAttribute("data-react-props")); } catch (_) {}
      }
    }
    return null;
  }

  function parseTextContent(parentSelector, labelText) {
    const rows = document.querySelectorAll(parentSelector + " .row");
    for (const row of rows) {
      const cols = row.querySelectorAll("[class*='col-']");
      if (cols.length >= 2) {
        const label = (cols[0].textContent || "").trim();
        if (label.toLowerCase().includes(labelText.toLowerCase())) {
          return (cols[cols.length - 1].textContent || "").trim();
        }
      }
    }
    return null;
  }

  // --- Dashboard page scraper ---
  async function scrapeDashboard() {
    const workerId = getWorkerId();
    if (!workerId) return;
    const workerName = getWorkerName();

    const currentEarnings = parseTextContent("#dashboard-available-earnings", "Current Earnings");
    const approved = parseTextContent("#dashboard-hits-overview", "Approved");
    const approvalRate = parseTextContent("#dashboard-hits-overview", "Approval Rate");
    const pending = parseTextContent("#dashboard-hits-overview", "Pending");
    const rejected = parseTextContent("#dashboard-hits-overview", "Rejected");
    const rejectionRate = parseTextContent("#dashboard-hits-overview", "Rejection Rate");

    const earningsData = parseTextContent("#dashboard-earnings-to-date", "Total Earnings");

    const dailyStats = getReactProps("DailyWorkerStatisticsTable");
    const earningsByPeriod = getReactProps("EarningsByPeriodTable");

    const payload = {
      worker_id: workerId,
      worker_name: workerName,
      current_earnings: currentEarnings,
      approved_hits: approved,
      approval_rate: approvalRate,
      pending_hits: pending,
      rejected_hits: rejected,
      rejection_rate: rejectionRate,
      total_earnings: earningsData,
      daily_stats: dailyStats ? dailyStats.bodyData : [],
      earnings_by_period: earningsByPeriod ? earningsByPeriod.bodyData : {},
      scraped_at: new Date().toISOString(),
      page: "dashboard"
    };

    try {
      await api("POST", "/api/worker-dashboard", payload);
      console.log("[AB2] Dashboard data sent for", workerId);
    } catch (e) {
      console.warn("[AB2] Dashboard scrape failed:", e.message);
    }
  }

  // --- Status Details page scraper ---
  async function scrapeStatusDetails() {
    const workerId = getWorkerId();
    if (!workerId) return;

    const titleEl = document.querySelector("h1");
    const dateMatch = (titleEl ? titleEl.textContent : "").match(/(\w+ \d+, \d{4})/);
    const dateStr = dateMatch ? dateMatch[1] : "";

    const hitDetails = getReactProps("HitStatusDetailsTable");

    const payload = {
      worker_id: workerId,
      date: dateStr,
      hits: hitDetails ? hitDetails.bodyData : [],
      scraped_at: new Date().toISOString(),
      page: "status_details"
    };

    try {
      await api("POST", "/api/worker-daily", payload);
      console.log("[AB2] Daily status sent for", workerId, dateStr, "—", (hitDetails?.bodyData || []).length, "HITs");
    } catch (e) {
      console.warn("[AB2] Daily scrape failed:", e.message);
    }
  }

  // --- Earnings / Transfer page scraper ---
  async function scrapeEarnings() {
    const workerId = getWorkerId();
    if (!workerId) return;
    const workerName = getWorkerName();

    // Current earnings from the h2 heading
    let currentEarnings = "";
    const h2s = document.querySelectorAll("h2");
    for (const h of h2s) {
      const m = h.textContent.match(/Current Earnings:\s*(\$[\d,.]+)/);
      if (m) { currentEarnings = m[1]; break; }
    }

    // "Earnings as of" date
    let earningsDate = "";
    const smallEls = document.querySelectorAll(".current-earnings small");
    for (const s of smallEls) {
      const m = s.textContent.match(/Earnings as of\s+(.+)/i);
      if (m) { earningsDate = m[1].trim(); break; }
    }

    // Bank account info
    let bankAccount = "";
    const bankLink = document.querySelector('a[href="/direct_deposit"]');
    if (bankLink) bankAccount = bankLink.textContent.trim();

    // Next payment date
    let nextPaymentDate = "";
    const payStrong = document.querySelector(".current-earnings strong");
    if (payStrong) {
      const m = payStrong.textContent.match(/on\s+(\w+ \d+, \d{4})/);
      if (m) nextPaymentDate = m[1];
    }

    // Transfer history from React props
    const transferHistory = getReactProps("TransferHistoryTable");
    const transfers = transferHistory ? transferHistory.bodyData : [];

    const payload = {
      worker_id: workerId,
      worker_name: workerName,
      current_earnings: currentEarnings,
      earnings_date: earningsDate,
      bank_account: bankAccount,
      next_payment_date: nextPaymentDate,
      transfers: transfers.map(function(t) {
        return {
          date: t.requestedDate || "",
          type: t.type || "",
          status: t.status || "",
          amount: t.amountRequested || 0,
          transfer_id: "",
        };
      }),
      transfers_raw: transfers,
      scraped_at: new Date().toISOString(),
      page: "earnings"
    };

    // Extract transfer IDs from expandedContent
    for (let i = 0; i < transfers.length; i++) {
      const ec = transfers[i].expandedContent || [];
      for (const item of ec) {
        if (item.label === "Transfer ID") {
          payload.transfers[i].transfer_id = item.text || "";
        }
      }
    }

    try {
      await api("POST", "/api/worker-earnings", payload);
      console.log("[AB2] Earnings data sent for", workerId, "—", currentEarnings, "—", transfers.length, "transfers");
    } catch (e) {
      console.warn("[AB2] Earnings scrape failed:", e.message);
    }
  }

  // --- Auto-run on page load ---
  const url = window.location.href;
  if (url.includes("/earnings")) {
    setTimeout(scrapeEarnings, 2000);
  } else if (url.includes("/dashboard")) {
    setTimeout(scrapeDashboard, 2000);
  } else if (url.includes("/status_details/")) {
    setTimeout(scrapeStatusDetails, 2000);
  }

})();

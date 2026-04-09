// ==UserScript==
// @name         Carelin Auto Answer
// @namespace    MTurkHelpers
// @version      5
// @description  For Q1/Q2/Q3 pages: click first choice in each question, then submit with human-like delay.
// @match        https://www.mturkcontent.com/*
// @match        https://*.mturkcontent.com/*
// @updateURL    https://github.com/mavericpartha/lokesh/raw/refs/heads/main/carelin.user.js
// @downloadURL  https://github.com/mavericpartha/lokesh/raw/refs/heads/main/carelin.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    BETWEEN_QUESTIONS_MIN_MS: 1400,
    BETWEEN_QUESTIONS_MAX_MS: 2800,
    BEFORE_SUBMIT_MIN_MS: 2200,
    BEFORE_SUBMIT_MAX_MS: 3800,
    POLL_MS: 450,
    DEBUG: false
  };

  const STATE_KEY_PREFIX = "mturk_carelin_submit_v2_";

  function log() {
    if (!CONFIG.DEBUG) return;
    const args = Array.from(arguments);
    args.unshift("[Carelin]");
    try { console.log.apply(console, args); } catch (e) {}
  }

  function randomBetween(minMs, maxMs) {
    const min = Math.max(0, Number(minMs) || 0);
    const max = Math.max(min, Number(maxMs) || min);
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function isMturkContentHost() {
    const host = location.hostname.toLowerCase();
    return host === "www.mturkcontent.com" || host.endsWith(".mturkcontent.com");
  }

  function isVisibleEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    const type = String(el.getAttribute("type") || "").toLowerCase();
    if (type === "hidden") return false;

    if (window.getComputedStyle) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
    }

    if (el.getBoundingClientRect) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
    }

    return true;
  }

  function clickElement(el) {
    if (!el || !isVisibleEnabled(el)) return false;
    try { if (el.focus) el.focus(); } catch (e) {}

    const events = ["mouseover", "mousedown", "mouseup", "click"];
    for (const eventName of events) {
      try {
        const ev = new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window });
        el.dispatchEvent(ev);
      } catch (e) {}
    }

    try {
      el.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  function markRadio(input) {
    if (!input) return;
    try { input.checked = true; } catch (e) {}
    try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    try { input.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
  }

  function getAssignmentId() {
    try {
      const fromQuery = new URLSearchParams(location.search).get("assignmentId");
      if (fromQuery && fromQuery !== "ASSIGNMENT_ID_NOT_AVAILABLE") return fromQuery;
    } catch (e) {}

    const hidden = document.querySelector('input[name="assignmentId"], input[name="assignment_id"]');
    if (hidden && hidden.value && hidden.value !== "ASSIGNMENT_ID_NOT_AVAILABLE") return hidden.value;

    return "no_assignment_id";
  }

  function getStateKey(assignmentId) {
    return `${STATE_KEY_PREFIX}${assignmentId}`;
  }

  function loadState(assignmentId) {
    const raw = sessionStorage.getItem(getStateKey(assignmentId));
    if (!raw) return { step: 0, nextActionAt: 0, done: false };
    try {
      const parsed = JSON.parse(raw);
      return {
        step: Math.max(0, Number(parsed.step) || 0),
        nextActionAt: Math.max(0, Number(parsed.nextActionAt) || 0),
        done: !!parsed.done
      };
    } catch (e) {
      return { step: 0, nextActionAt: 0, done: false };
    }
  }

  function saveState(assignmentId, state) {
    const safe = {
      step: Math.max(0, Math.min(4, Number(state.step) || 0)),
      nextActionAt: Math.max(0, Number(state.nextActionAt) || 0),
      done: !!state.done
    };
    sessionStorage.setItem(getStateKey(assignmentId), JSON.stringify(safe));
  }

  function pageLooksLikeQ1Q2Q3Template() {
    if (!document.querySelector("#mturk_form")) return false;
    if (!document.querySelector("#submitbutton")) return false;
    if (!document.querySelector("input[type='radio'][name='q1']")) return false;
    if (!document.querySelector("input[type='radio'][name='q2']")) return false;
    if (!document.querySelector("input[type='radio'][name='q3']")) return false;
    return true;
  }

  function getFirstVisibleChoice(questionName) {
    const radios = Array.from(
      document.querySelectorAll(`input[type="radio"][name="${questionName}"]`)
    ).filter((el) => isVisibleEnabled(el) && String(el.value || "").toLowerCase() !== "none");

    return radios[0] || null;
  }

  function hasAnswered(questionName) {
    const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${questionName}"]`));
    return radios.some((el) => el.checked && String(el.value || "").toLowerCase() !== "none");
  }

  function inferStepFromDom() {
    if (hasAnswered("q3")) return 3;
    if (hasAnswered("q2")) return 2;
    if (hasAnswered("q1")) return 1;
    return 0;
  }

  function submitButton() {
    return document.querySelector("#submitbutton") ||
      document.querySelector('#mturk_form input[type="submit"], #mturk_form button[type="submit"]');
  }

  function canSubmitNow() {
    const btn = submitButton();
    return !!(btn && isVisibleEnabled(btn) && !btn.disabled);
  }

  function trySubmit() {
    const btn = submitButton();
    if (btn && !btn.disabled) {
      return clickElement(btn);
    }
    return false;
  }

  function startAutomation() {
    const assignmentId = getAssignmentId();
    let state = loadState(assignmentId);

    if (state.step === 0 && !state.done) {
      const inferred = inferStepFromDom();
      if (inferred > 0) {
        state.step = inferred;
        saveState(assignmentId, state);
      }
    }

    let busy = false;
    let observer = null;
    let poller = null;

    function cleanup() {
      if (observer) observer.disconnect();
      if (poller) clearInterval(poller);
    }

    function scheduleNext(step, minMs, maxMs) {
      saveState(assignmentId, {
        step,
        done: false,
        nextActionAt: Date.now() + randomBetween(minMs, maxMs)
      });
    }

    function run() {
      if (busy) return;
      const now = Date.now();
      state = loadState(assignmentId);

      if (state.done || state.step >= 4) {
        cleanup();
        return;
      }

      if (now < state.nextActionAt) return;

      busy = true;

      if (state.step === 0) {
        const q1First = getFirstVisibleChoice("q1");
        if (q1First) {
          markRadio(q1First);
          if (clickElement(q1First)) {
            log("Clicked q1 first choice");
            scheduleNext(1, CONFIG.BETWEEN_QUESTIONS_MIN_MS, CONFIG.BETWEEN_QUESTIONS_MAX_MS);
          }
        }
        busy = false;
        return;
      }

      if (state.step === 1) {
        const q2First = getFirstVisibleChoice("q2");
        if (q2First) {
          markRadio(q2First);
          if (clickElement(q2First)) {
            log("Clicked q2 first choice");
            scheduleNext(2, CONFIG.BETWEEN_QUESTIONS_MIN_MS, CONFIG.BETWEEN_QUESTIONS_MAX_MS);
          }
        }
        busy = false;
        return;
      }

      if (state.step === 2) {
        const q3First = getFirstVisibleChoice("q3");
        if (q3First) {
          markRadio(q3First);
          if (clickElement(q3First)) {
            log("Clicked q3 first choice");
            scheduleNext(3, CONFIG.BEFORE_SUBMIT_MIN_MS, CONFIG.BEFORE_SUBMIT_MAX_MS);
          }
        }
        busy = false;
        return;
      }

      if (state.step === 3) {
        if (canSubmitNow() && trySubmit()) {
          saveState(assignmentId, { step: 4, done: true, nextActionAt: Date.now() });
          log("Submitted form");
        }
        busy = false;
      }
    }

    run();
    observer = new MutationObserver(run);
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });
    poller = setInterval(run, CONFIG.POLL_MS);
    window.addEventListener("beforeunload", cleanup);
  }

  if (!isMturkContentHost()) return;
  if (!pageLooksLikeQ1Q2Q3Template()) return;
  startAutomation();
})();

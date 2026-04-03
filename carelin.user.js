// ==UserScript==
// @name         Carelin-Q3 Then Submit (Slow)
// @namespace    MTurkHelpers
// @version      .0
// @description  For Q1/Q2/Q3 pages: click first choice in each question, then submit with human-like delay.
// @match        https://www.mturkcontent.com/*
// @match        https://*.mturkcontent.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/Vinylgeorge/Team-perundurai/raw/refs/heads/main/carelin.user.js
// @downloadURL  https://github.com/Vinylgeorge/Team-perundurai/raw/refs/heads/main/carelin.user.js
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    // Human-like pauses after each answer selection
    BETWEEN_QUESTIONS_MIN_MS: 1400,
    BETWEEN_QUESTIONS_MAX_MS: 2800,

    // Pause after Q3 before submit
    BEFORE_SUBMIT_MIN_MS: 2200,
    BEFORE_SUBMIT_MAX_MS: 3800,

    POLL_MS: 450,
    DEBUG: false
  };

  const STATE_KEY_PREFIX = "mturk_q123_submit_slow_v2_";

  function log() {
    if (!CONFIG.DEBUG) return;
    const args = Array.from(arguments);
    args.unshift("[MTurk Q123]");
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

    // Fallback so state still works if assignmentId is absent temporarily.
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
    // 0 -> click q1 first choice
    // 1 -> click q2 first choice
    // 2 -> click q3 first choice
    // 3 -> submit
    // 4 -> done
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

    // If state is empty/new, infer from current DOM.
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

      // Step 0: click first choice of q1
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

      // Step 1: click first choice of q2 (wait until visible due page logic)
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

      // Step 2: click first choice of q3 (wait until visible due page logic)
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

      // Step 3: submit
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
// ==UserScript==
// @name         MTurk First Option + Submit x3
// @namespace    MTurkHelpers
// @version      1.2
// @description  Click first option then submit, repeated 3 times for dynamic MTurk task content.
// @match        https://worker.mturk.com/projects/*/tasks/*
// @match        https://www.mturk.com/projects/*/tasks/*
// @match        https://www.mturkcontent.com/*
// @match        https://*.mturkcontent.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CONFIG = {
    CHOICE_CLICKS_BEFORE_SUBMIT: 3,
    BETWEEN_CHOICE_MIN_MS: 1200,
    BETWEEN_CHOICE_MAX_MS: 2400,
    BEFORE_SUBMIT_MIN_MS: 1800,
    BEFORE_SUBMIT_MAX_MS: 3200,
    POLL_MS: 500,
    PARENT_SUBMIT_MIN_DELAY_MS: 1300,
    PARENT_SUBMIT_MAX_DELAY_MS: 2400,
    PARENT_SUBMIT_RETRY_MS: 260,
    PARENT_SUBMIT_MAX_TRIES: 16,
    DEBUG: false
  };

  const MESSAGE_TYPE = "MTURK_FIRST_OPTION_SUBMIT_X3";
  const STATE_KEY_PREFIX = "mturk_first_option_submit_x3_v2_state_";

  function log() {
    if (!CONFIG.DEBUG) return;
    const args = Array.from(arguments);
    args.unshift("[MTurk x3]");
    try { console.log.apply(console, args); } catch (e) {}
  }

  function randomBetween(minMs, maxMs) {
    const min = Math.max(0, Number(minMs) || 0);
    const max = Math.max(min, Number(maxMs) || min);
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function cssEscape(value) {
    const raw = String(value || "");
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(raw);
    }
    return raw.replace(/[^a-zA-Z0-9_\-]/g, "\\$&");
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

  function isMturkContentHost() {
    const host = location.hostname.toLowerCase();
    return host === "www.mturkcontent.com" || host.endsWith(".mturkcontent.com");
  }

  function isWorkerTaskPage() {
    const host = location.hostname.toLowerCase();
    if (host !== "worker.mturk.com" && host !== "www.mturk.com") return false;
    return /^\/projects\/[^/]+\/tasks\/[^/]+/.test(location.pathname);
  }

  function getAssignmentIdFromPage() {
    try {
      const qs = new URLSearchParams(location.search);
      const fromQuery = qs.get("assignmentId");
      if (fromQuery && fromQuery !== "ASSIGNMENT_ID_NOT_AVAILABLE") return fromQuery;
    } catch (e) {}

    const fromInput = document.querySelector('input[name="assignmentId"], input[name="assignment_id"]');
    if (fromInput && fromInput.value && fromInput.value !== "ASSIGNMENT_ID_NOT_AVAILABLE") return fromInput.value;
    return "";
  }

  function getElementText(el) {
    return String((el && (el.innerText || el.textContent || el.value || el.getAttribute("aria-label"))) || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function clickElement(el) {
    if (!el || !isVisibleEnabled(el)) return false;
    try { if (el.focus) el.focus(); } catch (e) {}

    const mouseEvents = ["mouseover", "mousedown", "mouseup", "click"];
    for (const eventName of mouseEvents) {
      try {
        const ev = new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window });
        el.dispatchEvent(ev);
      } catch (e) {}
    }

    try {
      el.click();
      return true;
    } catch (e) {}

    try {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(ev);
      return true;
    } catch (e) {
      return false;
    }
  }

  function markInputChoice(el) {
    if (!el) return;
    const tag = String(el.tagName || "").toLowerCase();
    const type = String(el.getAttribute("type") || "").toLowerCase();
    if (tag !== "input" || (type !== "radio" && type !== "checkbox")) return;

    try { el.checked = true; } catch (e) {}
    try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
  }

  function resolveChoiceInput(choiceEl) {
    if (!choiceEl) return null;
    const tag = String(choiceEl.tagName || "").toLowerCase();

    if (tag === "input") return choiceEl;

    if (tag === "label") {
      const forId = choiceEl.getAttribute("for");
      if (forId) {
        const byFor = document.getElementById(forId);
        if (byFor) return byFor;
      }
      const nestedInput = choiceEl.querySelector("input[type='radio'], input[type='checkbox']");
      if (nestedInput) return nestedInput;
    }

    return null;
  }

  function isReturnLike(el) {
    const txt = getElementText(el);
    if (/return|cancel|skip|report/i.test(txt)) return true;
    const form = el.closest ? el.closest("form") : null;
    if (form && form.querySelector('input[name="_method"][value="delete"]')) return true;
    return false;
  }

  function isSubmitLike(el) {
    const type = String(el.getAttribute("type") || "").toLowerCase();
    if (type === "submit") return true;

    const txt = getElementText(el);
    if (/\bsubmit\b|\bcontinue\b|\bnext\b|\bdone\b|\bfinish\b|\bcomplete\b/.test(txt)) return true;

    const idClass = `${el.id || ""} ${el.className || ""}`.toLowerCase();
    return idClass.includes("submit");
  }

  function findFirstOptionControl(root) {
    const scope = root || document;
    const form = scope.querySelector("form") || scope;

    const radios = Array.from(form.querySelectorAll('input[type="radio"]')).filter(isVisibleEnabled);
    if (radios.length > 0) {
      const first = radios[0];
      if (first.id) {
        const label = form.querySelector(`label[for="${cssEscape(first.id)}"]`);
        if (label && isVisibleEnabled(label)) return label;
      }
      return first;
    }

    const checks = Array.from(form.querySelectorAll('input[type="checkbox"]')).filter(isVisibleEnabled);
    if (checks.length > 0) {
      const first = checks[0];
      if (first.id) {
        const label = form.querySelector(`label[for="${cssEscape(first.id)}"]`);
        if (label && isVisibleEnabled(label)) return label;
      }
      return first;
    }

    const ariaChoices = Array.from(form.querySelectorAll('[role="radio"], [role="option"], [data-testid*="choice" i]'))
      .filter((el) => isVisibleEnabled(el) && !isSubmitLike(el) && !isReturnLike(el));
    if (ariaChoices.length > 0) return ariaChoices[0];

    const buttonCandidates = Array.from(
      form.querySelectorAll("button, input[type='button'], a[role='button'], div[role='button'], span[role='button']")
    ).filter((el) => {
      if (!isVisibleEnabled(el)) return false;
      if (isSubmitLike(el) || isReturnLike(el)) return false;
      const txt = getElementText(el);
      if (/\bhelp\b|\binstruction\b|\baudio\b|\bvideo\b|\bplay\b|\bpause\b/.test(txt)) return false;
      return true;
    });
    return buttonCandidates[0] || null;
  }

  function findSubmitControl(root) {
    const base = root || document;
    const preferredSelectors = [
      "button[type='submit']",
      "input[type='submit']",
      "button[name*='submit' i]",
      "button[id*='submit' i]",
      "input[name*='submit' i]",
      "input[id*='submit' i]"
    ];

    const searchScopes = [];
    const directSubmitForm = base.querySelector("form[action*='submit']");
    if (directSubmitForm) searchScopes.push(directSubmitForm);
    const anyForm = base.querySelector("form");
    if (anyForm && anyForm !== directSubmitForm) searchScopes.push(anyForm);
    searchScopes.push(base);

    for (const scope of searchScopes) {
      for (const selector of preferredSelectors) {
        const match = Array.from(scope.querySelectorAll(selector))
          .find((el) => isVisibleEnabled(el) && !isReturnLike(el));
        if (match) return match;
      }

      const textMatch = Array.from(scope.querySelectorAll("button, input[type='button'], input[type='submit'], a[role='button']"))
        .find((el) => isVisibleEnabled(el) && isSubmitLike(el) && !isReturnLike(el));
      if (textMatch) return textMatch;
    }

    return null;
  }

  function getStateKey(assignmentId) {
    return `${STATE_KEY_PREFIX}${assignmentId}`;
  }

  function loadState(assignmentId) {
    const raw = sessionStorage.getItem(getStateKey(assignmentId));
    if (!raw) return { clicksDone: 0, submitted: false, nextActionAt: 0 };
    try {
      const parsed = JSON.parse(raw);
      return {
        clicksDone: Math.max(0, Number(parsed.clicksDone) || 0),
        submitted: !!parsed.submitted,
        nextActionAt: Math.max(0, Number(parsed.nextActionAt) || 0)
      };
    } catch (e) {
      return { clicksDone: 0, submitted: false, nextActionAt: 0 };
    }
  }

  function saveState(assignmentId, state) {
    const safe = {
      clicksDone: Math.max(0, Math.min(CONFIG.CHOICE_CLICKS_BEFORE_SUBMIT, Number(state.clicksDone) || 0)),
      submitted: !!state.submitted,
      nextActionAt: Math.max(0, Number(state.nextActionAt) || 0)
    };
    sessionStorage.setItem(getStateKey(assignmentId), JSON.stringify(safe));
  }

  function setupParentSubmitBridge() {
    function clickSubmitInParent() {
      const submit = findSubmitControl(document);
      if (submit && clickElement(submit)) return true;

      const submitForm = document.querySelector("form[action*='submit']");
      if (submitForm) {
        try {
          if (typeof submitForm.requestSubmit === "function") {
            submitForm.requestSubmit();
          } else {
            submitForm.submit();
          }
          return true;
        } catch (e) {}
      }

      return false;
    }

    window.addEventListener("message", (event) => {
      const data = event && event.data;
      if (!data || data.type !== MESSAGE_TYPE) return;

      const origin = String((event && event.origin) || "").toLowerCase();
      if (origin && !origin.endsWith(".mturkcontent.com") && origin !== "https://www.mturkcontent.com") return;

      const pageAssignment = getAssignmentIdFromPage();
      if (pageAssignment && data.assignmentId && pageAssignment !== data.assignmentId) return;

      const startAfter = randomBetween(CONFIG.PARENT_SUBMIT_MIN_DELAY_MS, CONFIG.PARENT_SUBMIT_MAX_DELAY_MS);
      setTimeout(() => {
        let tries = 0;
        const timer = setInterval(() => {
          tries += 1;
          if (clickSubmitInParent() || tries >= CONFIG.PARENT_SUBMIT_MAX_TRIES) {
            clearInterval(timer);
            log("parent submit attempt ended", { tries });
          }
        }, CONFIG.PARENT_SUBMIT_RETRY_MS);
      }, startAfter);
    });
  }

  function setupIframeFlow() {
    const assignmentId = getAssignmentIdFromPage();
    if (!assignmentId) return;

    let busy = false;
    let observer = null;
    let poller = null;

    function cleanup() {
      if (observer) observer.disconnect();
      if (poller) clearInterval(poller);
    }

    function runOneStep() {
      if (busy) return;
      const now = Date.now();

      const state = loadState(assignmentId);
      if (state.submitted) {
        cleanup();
        return;
      }
      if (now < state.nextActionAt) return;

      if (state.clicksDone < CONFIG.CHOICE_CLICKS_BEFORE_SUBMIT) {
        const firstOption = findFirstOptionControl(document);
        if (!firstOption) return;

        busy = true;
        const linkedInput = resolveChoiceInput(firstOption);
        if (linkedInput) markInputChoice(linkedInput);
        const clickedOption = clickElement(firstOption);
        if (!clickedOption) {
          busy = false;
          return;
        }

        const nextClicks = Math.min(CONFIG.CHOICE_CLICKS_BEFORE_SUBMIT, state.clicksDone + 1);
        const nextDelay = nextClicks < CONFIG.CHOICE_CLICKS_BEFORE_SUBMIT
          ? randomBetween(CONFIG.BETWEEN_CHOICE_MIN_MS, CONFIG.BETWEEN_CHOICE_MAX_MS)
          : randomBetween(CONFIG.BEFORE_SUBMIT_MIN_MS, CONFIG.BEFORE_SUBMIT_MAX_MS);

        saveState(assignmentId, {
          clicksDone: nextClicks,
          submitted: false,
          nextActionAt: Date.now() + nextDelay
        });
        log(`first choice click ${nextClicks}/${CONFIG.CHOICE_CLICKS_BEFORE_SUBMIT}`);
        busy = false;
        return;
      }

      busy = true;
      let didSubmit = false;
      const submit = findSubmitControl(document);
      if (submit) {
        didSubmit = clickElement(submit);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: MESSAGE_TYPE, assignmentId }, "*");
        didSubmit = true;
      }

      if (didSubmit) {
        saveState(assignmentId, {
          clicksDone: CONFIG.CHOICE_CLICKS_BEFORE_SUBMIT,
          submitted: true,
          nextActionAt: Date.now() + randomBetween(400, 900)
        });
        log("submitted after three choice clicks");
      } else {
        saveState(assignmentId, {
          clicksDone: state.clicksDone,
          submitted: false,
          nextActionAt: Date.now() + randomBetween(1000, 1800)
        });
      }
      busy = false;
    }

    runOneStep();
    observer = new MutationObserver(runOneStep);
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });

    poller = setInterval(() => {
      runOneStep();
    }, CONFIG.POLL_MS);

    window.addEventListener("beforeunload", cleanup);
  }

  if (isWorkerTaskPage()) {
    setupParentSubmitBridge();
    return;
  }

  if (isMturkContentHost()) {
    setupIframeFlow();
  }
})();

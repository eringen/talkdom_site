(function () {

  var WS = /\s+/;
  var STORAGE_PREFIX = "talkDOM:";

  // Parse "receiver keyword: arg keyword: arg" into structured message object.
  // Tokens ending with ":" are keywords, everything else fills args.
  function parseMessage(str) {
    var trimmed = str.trim();
    var tokens = trimmed.split(WS);
    var receiver = tokens[0];
    var body = trimmed.substring(receiver.length).trim();
    var rest = tokens.slice(1);
    var keywords = [];
    var args = [];
    var currentArg = [];

    for (var i = 0; i < rest.length; i++) {
      var token = rest[i];
      if (token.endsWith(":")) {
        if (keywords.length > 0 && currentArg.length > 0) {
          args.push(currentArg.join(" "));
          currentArg = [];
        } else if (keywords.length > 0) {
          args.push("");
        }
        keywords.push(token);
      } else {
        currentArg.push(token);
      }
    }
    if (keywords.length > 0) {
      args.push(currentArg.join(" "));
    }

    return { receiver: receiver, selector: keywords.join(""), keywords: keywords, args: args, body: body };
  }

  // Extract the first word from the receiver attribute (the name).
  function receiverName(el) {
    var attr = el.getAttribute("receiver").trim();
    var sp = attr.indexOf(" ");
    return sp === -1 ? attr : attr.substring(0, sp);
  }

  // Receiver cache: maps name -> NodeList, invalidated by DOM mutations.
  var receiverCache = Object.create(null);
  var cacheValid = false;

  new MutationObserver(function () { cacheValid = false; })
    .observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["receiver"] });

  // Find all elements whose receiver attribute contains the given name.
  function findReceivers(name) {
    if (!cacheValid) {
      Object.keys(receiverCache).forEach(function (key) { delete receiverCache[key]; });
      cacheValid = true;
    }
    if (receiverCache[name]) return receiverCache[name];
    var result = document.querySelectorAll('[receiver~="' + name + '"]');
    receiverCache[name] = result;
    return result;
  }

  // Check if a receiver allows a given apply operation (inner, text, append, outer).
  // No "accepts" attribute means everything is allowed.
  function accepts(el, op) {
    var attr = el.getAttribute("accepts");
    if (!attr) return true;
    return (" " + attr + " ").includes(" " + op + " ");
  }

  // Save receiver content to localStorage after apply, keyed by receiver name.
  function persist(el, op) {
    if (!el.hasAttribute("receiver") || !el.hasAttribute("persist")) return;
    var name = receiverName(el);
    var key = STORAGE_PREFIX + name;
    var content = op === "outer" ? el.outerHTML : el.innerHTML;
    localStorage.setItem(key, JSON.stringify({ op: op, content: content }));
  }

  // On page load, restore persisted receiver content from localStorage.
  function restore() {
    document.querySelectorAll("[persist]").forEach(function (el) {
      if (!el.hasAttribute("receiver")) return;
      var name = receiverName(el);
      var raw = localStorage.getItem(STORAGE_PREFIX + name);
      if (!raw) return;
      var state;
      try { state = JSON.parse(raw); } catch (e) {
        localStorage.removeItem(STORAGE_PREFIX + name);
        return;
      }
      if (state.op === "outer") {
        el.outerHTML = state.content;
      } else {
        el.innerHTML = state.content;
      }
    });
  }

  // Apply content to an element using the specified operation (inner, text, append, outer).
  function apply(el, op, content) {
    if (!accepts(el, op)) {
      console.error(receiverName(el) + " does not accept " + op);
      return;
    }
    switch (op) {
      case "inner": el.innerHTML = content; break;
      case "text": el.textContent = content; break;
      case "append": el.insertAdjacentHTML("beforeend", content); break;
      case "outer": el.outerHTML = content; break;
    }
    persist(el, op);
    return content;
  }

  var csrfMeta = null;

  function csrfToken() {
    if (!csrfMeta || !csrfMeta.isConnected) {
      csrfMeta = document.querySelector('meta[name="csrf-token"]');
    }
    return csrfMeta ? csrfMeta.getAttribute("content") : "";
  }

  // Perform a fetch with talkDOM headers. Returns a promise resolving to response text.
  // Fires server-triggered messages from X-TalkDOM-Trigger header if present.
  function request(method, url, receiver, body) {
    var headers = {
      "X-TalkDOM-Request": "true",
      "X-TalkDOM-Current-URL": location.href,
    };
    if (receiver) {
      headers["X-TalkDOM-Receiver"] = receiver;
    }
    if (method !== "GET") {
      var token = csrfToken();
      if (token) headers["X-CSRF-Token"] = token;
      else console.warn("talkDOM: no CSRF token found for " + method + " " + url);
    }
    return fetch(url, { method: method, headers: headers, body: body }).then(function (r) {
      if (!r.ok) {
        console.error("talkDOM: " + method + " " + url + " " + r.status);
        return Promise.reject(r.status);
      }
      var trigger = r.headers.get("X-TalkDOM-Trigger");
      return r.text().then(function (text) {
        if (trigger) dispatchRaw(trigger);
        return text;
      });
    });
  }

  function serializeForm(form) {
    return new URLSearchParams(new FormData(form)).toString();
  }

  function recName(el) {
    return el.hasAttribute("receiver") ? receiverName(el) : "";
  }

  // Built-in method table. Each method receives (el, ...args) from the parsed message.
  // Extensible via talkDOM.methods at runtime.
  var methods = {
    "get:": function (el, url) { return request("GET", url, recName(el)); },
    "post:": function (el, url) { return request("POST", url, recName(el)); },
    "put:": function (el, url) { return request("PUT", url, recName(el)); },
    "delete:": function (el, url) { return request("DELETE", url, recName(el)); },
    "confirm:": function (el, message) { if (!confirm(message)) return Promise.reject("cancelled"); },
    "apply:": function (el, content, op) { return apply(el, op, content); },
    "get:apply:": function (el, url, op) { return request("GET", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
    "post:apply:": function (el, url, op) { return request("POST", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
    "put:apply:": function (el, url, op) { return request("PUT", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
    "delete:apply:": function (el, url, op) { return request("DELETE", url, recName(el)).then(function (t) { return apply(el, op, t); }); },
    "post-form:apply:form:": function (el, url, op, formSelector) {
      var form = document.querySelector(formSelector);
      if (!form) { console.error("post-form: form not found: " + formSelector); return; }
      var body = serializeForm(form);
      return request("POST", url, recName(el), body).then(function (t) { return apply(el, op, t); });
    },
    "put-form:apply:form:": function (el, url, op, formSelector) {
      var form = document.querySelector(formSelector);
      if (!form) { console.error("put-form: form not found: " + formSelector); return; }
      var body = serializeForm(form);
      return request("PUT", url, recName(el), body).then(function (t) { return apply(el, op, t); });
    },
    "delete-form:apply:form:": function (el, url, op, formSelector) {
      var form = document.querySelector(formSelector);
      if (!form) { console.error("delete-form: form not found: " + formSelector); return; }
      var body = serializeForm(form);
      return request("DELETE", url, recName(el), body).then(function (t) { return apply(el, op, t); });
    },
    "post-json:apply:json:": function (el, url, op, jsonStr) {
      var data;
      try { data = JSON.parse(jsonStr); } catch (e) { data = {}; }
      return request("POST", url, recName(el), JSON.stringify(data)).then(function (t) { return apply(el, op, t); });
    },
    "put-json:apply:json:": function (el, url, op, jsonStr) {
      var data;
      try { data = JSON.parse(jsonStr); } catch (e) { data = {}; }
      return request("PUT", url, recName(el), JSON.stringify(data)).then(function (t) { return apply(el, op, t); });
    },
  };

  var pushing = false;

  // Push URL to browser history. Uses push-url attr value, or falls back to first message arg.
  function pushUrl(senderEl, raw) {
    if (!senderEl.hasAttribute("push-url")) return;
    var url = senderEl.getAttribute("push-url");
    if (!url) {
      var msg = parseMessage(raw.split(";")[0].split("|")[0].trim());
      if (msg.args.length > 0) {
        url = msg.args[0].split(/\s/)[0] || "";
      }
    }
    if (url && (location.pathname + location.search) !== url) {
      history.pushState({ sender: raw }, "", url);
    }
  }

  // Re-dispatch a sender message from history state (back/forward navigation).
  function replayState(state) {
    if (!state || !state.sender) return;
    pushing = true;
    dispatchRaw(state.sender);
    pushing = false;
  }

  window.addEventListener("popstate", function (e) {
    replayState(e.state);
  });

  // After an outer swap el is gone. Walk from the snapshotted sibling or
  // parent to find the element that took its place.
  function resolveTarget(el, next, parent, name) {
    if (el.isConnected) return el;
    var candidate = next && next.isConnected ? next.previousElementSibling
      : parent && parent.isConnected ? parent.lastElementChild : null;
    return candidate || findReceivers(name)[0];
  }

  // Deliver a parsed message to all matching receivers. Fires talkdom:done or talkdom:error
  // lifecycle events on the receiver element (or its replacement if outer-swapped).
  function send(msg, piped) {
    var els = findReceivers(msg.receiver);
    if (els.length === 0) {
      console.error(msg.receiver + " not found");
      return;
    }
    var loadingClass = null;
    var keywords = msg.keywords;
    var args = msg.args;
    var loadingIdx = keywords.indexOf("loading:");
    if (loadingIdx !== -1) {
      loadingClass = args[loadingIdx];
      keywords = keywords.filter(function (_, i) { return i !== loadingIdx; });
      args = args.filter(function (_, i) { return i !== loadingIdx; });
    }
    var selector = keywords.join("");
    var method = methods[selector];
    if (!method) {
      console.error(msg.receiver + " does not understand " + selector);
      return;
    }
    var finalArgs = piped !== undefined ? [piped].concat(args) : args;
    var result;
    els.forEach(function (el) {
      var detail = { receiver: msg.receiver, selector: selector, args: msg.args };
      var parent = el.parentNode;
      var next = el.nextElementSibling;
      if (loadingClass) el.classList.add(loadingClass);
      result = method(el, ...finalArgs);
      if (result && typeof result.then === "function") {
        result.then(function () {
          if (loadingClass) el.classList.remove(loadingClass);
          var target = resolveTarget(el, next, parent, msg.receiver);
          if (target) target.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail: detail }));
        }, function (err) {
          if (loadingClass) el.classList.remove(loadingClass);
          detail.error = err;
          var target = resolveTarget(el, next, parent, msg.receiver);
          if (target) target.dispatchEvent(new CustomEvent("talkdom:error", { bubbles: true, detail: detail }));
        });
      } else {
        if (loadingClass) el.classList.remove(loadingClass);
        var target = resolveTarget(el, next, parent, msg.receiver);
        if (target) target.dispatchEvent(new CustomEvent("talkdom:done", { bubbles: true, detail: detail }));
      }
    });
    return result;
  }

  // Programmatic API: parse and execute a raw message string (supports pipes and semicolons).
  // Returns a promise that resolves when all chains complete.
  function run(raw) {
    var trimmed = raw.trim();
    if (trimmed.indexOf(";") === -1 && trimmed.indexOf("|") === -1) {
      return Promise.resolve(send(parseMessage(trimmed))).then(function (r) { return [r]; });
    }
    var chains = trimmed.split(";").map(function (chain) {
      var step = chain.trim();
      if (!step) return Promise.resolve();
      var steps = step.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      if (steps.length === 1) {
        return Promise.resolve(send(parseMessage(steps[0])));
      }
      return steps.reduce(function (prev, step) {
        var msg = parseMessage(step);
        return Promise.resolve(prev).then(function (piped) {
          return send(msg, piped);
        });
      }, undefined);
    });
    return Promise.all(chains);
  }

  // Fire-and-forget dispatch used by declarative senders and server triggers.
  function dispatchRaw(raw) {
    run(raw).catch(function (err) { console.warn("talkDOM:", err); });
  }

  // Entry point for a sender click: dispatch its message and optionally push URL.
  function dispatch(senderEl) {
    var raw = senderEl.getAttribute("sender");
    dispatchRaw(raw);
    if (!pushing) pushUrl(senderEl, raw);
  }

  function parseInterval(str) {
    var match = str.match(/^(\d+)(s|ms)$/);
    if (!match) return null;
    var n = parseInt(match[1], 10);
    return match[2] === "s" ? n * 1000 : n;
  }

  // Set up a repeating interval for receivers with a poll: keyword.
  var activePollers = 0;
  var maxPollers = 64;

  function startPolling(el) {
    var attr = el.getAttribute("receiver");
    var msg = parseMessage(attr);
    if (msg.keywords[msg.keywords.length - 1] !== "poll:") return;
    if (activePollers >= maxPollers) {
      console.warn("talkDOM: max pollers (" + maxPollers + ") reached, ignoring " + msg.receiver);
      return;
    }
    var interval = parseInterval(msg.args[msg.args.length - 1]);
    if (!interval) {
      console.error("poll: invalid interval for " + msg.receiver);
      return;
    }
    var selector = msg.keywords.slice(0, -1).join("");
    var args = msg.args.slice(0, -1);
    var name = msg.receiver;
    var cachedTargets = findReceivers(name);
    var method = methods[selector];
    activePollers++;
    var id = setInterval(function () {
      if (!el.isConnected) { clearInterval(id); activePollers--; return; }
      if (cachedTargets.length === 0 || !cachedTargets[0].isConnected) {
        cachedTargets = findReceivers(name);
      }
      if (cachedTargets.length === 0) return;
      if (!method) method = methods[selector];
      if (!method) {
        console.error(name + " does not understand " + selector);
        return;
      }
      cachedTargets.forEach(function (target) { method(target, ...args); });
    }, interval);
  }

  // Global click handler: delegate to any element with a sender attribute.
  document.addEventListener("click", function (e) {
    var sender = e.target.closest("[sender]");
    if (sender) {
      e.preventDefault();
      dispatch(sender);
    }
  });

  restore();
  replayState(history.state);
  document.querySelectorAll("[receiver]").forEach(startPolling);

  // Watch for dynamically added receivers (polling, etc.)
  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.hasAttribute && node.hasAttribute("receiver")) {
            startPolling(node);
          }
          var children = node.querySelectorAll ? node.querySelectorAll("[receiver]") : [];
          for (var k = 0; k < children.length; k++) {
            startPolling(children[k]);
          }
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });

  window.talkDOM = {
    methods: methods,
    send: run,
    get maxPollers() { return maxPollers; },
    set maxPollers(n) { maxPollers = n; },
  };

}());

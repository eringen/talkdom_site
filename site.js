(function () {
  'use strict';

  // Site examples register their extensions once, including after fragment navigation.
  talkDOM.methods['toggle:'] = function (el, cls) { el.classList.toggle(cls); };
  var loading = new WeakMap();
  talkDOM.methods['get:apply:loading:'] = function (el, url, op, cls) {
    var counts = loading.get(el) || new Map();
    loading.set(el, counts);
    counts.set(cls, (counts.get(cls) || 0) + 1);
    el.classList.add(cls);
    return talkDOM.methods['get:apply:'](el, url, op).finally(function () {
      counts.set(cls, counts.get(cls) - 1);
      if (!counts.get(cls)) { counts.delete(cls); el.classList.remove(cls); }
    });
  };

  var browsers = new Map();
  var selectedClasses = ['bg-amber-400/10', 'text-amber-400'];
  function select(root, selector, current) {
    root.querySelectorAll(selector).forEach(function (button) {
      var active = button === current;
      button.setAttribute('aria-pressed', String(active));
      selectedClasses.forEach(function (cls) { button.classList.toggle(cls, active); });
      button.classList.toggle(selector === '[data-item]' ? 'text-gray-300' : 'text-gray-400', !active);
      if (selector === '[data-item]') {
        button.classList.toggle('border-l-2', active);
        button.classList.toggle('border-l-amber-400', active);
      }
    });
  }
  function status(panel, message, failed) {
    panel.replaceChildren();
    var text = document.createElement('p');
    text.className = 'p-6 text-sm text-gray-400';
    text.textContent = message;
    text.setAttribute('role', failed ? 'alert' : 'status');
    panel.appendChild(text);
    panel.setAttribute('aria-busy', String(!failed));
  }
  async function fragment(url, signal) {
    var response = await fetch(url, {signal:signal});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.text();
  }
  function cancel(state, key) {
    if (state[key]) state[key].abort();
    state[key] = null;
  }
  async function loadItem(root, button) {
    var state = browsers.get(root);
    cancel(state, 'detailRequest');
    var request = state.detailRequest = new AbortController();
    var panel = root.querySelector('[data-api-detail]');
    root.dataset.selectedItem = button.dataset.item;
    select(root, '[data-item]', button);
    status(panel, 'Loading ' + button.textContent.trim() + '…');
    try {
      var html = await fragment(button.dataset.item, request.signal);
      if (!root.isConnected || state.detailRequest !== request) return;
      panel.innerHTML = html;
      panel.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (request.signal.aborted || !root.isConnected || state.detailRequest !== request) return;
      status(panel, 'Could not load this reference. Select the item again to retry.', true);
    }
  }
  async function loadCategory(root, button, preferredItem) {
    var state = browsers.get(root);
    cancel(state, 'categoryRequest');
    cancel(state, 'detailRequest');
    var request = state.categoryRequest = new AbortController();
    root.dataset.selectedCategory = button.dataset.category;
    delete root.dataset.selectedItem;
    select(root, '[data-category]', button);
    var items = root.querySelector('[data-api-items]');
    var detail = root.querySelector('[data-api-detail]');
    status(items, 'Loading ' + button.textContent.trim() + '…');
    status(detail, 'Loading reference…');
    try {
      var html = await fragment(button.dataset.category, request.signal);
      if (!root.isConnected || state.categoryRequest !== request) return;
      items.innerHTML = html;
      items.setAttribute('aria-busy', 'false');
      var buttons = Array.from(items.querySelectorAll('[data-item]'));
      var first = buttons.find(function (item) { return item.dataset.item === preferredItem; }) || buttons[0];
      if (first) await loadItem(root, first);
      else status(detail, 'No reference entries in this category.', true);
    } catch (error) {
      if (request.signal.aborted || !root.isConnected || state.categoryRequest !== request) return;
      status(items, 'Could not load this category. Select it again to retry.', true);
      status(detail, 'Select a category to load its reference.', true);
    }
  }
  function reconcile() {
    browsers.forEach(function (state, root) {
      if (root.isConnected) return;
      cancel(state, 'categoryRequest'); cancel(state, 'detailRequest');
      browsers.delete(root);
    });
    document.querySelectorAll('[data-api-browser]').forEach(function (root) {
      if (browsers.has(root)) return;
      browsers.set(root, {});
      var categories = Array.from(root.querySelectorAll('[data-category]'));
      var first = categories.find(function (button) { return button.dataset.category === root.dataset.selectedCategory; }) || categories[0];
      if (first) loadCategory(root, first, root.dataset.selectedItem);
    });
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-category], [data-item]');
    if (!button) return;
    var root = button.closest('[data-api-browser]');
    if (!root) return;
    event.preventDefault();
    reconcile();
    if (button.hasAttribute('data-category')) loadCategory(root, button);
    else loadItem(root, button);
  });
  new MutationObserver(reconcile).observe(document, {childList:true, subtree:true});
  reconcile();
}());

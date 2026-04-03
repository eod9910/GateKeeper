// App-wide page state: save/restore per-page state so returning to a page restores it.
// Set data-page-id on <html> (e.g. data-page-id="research") so the key is stable.
// Usage: AppState.save({ ... });  and  var state = AppState.restore();
(function () {
  function getPageId() {
    var el = document.documentElement;
    if (el.dataset && el.dataset.pageId) return el.dataset.pageId;
    var path = (window.location.pathname || '').replace(/^\//, '').replace(/\.html$/, '');
    return path || 'index';
  }

  function storageKey() {
    return 'appPageState_' + getPageId();
  }

  window.AppState = {
    getPageId: getPageId,
    save: function (state) {
      try {
        localStorage.setItem(storageKey(), JSON.stringify(state));
      } catch (e) {}
    },
    restore: function () {
      try {
        var raw = localStorage.getItem(storageKey());
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }
  };
})();

// App-wide collapsible panel persistence.
// Any element with class="... collapsible" and data-collapse-key="<key>" gets wired automatically.
// Collapsed state is saved per page to localStorage and restored on every render.
// Usage (pages with dynamic HTML):
//   After injecting new collapsible HTML, call AppCollapse.apply() to attach handlers + restore state.
// Usage (static HTML):
//   Just add the attributes — DOMContentLoaded wires everything automatically.
(function () {
  var STORAGE_KEY_PREFIX = 'appCollapse_';

  function pageKey() {
    var el = document.documentElement;
    var id = (el.dataset && el.dataset.pageId) ? el.dataset.pageId
      : (window.location.pathname || '').replace(/^\//, '').replace(/\.html$/, '') || 'index';
    return STORAGE_KEY_PREFIX + id;
  }

  function load() {
    try {
      var raw = localStorage.getItem(pageKey());
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (e) { return new Set(); }
  }

  function save(set) {
    try {
      localStorage.setItem(pageKey(), JSON.stringify(Array.from(set)));
    } catch (e) {}
  }

  // Live in-memory set for this page load
  var collapsed = load();

  function applyAll() {
    document.querySelectorAll('[data-collapse-key]').forEach(function (el) {
      var key = el.getAttribute('data-collapse-key');
      if (collapsed.has(key)) el.classList.add('collapsed');
      else el.classList.remove('collapsed');
    });
  }

  function wire(container) {
    var root = container || document;
    root.querySelectorAll('[data-collapse-key]').forEach(function (el) {
      if (el._appCollapseWired) return;
      el._appCollapseWired = true;

      // Find the toggle trigger: panel-header or detail-section-header child
      var trigger = el.querySelector('.panel-header, .detail-section-header');
      if (!trigger) return;

      trigger.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        var key = el.getAttribute('data-collapse-key');
        var nowCollapsed = el.classList.toggle('collapsed');
        if (nowCollapsed) collapsed.add(key);
        else collapsed.delete(key);
        save(collapsed);
      });
    });
  }

  window.AppCollapse = {
    /** Call after injecting dynamic HTML to wire new elements and apply saved state. */
    apply: function (container) {
      wire(container);
      applyAll();
    },
    /** Reload collapsed set from localStorage (call if another tab may have changed it). */
    reload: function () {
      collapsed = load();
      applyAll();
    },
    /** Get current collapsed keys (for pages that also manage their own state). */
    getKeys: function () { return Array.from(collapsed); },
    /** Seed the set from an external source (e.g. research.js passes its own set). */
    setKeys: function (keys) {
      collapsed = new Set(keys);
      save(collapsed);
      applyAll();
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    wire(document);
    applyAll();
  });
})();

// Sidebar resize handle — drag the right edge to resize
(function () {
  var STORAGE_KEY = 'sidebar-width';
  var MIN = 140;
  var MAX = 480;

  function applyWidth(sidebar, main, w) {
    sidebar.style.width = w + 'px';
    if (main) main.style.marginLeft = w + 'px';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var sidebar = document.querySelector('.app-sidebar');
    var main    = document.querySelector('.app-main');
    if (!sidebar) return;

    // Restore saved width (skip if sidebar is currently collapsed)
    var saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
    var isCollapsed = sidebar.classList.contains('collapsed');
    if (saved && saved >= MIN && saved <= MAX && !isCollapsed) {
      applyWidth(sidebar, main, saved);
    }

    // Inject handle
    var handle = document.createElement('div');
    handle.className = 'sidebar-resize-handle';
    sidebar.appendChild(handle);

    var startX, startW;

    handle.addEventListener('mousedown', function (e) {
      if (sidebar.classList.contains('collapsed')) return;
      e.preventDefault();
      startX = e.clientX;
      startW = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        var w = Math.min(MAX, Math.max(MIN, startW + (e.clientX - startX)));
        applyWidth(sidebar, main, w);
      }

      function onUp() {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(STORAGE_KEY, sidebar.offsetWidth);
        window.dispatchEvent(new Event('resize')); // let charts re-measure
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Double-click handle to reset to default width
    handle.addEventListener('dblclick', function () {
      var defaultW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 200;
      applyWidth(sidebar, main, defaultW);
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event('resize'));
    });
  });
})();

// Sidebar collapse toggle — single source of truth for all pages
(function () {
  var sidebar = document.querySelector('.app-sidebar');
  var toggle = document.querySelector('.sidebar-toggle');
  if (!sidebar || !toggle) return;

  // Migrate old camelCase key if present (index.js used 'sidebarCollapsed')
  var oldKey = localStorage.getItem('sidebarCollapsed');
  if (oldKey !== null && localStorage.getItem('sidebar-collapsed') === null) {
    localStorage.setItem('sidebar-collapsed', oldKey);
    localStorage.removeItem('sidebarCollapsed');
  } else if (oldKey !== null) {
    localStorage.removeItem('sidebarCollapsed');
  }

  // Restore state from localStorage
  if (localStorage.getItem('sidebar-collapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }

  toggle.addEventListener('click', function () {
    sidebar.classList.toggle('collapsed');
    var isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebar-collapsed', isCollapsed);

    var main = document.querySelector('.app-main');
    if (isCollapsed) {
      // Override inline styles so CSS collapsed rules take over
      sidebar.style.width = '';
      if (main) main.style.marginLeft = '';
    } else {
      // Restore saved custom width if any
      var saved = parseInt(localStorage.getItem('sidebar-width'), 10);
      if (saved && saved >= 140 && saved <= 480) {
        sidebar.style.width = saved + 'px';
        if (main) main.style.marginLeft = saved + 'px';
      }
    }

    // Dispatch event so page-specific code can react (e.g. resize charts)
    window.dispatchEvent(new CustomEvent('sidebar-toggled', {
      detail: { collapsed: isCollapsed }
    }));
  });
})();

// Inject the Tombstones nav link into every shared sidebar.
(function () {
  function ensureTrainingNav() {
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    if (nav.querySelector('a[href="training.html"]')) return;

    var executionLink = nav.querySelector('a[href="execution.html"]');
    var link = document.createElement('a');
    link.href = 'training.html';
    link.className = 'sidebar-nav-item';
    link.innerHTML = '<span class="nav-dot"></span><span class="sidebar-label-text">Training</span>';

    var pathname = (window.location.pathname || '').toLowerCase();
    if (pathname.endsWith('/training.html') || pathname.endsWith('\\training.html') || pathname === '/training.html' || pathname === '/training') {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }

    if (executionLink && executionLink.parentNode === nav && executionLink.nextSibling) {
      nav.insertBefore(link, executionLink.nextSibling);
    } else if (executionLink && executionLink.parentNode === nav) {
      nav.appendChild(link);
    } else {
      nav.appendChild(link);
    }
  }

  document.addEventListener('DOMContentLoaded', ensureTrainingNav);
})();

// Inject the Tombstones nav link into every shared sidebar.
(function () {
  function ensureVisionLabNav() {
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    if (nav.querySelector('a[href="vision-lab.html"]')) return;

    var settingsLink = nav.querySelector('a[href="settings.html"]');
    var link = document.createElement('a');
    link.href = 'vision-lab.html';
    link.className = 'sidebar-nav-item';
    link.innerHTML = '<span class="nav-dot"></span><span class="sidebar-label-text">Vision Lab</span>';

    var pathname = (window.location.pathname || '').toLowerCase();
    if (pathname.endsWith('/vision-lab.html') || pathname.endsWith('\\vision-lab.html') || pathname === '/vision-lab.html') {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }

    if (settingsLink && settingsLink.parentNode === nav) {
      nav.insertBefore(link, settingsLink);
    } else {
      nav.appendChild(link);
    }
  }

  document.addEventListener('DOMContentLoaded', ensureVisionLabNav);
})();

// Inject the Tombstones nav link into every shared sidebar.
(function () {
  function ensureTombstonesNav() {
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    if (nav.querySelector('a[href="tombstones.html"]')) return;

    var settingsLink = nav.querySelector('a[href="settings.html"]');
    var link = document.createElement('a');
    link.href = 'tombstones.html';
    link.className = 'sidebar-nav-item';
    link.innerHTML = '<span class="nav-dot"></span><span class="sidebar-label-text">Tombstones</span>';

    var pathname = (window.location.pathname || '').toLowerCase();
    if (pathname.endsWith('/tombstones.html') || pathname.endsWith('\\tombstones.html') || pathname === '/tombstones.html') {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }

    if (settingsLink && settingsLink.parentNode === nav) {
      nav.insertBefore(link, settingsLink);
    } else {
      nav.appendChild(link);
    }
  }

  document.addEventListener('DOMContentLoaded', ensureTombstonesNav);
})();

// Keep all chat panels viewport-bounded so messages scroll inside the panel
// instead of pushing the page below the fold.
(function () {
  var panelSelectors = [
    '.scanner-chat-panel',
    '.validator-chat-panel',
    '.workshop-chat-panel',
    '.chat-panel',
    '.copilot-chat-panel',
    '#ai-panel'
  ];

  var messageSelectors = [
    '.scanner-chat-messages',
    '.validator-chat-messages',
    '.workshop-chat-messages',
    '.chat-messages',
    '#chat-messages'
  ];

  function getUniqueElements(selectors) {
    var out = [];
    var seen = new Set();
    selectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (!seen.has(el)) {
          seen.add(el);
          out.push(el);
        }
      });
    });
    return out;
  }

  function clampChatPanelsToViewport() {
    var viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!viewportH) return;

    var bottomGap = 12;
    var minPanelHeight = 260;

    getUniqueElements(panelSelectors).forEach(function (panel) {
      if (!(panel instanceof HTMLElement)) return;
      if (panel.offsetParent === null) return; // hidden
      if (panel.dataset && panel.dataset.skipViewportClamp === 'true') return;

      var rect = panel.getBoundingClientRect();
      var available = Math.floor(viewportH - rect.top - bottomGap);
      if (!Number.isFinite(available)) return;
      if (available < minPanelHeight) available = minPanelHeight;

      panel.style.minHeight = '0px';
      panel.style.overflow = 'hidden';
      panel.style.maxHeight = available + 'px';
      panel.style.height = available + 'px';
    });

    getUniqueElements(messageSelectors).forEach(function (box) {
      if (!(box instanceof HTMLElement)) return;
      box.style.minHeight = '0px';
      box.style.overflowY = 'auto';
      box.style.overflowX = 'hidden';
      box.style.flex = '1 1 auto';
    });
  }

  function queueClamp() {
    window.requestAnimationFrame(clampChatPanelsToViewport);
  }

  document.addEventListener('DOMContentLoaded', queueClamp);
  window.addEventListener('resize', queueClamp);
  window.addEventListener('orientationchange', queueClamp);
  window.addEventListener('sidebar-toggled', queueClamp);

  // Catch late-rendered content (chat history append, async UI mounts).
  window.setTimeout(queueClamp, 50);
  window.setTimeout(queueClamp, 250);
  window.setTimeout(queueClamp, 600);
})();

// Optional vertical resize handles for chat/panel stacks that need manual height control.
(function () {
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getPanelHeightLimits(panel) {
    var min = parseInt(panel.dataset.resizeMin || '', 10);
    if (!Number.isFinite(min)) min = 220;

    var max = parseInt(panel.dataset.resizeMax || '', 10);
    if (!Number.isFinite(max)) max = 720;

    var viewportMax = Math.max(min, (window.innerHeight || document.documentElement.clientHeight || max) - 140);
    return {
      min: min,
      max: Math.max(min, Math.min(max, viewportMax))
    };
  }

  function applyResizablePanelHeight(panel, height) {
    if (!(panel instanceof HTMLElement)) return;
    var limits = getPanelHeightLimits(panel);
    var next = clamp(height, limits.min, limits.max);
    panel.style.height = next + 'px';
    panel.style.flexBasis = next + 'px';
    return next;
  }

  function initVerticalResizablePanels() {
    document.querySelectorAll('[data-resizable-height="true"]').forEach(function (panel) {
      if (!(panel instanceof HTMLElement)) return;
      if (panel.dataset.resizeBound === 'true') return;

      var handle = panel.querySelector('.panel-resize-handle--vertical');
      if (!(handle instanceof HTMLElement) && panel.id) {
        handle = document.querySelector('.panel-resize-handle--vertical[data-resize-target="' + panel.id + '"]');
      }
      if (!(handle instanceof HTMLElement)) return;

      panel.dataset.resizeBound = 'true';
      var storageKey = panel.dataset.resizeStorageKey || '';
      var defaultHeight = parseInt(panel.dataset.resizeDefault || '', 10);
      if (!Number.isFinite(defaultHeight)) {
        defaultHeight = panel.offsetHeight || 360;
      }

      if (storageKey) {
        var saved = parseInt(localStorage.getItem(storageKey) || '', 10);
        if (Number.isFinite(saved)) {
          applyResizablePanelHeight(panel, saved);
        } else {
          applyResizablePanelHeight(panel, defaultHeight);
        }
      } else {
        applyResizablePanelHeight(panel, defaultHeight);
      }

      handle.addEventListener('mousedown', function (e) {
        if (panel.classList.contains('collapsed')) return;
        e.preventDefault();

        var startY = e.clientY;
        var startHeight = panel.getBoundingClientRect().height;
        handle.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        function onMove(moveEvent) {
          var next = applyResizablePanelHeight(panel, startHeight + (moveEvent.clientY - startY));
          if (storageKey) localStorage.setItem(storageKey, String(next));
          window.dispatchEvent(new Event('resize'));
        }

        function onUp() {
          handle.classList.remove('dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          window.dispatchEvent(new Event('resize'));
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      handle.addEventListener('dblclick', function () {
        var next = applyResizablePanelHeight(panel, defaultHeight);
        if (storageKey) localStorage.setItem(storageKey, String(next));
        window.dispatchEvent(new Event('resize'));
      });
    });
  }

  document.addEventListener('DOMContentLoaded', initVerticalResizablePanels);
  window.addEventListener('resize', function () {
    document.querySelectorAll('[data-resizable-height="true"]').forEach(function (panel) {
      if (!(panel instanceof HTMLElement)) return;
      if (!panel.style.height) return;
      var current = parseInt(panel.style.height, 10);
      if (!Number.isFinite(current)) return;
      applyResizablePanelHeight(panel, current);
    });
  });
})();

/**
 * Sync every cc-toggle-btn arrow to match its panel's actual collapsed state.
 * Runs on DOMContentLoaded so the initial HTML arrow is always correct.
 */
function syncCollapseBtns() {
  document.querySelectorAll('.cc-panel').forEach(function (panel) {
    var btn = panel.querySelector('.cc-toggle-btn');
    if (!btn) return;
    var isCollapsed = panel.classList.contains('collapsed');
    btn.textContent = isCollapsed ? '\u203A' : '\u2039';
    btn.title = isCollapsed ? 'Expand panel' : 'Collapse panel';
  });
}
document.addEventListener('DOMContentLoaded', syncCollapseBtns);

/**
 * Generic collapsible chat panel toggle.
 * panelId       – id of the .cc-panel element
 * gridId        – id of the parent grid element (or null)
 * collapsedClass – CSS class to add to the grid when collapsed (or null)
 */
function toggleChat(panelId, gridId, collapsedClass) {
  var panel = document.getElementById(panelId);
  var grid  = gridId ? document.getElementById(gridId) : null;
  if (!panel) return;
  var collapsed = panel.classList.toggle('collapsed');
  if (grid && collapsedClass) grid.classList.toggle(collapsedClass, collapsed);
  var btn = panel.querySelector('.cc-toggle-btn');
  if (btn) {
    btn.textContent = collapsed ? '\u203A' : '\u2039';
    btn.title = collapsed ? 'Expand panel' : 'Collapse panel';
  }
  // Fire resize after CSS transition so charts re-measure their containers
  setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 220);
}
window.toggleChat = toggleChat;

/* ── Generic detachable chat popout ─────────────────────────────────
 *
 * Usage from any page:
 *   popoutChatPanel({
 *     panelId:       'blockly-chat-panel',
 *     gridId:        'blockly-main-layout',       // optional – parent grid to collapse
 *     collapsedClass:'chat-collapsed',             // optional
 *     title:         'Blockly Assistant',
 *     statusId:      'blockly-chat-status',        // optional
 *     messagesId:    'blockly-chat-messages',
 *     inputId:       'blockly-chat-input',
 *     sendFn:        'sendBlocklyChat',            // global fn name
 *     actions: [                                   // optional quick-action buttons
 *       { label: 'Show Primitives', prefill: 'What primitives are available?' },
 *     ],
 *   });
 */
(function () {
  var _popouts = {};

  function buildPopoutHTML(cfg) {
    var actionBtns = (cfg.actions || []).map(function (a) {
      var escaped = String(a.prefill || '').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      return '<button class="pop-action-btn" onclick="popSend(\'' + escaped + '\')">' +
        (a.label || 'Action') + '</button>';
    }).join('\n      ');

    return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<title>' + (cfg.title || 'Chat') + '</title>\n' +
'<style>\n' +
'  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n' +
'  :root {\n' +
'    --color-bg: #1c1c1e; --color-surface: #222224; --color-border: #333335;\n' +
'    --color-text: #e8e8e4; --color-text-muted: #a8a8a4; --color-accent: #5d7a92;\n' +
'    --font-mono: "JetBrains Mono","Fira Code","SF Mono",monospace;\n' +
'  }\n' +
'  html, body { height: 100%; overflow: hidden; background: var(--color-bg); color: var(--color-text);\n' +
'    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; }\n' +
'  body { display: flex; flex-direction: column; }\n' +
'  .pop-header { display: flex; align-items: center; gap: 8px; padding: 10px 14px;\n' +
'    border-bottom: 1px solid var(--color-border); background: var(--color-surface); flex: 0 0 auto; }\n' +
'  .pop-header-title { font-weight: 700; font-size: 14px; flex: 1; }\n' +
'  .pop-status { font-size: 11px; color: var(--color-text-muted); font-family: var(--font-mono); }\n' +
'  .pop-dock-btn { background: none; border: 1px solid var(--color-border); border-radius: 6px;\n' +
'    color: var(--color-text-muted); padding: 4px 10px; cursor: pointer; font-size: 12px; }\n' +
'  .pop-dock-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }\n' +
'  .pop-messages { flex: 1 1 0%; overflow-y: auto; padding: 12px; display: flex;\n' +
'    flex-direction: column; gap: 8px; }\n' +
'  .pop-msg { padding: 10px 14px; border-radius: 10px; font-size: 12.5px;\n' +
'    line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-width: 92%; }\n' +
'  .pop-msg.ai, .pop-msg.assistant { background: rgba(255,255,255,0.04); border: 1px solid var(--color-border);\n' +
'    align-self: flex-start; color: var(--color-text); }\n' +
'  .pop-msg.user { background: var(--color-accent); color: #fff;\n' +
'    align-self: flex-end; border: none; }\n' +
'  .pop-input-row { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--color-border);\n' +
'    background: var(--color-surface); flex: 0 0 auto; }\n' +
'  .pop-input-row textarea { flex: 1; resize: none; border: 1px solid var(--color-border);\n' +
'    border-radius: 8px; background: var(--color-bg); color: var(--color-text); padding: 8px 10px;\n' +
'    font: inherit; font-size: 12.5px; outline: none; }\n' +
'  .pop-input-row textarea:focus { border-color: var(--color-accent); }\n' +
'  .pop-send-btn { width: 36px; height: 36px; border: none; border-radius: 50%;\n' +
'    background: var(--color-accent); color: #fff; font-size: 16px; cursor: pointer;\n' +
'    display: flex; align-items: center; justify-content: center; align-self: flex-end; }\n' +
'  .pop-send-btn:hover { filter: brightness(1.15); }\n' +
'  .pop-actions { display: flex; gap: 6px; padding: 6px 12px 10px; flex-wrap: wrap; background: var(--color-surface); flex: 0 0 auto; }\n' +
'  .pop-action-btn { background: none; border: 1px solid var(--color-border); border-radius: 6px;\n' +
'    color: var(--color-text-muted); padding: 5px 12px; cursor: pointer; font-size: 11.5px; flex: 1; min-width: 0; text-align: center; }\n' +
'  .pop-action-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="pop-header">\n' +
'    <span class="pop-header-title">' + (cfg.title || 'Chat') + '</span>\n' +
'    <span id="popout-status" class="pop-status">Ready</span>\n' +
'    <button class="pop-dock-btn" onclick="doDock()" title="Dock back into main window">&#8598; Dock</button>\n' +
'  </div>\n' +
'  <div id="popout-messages" class="pop-messages"></div>\n' +
'  <div class="pop-input-row">\n' +
'    <textarea id="popout-input" rows="2" placeholder="Ask..."\n' +
'      onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();popSend();}"></textarea>\n' +
'    <button class="pop-send-btn" onclick="popSend()">&#8593;</button>\n' +
'  </div>\n' +
(actionBtns ? '  <div class="pop-actions">\n      ' + actionBtns + '\n  </div>\n' : '') +
'  <script>\n' +
'    function popSend(prefill) {\n' +
'      var input = document.getElementById("popout-input");\n' +
'      var msg = typeof prefill === "string" ? prefill : (input ? input.value : "");\n' +
'      if (input && typeof prefill !== "string") input.value = "";\n' +
'      if (window.opener && window.opener["' + cfg.sendFn + '"]) {\n' +
'        window.opener["' + cfg.sendFn + '"](msg);\n' +
'      }\n' +
'    }\n' +
'    function doDock() {\n' +
'      if (window.opener && window.opener.dockChatPanel) {\n' +
'        window.opener.dockChatPanel("' + cfg.panelId + '");\n' +
'      }\n' +
'    }\n' +
'  </script>\n' +
'</body>\n' +
'</html>';
  }

  function syncPopoutMessages(panelId) {
    var entry = _popouts[panelId];
    if (!entry || !entry.win || entry.win.closed) return;
    var src = document.getElementById(entry.cfg.messagesId);
    var dst = entry.win.document.getElementById('popout-messages');
    if (!src || !dst) return;
    var bubbles = src.querySelectorAll('[class*="chat-bubble"], [class*="chat-message"], .chat-ai, .chat-user');
    if (bubbles.length === 0) {
      dst.innerHTML = src.innerHTML;
    } else {
      var html = '';
      bubbles.forEach(function (b) {
        var sender = /\buser\b/.test(b.className) ? 'user' : 'ai';
        html += '<div class="pop-msg ' + sender + '">' + b.innerHTML + '</div>';
      });
      dst.innerHTML = html;
    }
    dst.scrollTop = dst.scrollHeight;
  }

  function syncPopoutStatus(panelId) {
    var entry = _popouts[panelId];
    if (!entry || !entry.win || entry.win.closed || !entry.cfg.statusId) return;
    var src = document.getElementById(entry.cfg.statusId);
    var dst = entry.win.document.getElementById('popout-status');
    if (src && dst) dst.textContent = src.textContent;
  }

  function popoutChatPanel(cfg) {
    if (_popouts[cfg.panelId] && _popouts[cfg.panelId].win && !_popouts[cfg.panelId].win.closed) {
      _popouts[cfg.panelId].win.focus();
      return;
    }

    var panel = document.getElementById(cfg.panelId);
    if (panel) panel.style.display = 'none';
    if (cfg.gridId) {
      var grid = document.getElementById(cfg.gridId);
      if (grid) grid.classList.add('chat-popped-out');
    }

    var pop = window.open('', 'popout-' + cfg.panelId,
      'width=420,height=700,resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no');
    if (!pop) {
      alert('Pop-up blocked. Please allow pop-ups for this site.');
      if (panel) panel.style.display = '';
      if (cfg.gridId) {
        var g = document.getElementById(cfg.gridId);
        if (g) g.classList.remove('chat-popped-out');
      }
      return;
    }

    _popouts[cfg.panelId] = { win: pop, cfg: cfg };

    var doc = pop.document;
    doc.open();
    doc.write(buildPopoutHTML(cfg));
    doc.close();

    syncPopoutMessages(cfg.panelId);
    syncPopoutStatus(cfg.panelId);

    pop.addEventListener('beforeunload', function () {
      dockChatPanel(cfg.panelId);
    });

    var btn = panel && panel.querySelector('.cc-popout-btn');
    if (btn) { btn.textContent = '\u2196'; btn.title = 'Dock back'; }

    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 220);
  }

  function dockChatPanel(panelId) {
    var entry = _popouts[panelId];
    var cfg = entry ? entry.cfg : null;

    var panel = document.getElementById(panelId);
    if (panel) panel.style.display = '';
    if (cfg && cfg.gridId) {
      var grid = document.getElementById(cfg.gridId);
      if (grid) grid.classList.remove('chat-popped-out');
    }

    if (entry && entry.win && !entry.win.closed) {
      try { entry.win.close(); } catch (e) { /* cross-origin guard */ }
    }
    delete _popouts[panelId];

    var btn = panel && panel.querySelector('.cc-popout-btn');
    if (btn) { btn.textContent = '\u2197'; btn.title = 'Pop out to separate window'; }

    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 220);
  }

  function notifyPopout(panelId) {
    syncPopoutMessages(panelId);
    syncPopoutStatus(panelId);
  }

  function isPopped(panelId) {
    var e = _popouts[panelId];
    return !!(e && e.win && !e.win.closed);
  }

  window.popoutChatPanel = popoutChatPanel;
  window.dockChatPanel   = dockChatPanel;
  window.notifyPopout    = notifyPopout;
  window.isPopped        = isPopped;
  window._chatPopouts    = _popouts;
})();

// Global page help modal powered by the shared app reference.
(function () {
  var HELP_CACHE = Object.create(null);

  function isGlobalHelpDisabled() {
    var body = document.body;
    var html = document.documentElement;
    var path = String(window.location.pathname || '').toLowerCase();
    return !!(
      path.endsWith('/blockly-composer.html') ||
      path === '/blockly-composer' ||
      (body && body.dataset && body.dataset.disableGlobalHelp === 'true') ||
      (html && html.dataset && html.dataset.disableGlobalHelp === 'true')
    );
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatInline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function markdownToHtml(markdown) {
    var lines = String(markdown || '').replace(/\r/g, '').split('\n');
    var html = [];
    var paragraph = [];
    var inList = false;

    function flushParagraph() {
      if (!paragraph.length) return;
      html.push('<p>' + formatInline(paragraph.join(' ')) + '</p>');
      paragraph = [];
    }

    function closeList() {
      if (!inList) return;
      html.push('</ul>');
      inList = false;
    }

    lines.forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line) {
        flushParagraph();
        closeList();
        return;
      }

      if (/^###\s+/.test(line)) {
        flushParagraph();
        closeList();
        html.push('<h3>' + formatInline(line.replace(/^###\s+/, '')) + '</h3>');
        return;
      }

      if (/^##\s+/.test(line)) {
        flushParagraph();
        closeList();
        html.push('<h2>' + formatInline(line.replace(/^##\s+/, '')) + '</h2>');
        return;
      }

      if (/^#\s+/.test(line)) {
        flushParagraph();
        closeList();
        html.push('<h1>' + formatInline(line.replace(/^#\s+/, '')) + '</h1>');
        return;
      }

      if (/^-\s+/.test(line)) {
        flushParagraph();
        if (!inList) {
          html.push('<ul>');
          inList = true;
        }
        html.push('<li>' + formatInline(line.replace(/^-\s+/, '')) + '</li>');
        return;
      }

      paragraph.push(line);
    });

    flushParagraph();
    closeList();
    return html.join('');
  }

  function ensureHelpStyles() {
    if (document.getElementById('global-page-help-styles')) return;
    var style = document.createElement('style');
    style.id = 'global-page-help-styles';
    style.textContent = [
      '.global-help-btn{position:fixed;right:20px;bottom:20px;z-index:1200;padding:10px 14px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);font-family:var(--font-mono);font-size:var(--text-caption);letter-spacing:.06em;text-transform:uppercase;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.28);}',
      '.global-help-btn:hover{border-color:var(--color-accent);color:var(--color-accent);}',
      '.global-help-overlay{position:fixed;inset:0;z-index:1250;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:24px;}',
      '.global-help-overlay.open{display:flex;}',
      '.global-help-modal{width:min(1100px,96vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);box-shadow:0 24px 64px rgba(0,0,0,.45);}',
      '.global-help-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 20px;border-bottom:1px solid var(--color-border);background:var(--color-surface);}',
      '.global-help-title{font-size:var(--text-large);font-weight:700;color:var(--color-text);margin:0;}',
      '.global-help-subtitle{font-size:var(--text-caption);color:var(--color-text-subtle);margin-top:6px;}',
      '.global-help-close{border:1px solid var(--color-border);background:var(--color-bg-subtle);color:var(--color-text);border-radius:var(--radius-sm);padding:6px 10px;cursor:pointer;font-family:var(--font-mono);}',
      '.global-help-close:hover{border-color:var(--color-accent);color:var(--color-accent);}',
      '.global-help-body{overflow:auto;padding:20px;display:flex;flex-direction:column;gap:18px;}',
      '.global-help-intro{padding:14px 16px;border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-surface);font-size:var(--text-small);line-height:1.6;color:var(--color-text);}',
      '.global-help-section{border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-surface);padding:16px;}',
      '.global-help-section h2,.global-help-section h3,.global-help-section h1{margin:0 0 10px 0;font-size:var(--text-medium);color:var(--color-text);}',
      '.global-help-section p{margin:0 0 10px 0;color:var(--color-text-muted);line-height:1.7;font-size:var(--text-small);}',
      '.global-help-section ul{margin:0;padding-left:18px;color:var(--color-text-muted);}',
      '.global-help-section li{margin:0 0 8px 0;line-height:1.7;font-size:var(--text-small);}',
      '.global-help-section code{font-family:var(--font-mono);font-size:.9em;background:var(--color-bg-subtle);padding:1px 4px;border-radius:4px;color:var(--color-accent);}',
      '.global-help-source{font-size:var(--text-caption);color:var(--color-text-subtle);padding:0 20px 16px 20px;}'
    ].join('');
    document.head.appendChild(style);
  }

  function ensureHelpUi() {
    if (isGlobalHelpDisabled()) {
      var existingBtn = document.getElementById('global-page-help-btn');
      var existingOverlay = document.getElementById('global-page-help-overlay');
      if (existingBtn && existingBtn.parentNode) existingBtn.parentNode.removeChild(existingBtn);
      if (existingOverlay && existingOverlay.parentNode) existingOverlay.parentNode.removeChild(existingOverlay);
      return;
    }
    ensureHelpStyles();
    if (document.getElementById('global-page-help-btn')) return;

    var button = document.createElement('button');
    button.id = 'global-page-help-btn';
    button.className = 'global-help-btn';
    button.type = 'button';
    button.textContent = 'Help';
    button.addEventListener('click', openPageHelp);

    var overlay = document.createElement('div');
    overlay.id = 'global-page-help-overlay';
    overlay.className = 'global-help-overlay';
    overlay.innerHTML = [
      '<div class="global-help-modal" role="dialog" aria-modal="true" aria-labelledby="global-help-title">',
      '  <div class="global-help-header">',
      '    <div>',
      '      <h2 id="global-help-title" class="global-help-title">Page Help</h2>',
      '      <div id="global-help-subtitle" class="global-help-subtitle">How to use this page</div>',
      '    </div>',
      '    <button type="button" class="global-help-close" id="global-help-close">Close</button>',
      '  </div>',
      '  <div class="global-help-body" id="global-help-body"><div class="global-help-intro">Loading help...</div></div>',
      '  <div class="global-help-source" id="global-help-source"></div>',
      '</div>'
    ].join('');

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closePageHelp();
    });

    document.body.appendChild(button);
    document.body.appendChild(overlay);
    document.getElementById('global-help-close').addEventListener('click', closePageHelp);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closePageHelp();
    });
  }

  function currentPageKey() {
    return window.location.pathname || '/';
  }

  function renderHelpPayload(payload) {
    var titleEl = document.getElementById('global-help-title');
    var subtitleEl = document.getElementById('global-help-subtitle');
    var bodyEl = document.getElementById('global-help-body');
    var sourceEl = document.getElementById('global-help-source');
    if (!titleEl || !subtitleEl || !bodyEl || !sourceEl) return;

    titleEl.textContent = payload.title || 'Page Help';
    subtitleEl.textContent = 'Canonical quick reference for the current page';

    var parts = [];
    if (payload.intro) {
      parts.push('<div class="global-help-intro">' + formatInline(payload.intro) + '</div>');
    }
    (payload.sections || []).forEach(function (section) {
      parts.push('<section class="global-help-section">' + markdownToHtml(section.markdown || '') + '</section>');
    });
    bodyEl.innerHTML = parts.join('') || '<div class="global-help-intro">No help content available for this page yet.</div>';
    sourceEl.textContent = payload.source ? ('Source: ' + payload.source) : '';
  }

  async function loadPageHelp() {
    var page = currentPageKey();
    if (HELP_CACHE[page]) return HELP_CACHE[page];

    var res = await fetch('/api/reference/page-help?page=' + encodeURIComponent(page));
    var data = await res.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to load page help.');
    }
    HELP_CACHE[page] = data.data;
    return data.data;
  }

  async function openPageHelp() {
    ensureHelpUi();
    var overlay = document.getElementById('global-page-help-overlay');
    var bodyEl = document.getElementById('global-help-body');
    if (!overlay || !bodyEl) return;
    overlay.classList.add('open');
    bodyEl.innerHTML = '<div class="global-help-intro">Loading help...</div>';

    try {
      var payload = await loadPageHelp();
      renderHelpPayload(payload);
    } catch (error) {
      bodyEl.innerHTML = '<div class="global-help-intro">Help could not be loaded for this page. ' + escapeHtml(error && error.message ? error.message : 'Unknown error') + '</div>';
    }
  }

  function closePageHelp() {
    var overlay = document.getElementById('global-page-help-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  document.addEventListener('DOMContentLoaded', ensureHelpUi);
})();


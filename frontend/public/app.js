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

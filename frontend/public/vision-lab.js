let visionLabImage = null;
let visionLabCrop = null;
let visionLabCropDrag = null;

function visionLabSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function visionLabFormatNow() {
  return new Date().toLocaleTimeString();
}

function visionLabSetCropStatus(message) {
  visionLabSetText('vision-lab-crop-status', message);
}

function visionLabGetUpscaleFactor() {
  const raw = document.getElementById('vision-lab-upscale')?.value || '1';
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function visionLabClearCropState() {
  visionLabCrop = null;
  visionLabCropDrag = null;
}

function visionLabGetPreviewMetrics() {
  const preview = document.getElementById('vision-lab-preview');
  if (!preview || !preview.naturalWidth || !preview.naturalHeight) return null;
  const rect = preview.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    preview,
    rect,
    displayWidth: rect.width,
    displayHeight: rect.height,
    naturalWidth: preview.naturalWidth,
    naturalHeight: preview.naturalHeight,
  };
}

function visionLabClamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function visionLabNormalizeDisplayRect(startX, startY, endX, endY, maxWidth, maxHeight) {
  const left = visionLabClamp(Math.min(startX, endX), 0, maxWidth);
  const top = visionLabClamp(Math.min(startY, endY), 0, maxHeight);
  const right = visionLabClamp(Math.max(startX, endX), 0, maxWidth);
  const bottom = visionLabClamp(Math.max(startY, endY), 0, maxHeight);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function visionLabDisplayRectToNatural(rect, metrics) {
  const scaleX = metrics.naturalWidth / metrics.displayWidth;
  const scaleY = metrics.naturalHeight / metrics.displayHeight;
  return {
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY),
  };
}

function visionLabGetImagePointFromEvent(event, metrics) {
  return {
    x: visionLabClamp(event.clientX - metrics.rect.left, 0, metrics.displayWidth),
    y: visionLabClamp(event.clientY - metrics.rect.top, 0, metrics.displayHeight),
  };
}

function visionLabRenderCrop() {
  const cropLayer = document.getElementById('vision-lab-crop-layer');
  const cropBox = document.getElementById('vision-lab-crop-box');
  if (!cropLayer || !cropBox) return;
  const upscale = visionLabGetUpscaleFactor();

  const activeRect = visionLabCropDrag?.displayRect || visionLabCrop?.displayRect || null;
  if (!visionLabImage?.dataUrl || !activeRect || !activeRect.width || !activeRect.height) {
    cropLayer.classList.remove('is-active');
    cropBox.classList.remove('is-visible');
    cropBox.style.left = '0px';
    cropBox.style.top = '0px';
    cropBox.style.width = '0px';
    cropBox.style.height = '0px';
    visionLabSetCropStatus(`Crop: full image | export ${upscale}x`);
    return;
  }

  cropLayer.classList.add('is-active');
  cropBox.classList.add('is-visible');
  cropBox.style.left = `${activeRect.x}px`;
  cropBox.style.top = `${activeRect.y}px`;
  cropBox.style.width = `${activeRect.width}px`;
  cropBox.style.height = `${activeRect.height}px`;

  const naturalRect = visionLabCropDrag?.naturalRect || visionLabCrop?.naturalRect || null;
  if (naturalRect) {
    visionLabSetCropStatus(
      `Crop: ${naturalRect.width.toLocaleString()}x${naturalRect.height.toLocaleString()} px @ (${naturalRect.x.toLocaleString()}, ${naturalRect.y.toLocaleString()}) | export ${upscale}x`
    );
  } else {
    visionLabSetCropStatus(`Crop: active | export ${upscale}x`);
  }
}

function visionLabRenderImage() {
  const dropzone = document.getElementById('vision-lab-dropzone');
  const empty = document.getElementById('vision-lab-dropzone-empty');
  const shell = document.getElementById('vision-lab-preview-shell');
  const preview = document.getElementById('vision-lab-preview');
  const meta = document.getElementById('vision-lab-image-meta');

  if (!dropzone || !empty || !shell || !preview || !meta) return;

  if (!visionLabImage?.dataUrl) {
    dropzone.classList.remove('is-loaded');
    empty.classList.remove('hidden');
    shell.classList.add('hidden');
    preview.removeAttribute('src');
    meta.textContent = '';
    visionLabClearCropState();
    visionLabRenderCrop();
    visionLabSetText('vision-lab-image-state', 'No');
    return;
  }

  dropzone.classList.add('is-loaded');
  empty.classList.add('hidden');
  shell.classList.remove('hidden');
  preview.src = visionLabImage.dataUrl;
  meta.textContent = `${visionLabImage.name || 'Pasted image'} | ${visionLabImage.mime || 'image'} | ${visionLabImage.dataUrl.length.toLocaleString()} chars`;
  visionLabSetText('vision-lab-image-state', 'Yes');
}

function visionLabReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read image file.'));
    reader.readAsDataURL(file);
  });
}

async function visionLabSetFile(file) {
  if (!file) return;
  const dataUrl = await visionLabReadFileAsDataUrl(file);
  visionLabImage = {
    dataUrl,
    name: file.name || 'Pasted image',
    mime: file.type || 'image/png',
  };
  visionLabClearCropState();
  visionLabRenderImage();
}

function visionLabClearCrop() {
  visionLabClearCropState();
  visionLabRenderCrop();
}

async function visionLabGetActiveImageDataUrl() {
  if (!visionLabImage?.dataUrl) return null;
  const upscale = visionLabGetUpscaleFactor();
  if ((!visionLabCrop?.naturalRect || !visionLabCrop.naturalRect.width || !visionLabCrop.naturalRect.height) && upscale === 1) {
    return visionLabImage.dataUrl;
  }

  const image = new Image();
  image.decoding = 'async';
  image.src = visionLabImage.dataUrl;
  await image.decode();

  const naturalRect = visionLabCrop?.naturalRect || {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  const { x, y, width, height } = naturalRect;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * upscale));
  canvas.height = Math.max(1, Math.round(height * upscale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return visionLabImage.dataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

function visionLabBuildChatContext(symbol) {
  const trimmedSymbol = String(symbol || '').trim();
  const context = {
    patternType: 'vision_debug',
    tradeDirection: 'LONG',
    copilotAnalysis: {
      scanner: true,
      candidate: {
        pattern_type: 'vision_debug',
        timeframe: 'debug',
        entry_ready: null,
      },
    },
  };

  if (trimmedSymbol) {
    context.symbol = trimmedSymbol;
    context.copilotAnalysis.candidate.symbol = trimmedSymbol;
  }

  return context;
}

function visionLabLog(summary, payload, response) {
  const logEl = document.getElementById('vision-lab-log');
  const responseEl = document.getElementById('vision-lab-response');
  if (logEl) {
    logEl.textContent = [
      `time: ${visionLabFormatNow()}`,
      `summary: ${summary}`,
      '',
      'request:',
      JSON.stringify(payload, null, 2),
    ].join('\n');
  }
  if (responseEl) {
    responseEl.textContent = JSON.stringify(response, null, 2);
  }
  visionLabSetText('vision-lab-last-run', visionLabFormatNow());
}

async function visionLabRefreshStatus() {
  try {
    const res = await fetch('/api/vision/status');
    const data = await res.json();
    const status = data?.data || {};
    visionLabSetText('vision-lab-provider', status.provider || '--');
    visionLabSetText('vision-lab-ready', status.available && status.modelLoaded ? 'Ready' : (status.error || 'Not ready'));
  } catch (err) {
    visionLabSetText('vision-lab-provider', '--');
    visionLabSetText('vision-lab-ready', `Failed: ${err.message}`);
  }
}

async function visionLabSendChat() {
  const role = document.getElementById('vision-lab-role')?.value || 'contextual_ranker';
  const symbol = (document.getElementById('vision-lab-symbol')?.value || '').trim();
  const message = (document.getElementById('vision-lab-message')?.value || '').trim() || 'Tell me exactly what visible labels, numbers, swing-point markers, and drawn lines you see.';
  const aiModel = (document.getElementById('vision-lab-model')?.value || '').trim() || undefined;
  const upscaleFactor = visionLabGetUpscaleFactor();

  const chartImage = await visionLabGetActiveImageDataUrl();
  const payload = {
    message,
    context: visionLabBuildChatContext(symbol),
    role,
    aiModel,
    chartImage,
    cropMode: visionLabCrop?.naturalRect ? 'cropped' : 'full_image',
    upscaleFactor,
  };

  const started = performance.now();
  const res = await fetch('/api/vision/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  const elapsed = Math.round(performance.now() - started);
  visionLabLog(`chat ${res.status} in ${elapsed}ms`, payload, data);
}

async function visionLabSendAnalyze() {
  if (!visionLabImage?.dataUrl) {
    visionLabLog('analyze skipped', { error: 'No image attached.' }, { success: false, error: 'No image attached.' });
    return;
  }

  const symbol = (document.getElementById('vision-lab-symbol')?.value || '').trim();
  const analysisMode = document.getElementById('vision-lab-analysis-mode')?.value || 'pattern_discovery';
  const upscaleFactor = visionLabGetUpscaleFactor();
  const imageBase64 = await visionLabGetActiveImageDataUrl();
  const payload = {
    imageBase64,
    patternInfo: {
      baseRange: 'vision-lab',
    },
    analysisMode,
    cropMode: visionLabCrop?.naturalRect ? 'cropped' : 'full_image',
    upscaleFactor,
  };

  if (symbol) {
    payload.patternInfo.symbol = symbol;
  }

  const started = performance.now();
  const res = await fetch('/api/vision/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  const elapsed = Math.round(performance.now() - started);
  visionLabLog(`analyze ${res.status} in ${elapsed}ms`, payload, data);
}

function visionLabClear() {
  visionLabImage = null;
  visionLabClearCropState();
  visionLabRenderImage();
  visionLabSetText('vision-lab-last-run', '--');
  visionLabSetText('vision-lab-log', 'Waiting for a request...');
  visionLabSetText('vision-lab-response', 'No response yet.');
}

function visionLabStartCrop(event) {
  if (!visionLabImage?.dataUrl) return;
  if (event.button !== 0) return;

  const metrics = visionLabGetPreviewMetrics();
  if (!metrics) return;

  const target = event.target;
  if (!(target instanceof HTMLElement) || target.id !== 'vision-lab-preview') return;

  event.preventDefault();
  const point = visionLabGetImagePointFromEvent(event, metrics);
  const displayRect = { x: point.x, y: point.y, width: 0, height: 0 };
  const naturalRect = visionLabDisplayRectToNatural(displayRect, metrics);
  visionLabCropDrag = {
    startX: point.x,
    startY: point.y,
    displayRect,
    naturalRect,
  };
  visionLabRenderCrop();
}

function visionLabMoveCrop(event) {
  if (!visionLabCropDrag) return;
  const metrics = visionLabGetPreviewMetrics();
  if (!metrics) return;
  const point = visionLabGetImagePointFromEvent(event, metrics);
  const displayRect = visionLabNormalizeDisplayRect(
    visionLabCropDrag.startX,
    visionLabCropDrag.startY,
    point.x,
    point.y,
    metrics.displayWidth,
    metrics.displayHeight
  );
  visionLabCropDrag.displayRect = displayRect;
  visionLabCropDrag.naturalRect = visionLabDisplayRectToNatural(displayRect, metrics);
  visionLabRenderCrop();
}

function visionLabFinishCrop() {
  if (!visionLabCropDrag) return;
  const displayRect = visionLabCropDrag.displayRect;
  const naturalRect = visionLabCropDrag.naturalRect;
  const isTooSmall = !displayRect || displayRect.width < 12 || displayRect.height < 12 || !naturalRect || naturalRect.width < 12 || naturalRect.height < 12;
  visionLabCrop = isTooSmall ? null : {
    displayRect,
    naturalRect,
  };
  visionLabCropDrag = null;
  visionLabRenderCrop();
}

function visionLabBindEvents() {
  const roleSelect = document.getElementById('vision-lab-role');
  const hintEl = document.getElementById('vision-lab-hint');
  const analyzeBtn = document.getElementById('vision-lab-send-analyze');
  const preview = document.getElementById('vision-lab-preview');
  const upscaleSelect = document.getElementById('vision-lab-upscale');

  function updateRoleUi() {
    const role = roleSelect?.value || 'contextual_ranker';
    if (hintEl) {
      hintEl.textContent = role === 'literal_chart_reader'
        ? 'Use literal_chart_reader with Send Chat for exact label reading. Leave Symbol blank unless you intentionally want to inject symbol context.'
        : 'Send Chat tests the conversational vision path. Send Analyze tests the chart-analysis endpoint and may inject pattern-analysis behavior.';
    }
    if (analyzeBtn) {
      analyzeBtn.disabled = role === 'literal_chart_reader';
      analyzeBtn.title = role === 'literal_chart_reader'
        ? 'literal_chart_reader is a chat-only role. Use Send Chat.'
        : '';
    }
  }

  document.getElementById('vision-lab-refresh-status')?.addEventListener('click', visionLabRefreshStatus);
  document.getElementById('vision-lab-send-chat')?.addEventListener('click', visionLabSendChat);
  document.getElementById('vision-lab-send-analyze')?.addEventListener('click', visionLabSendAnalyze);
  document.getElementById('vision-lab-clear-all')?.addEventListener('click', visionLabClear);
  document.getElementById('vision-lab-clear-crop')?.addEventListener('click', visionLabClearCrop);
  document.getElementById('vision-lab-remove-image')?.addEventListener('click', () => {
    visionLabImage = null;
    visionLabClearCropState();
    visionLabRenderImage();
  });
  document.getElementById('vision-lab-upload-trigger')?.addEventListener('click', () => {
    document.getElementById('vision-lab-upload')?.click();
  });
  document.getElementById('vision-lab-upload')?.addEventListener('change', async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    await visionLabSetFile(file);
    event.target.value = '';
  });
  roleSelect?.addEventListener('change', updateRoleUi);
  upscaleSelect?.addEventListener('change', visionLabRenderCrop);

  const dropzone = document.getElementById('vision-lab-dropzone');
  if (dropzone) {
    dropzone.addEventListener('paste', async (event) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.kind === 'file' && /^image\//i.test(item.type || ''));
      if (!imageItem) return;
      event.preventDefault();
      const file = imageItem.getAsFile();
      if (file) await visionLabSetFile(file);
    });
    dropzone.addEventListener('dragover', (event) => {
      event.preventDefault();
    });
    dropzone.addEventListener('drop', async (event) => {
      event.preventDefault();
      const file = Array.from(event.dataTransfer?.files || []).find((entry) => /^image\//i.test(entry.type || ''));
      if (file) await visionLabSetFile(file);
    });
  }

  preview?.addEventListener('load', () => {
    visionLabRenderCrop();
  });
  preview?.addEventListener('mousedown', visionLabStartCrop);
  window.addEventListener('mousemove', visionLabMoveCrop);
  window.addEventListener('mouseup', visionLabFinishCrop);

  updateRoleUi();
}

document.addEventListener('DOMContentLoaded', () => {
  visionLabBindEvents();
  visionLabRenderImage();
  visionLabRefreshStatus();
});

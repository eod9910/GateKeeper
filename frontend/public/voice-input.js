(function () {
  const VOICE_INPUT_CONFIGS = [
    { inputId: 'scanner-chat-input', sendFunctionName: 'sendScannerChat', layout: 'inline' },
    { inputId: 'fundamentals-chat-input', sendFunctionName: 'sendFundamentalsChat', layout: 'inline' },
    { inputId: 'chat-input', sendFunctionName: 'sendChat', layout: 'floating' },
    { inputId: 'validator-chat-input', sendFunctionName: 'sendValidatorChat', layout: 'inline' },
    { inputId: 'strategy-chat-input', sendFunctionName: 'sendStrategyChat', layout: 'inline' },
    { inputId: 'workshop-chat-input', sendFunctionName: 'sendWorkshopChat', layout: 'inline' },
    { inputId: 'workshop-scanner-ai-input', sendFunctionName: 'sendWorkshopScannerChat', layout: 'inline' },
    { inputId: 'composite-ai-input', sendFunctionName: 'sendCompositeChat', layout: 'inline' },
    { inputId: 'blockly-chat-input', sendFunctionName: 'sendBlocklyChat', layout: 'inline' },
    { inputId: 'pipeline-chat-input', sendFunctionName: 'sendPipelineChat', layout: 'inline' },
  ];

  const sessions = new Map();
  let styleMounted = false;

  function mountStyles() {
    if (styleMounted || !document.head) return;
    styleMounted = true;
    const style = document.createElement('style');
    style.textContent = `
.voice-input-btn {
  border: 1px solid var(--color-border, #3a3a3a);
  background: var(--color-surface, #1b1b1b);
  color: var(--color-text, #f3f3f3);
  border-radius: 999px;
  height: 34px;
  min-width: 34px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}
.voice-input-btn[data-state="recording"] {
  background: #7f1d1d;
  border-color: #b91c1c;
  color: #fff;
}
.voice-input-btn[data-state="transcribing"] {
  opacity: 0.75;
  cursor: wait;
}
.voice-input-btn--floating {
  position: absolute;
  right: 52px;
  bottom: 12px;
}
`;
    document.head.appendChild(style);
  }

  function resolveRecorderMimeType() {
    if (typeof window.MediaRecorder === 'undefined') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const mimeType of candidates) {
      if (!mimeType || !window.MediaRecorder.isTypeSupported || window.MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }
    return '';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || '');
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('Failed to read recorded audio.'));
      reader.readAsDataURL(blob);
    });
  }

  function dispatchInputUpdate(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function updateButtonState(session, state, title) {
    session.state = state;
    session.button.dataset.state = state;
    if (state === 'recording') {
      session.button.textContent = 'Stop';
    } else if (state === 'transcribing') {
      session.button.textContent = '...';
    } else {
      session.button.textContent = 'Mic';
    }
    session.button.title = title || 'Voice input';
    session.button.setAttribute('aria-label', title || 'Voice input');
    session.button.disabled = state === 'transcribing';
  }

  function cleanupStream(session) {
    if (!session.stream) return;
    for (const track of session.stream.getTracks()) {
      track.stop();
    }
    session.stream = null;
  }

  async function transcribeRecording(session, blob) {
    updateButtonState(session, 'transcribing', 'Transcribing voice input');
    try {
      const audioBase64 = await blobToBase64(blob);
      const response = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: blob.type || session.mimeType || 'audio/webm',
          fileName: `voice-input.${(blob.type || '').includes('mp4') ? 'm4a' : 'webm'}`,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Transcription request failed.');
      }
      const text = String(payload?.data?.text || '').trim();
      if (!text) {
        throw new Error('No speech was detected.');
      }

      const input = session.input;
      const existing = String(input.value || '').trim();
      input.value = existing ? `${existing} ${text}` : text;
      input.focus();
      dispatchInputUpdate(input);
      updateButtonState(session, 'idle', 'Voice input ready');
    } catch (error) {
      console.error('[VoiceInput] transcription failed:', error);
      updateButtonState(session, 'idle', `Voice input failed: ${error.message || error}`);
    } finally {
      cleanupStream(session);
      session.recorder = null;
      session.chunks = [];
    }
  }

  async function startRecording(session) {
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder === 'undefined') {
      updateButtonState(session, 'idle', 'Voice input is not supported in this browser.');
      return;
    }

    const mimeType = resolveRecorderMimeType();
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      session.chunks = [];
      session.mimeType = mimeType || 'audio/webm';
      session.recorder = mimeType
        ? new MediaRecorder(session.stream, { mimeType })
        : new MediaRecorder(session.stream);
      session.recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) {
          session.chunks.push(event.data);
        }
      });
      session.recorder.addEventListener('stop', () => {
        const blob = new Blob(session.chunks, { type: session.mimeType || 'audio/webm' });
        void transcribeRecording(session, blob);
      });
      session.recorder.start();
      updateButtonState(session, 'recording', 'Recording voice input. Click again to stop.');
    } catch (error) {
      console.error('[VoiceInput] microphone access failed:', error);
      cleanupStream(session);
      updateButtonState(session, 'idle', `Microphone access failed: ${error.message || error}`);
    }
  }

  function stopRecording(session) {
    if (!session.recorder || session.state !== 'recording') return;
    session.recorder.stop();
  }

  function insertButton(session, config) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'voice-input-btn';
    button.textContent = 'Mic';
    button.title = 'Start voice input';
    button.setAttribute('aria-label', 'Start voice input');
    button.addEventListener('click', () => {
      if (session.state === 'recording') {
        stopRecording(session);
        return;
      }
      if (session.state === 'transcribing') return;
      void startRecording(session);
    });

    if (config.layout === 'floating') {
      const wrapper = session.input.parentElement;
      if (!wrapper) return null;
      button.classList.add('voice-input-btn--floating');
      const currentPaddingRight = session.input.style.paddingRight;
      if (!currentPaddingRight || currentPaddingRight === '56px') {
        session.input.style.paddingRight = '96px';
      }
      wrapper.appendChild(button);
    } else {
      const row = session.input.parentElement;
      if (!row) return null;
      const toolbar = row.querySelector('.scanner-chat-input-toolbar');
      const mount = toolbar || row;
      const firstButton = Array.from(mount.children).find((child) => child.tagName === 'BUTTON');
      if (firstButton) {
        mount.insertBefore(button, firstButton);
      } else {
        mount.appendChild(button);
      }
    }

    return button;
  }

  function initVoiceInput(config) {
    const input = document.getElementById(config.inputId);
    if (!input || sessions.has(config.inputId)) return;

    const session = {
      input,
      state: 'idle',
      button: null,
      recorder: null,
      stream: null,
      chunks: [],
      mimeType: '',
    };

    const button = insertButton(session, config);
    if (!button) return;
    session.button = button;
    sessions.set(config.inputId, session);
    updateButtonState(session, 'idle', 'Start voice input');
  }

  function initAllVoiceInputs() {
    mountStyles();
    for (const config of VOICE_INPUT_CONFIGS) {
      initVoiceInput(config);
    }
  }

  window.PatternDetectorVoiceInput = {
    initAll: initAllVoiceInputs,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllVoiceInputs, { once: true });
  } else {
    initAllVoiceInputs();
  }
})();

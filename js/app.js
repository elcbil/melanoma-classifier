'use strict';

const CONFIG = {
  modelUrl:  'model/model.json',
  inputSize: 300,
  classes:   ['Melanoma', 'Melanocytic Nevus'],
};

let model     = null;
let camStream = null;
let rafId     = null;

// ── Model Loader ─────────────────────────────────────────────
const ModelLoader = (() => {

  function setStatus(state, text) {
    const bar = document.getElementById('modelBar');
    bar.className = `model-bar ${state}`;
    document.getElementById('modelStatus').textContent = text;
  }

  function buildDummyModel() {
    const m = tf.sequential();
    m.add(tf.layers.flatten({ inputShape: [CONFIG.inputSize, CONFIG.inputSize, 3] }));
    m.add(tf.layers.dense({ units: CONFIG.classes.length, activation: 'softmax' }));
    return m;
  }

  async function load() {
    setStatus('loading', 'Memuat model TensorFlow.js…');
    try {
      // FIX: langsung tf.loadLayersModel, biarkan TF.js handle cache/fetch sendiri
      model = await tf.loadLayersModel(CONFIG.modelUrl);

      // Warmup inference
      const warmup = tf.zeros([1, CONFIG.inputSize, CONFIG.inputSize, 3]);
      const warmupOut = model.predict(warmup);
      warmupOut.dispose();
      warmup.dispose();

      setStatus('ready', `Model siap · input ${CONFIG.inputSize}×${CONFIG.inputSize}`);
      console.info('[ModelLoader] Model dimuat, output shape:', model.outputs[0].shape);
    } catch (err) {
      console.warn('[ModelLoader] Gagal memuat model, menggunakan dummy:', err.message);
      model = buildDummyModel();
      setStatus('error', 'Demo mode (model dummy) — ' + err.message);
    }
  }

  return { load };
})();

// ── Classifier ───────────────────────────────────────────────
const Classifier = (() => {

  // FIX: EfficientNet preprocess_input: pixel → [0,255] → (x/127.5) - 1 → [-1, 1]
  function efficientnetPreprocess(tensor) {
    return tensor.div(127.5).sub(1.0);
  }

  async function classify(source) {
    if (!model) throw new Error('Model belum dimuat.');

    const inputTensor = tf.tidy(() => {
      return tf.browser.fromPixels(source)
        .resizeBilinear([CONFIG.inputSize, CONFIG.inputSize])
        .toFloat()
        .pipe(efficientnetPreprocess)   // ← FIX: normalisasi ke [-1, 1]
        .expandDims(0);
    });

    const predTensor = model.predict(inputTensor);
    const data       = await predTensor.data();   // Float32Array

    inputTensor.dispose();
    predTensor.dispose();

    return Array.from(data);   // kembalikan sebagai Array biasa
  }

  return { classify };
})();

// ── UI ───────────────────────────────────────────────────────
const UI = (() => {

  function switchTab(tab) {
    const isUpload = tab === 'upload';
    document.getElementById('panelUpload').classList.toggle('active', isUpload);
    document.getElementById('panelCam').classList.toggle('active', !isUpload);
    document.getElementById('tabUpload').classList.toggle('active', isUpload);
    document.getElementById('tabCam').classList.toggle('active', !isUpload);
    if (isUpload) Cam.stop();
  }

  function renderResult(containerId, scores) {
    const el     = document.getElementById(containerId);
    const topIdx = scores.indexOf(Math.max(...scores));
    const label  = CONFIG.classes[topIdx];
    const cssClass = topIdx === 0 ? 'melanoma' : 'nevus';
    const conf   = (scores[topIdx] * 100).toFixed(1);

    const barsHTML = CONFIG.classes.map((name, i) => {
      const cls = i === 0 ? 'melanoma' : 'nevus';
      const pct = (scores[i] * 100).toFixed(1);
      return `
        <div class="bar-row">
          <div class="bar-label"><span>${name}</span><span>${pct}%</span></div>
          <div class="bar-track">
            <div class="bar-fill ${cls}" style="width:${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = `
      <p class="result-sub">Hasil Klasifikasi</p>
      <div class="result-label ${cssClass}">${label}</div>
      <p class="result-sub">Confidence: ${conf}%</p>
      ${barsHTML}
      <div class="disclaimer">
        <strong>⚠ Perhatian:</strong> Hasil ini hanya untuk tujuan penelitian dan edukasi.
        Bukan pengganti diagnosis klinis. Konsultasikan dengan dokter kulit untuk evaluasi medis resmi.
      </div>`;

    el.classList.add('visible');
  }

  function showLoader(id) { document.getElementById(id).classList.add('visible'); }
  function hideLoader(id) { document.getElementById(id).classList.remove('visible'); }
  function hideResult(id) { document.getElementById(id).classList.remove('visible'); }

  return { switchTab, renderResult, showLoader, hideLoader, hideResult };
})();

// ── Upload ───────────────────────────────────────────────────
const Upload = (() => {

  const RESULT_ID = 'uploadResult';
  const LOADER_ID = 'uploadLoader';

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Pilih file gambar yang valid (JPG, PNG, WEBP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Ukuran file melebihi 10 MB.');
      return;
    }

    const wrap = document.getElementById('uploadPreviewWrap');
    wrap.innerHTML = '';
    const img = new Image();
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    img.alt = 'Preview gambar yang diupload';
    img.src = URL.createObjectURL(file);
    wrap.appendChild(img);

    // FIX: tangkap error decode gambar
    try {
      await img.decode();
    } catch {
      alert('Gagal membaca gambar. Pastikan file tidak korup.');
      URL.revokeObjectURL(img.src);
      return;
    }

    const canvas = document.getElementById('uploadCanvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    UI.showLoader(LOADER_ID);
    UI.hideResult(RESULT_ID);

    try {
      const scores = await Classifier.classify(canvas);
      UI.renderResult(RESULT_ID, scores);
    } catch (err) {
      console.error('[Upload] Klasifikasi gagal:', err);
      alert('Gagal mengklasifikasi gambar: ' + err.message);
    } finally {
      UI.hideLoader(LOADER_ID);
      URL.revokeObjectURL(img.src);
    }
  }

  function init() {
    const fileInput = document.getElementById('fileInput');
    const dropZone  = document.getElementById('dropZone');

    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
  }

  return { init };
})();

// ── Camera ───────────────────────────────────────────────────
const Cam = (() => {

  const RESULT_ID  = 'camResult';
  const LOADER_ID  = 'camLoader';
  const video      = () => document.getElementById('video');
  const btnStart   = () => document.getElementById('btnStartCam');
  const btnCapture = () => document.getElementById('btnCapture');
  const statusEl   = () => document.getElementById('camStatus');
  const statusTxt  = () => document.getElementById('camStatusText');

  function startLiveFeed() {
    const displayCanvas = document.getElementById('camDisplayCanvas');
    const ctx = displayCanvas.getContext('2d');

    function draw() {
      const vid = video();
      if (camStream && vid.readyState >= vid.HAVE_CURRENT_DATA) {
        if (vid.videoWidth && displayCanvas.width  !== vid.videoWidth)  displayCanvas.width  = vid.videoWidth;
        if (vid.videoHeight && displayCanvas.height !== vid.videoHeight) displayCanvas.height = vid.videoHeight;
        ctx.drawImage(vid, 0, 0, displayCanvas.width, displayCanvas.height);
      }
      rafId = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopLiveFeed() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function setLiveUI(isLive) {
    const st = statusEl();
    st.className = isLive ? 'cam-status live' : 'cam-status';
    statusTxt().textContent = isLive ? 'Live — kamera aktif' : 'Kamera tidak aktif';
    btnStart().textContent  = isLive ? '■ Matikan Kamera' : '▶ Aktifkan Kamera';
    btnStart().onclick      = isLive ? stop : start;
    btnCapture().disabled   = !isLive;
  }

  async function start() {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      video().srcObject = camStream;
      await video().play();
      setLiveUI(true);
      startLiveFeed();
    } catch (err) {
      alert('Tidak dapat mengakses kamera: ' + err.message);
    }
  }

  function stop() {
    stopLiveFeed();
    if (camStream) {
      camStream.getTracks().forEach(t => t.stop());
      camStream = null;
    }
    video().srcObject = null;
    setLiveUI(false);
  }

  async function capture() {
    const vid = video();
    if (!camStream || vid.readyState < vid.HAVE_CURRENT_DATA) {
      alert('Kamera belum siap, coba lagi.');
      return;
    }

    const captureCanvas  = document.getElementById('camCaptureCanvas');
    captureCanvas.width  = vid.videoWidth;
    captureCanvas.height = vid.videoHeight;
    captureCanvas.getContext('2d').drawImage(vid, 0, 0);

    const displayCanvas = document.getElementById('camDisplayCanvas');
    displayCanvas.getContext('2d').drawImage(
      captureCanvas, 0, 0, displayCanvas.width, displayCanvas.height
    );

    UI.showLoader(LOADER_ID);
    UI.hideResult(RESULT_ID);
    btnCapture().disabled = true;

    try {
      const scores = await Classifier.classify(captureCanvas);
      UI.renderResult(RESULT_ID, scores);
    } catch (err) {
      console.error('[Cam] Klasifikasi gagal:', err);
      alert('Gagal mengklasifikasi: ' + err.message);
    } finally {
      UI.hideLoader(LOADER_ID);
      btnCapture().disabled = false;
    }
  }

  function init() {
    btnStart().onclick   = start;
    btnCapture().onclick = capture;
  }

  return { init, start, stop, capture };
})();

// ── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Upload.init();
  Cam.init();
  ModelLoader.load();
});

window.UI  = UI;
window.Cam = Cam;
'use strict';

// ===========================
// PDF.js worker setup
// ===========================
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ===========================
// State
// ===========================
let words = [];
let currentIndex = 0;
let wpm = 300;
let playing = false;
let timer = null;
let chapters = [];
let extractedText = '';

// ===========================
// DOM refs
// ===========================
const fileInput       = document.getElementById('file-input');
const dropzone        = document.getElementById('dropzone');
const pasteArea       = document.getElementById('paste-area');
const useTextBtn      = document.getElementById('use-text-btn');
const chapterSection  = document.getElementById('chapter-section');
const chapterSelect   = document.getElementById('chapter-select');
const loadChapterBtn  = document.getElementById('load-chapter-btn');
const saveSection     = document.getElementById('save-section');
const saveTextBtn     = document.getElementById('save-text-btn');
const readerSection   = document.getElementById('reader-section');
const wordBefore      = document.getElementById('word-before');
const wordOrp         = document.getElementById('word-orp');
const wordAfter       = document.getElementById('word-after');
const wordDisplay     = document.getElementById('word-display');
const progressFill    = document.getElementById('progress-fill');
const progressCounter = document.getElementById('progress-counter');
const playPauseBtn    = document.getElementById('play-pause-btn');
const restartBtn      = document.getElementById('restart-btn');
const backBtn         = document.getElementById('back-btn');
const forwardBtn      = document.getElementById('forward-btn');
const speedBtns       = document.querySelectorAll('.speed-btn');
const customWpmInput  = document.getElementById('custom-wpm-input');
const setWpmBtn       = document.getElementById('set-wpm-btn');
const wpmBadge        = document.getElementById('wpm-badge');
const tabBtns         = document.querySelectorAll('.tab-btn');
const tabPanels       = document.querySelectorAll('.tab-panel');

// ===========================
// Extract text from PDF
// ===========================
async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageStr = content.items.map(item => item.str).join(' ');
    pageTexts.push(pageStr);
  }
  return pageTexts.join('\n\n');
}

// ===========================
// Clean raw text
// ===========================
function cleanText(raw) {
  if (!raw) return '';
  let lines = raw.split('\n');

  lines = lines.filter(line => {
    const trimmed = line.trim();
    // Remove lines that are purely numeric (page numbers)
    if (/^\d+$/.test(trimmed)) return false;
    // Remove very short lines (1-2 chars)
    if (trimmed.length < 3) return false;
    return true;
  });

  let text = lines.join('\n');

  // Collapse 3+ newlines to double newline (paragraph break)
  text = text.replace(/\n{3,}/g, '\n\n');

  // Collapse multiple spaces
  text = text.replace(/[ \t]+/g, ' ');

  return text.trim();
}

// ===========================
// Detect chapters
// ===========================
function detectChapters(text) {
  const lines = text.split('\n');
  const found = [];
  let charIndex = 0;

  const chapterPattern = /^(chapter|part)\s+(\d+|[ivxlcdmIVXLCDM]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
  const numberedSectionPattern = /^\d{1,2}\.\s+[A-Z]/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (chapterPattern.test(trimmed) || numberedSectionPattern.test(trimmed)) {
      found.push({ title: trimmed, charIndex });
    }
    charIndex += line.length + 1; // +1 for the \n
  }

  return found.length >= 2 ? found : [];
}

// ===========================
// Convert char index → word index
// ===========================
function charsToWordIndex(text, charIndex) {
  const prefix = text.slice(0, charIndex);
  const prefixWords = prefix.split(/\s+/).filter(w => w.length > 0);
  return Math.max(0, prefixWords.length);
}

// ===========================
// Load text into reader
// ===========================
function loadText(text) {
  if (!text || text.trim().length === 0) {
    alert('No readable text found.');
    return;
  }

  extractedText = text;
  words = text.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) {
    alert('No readable text found.');
    return;
  }

  // Detect chapters
  chapters = detectChapters(text);
  populateChapterDropdown();

  if (chapters.length >= 2) {
    chapterSection.classList.remove('hidden');
  } else {
    chapterSection.classList.add('hidden');
  }

  // Show save button and reader
  saveSection.classList.remove('hidden');
  readerSection.classList.remove('hidden');

  // Reset playback
  pause();
  currentIndex = 0;
  renderWord(0);
}

// ===========================
// Populate chapter dropdown
// ===========================
function populateChapterDropdown() {
  chapterSelect.innerHTML = '';
  chapters.forEach((ch, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = ch.title.length > 60 ? ch.title.slice(0, 57) + '...' : ch.title;
    chapterSelect.appendChild(opt);
  });
}

// ===========================
// ORP position
// ===========================
function getOrpPosition(word) {
  const len = word.length;
  if (len === 1) return 0;
  if (len <= 3) return 1;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

// ===========================
// Render word
// ===========================
function renderWord(index) {
  if (words.length === 0) return;
  const idx = Math.max(0, Math.min(index, words.length - 1));
  currentIndex = idx;

  const word = words[idx];
  const orp = getOrpPosition(word);

  wordBefore.textContent = word.slice(0, orp);
  wordOrp.textContent = word.slice(orp, orp + 1);
  wordAfter.textContent = word.slice(orp + 1);

  // Dynamic font size based on word length
  const len = word.length;
  let fontSize;
  if (len <= 5) {
    fontSize = '5rem';
  } else if (len <= 10) {
    fontSize = '4.5rem';
  } else if (len <= 15) {
    fontSize = '3.5rem';
  } else {
    fontSize = '2.5rem';
  }
  wordDisplay.style.fontSize = fontSize;

  // Progress
  const pct = words.length > 1 ? (idx / (words.length - 1)) * 100 : 100;
  progressFill.style.width = pct + '%';
  progressCounter.textContent = 'Word ' + (idx + 1) + ' of ' + words.length;
}

// ===========================
// Play
// ===========================
function play() {
  if (words.length === 0) return;
  if (currentIndex >= words.length) {
    currentIndex = 0;
  }
  playing = true;
  playPauseBtn.textContent = '⏸';
  timer = setInterval(() => {
    if (currentIndex >= words.length) {
      pause();
      return;
    }
    renderWord(currentIndex);
    currentIndex++;
  }, 60000 / wpm);
}

// ===========================
// Pause
// ===========================
function pause() {
  playing = false;
  clearInterval(timer);
  timer = null;
  playPauseBtn.textContent = '▶';
}

// ===========================
// Set speed
// ===========================
function setSpeed(newWpm) {
  wpm = newWpm;
  wpmBadge.textContent = wpm + ' WPM';

  // Update active preset button
  speedBtns.forEach(btn => {
    const btnWpm = parseInt(btn.dataset.wpm, 10);
    if (btnWpm === wpm) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Restart timer if playing
  if (playing) {
    pause();
    play();
  }
}

// ===========================
// Handle file loading
// ===========================
async function handleFile(file) {
  if (!file) return;

  const name = file.name.toLowerCase();

  try {
    if (name.endsWith('.pdf')) {
      if (typeof pdfjsLib === 'undefined') {
        alert('PDF.js failed to load. Please check your internet connection and reload.');
        return;
      }
      const raw = await extractPdfText(file);
      const cleaned = cleanText(raw);
      loadText(cleaned);
    } else if (name.endsWith('.txt')) {
      const raw = await file.text();
      const cleaned = cleanText(raw);
      loadText(cleaned);
    } else {
      alert('Unsupported file type. Please upload a .pdf or .txt file.');
    }
  } catch (err) {
    console.error('File read error:', err);
    alert('Could not read this PDF. Try saving it as text first.');
  }
}

// ===========================
// Event: File input change
// ===========================
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  // Reset input so same file can be re-selected
  fileInput.value = '';
});

// ===========================
// Event: Drag & Drop
// ===========================
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// ===========================
// Event: Paste text
// ===========================
useTextBtn.addEventListener('click', () => {
  const text = pasteArea.value;
  if (!text.trim()) {
    alert('Please paste some text first.');
    return;
  }
  loadText(cleanText(text));
});

// ===========================
// Event: Tab switching
// ===========================
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;

    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    tabPanels.forEach(panel => {
      if (panel.id === 'panel-' + target) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    });
  });
});

// ===========================
// Event: Speed preset buttons
// ===========================
speedBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const newWpm = parseInt(btn.dataset.wpm, 10);
    setSpeed(newWpm);
  });
});

// ===========================
// Event: Custom WPM
// ===========================
setWpmBtn.addEventListener('click', () => {
  let val = parseInt(customWpmInput.value, 10);
  if (isNaN(val)) {
    alert('Please enter a valid number.');
    return;
  }
  val = Math.max(50, Math.min(2000, val));
  customWpmInput.value = val;
  setSpeed(val);
});

customWpmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') setWpmBtn.click();
});

// ===========================
// Event: Play/Pause button
// ===========================
playPauseBtn.addEventListener('click', () => {
  if (playing) {
    pause();
  } else {
    play();
  }
});

// ===========================
// Event: Restart
// ===========================
restartBtn.addEventListener('click', () => {
  pause();
  currentIndex = 0;
  renderWord(0);
});

// ===========================
// Event: -50 words
// ===========================
backBtn.addEventListener('click', () => {
  const wasPlaying = playing;
  if (wasPlaying) pause();
  currentIndex = Math.max(0, currentIndex - 50);
  renderWord(currentIndex);
  if (wasPlaying) play();
});

// ===========================
// Event: +50 words
// ===========================
forwardBtn.addEventListener('click', () => {
  const wasPlaying = playing;
  if (wasPlaying) pause();
  currentIndex = Math.min(words.length - 1, currentIndex + 50);
  renderWord(currentIndex);
  if (wasPlaying) play();
});

// ===========================
// Event: Load Chapter
// ===========================
loadChapterBtn.addEventListener('click', () => {
  const selectedIndex = parseInt(chapterSelect.value, 10);
  if (isNaN(selectedIndex) || !chapters[selectedIndex]) return;
  const chapter = chapters[selectedIndex];
  const wordIdx = charsToWordIndex(extractedText, chapter.charIndex);
  const wasPlaying = playing;
  if (wasPlaying) pause();
  currentIndex = wordIdx;
  renderWord(currentIndex);
  if (wasPlaying) play();
});

// ===========================
// Event: Save extracted text
// ===========================
saveTextBtn.addEventListener('click', () => {
  if (!extractedText) return;
  const blob = new Blob([extractedText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'extracted-text.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ===========================
// Keyboard shortcuts
// ===========================
document.addEventListener('keydown', (e) => {
  // Ignore shortcuts when typing in inputs
  const tag = e.target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (playing) {
      pause();
    } else {
      play();
    }
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    const wasPlaying = playing;
    if (wasPlaying) pause();
    currentIndex = Math.max(0, currentIndex - 50);
    renderWord(currentIndex);
    if (wasPlaying) play();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    const wasPlaying = playing;
    if (wasPlaying) pause();
    currentIndex = Math.min(words.length - 1, currentIndex + 50);
    renderWord(currentIndex);
    if (wasPlaying) play();
  }
});

// ===========================
// Init: set default WPM badge
// ===========================
wpmBadge.textContent = wpm + ' WPM';

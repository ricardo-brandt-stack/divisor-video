let selectedFile = null;
const MAX_TARGET_BYTES = 249 * 1024 * 1024; // 249 MB limite máximo
let ffmpegInstance = null;

// Elementos DOM
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const fileInfoPanel = document.getElementById('file-info-panel');
const infoName = document.getElementById('info-name');
const infoSize = document.getElementById('info-size');
const splitBtn = document.getElementById('split-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const resultsPanel = document.getElementById('results-panel');
const partsList = document.getElementById('parts-list');

// =========================================================
// 1. GERENCIAMENTO DE TEMA (DARK MODE)
// =========================================================
const currentTheme = localStorage.getItem('theme');
if (currentTheme === 'dark') {
    document.body.classList.add('dark-mode');
    if (themeIcon) themeIcon.textContent = '☀️';
}

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        if (themeIcon) themeIcon.textContent = isDark ? '☀️' : '🌙';
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
}

// =========================================================
// 2. SELEÇÃO DE ARQUIVO DE VÍDEO
// =========================================================
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    selectedFile = file;
    uploadStatus.textContent = `Vídeo carregado: ${file.name}`;
    infoName.textContent = file.name;
    infoSize.textContent = formatBytes(file.size);

    fileInfoPanel.classList.remove('hidden');
    resultsPanel.classList.add('hidden');
    partsList.innerHTML = '';
    splitBtn.disabled = false;
});

// =========================================================
// 3. INICIALIZAÇÃO DO FFMPEG WASM
// =========================================================
async function getFFmpeg() {
    if (ffmpegInstance) return ffmpegInstance;
    
    const { createFFmpeg } = FFmpeg;
    ffmpegInstance = createFFmpeg({ log: false });
    
    uploadStatus.textContent = 'A carregar motor de corte de vídeo...';
    await ffmpegInstance.load();
    return ffmpegInstance;
}

// =========================================================
// 4. DIVISÃO DE VÍDEO (MÁX 249 MB POR PARTE)
// =========================================================
splitBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    try {
        splitBtn.disabled = true;
        progressContainer.classList.remove('hidden');
        resultsPanel.classList.add('hidden');
        partsList.innerHTML = '';
        updateProgress(5);

        // Obter duração do vídeo no navegador
        const videoDuration = await getVideoDuration(selectedFile);
        
        // Calcular tempo estimado por segmento baseado na proporção do tamanho total
        const totalSize = selectedFile.size;
        const totalPartsEstimate = Math.ceil(totalSize / MAX_TARGET_BYTES);
        const segmentDuration = Math.floor(videoDuration / (totalSize / MAX_TARGET_BYTES));

        const ffmpeg = await getFFmpeg();
        const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')) || '.mp4';
        const baseName = selectedFile.name.replace(/\.[^/.]+$/, "");

        updateProgress(15);
        uploadStatus.textContent = 'A preparar o ficheiro na memória...';

        // Escreve o ficheiro na memória virtual do FFmpeg
        const fileData = new Uint8Array(await selectedFile.arrayBuffer());
        ffmpeg.FS('writeFile', `input${ext}`, fileData);

        const generatedParts = [];
        let startTime = 0;
        let partIndex = 1;

        while (startTime < videoDuration) {
            const outputFileName = `output_part${partIndex}${ext}`;
            uploadStatus.textContent = `A cortar Parte ${partIndex}...`;

            // Comando FFmpeg com '-c copy' para corte direto instantâneo sem perda de qualidade
            await ffmpeg.run(
                '-ss', startTime.toString(),
                '-i', `input${ext}`,
                '-t', segmentDuration.toString(),
                '-c', 'copy',
                outputFileName
            );

            // Lê o ficheiro resultante da memória virtual
            const data = ffmpeg.FS('readFile', outputFileName);
            const partName = `${baseName}_Parte${partIndex}${ext}`;

            generatedParts.push({
                name: partName,
                bytes: data.buffer
            });

            // Limpa o ficheiro da memória virtual
            ffmpeg.FS('unlink', outputFileName);

            startTime += segmentDuration;
            partIndex++;

            const progress = Math.min(Math.round((startTime / videoDuration) * 100), 95);
            updateProgress(progress);
        }

        // Limpa o ficheiro de entrada
        ffmpeg.FS('unlink', `input${ext}`);

        updateProgress(100);
        renderResults(generatedParts);
        uploadStatus.textContent = 'Processamento concluído!';
        splitBtn.disabled = false;

    } catch (err) {
        console.error('Erro ao dividir vídeo:', err);
        alert('Ocorreu um erro ao processar o vídeo. Verifique a compatibilidade do formato.');
        splitBtn.disabled = false;
    }
});

// Obtém a duração total do vídeo usando o elemento HTML5 Video
function getVideoDuration(file) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = URL.createObjectURL(file);

        video.onloadedmetadata = () => {
            URL.revokeObjectURL(video.src);
            resolve(video.duration);
        };

        video.onerror = (err) => reject(err);
    });
}

function renderResults(parts) {
    resultsPanel.classList.remove('hidden');
    partsList.innerHTML = '';

    parts.forEach(part => {
        const li = document.createElement('li');
        const blob = new Blob([part.bytes], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        li.innerHTML = `
            <div>
                <strong>${part.name}</strong>
                <span style="display: block; font-size: 0.75rem; color: var(--text-secondary);">
                    Tamanho: ${formatBytes(part.bytes.byteLength)}
                </span>
            </div>
            <a href="${url}" download="${part.name}" class="btn-download-part">Baixar</a>
        `;

        partsList.appendChild(li);
    });

    resultsPanel.scrollIntoView({ behavior: 'smooth' });
}

function updateProgress(percent) {
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${percent}%`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
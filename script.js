/**
 * Premium Pinterest Downloader - Frontend JS Engine
 * Handles URL validation, clip-actions (Paste/Clear/Copy), Loader triggering,
 * response media rendering, direct CORS-bypass downloads, and FAQ accordion.
 */

// CONFIGURATION: Add deployed worker URLs here to distribute requests.
const WORKER_API_ENDPOINTS = [
    'https://pindown.romitkryadav.workers.dev/',
     'https://pinload.romitkr3018.workers.dev/',
     'https://pinloa3.ronitkr9341.workers.dev/',
];
let workerCursor = 0;

function getNextWorkerEndpoint() {
    const endpoint = WORKER_API_ENDPOINTS[workerCursor % WORKER_API_ENDPOINTS.length];
    workerCursor += 1;
    return endpoint;
}

// Helper to construct proxy URLs dynamically based on environment
function getProxyUrl(targetUrl, inline = false, filename = '') {
    const isLocal = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' || 
                    window.location.hostname.includes('run.app');
    
    if (isLocal) {
        // Use the local development Express proxy
        let localUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
        if (inline) localUrl += '&inline=true';
        if (filename) localUrl += `&filename=${encodeURIComponent(filename)}`;
        return localUrl;
    } else {
        // Use the Cloudflare Worker proxy
        const baseWorker = getNextWorkerEndpoint().replace(/\/$/, '');
        let workerUrl = `${baseWorker}/api/proxy?url=${encodeURIComponent(targetUrl)}`;
        if (inline) workerUrl += '&inline=true';
        if (filename) workerUrl += `&filename=${encodeURIComponent(filename)}`;
        return workerUrl;
    }
}

function getWorkerProxyUrl(targetUrl, filename = '', inline = false, endpoint = getNextWorkerEndpoint()) {
    const baseWorker = endpoint.replace(/\/$/, '');
    let workerUrl = `${baseWorker}/api/proxy?url=${encodeURIComponent(targetUrl)}&filename=${encodeURIComponent(filename)}`;
    if (inline) workerUrl += '&inline=true';
    return workerUrl;
}

// Helper to get extraction API URL based on environment
function getApiEndpoint() {
    const isLocal = window.location.hostname === 'localhost' || 
                    window.location.hostname === '127.0.0.1' || 
                    window.location.hostname.includes('run.app');
    
    if (isLocal) {
        return '/api/download';
    } else {
        return getNextWorkerEndpoint();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const form = document.getElementById('downloader-form');
    const urlInput = document.getElementById('pinterest-url');
    const pasteBtn = document.getElementById('paste-btn');
    const clearBtn = document.getElementById('clear-btn');
    const spinner = document.getElementById('spinner');
    const progressBar = document.getElementById('progress-bar');
    const progressPercent = document.getElementById('progress-percent');
    const progressTrack = spinner.querySelector('.progress-track');
    const newDownloadBtn = document.getElementById('new-download-btn');
    const menuToggle = document.getElementById('menu-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    const resultsContainer = document.getElementById('results-container');
    const mediaPreview = document.getElementById('media-preview');
    const dlOptions = document.getElementById('dl-options');
    const faqItems = document.querySelectorAll('.faq-item');

    function setProgress(value) {
        const percent = Math.max(0, Math.min(100, Math.round(value)));
        progressBar.style.width = `${percent}%`;
        progressPercent.textContent = `${percent}%`;
        progressTrack.setAttribute('aria-valuenow', String(percent));
    }

    function animateProgress(startTime) {
        const elapsed = Date.now() - startTime;
        const percent = Math.min(96, (elapsed / 2000) * 96);
        setProgress(percent);
        return elapsed < 2000;
    }

    // 1. Toast Notification Helper
    function showToast(message, type = 'success') {
        const existingContainer = document.querySelector('.toast-container');
        if (existingContainer) existingContainer.remove();

        const toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';

        const toast = document.createElement('div');
        toast.className = 'toast';
        if (type === 'error') {
            toast.style.borderColor = '#f43f5e';
        }

        // SVG icon selection
        const checkIcon = `<svg style="stroke:#8b5cf6;" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        const errorIcon = `<svg style="stroke:#f43f5e;" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
        
        toast.innerHTML = `
            ${type === 'success' ? checkIcon : errorIcon}
            <span>${message}</span>
        `;
        
        toastContainer.appendChild(toast);
        document.body.appendChild(toastContainer);

        // Auto remove toast
        setTimeout(() => {
            toastContainer.style.opacity = '0';
            toastContainer.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toastContainer.remove(), 300);
        }, 3500);
    }

    // 2. URL Input Buttons Actions (Paste / Clear)
    pasteBtn.addEventListener('click', async () => {
        try {
            const clipboardText = await navigator.clipboard.readText();
            if (clipboardText) {
                urlInput.value = clipboardText;
                showToast('URL successfully pasted from clipboard!');
                toggleInputButtons();
            } else {
                showToast('Clipboard is empty!', 'error');
            }
        } catch (err) {
            showToast('Unable to read clipboard. Please paste manually.', 'error');
        }
    });

    clearBtn.addEventListener('click', () => {
        urlInput.value = '';
        toggleInputButtons();
        showToast('Form cleared.');
    });

    function toggleInputButtons() {
        if (urlInput.value.trim() === '') {
            pasteBtn.style.display = 'block';
            clearBtn.style.display = 'none';
        } else {
            pasteBtn.style.display = 'none';
            clearBtn.style.display = 'block';
        }
    }

    urlInput.addEventListener('input', toggleInputButtons);
    toggleInputButtons(); // Initial call

    menuToggle.addEventListener('click', () => {
        const isOpen = mobileMenu.classList.toggle('open');
        menuToggle.classList.toggle('active', isOpen);
        menuToggle.setAttribute('aria-expanded', String(isOpen));
        menuToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.remove('open');
            menuToggle.classList.remove('active');
            menuToggle.setAttribute('aria-expanded', 'false');
            menuToggle.setAttribute('aria-label', 'Open menu');
        });
    });

    newDownloadBtn.addEventListener('click', () => {
        form.style.display = 'flex';
        newDownloadBtn.style.display = 'none';
        resultsContainer.style.display = 'none';
        mediaPreview.innerHTML = '';
        dlOptions.innerHTML = '';
        urlInput.value = '';
        toggleInputButtons();
        urlInput.focus();
    });

    // 3. Form Submit / Media Extraction Processor
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pinUrl = urlInput.value.trim();

        // Regex validation
        const pinRegex = /https?:\/\/(?:[a-z]{2,3}\.)?pinterest\.(?:com|ca|cl|co|co\.uk|es|fr|it|ph|ru|at|ch|com\.au|com\.mx|de|ie|jp|pt|se)\/pin\/\d+|https?:\/\/pin\.it\/[a-zA-Z0-9]+/i;

        if (!pinUrl) {
            showToast('Please enter a Pinterest URL first!', 'error');
            return;
        }

        if (!pinRegex.test(pinUrl)) {
            showToast('Please insert a valid Pinterest URL (e.g., https://pin.it/... or www.pinterest.com/pin/... )', 'error');
            return;
        }

        // Reset views
        resultsContainer.style.display = 'none';
        spinner.style.display = 'flex';
        const loadingStartedAt = Date.now();
        setProgress(0);
        const progressTimer = setInterval(() => {
            if (!animateProgress(loadingStartedAt)) {
                clearInterval(progressTimer);
            }
        }, 40);
        form.querySelector('button[type="submit"]').disabled = true;

        try {
            let apiEndpoint = getApiEndpoint();
            let response;
            let responseText = "";
            let succeeded = false;

            // Only try GET on external production endpoint (Cloudflare Worker) to avoid Express/Vite router fallback to index.html
            const isRelativeEndpoint = apiEndpoint.startsWith('/');
            if (!isRelativeEndpoint) {
                try {
                    const separator = apiEndpoint.includes('?') ? '&' : '?';
                    const getUrl = `${apiEndpoint}${separator}url=${encodeURIComponent(pinUrl)}`;
                    response = await fetch(getUrl, {
                        method: 'GET'
                    });
                    const contentType = response.headers.get("content-type") || "";
                    responseText = await response.text();
                    if (response.ok && contentType.includes("application/json") && !responseText.trim().startsWith("<")) {
                        succeeded = true;
                    }
                } catch (getErr) {
                    console.warn("GET request failed, trying POST fallback...", getErr);
                }
            }

            if (!succeeded) {
                // Try POST Fallback (used natively on local backend and as fallback for worker)
                try {
                    response = await fetch(apiEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ url: pinUrl }),
                    });
                    const contentType = response.headers.get("content-type") || "";
                    responseText = await response.text();

                    let isJsonObj = false;
                    let parsedJson = null;
                    try {
                        parsedJson = JSON.parse(responseText);
                        isJsonObj = true;
                    } catch (e) {}

                    const isHtmlText = responseText.trim().startsWith("<") || contentType.includes("text/html");
                    const isErrorState = !response.ok || (isJsonObj && parsedJson && parsedJson.success === false);

                    // If we got an HTML response or any error state, and we were hitting the relative endpoint,
                    // we must fall back to the external Cloudflare Worker!
                    if (isRelativeEndpoint && (isHtmlText || isErrorState)) {
                        console.warn("Local backend returned HTML, error status, or failure. Falling back to Cloudflare Worker...");
                        apiEndpoint = getNextWorkerEndpoint();
                        succeeded = false;
                    } else {
                        succeeded = true;
                    }
                } catch (postErr) {
                    console.warn("POST to primary endpoint failed:", postErr);
                    if (isRelativeEndpoint) {
                        console.warn("Falling back to Cloudflare Worker...");
                        apiEndpoint = getNextWorkerEndpoint();
                        succeeded = false;
                    } else {
                        throw postErr;
                    }
                }
            }

            // Fallback: If we were aiming local relative API but it returned HTML or failed, try Worker instead!
            if (isRelativeEndpoint && !succeeded && !apiEndpoint.startsWith('/')) {
                // Try Worker via GET first (CORS friendly)
                try {
                    const separator = apiEndpoint.includes('?') ? '&' : '?';
                    const getUrl = `${apiEndpoint}${separator}url=${encodeURIComponent(pinUrl)}`;
                    response = await fetch(getUrl, {
                        method: 'GET'
                    });
                    const contentType = response.headers.get("content-type") || "";
                    responseText = await response.text();
                    if (response.ok && contentType.includes("application/json") && !responseText.trim().startsWith("<")) {
                        succeeded = true;
                    }
                } catch (workerGetErr) {
                    console.warn("Worker GET fallback failed, trying Worker POST...", workerGetErr);
                }

                if (!succeeded) {
                    // Try Worker via POST
                    response = await fetch(apiEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ url: pinUrl }),
                    });
                    responseText = await response.text();
                    succeeded = true;
                }
            }

            if (!responseText) {
                throw new Error("Received an empty response from the extraction server.");
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (jsonErr) {
                console.error("Non-JSON response received:", responseText);
                if (responseText.toLowerCase().includes("<html")) {
                    throw new Error("The API endpoint returned an HTML error page. Please ensure at least one configured Cloudflare Worker is deployed: " + WORKER_API_ENDPOINTS.join(', '));
                } else {
                    throw new Error("Unable to parse API response. Worker output: " + responseText.substring(0, 150));
                }
            }

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Media extraction failed. Please make sure the Pin is public.');
            }

            const remainingTime = Math.max(0, 2000 - (Date.now() - loadingStartedAt));
            await new Promise(resolve => setTimeout(resolve, remainingTime));
            clearInterval(progressTimer);
            setProgress(100);
            const mediaWorkerEndpoint = apiEndpoint.startsWith('/') ? getNextWorkerEndpoint() : apiEndpoint;
            renderResults(data, mediaWorkerEndpoint);
            form.style.display = 'none';
            newDownloadBtn.style.display = 'block';
            showToast('Media successfully fetched!');
        } catch (error) {
            console.error(error);
            showToast(error.message, 'error');
        } finally {
            clearInterval(progressTimer);
            spinner.style.display = 'none';
            form.querySelector('button[type="submit"]').disabled = false;
        }
    });

    // 4. Render Pinterest Media Results
    function showPreviewError(container) {
        const el = createPreviewError();
        container.appendChild(el);
    }

    function createPreviewError() {
        const el = document.createElement('div');
        el.style.cssText = [
            'display:flex', 'flex-direction:column', 'align-items:center',
            'justify-content:center', 'gap:10px', 'padding:28px 20px',
            'color:#666', 'font-size:0.88rem', 'text-align:center',
            'border:1px dashed #2b2b2b', 'border-radius:14px'
        ].join(';');
        el.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#444"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>Preview unavailable — use the Download button below.</span>
        `;
        return el;
    }

    function renderResults(data, mediaWorkerEndpoint) {
        // Clear old results
        mediaPreview.innerHTML = '';
        dlOptions.innerHTML = '';

        // Find primary media type (prefer video, then gif, then first)
        const mediaItems = Array.isArray(data.media) ? data.media : [];
        if (mediaItems.length === 0) {
            throw new Error('No downloadable media found for this Pin.');
        }
        const primaryMedia = mediaItems.find(m => m.type === 'video' || m.type === 'gif') || mediaItems[0];

        const sanitizedTitle = (data.title || 'pinterest_download')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .substring(0, 30);

        // Preview Element Creation
        if (primaryMedia.type === 'video') {
            const videoEl = document.createElement('video');
            videoEl.controls = true;
            videoEl.autoplay = true;
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.preload = 'metadata';
            if (data.thumbnail) videoEl.poster = data.thumbnail;
            mediaPreview.appendChild(videoEl);

            // Try loading video: direct URL first, then proxy, then show error
            async function loadVideo() {
                const attempts = [
                    primaryMedia.url,
                    getWorkerProxyUrl(primaryMedia.url, 'preview', true, mediaWorkerEndpoint)
                ];
                for (const src of attempts) {
                    try {
                        const res = await fetch(src, { method: 'HEAD' });
                        const ct = res.headers.get('content-type') || '';
                        if (res.ok && (ct.includes('video') || ct.includes('octet-stream') || ct.includes('mp4'))) {
                            videoEl.src = src;
                            return;
                        }
                    } catch (_) { /* try next */ }
                    // HEAD might be blocked — just try setting src and see
                    videoEl.src = src;
                    const loaded = await new Promise(resolve => {
                        videoEl.onloadedmetadata = () => resolve(true);
                        videoEl.onerror = () => resolve(false);
                        setTimeout(() => resolve(false), 8000);
                    });
                    videoEl.onloadedmetadata = null;
                    videoEl.onerror = null;
                    if (loaded) return;
                }
                // All attempts failed — show message
                videoEl.remove();
                showPreviewError(mediaPreview);
            }
            loadVideo();

        } else {
            // Use fetch+blob to validate the image before showing it
            // This prevents the browser ever rendering a broken/fake image
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:120px;color:#555;font-size:0.85rem;';
            placeholder.textContent = 'Loading preview…';
            mediaPreview.appendChild(placeholder);

            async function loadImage() {
                const attempts = [
                    primaryMedia.url,
                    getWorkerProxyUrl(primaryMedia.url, 'preview', true, mediaWorkerEndpoint)
                ];
                for (const src of attempts) {
                    try {
                        const res = await fetch(src);
                        const ct = res.headers.get('content-type') || '';
                        if (res.ok && ct.startsWith('image/')) {
                            const blob = await res.blob();
                            const objectUrl = URL.createObjectURL(blob);
                            const imgEl = document.createElement('img');
                            imgEl.src = objectUrl;
                            imgEl.alt = data.title || 'Pinterest Image';
                            imgEl.style.cssText = 'max-width:100%;display:block;border-radius:12px;';
                            imgEl.onload = () => URL.revokeObjectURL(objectUrl);
                            placeholder.replaceWith(imgEl);
                            return;
                        }
                    } catch (_) { /* try next */ }
                }
                // All attempts failed
                placeholder.replaceWith(createPreviewError());
            }
            loadImage();
        }

        // A video preview should only offer video downloads; image previews keep image options.
        const downloadableMedia = primaryMedia.type === 'video'
            ? mediaItems.filter(item => item.type === 'video')
            : mediaItems;

        // Download Links Grid Creation
        downloadableMedia.forEach((item, index) => {
            const row = document.createElement('div');
            row.className = 'dl-card';

            const meta = document.createElement('div');
            meta.className = 'dl-meta';
            
            const formatTitle = document.createElement('div');
            formatTitle.className = 'dl-format';
            formatTitle.textContent = `${item.type.toUpperCase()} Option #${index + 1}`;

            const qualityText = document.createElement('div');
            qualityText.className = 'dl-quality';
            qualityText.textContent = item.quality || 'Super HD Source';

            meta.appendChild(formatTitle);
            meta.appendChild(qualityText);

            const actions = document.createElement('div');
            actions.className = 'dl-action-row';

            // Link copy action button
            const copyUrlBtn = document.createElement('button');
            copyUrlBtn.className = 'btn-secondary';
            copyUrlBtn.innerHTML = 'Copy URL';
            copyUrlBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(item.url);
                showToast('Direct URL copied to clipboard!');
            });

            // Direct download button for the media URL returned by Pinterest.
            const safeDownloadLink = document.createElement('a');
            safeDownloadLink.className = 'btn-action';

            safeDownloadLink.href = getWorkerProxyUrl(item.url, sanitizedTitle, false, mediaWorkerEndpoint);
            safeDownloadLink.download = `${sanitizedTitle}.${item.type === 'video' ? 'mp4' : item.type === 'gif' ? 'gif' : 'jpg'}`;
            safeDownloadLink.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download
            `;

            safeDownloadLink.addEventListener('click', () => {
                showToast('Download started!');
            });
            
            actions.appendChild(copyUrlBtn);
            actions.appendChild(safeDownloadLink);

            row.appendChild(meta);
            row.appendChild(actions);

            dlOptions.appendChild(row);
        });

        // Display container and scroll smoothly
        resultsContainer.style.display = 'block';
        resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // 5. Accordion FAQ Animation
    faqItems.forEach(item => {
        const trigger = item.querySelector('.faq-trigger');
        const content = item.querySelector('.faq-content');

        trigger.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all other FAQs first
            faqItems.forEach(ot => {
                ot.classList.remove('active');
                ot.querySelector('.faq-content').style.maxHeight = '0px';
            });

            if (!isActive) {
                item.classList.add('active');
                content.style.maxHeight = content.scrollHeight + 'px';
            } else {
                item.classList.remove('active');
                content.style.maxHeight = '0px';
            }
        });
    });
});

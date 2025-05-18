import { initDB, addScreenshot } from './idb-helper.js'; // Assuming idb-helper.js exports these, or adjust as needed

const toggleCaptureButton = document.getElementById('toggleCapture');
const openOptionsButton = document.getElementById('openOptions');
const screenshotsListDiv = document.getElementById('screenshotsList');
const itemTemplate = document.getElementById('screenshotItemTemplate');
const emptyMessageP = screenshotsListDiv.querySelector('.empty-message');

// Modal elements
const modal = document.getElementById('modal');
const modalImage = document.getElementById('fullScreenshotImage');
const modalCaption = document.getElementById('caption');
const closeModalButton = modal.querySelector('.close-button');

const storageUsedSpan = document.getElementById('storageUsed');
const storageQuotaSpan = document.getElementById('storageQuota');

const createTutorialButton = document.getElementById('createTutorialButton');

// Initialize diagnostic button
// const diagnoseButton = document.getElementById('diagnoseButton'); // REMOVE or COMMENT OUT

// --- Helper Functions ---
function formatTimestamp(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toLocaleString(); // Adjust format as needed
}

function truncateText(text, maxLength = 50) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

// --- IndexedDB Functions (Directly in popup for now, or use a shared module/messaging) ---
let db;
async function getDb() {
  if (db) return db;
  db = await initDB(); // Ensure initDB is available and works standalone
  return db;
}

async function getRecentScreenshots(limit = 10) {
  const currentDb = await getDb();
  return new Promise((resolve, reject) => {
    if (!currentDb) {
        reject("Database not available");
        return;
    }
    const transaction = currentDb.transaction(['screenshots'], 'readonly');
    const store = transaction.objectStore('screenshots');
    const index = store.index('timestamp'); // Assuming 'timestamp' index exists
    const request = index.getAll(null, limit); // Gets all, then we slice. Better: use cursor with IDBKeyRange and sort direction.
    // Or, if using auto-incrementing ID as primary key and wanting latest by ID:
    // const request = store.openCursor(null, 'prev');
    // For now, getAll and sort/slice is simpler for small N

    request.onsuccess = () => {
      // Sort by timestamp descending to get the most recent
      const sortedResults = request.result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      resolve(sortedResults.slice(0, limit));
    };
    request.onerror = (event) => {
      console.error('Error fetching recent screenshots:', event.target.error);
      reject(event.target.error);
    };
  });
}

async function deleteScreenshot(id) {
    const currentDb = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = currentDb.transaction(['screenshots'], 'readwrite');
        const store = transaction.objectStore('screenshots');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
    });
}

async function getScreenshotBlob(id) {
    const currentDb = await getDb();
    return new Promise((resolve, reject) => {
        const transaction = currentDb.transaction(['screenshots'], 'readonly');
        const store = transaction.objectStore('screenshots');
        const request = store.get(id);
        request.onsuccess = () => {
            if (request.result && request.result.imageData instanceof Blob) {
                resolve(request.result.imageData);
            } else {
                reject('Image data not found or not a Blob.');
            }
        };
        request.onerror = (event) => reject(event.target.error);
    });
}


// --- UI Rendering ---
async function displayScreenshots() {
  try {
    const screenshots = await getRecentScreenshots(10);
    screenshotsListDiv.innerHTML = ''; // Clear existing

    if (screenshots && screenshots.length > 0) {
      if(emptyMessageP) emptyMessageP.style.display = 'none';
      screenshots.forEach(renderScreenshotItem);
    } else {
      if(emptyMessageP) {
        emptyMessageP.textContent = 'No screenshots captured yet.';
        emptyMessageP.style.display = 'block';
        screenshotsListDiv.appendChild(emptyMessageP);
      }
    }
  } catch (error) {
    console.error('Failed to display screenshots:', error);
    if(emptyMessageP) {
        emptyMessageP.textContent = 'Error loading screenshots.';
        emptyMessageP.style.display = 'block';
        screenshotsListDiv.appendChild(emptyMessageP);
    }
  }
}

function renderScreenshotItem(item) {
  const templateClone = itemTemplate.content.cloneNode(true);
  const screenshotDiv = templateClone.querySelector('.screenshot-item');
  const thumb = templateClone.querySelector('.thumbnail');
  const titleP = templateClone.querySelector('.title');
  const urlP = templateClone.querySelector('.url');
  const timestampP = templateClone.querySelector('.timestamp');
  const clickTargetP = templateClone.querySelector('.click-target');
  const viewButton = templateClone.querySelector('.view-full');
  const deleteButton = templateClone.querySelector('.delete-item');

  // Use thumbnailDataUrl if available, otherwise try to create from imageData (less ideal for popup)
  console.log('Rendering item ID:', item.id, 'Has thumbnail:', !!item.thumbnailDataUrl);
  if (item.thumbnailDataUrl) {
    console.log('Thumbnail data URL length:', item.thumbnailDataUrl.length);
    console.log('Thumbnail data URL starts with:', item.thumbnailDataUrl.substring(0, 30) + '...');
  }
  
  thumb.onerror = () => {
    console.error('Error loading thumbnail for ID:', item.id);
    thumb.src = '../icons/icon48.png'; // Fallback icon on error
  };
  
  thumb.src = item.thumbnailDataUrl || '../icons/icon48.png'; // Fallback icon
  thumb.alt = item.pageTitle || 'Screenshot thumbnail';
  
  // Add a class to highlight newly added items
  screenshotDiv.classList.add('new-item');
  setTimeout(() => screenshotDiv.classList.remove('new-item'), 2000);
  
  titleP.textContent = truncateText(item.pageTitle || 'No Title', 30);
  titleP.title = item.pageTitle || 'No Title';
  urlP.textContent = truncateText(item.pageUrl, 40);
  urlP.title = item.pageUrl;
  timestampP.textContent = formatTimestamp(item.timestamp);
  clickTargetP.textContent = `Clicked: ${truncateText(item.targetElementInfo?.selector, 30)}`;
  clickTargetP.title = item.targetElementInfo?.selector || 'N/A';

  screenshotDiv.dataset.id = item.id;

  viewButton.addEventListener('click', async () => {
    try {
      const blob = await getScreenshotBlob(item.id);
      modalImage.src = URL.createObjectURL(blob);
      modalCaption.textContent = `${item.pageTitle || 'Screenshot'} (${formatTimestamp(item.timestamp)})`;
      modal.style.display = 'block';
    } catch (e) {
      console.error("Could not load full image:", e);
      alert("Could not load full image.");
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete this screenshot?')) {
      try {
        await deleteScreenshot(item.id);
        displayScreenshots(); // Refresh list
      } catch (e) {
        console.error("Could not delete screenshot:", e);
        alert("Error deleting screenshot.");
      }
    }
  });

  screenshotsListDiv.appendChild(templateClone);
}

// --- Event Handlers & Initialization ---
function updateToggleButton(enabled) {
  if (enabled) {
    toggleCaptureButton.textContent = 'Stop Capturing';
    toggleCaptureButton.title = 'Click to Stop Screenshot Capture';
    toggleCaptureButton.classList.remove('paused');
    toggleCaptureButton.classList.add('active');
    if (createTutorialButton) createTutorialButton.style.display = 'none'; // Hide when capturing
  } else {
    toggleCaptureButton.textContent = 'Start Capturing';
    toggleCaptureButton.title = 'Click to Start Screenshot Capture';
    toggleCaptureButton.classList.remove('active');
    toggleCaptureButton.classList.add('paused');
    // Basic visibility: show if not capturing. Refine later with screenshot count.
    if (createTutorialButton) {
        // For now, just show it if not capturing. Later, add check for unassigned screenshots > 0
        console.log("[Popup] Capturing is OFF. Displaying 'Create Tutorial' button (pending step count check).");
        createTutorialButton.style.display = 'inline-block'; 
    }
  }
}

toggleCaptureButton.addEventListener('click', () => {
  console.log('[Popup] Toggle capture button clicked.');
  chrome.storage.local.get('captureEnabled', (data) => {
    if (chrome.runtime.lastError) {
      console.error('[Popup] Error getting captureEnabled setting:', chrome.runtime.lastError.message);
      return;
    }
    
    const currentStatus = data.captureEnabled !== undefined ? data.captureEnabled : false;
    const newStatus = !currentStatus;
    console.log(`[Popup] Changing captureEnabled from ${currentStatus} to ${newStatus}`);
    
    chrome.storage.local.set({ captureEnabled: newStatus }, () => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] Error setting captureEnabled:', chrome.runtime.lastError.message);
        return;
      }
      updateToggleButton(newStatus);
      console.log(`[Popup] Capture ${newStatus ? 'started' : 'stopped'}. Notifying content scripts.`);
      
      // Notify active tab's content script to refresh its settings
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (chrome.runtime.lastError) {
          console.error("[Popup] Error querying tabs:", chrome.runtime.lastError.message);
          return;
        }
        if (tabs && tabs.length > 0 && tabs[0].id) {
          const activeTabId = tabs[0].id;
          console.log('[Popup] Sending REFRESH_SETTINGS to tabId:', activeTabId);
          chrome.tabs.sendMessage(activeTabId, { type: 'REFRESH_SETTINGS' })
            .then(response => {
              console.log('[Popup] REFRESH_SETTINGS response from content script:', response);
            })
            .catch(error => {
              // It's common for this to fail if the content script isn't injected on the page (e.g., chrome:// pages)
              console.warn('[Popup] Could not send REFRESH_SETTINGS to tabId:', activeTabId, 'Error:', error.message, '(This is often normal for pages like chrome://extensions)');
            });
        } else {
          console.warn('[Popup] No active tab found or tab has no ID to send REFRESH_SETTINGS.');
        }
      });
    });
  });
});

openOptionsButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Modal close functionality
closeModalButton.onclick = function() {
  modal.style.display = "none";
  URL.revokeObjectURL(modalImage.src); // Clean up blob URL
}
window.onclick = function(event) {
  if (event.target == modal) {
    modal.style.display = "none";
    URL.revokeObjectURL(modalImage.src); // Clean up blob URL
  }
}

async function displayStorageInfo() {
    try {
        const { storageQuotaMB } = await chrome.storage.local.get('storageQuotaMB');
        const quotaToShow = storageQuotaMB || 100; // Default if not set
        storageQuotaSpan.textContent = `${quotaToShow} MB`;

        const idbHelper = await import('../js/idb-helper.js');
        const totalBytesUsed = await idbHelper.getTotalStorageUsed();
        const totalMbUsed = (totalBytesUsed / (1024 * 1024)).toFixed(2);
        storageUsedSpan.textContent = `${totalMbUsed} MB`;

    } catch (error) {
        console.error("Error displaying storage info:", error);
        storageUsedSpan.textContent = "Error";
        storageQuotaSpan.textContent = "Error";
    }
}

// Initial load
async function initPopup() {
  // Load initial toggle button state
  chrome.storage.local.get('captureEnabled', (data) => {
    if (chrome.runtime.lastError) {
        console.error("[Popup] Error getting captureEnabled in initPopup:", chrome.runtime.lastError.message);
        updateToggleButton(false); // Default to false if error
        return;
    }
    updateToggleButton(data.captureEnabled !== undefined ? data.captureEnabled : false);
  });

  // Listen for storage changes to update button dynamically
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.captureEnabled !== undefined) {
      updateToggleButton(changes.captureEnabled.newValue);
    }
    if (namespace === 'local' && (changes.storageQuotaMB || changes.retentionDays)) {
        displayStorageInfo();
    }
  });

  await displayScreenshots();
  await displayStorageInfo(); 
}

document.addEventListener('DOMContentLoaded', initPopup);

// Listen for STORAGE_UPDATED message from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'STORAGE_UPDATED') {
    console.log('[Popup] Received STORAGE_UPDATED, refreshing screenshots and storage info.');
    displayScreenshots();
    displayStorageInfo();
  }
  // Return false or true based on whether you intend to send an async response from this listener
  return false; 
});

// Initialize diagnostic button
/*
if (diagnoseButton) {
  diagnoseButton.addEventListener('click', async () => {
    console.log('Running thumbnail diagnostic...');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_THUMBNAIL' });
      console.log('Diagnostic result:', response);
      alert(JSON.stringify(response, null, 2));
    } catch (e) {
      console.error('Diagnostic error:', e);
      alert('Diagnostic failed: ' + e.message);
    }
  });
}
*/

// Add event listener for createTutorialButton - for now, just a log and alert
if (createTutorialButton) {
  createTutorialButton.addEventListener('click', () => {
    console.log('[Popup] Create Tutorial button clicked.');
    alert('Create Tutorial functionality coming in Phase 2! This will gather unassigned screenshots.');
    // Placeholder: In Phase 2, this will prompt for title and then redirect:
    // chrome.tabs.create({ url: 'html/tutorials.html' }); 
  });
}

console.log('Popup script loaded.'); 
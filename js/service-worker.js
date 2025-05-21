// Default settings
const defaultSettings = {
  captureEnabled: false,
  captureScope: { type: 'all', domains: [] },
  debounceMs: 500,
  screenshotFormat: 'png',
  jpegQuality: 90,
  storageQuotaMB: 100,
  retentionDays: 7,
  remoteSync: { enabled: false, apiUrl: '', authToken: '' }
};

// Alarm names
const ALARM_CLEANUP = 'cleanupStorage';

// Import IndexedDB helper functions
import {
  initDB,
  addScreenshot,
  getScreenshotsOlderThan,
  deleteScreenshots,
  getTotalStorageUsed,
  getOldestScreenshots
} from './idb-helper.js';

const OFFSCREEN_DOCUMENT_PATH = 'html/offscreen.html';

async function dataURLtoBlob(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return blob;
}

// Function to check if an offscreen document is active
async function hasOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) { // Check if the API exists
    try {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        console.log('hasOffscreenDocument: chrome.offscreen.hasDocument() returned true.');
      } else {
        console.log('hasOffscreenDocument: chrome.offscreen.hasDocument() returned false.');
      }
      return hasDoc;
    } catch (e) {
        console.error("Error calling chrome.offscreen.hasDocument():", e, "Falling back to clients.matchAll()");
        // Fallback or log error, then attempt clients.matchAll()
    }
  }
  
  // Fallback to clients.matchAll() if chrome.offscreen.hasDocument is not available or errored
  console.log('hasOffscreenDocument: Using clients.matchAll() as fallback or primary.');
  const matchedClients = await clients.matchAll({ includeUncontrolled: true, type: 'window' }); // Added options
  for (const client of matchedClients) {
    if (client.url && client.url.endsWith(OFFSCREEN_DOCUMENT_PATH)) {
      console.log('hasOffscreenDocument: Found matching client via clients.matchAll()');
      return true;
    }
  }
  console.log('hasOffscreenDocument: No matching client found via clients.matchAll()');
  return false;
}

// Function to create the offscreen document if it doesn't exist
async function ensureOffscreenDocument() {
  // console.log('chrome.offscreen.Reason object:', JSON.stringify(chrome.offscreen.Reason, null, 2)); // Can be removed if Reason issue is resolved

  if (await hasOffscreenDocument()) {
    console.log('Offscreen document already exists. Not creating a new one.');
    return;
  }
  console.log('No existing offscreen document found (or hasDocument check failed), attempting to create...');
  
  const offscreenReasons = ['BLOBS'];
  // console.log('Using reasons for offscreen document:', offscreenReasons); // Can be removed

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: offscreenReasons,
      justification: 'Thumbnail generation for screenshots',
    });
    console.log('Offscreen document created successfully via createDocument().');
  } catch (error) {
    console.error('Error during chrome.offscreen.createDocument call:', error.message);
    // No need to log arguments again if error.message is clear, but keep if needed for debugging.
    // console.error('Arguments passed to createDocument:', { /* ... */ }); 
    throw error; 
  }
}

// Call ensureOffscreenDocument on service worker startup
// Wrap in a try-catch to see if ensureOffscreenDocument itself throws an error that we are missing
(async () => {
    try {
        console.log("Attempting to ensure offscreen document on startup...");
        await ensureOffscreenDocument();
        console.log("Successfully ensured offscreen document on startup.");
    } catch (err) {
        console.error("Top-level error ensuring offscreen document on startup:", err);
    }
})();

chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed or updated:', details);

  // Set default settings on first install
  chrome.storage.local.get(Object.keys(defaultSettings), (storedSettings) => {
    const newSettings = {};
    let settingsChanged = false;
    for (const key in defaultSettings) {
      if (storedSettings[key] === undefined) {
        newSettings[key] = defaultSettings[key];
        settingsChanged = true;
      }
    }
    if (settingsChanged) {
      chrome.storage.local.set(newSettings, () => {
        console.log('Default settings saved.');
      });
    }
  });

  // Create cleanup alarm (runs daily, starts 5 mins after install/update)
  chrome.alarms.create(ALARM_CLEANUP, {
    delayInMinutes: 5,
    periodInMinutes: 24 * 60 // 24 hours
  });
  console.log('Cleanup alarm created.');

  // Placeholder for IndexedDB initialization if needed on install/update
  initDB().then(() => {
    console.log('Database initialized via onInstalled event.');
  }).catch(err => {
    console.error('Failed to initialize database from onInstalled:', err);
  });
});

async function performCleanup() {
  console.log('Performing daily cleanup...');
  try {
    const settings = await chrome.storage.local.get(['retentionDays', 'storageQuotaMB']);
    const retentionDays = settings.retentionDays || 7;
    const storageQuotaMB = settings.storageQuotaMB || 100;

    // 1. Delete by retention policy
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const oldScreenshots = await getScreenshotsOlderThan(cutoffDate.toISOString());
    if (oldScreenshots.length > 0) {
      const idsToDelete = oldScreenshots.map(s => s.id);
      await deleteScreenshots(idsToDelete);
      console.log(`Cleanup: Deleted ${idsToDelete.length} screenshots older than ${retentionDays} days.`);
      chrome.runtime.sendMessage({ type: 'STORAGE_UPDATED' }).catch(e => console.debug("Error sending STORAGE_UPDATED message after retention cleanup, popup likely closed:", e));
    } else {
      console.log(`Cleanup: No screenshots found older than ${retentionDays} days.`);
    }

    // 2. Enforce storage quota (this is also done before each save, but good to have a periodic check)
    await enforceStorageQuota(0, storageQuotaMB); // 0 for new image size, just check current total

  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

// Modify alarm listener to call performCleanup
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_CLEANUP) {
    console.log('Cleanup alarm triggered:', new Date());
    await performCleanup();
  }
});

async function enforceStorageQuota(newImageSizeInBytes, storageQuotaMB) {
  if (!storageQuotaMB || storageQuotaMB <= 0) return true; // No quota or invalid quota

  const maxSizeBytes = storageQuotaMB * 1024 * 1024;
  let currentTotalSize = await getTotalStorageUsed();
  console.log(`Storage: Current size = ${(currentTotalSize / 1024 / 1024).toFixed(2)}MB, New image = ${(newImageSizeInBytes / 1024 / 1024).toFixed(2)}MB, Quota = ${storageQuotaMB}MB`);

  // Check if the new image ALONE exceeds the quota
  if (newImageSizeInBytes > maxSizeBytes) {
      console.warn(`New screenshot (${(newImageSizeInBytes / 1024 / 1024).toFixed(2)}MB) exceeds total quota (${storageQuotaMB}MB). Cannot save.`);
      return false; // Cannot save this image
  }

  let madeDeletions = false;
  while ((currentTotalSize + newImageSizeInBytes) > maxSizeBytes) {
    console.log(`Storage: Exceeds quota. Current: ${currentTotalSize}, New: ${newImageSizeInBytes}. Need to free space.`);
    const oldestItems = await getOldestScreenshots(1);
    if (oldestItems.length > 0) {
      const itemToDelete = oldestItems[0];
      console.log(`Storage: Deleting oldest item ID ${itemToDelete.id} (size: ${itemToDelete.imageSizeBytes || 0} bytes) to free space.`);
      await deleteScreenshots([itemToDelete.id]);
      currentTotalSize -= (itemToDelete.imageSizeBytes || 0);
      if (currentTotalSize < 0) currentTotalSize = 0; // Safety check
      console.log(`Storage: New total size after deletion: ${(currentTotalSize / 1024 / 1024).toFixed(2)}MB`);
      madeDeletions = true;
    } else {
      console.warn('Storage: Quota exceeded, but no more items to delete. Cannot save new screenshot.');
      return false; // Cannot free enough space
    }
  }
  if (madeDeletions) {
    chrome.runtime.sendMessage({ type: 'STORAGE_UPDATED' }).catch(e => console.debug("Error sending STORAGE_UPDATED after quota enforcement, popup likely closed:", e));
  }
  return true; // Enough space or space freed
}

// New function to get thumbnail using chrome.runtime.connect()
async function getThumbnailFromOffscreen(dataUrl, requestId) {
  console.log(`[SW/getThumbnailFromOffscreen] Called for requestId: ${requestId}`);
  try {
    await ensureOffscreenDocument(); // Ensure it's still there
    console.log("[SW/getThumbnailFromOffscreen] Offscreen document ensured. Attempting to connect to port.");

    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: 'offscreen-thumbnail-port' });
      let communicationTimeout;

      const onPortMessage = (message) => {
        // console.log(`[SW/getThumbnailFromOffscreen] Message received on port for ${requestId}:`, message);
        if (message.originalRequestId === requestId) {
          clearTimeout(communicationTimeout);
          port.onMessage.removeListener(onPortMessage);
          port.disconnect(); // Clean up the port

          if (message.success) {
            console.log(`[SW/getThumbnailFromOffscreen] Thumbnail gen SUCCEEDED via port for ${requestId}`);
            resolve(message.thumbnailDataUrl);
          } else {
            console.error(`[SW/getThumbnailFromOffscreen] Thumbnail gen FAILED via port for ${requestId}:`, message.error);
            reject(new Error(message.error || 'Unknown error from offscreen document'));
          }
        }
      };

      port.onMessage.addListener(onPortMessage);

      port.onDisconnect.addListener(() => {
        console.log(`[SW/getThumbnailFromOffscreen] Port disconnected for ${requestId}.`);
        clearTimeout(communicationTimeout);
        // If the promise hasn't been resolved or rejected yet, it means an unexpected disconnect.
        // It might have been resolved/rejected by onPortMessage already if disconnect is graceful.
        // To avoid issues with `reject` being called multiple times, check promise state or use a flag.
        // For now, we assume onPortMessage handles success/failure before a typical disconnect.
        // If it's an abrupt disconnect (e.g., offscreen crashed), the timeout should catch it.
      });
      
      // Set a timeout for the entire communication sequence
      communicationTimeout = setTimeout(() => {
        console.error(`[SW/getThumbnailFromOffscreen] TIMEOUT for requestId: ${requestId} (port communication)`);
        port.onMessage.removeListener(onPortMessage);
        port.disconnect();
        reject(new Error(`Timeout waiting for thumbnail response via port for requestId: ${requestId}`));
      }, 15000); // Increased timeout to 15 seconds for port comms

      console.log(`[SW/getThumbnailFromOffscreen] Port connected. Sending GENERATE_THUMBNAIL to offscreen for ${requestId}`);
      try {
        port.postMessage({
          type: 'GENERATE_THUMBNAIL',
          dataUrl: dataUrl,
          requestId: requestId,
          // Optional: specify thumbnail parameters if needed, or let offscreen use defaults
          // thumbnailWidth: 200, 
          // thumbnailFormat: 'image/jpeg',
          // thumbnailQuality: 0.7
        });
      } catch (error) {
        clearTimeout(communicationTimeout);
        port.onMessage.removeListener(onPortMessage);
        port.disconnect();
        console.error('[SW/getThumbnailFromOffscreen] Error POSTING message to offscreen port:', error);
        reject(error);
      }
    });
  } catch (error) {
    console.error("[SW/getThumbnailFromOffscreen] Overall error for requestId:", requestId, error);
    throw error; // Re-throw to be caught by caller
  }
}

// Debounce map
const debouncedCaptures = new Map();

async function handleCaptureAndStore(tab, clickData) {
  console.log("[SW/handleCaptureAndStore] CALLED. Tab ID:", tab.id, "Tab URL:", tab.url, "ClickData:", clickData);

  const { debounceMs } = await chrome.storage.local.get('debounceMs');
  const effectiveDebounceMs = debounceMs || 500;
  console.log("[SW/handleCaptureAndStore] Effective debounceMs:", effectiveDebounceMs);

  if (debouncedCaptures.has(tab.id)) {
    console.log(`[SW/handleCaptureAndStore] Debouncing capture for tabId: ${tab.id}. Clearing existing timeout.`);
    clearTimeout(debouncedCaptures.get(tab.id));
  }

  debouncedCaptures.set(tab.id, setTimeout(async () => {
    debouncedCaptures.delete(tab.id);
    console.log(`[SW/handleCaptureAndStore] Debounce ended for tabId: ${tab.id}. Proceeding with capture.`);

    try {
      console.log("[SW/handleCaptureAndStore] Getting screenshot settings (format, quality, quota)...");
      const { screenshotFormat, jpegQuality, storageQuotaMB } = await chrome.storage.local.get([
        'screenshotFormat',
        'jpegQuality',
        'storageQuotaMB'
      ]);
      console.log("[SW/handleCaptureAndStore] Settings retrieved: format:", screenshotFormat, "jpegQuality:", jpegQuality, "storageQuotaMB:", storageQuotaMB);

      const format = screenshotFormat || 'png';
      const quality = format === 'jpeg' ? (jpegQuality || 90) : undefined;
      console.log(`[SW/handleCaptureAndStore] Using format: ${format}, quality: ${quality}`);
      
      console.log(`[SW/handleCaptureAndStore] Attempting chrome.tabs.captureVisibleTab for tabId: ${tab.id}`);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format, quality });
      
      if (!dataUrl) {
        console.error("[SW/handleCaptureAndStore] captureVisibleTab returned EMPTY dataUrl for tabId:", tab.id);
        throw new Error('Capture failed, no data returned from captureVisibleTab.');
      }
      console.log(`[SW/handleCaptureAndStore] captureVisibleTab SUCCEEDED for tabId: ${tab.id}. Data URL length: ${dataUrl.length}`);
      
      const imageBlob = await dataURLtoBlob(dataUrl);
      const imageSizeBytes = imageBlob.size;
      const imageType = imageBlob.type;

      console.log(`[SW/handleCaptureAndStore] Converted to Blob. Size: ${imageSizeBytes} bytes, Type: ${imageType}. Checking storage quota...`);
      if (!await enforceStorageQuota(imageSizeBytes, storageQuotaMB || defaultSettings.storageQuotaMB)) {
        console.warn("[SW/handleCaptureAndStore] Not enough storage after attempting cleanup. Screenshot NOT SAVED for tabId:", tab.id);
        chrome.action.setBadgeText({ text: 'FULL' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
        return; 
      }
      console.log("[SW/handleCaptureAndStore] Storage quota check PASSED.");

      console.log("[SW/handleCaptureAndStore] Generating thumbnail for tabId:", tab.id);
      const thumbnailRequestId = `thumb-${tab.id}-${Date.now()}`;
      let thumbnailDataUrl = null;
      try {
        thumbnailDataUrl = await getThumbnailFromOffscreen(dataUrl, thumbnailRequestId);
        console.log("[SW/handleCaptureAndStore] Thumbnail received for tabId:", tab.id, "Length:", thumbnailDataUrl ? thumbnailDataUrl.length : 'N/A');
      } catch (thumbError) {
        console.error("[SW/handleCaptureAndStore] Thumbnail generation FAILED for tabId:", tab.id, "Error:", thumbError.message);
        // Continue to save without a thumbnail
      }

      // Get current step counter, increment, and save
      let { stepCounter } = await chrome.storage.local.get({ stepCounter: 0 });
      stepCounter++;
      await chrome.storage.local.set({ stepCounter });
      const pageTitleWithStep = `Step ${stepCounter}: ${tab.title}`;
      console.log(`[SW/handleCaptureAndStore] Updated page title with step: "${pageTitleWithStep}"`);

      const record = {
        timestamp: new Date().toISOString(),
        pageUrl: tab.url,
        pageTitle: pageTitleWithStep, // Use updated title
        imageData: imageBlob, // Store the Blob itself
        imageType: imageType, // Store the Blob's type
        thumbnailDataUrl: thumbnailDataUrl,
        imageSizeBytes: imageSizeBytes,
        targetElementInfo: clickData?.targetElementInfo,
        clickCoordinates: clickData?.clickCoordinates,
        viewportDimensions: clickData?.viewportDimensions
      };
      console.log("[SW/handleCaptureAndStore] Screenshot record prepared:", record);

      console.log("[SW/handleCaptureAndStore] Calling idbHelper.addScreenshot for tabId:", tab.id);
      const recordId = await addScreenshot(record);
      console.log("[SW/handleCaptureAndStore] Screenshot record SAVED to DB with ID:", recordId, "for tabId:", tab.id);

      chrome.runtime.sendMessage({ type: 'SCREENSHOT_TAKEN', screenshotId: recordId });
      console.log("[SW/handleCaptureAndStore] Sent SCREENSHOT_TAKEN message for ID:", recordId);

    } catch (error) {
      console.error("[SW/handleCaptureAndStore] CRITICAL Error during capture and store for tabId:", tab.id, error, error.stack);
      chrome.action.setBadgeText({ text: 'ERR' });
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      setTimeout(() => chrome.action.setBadgeText({ text: '' }), 5000);
    }
  }, effectiveDebounceMs));
}

// Main message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[SW/onMessage] Received message: ", message, "From sender tab ID:", sender.tab ? sender.tab.id : 'N/A', "From extension ID:", sender.id, "Expected ext ID:", chrome.runtime.id);

  // Allow messages from the offscreen document or other parts of the extension itself
  if (sender.id !== chrome.runtime.id && message.target !== 'offscreen') { // Adjusted condition
      if (!message.type?.startsWith('CAPTURE_') && !message.type?.startsWith('THUMBNAIL_')) { // Be more specific about allowed external messages if any
         console.warn("[SW/onMessage] Ignoring message from unexpected sender or unknown type:", sender, message);
         // sendResponse({success: false, error: "Invalid sender or message type"});
         // return false; // Or true if you might respond later
      }
  }

  if (message.type === 'CAPTURE_CLICK') {
    console.log("[SW/onMessage] CAPTURE_CLICK message received. Sender tab:", sender.tab);
    if (!sender.tab) {
      console.error("[SW/onMessage] CAPTURE_CLICK received without sender.tab. Cannot process.");
      sendResponse({ success: false, error: "No sender tab info for CAPTURE_CLICK" });
      return true; 
    }
    console.log("[SW/onMessage] Checking captureEnabled setting before proceeding with CAPTURE_CLICK...");
    chrome.storage.local.get('captureEnabled', async (settings) => {
        if (chrome.runtime.lastError) {
            console.error("[SW/onMessage] Error getting captureEnabled setting for CAPTURE_CLICK:", chrome.runtime.lastError.message);
            sendResponse({success: false, error: "Failed to get capture settings"});
            return;
        }
        console.log("[SW/onMessage] captureEnabled setting for CAPTURE_CLICK is:", settings.captureEnabled);
        if (settings.captureEnabled) {
            console.log("[SW/onMessage] Capture is ENABLED. Calling handleCaptureAndStore. Message payload:", message.payload);
            // No need to await handleCaptureAndStore itself as it contains a setTimeout
            handleCaptureAndStore(sender.tab, message.payload); 
            sendResponse({ success: true, message: "Capture initiated" });
        } else {
            console.log("[SW/onMessage] Capture is NOT enabled. Ignoring CAPTURE_CLICK.");
            sendResponse({ success: false, message: "Capture not enabled" });
        }
    });
    return true; // Indicate async response because of chrome.storage.local.get
  }
  
  // Listener for messages from the offscreen document (thumbnail results)
  if (message.type === 'THUMBNAIL_GENERATED' && message.target === 'service-worker') {
    // This is now handled by the specific listener in getThumbnailFromOffscreen for clarity and request matching.
    // The global listener in getThumbnailFromOffscreen will pick this up.
    // console.log("[SW/onMessage] Received THUMBNAIL_GENERATED from offscreen (will be handled by getThumbnailFromOffscreen specific listener):", message.requestId);
    // No sendResponse needed here as it's a response to a promise within getThumbnailFromOffscreen
    return false;
  }

  // Listener for requests from the offscreen document to the service worker (if any were needed)
  // Example: if offscreen needed to ask SW for something.
  // if (message.type === 'REQUEST_FROM_OFFSCREEN' && sender.url && sender.url.endsWith(OFFSCREEN_DOCUMENT_PATH)) {
  //   console.log("Message from offscreen document:", message.data);
  //   sendResponse({ success: true, reply: "SW got your request from offscreen!" });
  //   return true;
  // }

  if (message.type === 'DIAGNOSE_THUMBNAIL') {
    // Diagnostic endpoint for testing thumbnail generation directly
    console.log('[DIAGNOSTIC] Testing thumbnail generation');
    ensureOffscreenDocument().then(async () => {
      try {
        // Create a small test image (1x1 pixel red square)
        const canvas = new OffscreenCanvas(1, 1);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'red';
        ctx.fillRect(0, 0, 1, 1);
        const blob = await canvas.convertToBlob();
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = reader.result;
          const diagnosticRequestId = `diag-${Date.now()}`;
          console.log(`[DIAGNOSTIC] Test image created (ID: ${diagnosticRequestId}), data URL length:`, dataUrl.length);
          
          try {
            // Use the new connect-based function for diagnostics too
            const thumbnailResponse = await getThumbnailFromOffscreen(dataUrl, diagnosticRequestId);
            console.log(`[DIAGNOSTIC] Thumbnail response (ID: ${diagnosticRequestId}):`, thumbnailResponse);
            sendResponse({ 
              success: true, 
              testImageLength: dataUrl.length,
              thumbnailResponse: thumbnailResponse 
            });
          } catch (e) {
            console.error(`[DIAGNOSTIC] Error getting test thumbnail from offscreen (ID: ${diagnosticRequestId}):`, e);
            sendResponse({ success: false, error: e.message });
          }
        };
        reader.onerror = (err) => {
          console.error('[DIAGNOSTIC] FileReader error:', err);
          sendResponse({ success: false, error: 'FileReader error' });
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        console.error('[DIAGNOSTIC] Error creating test image:', e);
        sendResponse({ success: false, error: e.message });
      }
    }).catch(err => {
      console.error('[DIAGNOSTIC] Error ensuring offscreen document:', err);
      sendResponse({ success: false, error: err.message });
    });
    
    return true; // Async response
  }
  
  return false; 
});

// Optional: Close offscreen document when service worker becomes inactive or on uninstall
// chrome.runtime.onSuspend.addListener(() => {
//   chrome.offscreen.closeDocument().catch(err => console.error("Error closing offscreen document on suspend:", err));
// });

// Add listener to monitor captureEnabled changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.captureEnabled) {
    console.log(`[Service Worker] captureEnabled changed: ${changes.captureEnabled.oldValue} → ${changes.captureEnabled.newValue}`);
  }
});

// Monitor the current setting on startup
chrome.storage.local.get('captureEnabled', (data) => {
  console.log(`[Service Worker] Initial captureEnabled: ${data.captureEnabled}`);
});

console.log('Service worker started.'); 
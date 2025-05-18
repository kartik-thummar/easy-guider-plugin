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
  console.log(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Attempting to connect to offscreen document.`);
  return new Promise(async (resolve, reject) => {
    if (!await hasOffscreenDocument()) {
      console.log(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Ensuring offscreen document exists or creating it.`);
      try {
        await ensureOffscreenDocument();
        console.log(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Offscreen document ensured.`);
      } catch (err) {
        console.error(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Failed to ensure offscreen document:`, err);
        return reject(new Error('Failed to create/ensure offscreen document: ' + err.message));
      }
    }

    const port = chrome.runtime.connect({ name: "offscreen-thumbnail-port" });
    let responseReceived = false;

    port.onMessage.addListener((response) => {
      console.log(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Message received from port:`, response);
      if (response.originalRequestId === requestId) {
        responseReceived = true;
        port.disconnect();
        if (response.success) {
          resolve(response);
        } else {
          console.error(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Thumbnail generation failed in offscreen:`, response.error);
          // Resolve with the error response structure, so the caller can see the error string
          resolve(response); 
        }
      }
    });

    port.onDisconnect.addListener(() => {
      console.log(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Port disconnected.`);
      if (!responseReceived) {
        const errorMessage = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Port disconnected before response.';
        console.error(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Error or disconnect without response:`, errorMessage);
        reject(new Error('Failed to get thumbnail: ' + errorMessage));
      }
      // Cleanup is handled by the promise resolving or rejecting
    });

    console.log(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Posting GENERATE_THUMBNAIL message to port.`);
    port.postMessage({
      type: 'GENERATE_THUMBNAIL',
      dataUrl: dataUrl,
      requestId: requestId // Include a unique ID for this request
    });

    // Timeout for the operation
    setTimeout(() => {
      if (!responseReceived) {
        console.error(`[SW] getThumbnailFromOffscreen (ID: ${requestId}): Operation timed out.`);
        port.disconnect();
        reject(new Error('Thumbnail generation timed out'));
      }
    }, 10000); // 10-second timeout
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received in service worker:', message, 'from sender:', sender);

  if (message.type === 'CLICK_DETECTED') {
    console.log('Click detected, processing screenshot for:', message.payload.pageUrl);

    if (!sender.tab || !sender.tab.id) {
      console.error('Sender tab ID is missing. Cannot capture screenshot.');
      sendResponse({ success: false, error: 'Missing tab ID' });
      return false;
    }
    const tabId = sender.tab.id;
    const windowId = sender.tab.windowId;

    chrome.storage.local.get(['screenshotFormat', 'jpegQuality', 'captureEnabled'], async (settings) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting settings for capture:', chrome.runtime.lastError);
        sendResponse({ success: false, error: 'Failed to get settings' });
        return;
      }

      if (!settings.captureEnabled) {
        console.log('Capture is disabled in settings. Skipping screenshot.');
        sendResponse({ success: false, error: 'Capture disabled' });
        return;
      }

      let targetTabInfo = null;
      try {
        targetTabInfo = await chrome.tabs.get(tabId);
        if (!targetTabInfo || targetTabInfo.windowId !== windowId) {
          console.warn(`Tab ID ${tabId} in window ${windowId} no longer exists or has changed window. Current info: ${JSON.stringify(targetTabInfo)}. Skipping capture.`);
          sendResponse({ success: false, error: 'Tab not found or changed window' });
          return;
        }
        // Add checks for tab status and activity
        if (targetTabInfo.status !== 'complete') {
          console.warn(`Tab ID ${tabId} is not fully loaded (status: ${targetTabInfo.status}). Skipping capture.`);
          sendResponse({ success: false, error: `Tab not complete (status: ${targetTabInfo.status})` });
          return;
        }
        // For captureVisibleTab, the tab doesn't strictly need to be active in its window, 
        // but if it's not, the user might be surprised.
        // However, the primary cause of "cannot access contents" isn't usually active state if windowId is correct.
        // We'll log if not active but proceed.
        if (!targetTabInfo.active) {
          console.log(`Tab ID ${tabId} is not the active tab in its window. Proceeding with capture anyway.`);
        }

        console.log(`Confirmed tab ${tabId} (status: ${targetTabInfo.status}, active: ${targetTabInfo.active}) exists in window ${targetTabInfo.windowId}. Proceeding with capture.`);
      } catch (error) {
        console.warn(`Error checking tab ${tabId} (expected in window ${windowId}): ${error.message}. Skipping capture.`);
        sendResponse({ success: false, error: `Tab ${tabId} not accessible: ${error.message}` });
        return;
      }

      const captureOptions = {
        format: settings.screenshotFormat === 'jpeg' ? 'jpeg' : 'png',
      };
      if (captureOptions.format === 'jpeg') {
        captureOptions.quality = settings.jpegQuality || 90;
      }
      
      // Use the confirmed windowId from the tab we just fetched.
      // The first argument to captureVisibleTab is windowId (optional). 
      // If we pass null, it uses the current window. If we pass the specific windowId, it targets that.
      console.log(`Attempting to capture tab in windowId: ${targetTabInfo.windowId} with options: ${JSON.stringify(captureOptions)}`);
      chrome.tabs.captureVisibleTab(targetTabInfo.windowId, captureOptions, async (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error(`Error capturing visible tab (tried windowId: ${targetTabInfo.windowId}, tabId: ${tabId}):`, chrome.runtime.lastError.message);
          sendResponse({ success: false, error: `Capture Error: ${chrome.runtime.lastError.message}` });
          return;
        }
        if (dataUrl) {
          console.log('Screenshot captured successfully for tabId:', tabId);
          
          try {
            await ensureOffscreenDocument();
            const imageBlob = await fetch(dataUrl).then(res => res.blob());
            const currentSettings = await chrome.storage.local.get(['storageQuotaMB']); // Re-fetch for accuracy
            const storageQuotaMB = currentSettings.storageQuotaMB || 100;
            const canSave = await enforceStorageQuota(imageBlob.size, storageQuotaMB);

            if (!canSave) {
              console.warn('Screenshot not saved due to storage quota limitations for tabId:', tabId);
              sendResponse({ success: false, error: 'Storage quota exceeded, screenshot not saved.' });
              return;
            }

            let thumbnailDataUrl = '';
            const thumbnailRequestId = `thumb-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            try {
              console.log(`[SW] Requesting thumbnail generation (ID: ${thumbnailRequestId}) for tabId:`, tabId, 'dataUrl length:', dataUrl.length);
              
              // Use the new connect-based function
              const thumbnailResponse = await getThumbnailFromOffscreen(dataUrl, thumbnailRequestId);
              
              console.log(`[SW] Thumbnail response (ID: ${thumbnailRequestId}) for tabId:`, tabId, 'Response:', thumbnailResponse);
              if (thumbnailResponse && thumbnailResponse.success) {
                thumbnailDataUrl = thumbnailResponse.thumbnailDataUrl;
                console.log(`[SW] Thumbnail generated successfully (ID: ${thumbnailRequestId}) for tabId:`, tabId);
                if (thumbnailDataUrl && !thumbnailDataUrl.startsWith('data:image/')) {
                  console.error(`[SW] Invalid thumbnail data URL format (ID: ${thumbnailRequestId}):`, thumbnailDataUrl.substring(0, 30) + '...');
                }
              } else {
                console.error(`[SW] Thumbnail generation failed (ID: ${thumbnailRequestId}) for tabId:`, tabId, 'Error:', thumbnailResponse && thumbnailResponse.error);
              }
            } catch (e) {
              console.error(`[SW] Error getting thumbnail from offscreen (ID: ${thumbnailRequestId}) for tabId:`, tabId, ':', e);
            }

            // Get and increment step counter
            let stepCounter = 1;
            try {
              const { stepCounter: storedStep } = await chrome.storage.local.get('stepCounter');
              stepCounter = (storedStep || 0) + 1;
              await chrome.storage.local.set({ stepCounter });
            } catch (e) {
              console.warn('Could not update step counter:', e);
            }

            // Prepend step number to pageTitle
            let pageTitleWithStep = message.payload.pageTitle || '';
            pageTitleWithStep = `Step ${stepCounter}: ${pageTitleWithStep}`;

            console.log(`[SW] About to save screenshot record. Thumbnail URL is: "${thumbnailDataUrl ? thumbnailDataUrl.substring(0, 50) + '...' : 'EMPTY'}"`); // Log thumbnail URL state
            const screenshotRecord = {
              ...message.payload,
              pageTitle: pageTitleWithStep,
              imageData: imageBlob,
              thumbnailDataUrl: thumbnailDataUrl, // Ensure this is correctly populated
              imageSizeBytes: imageBlob.size,
              tabId: tabId, // ensure tabId is from the original message sender
              windowId: targetTabInfo.windowId // use the confirmed windowId
            };

            // Log the actual record before saving
            console.log('[SW] Screenshot record to be saved:', JSON.parse(JSON.stringify(screenshotRecord, (key, value) => key === 'imageData' ? '[BlobData]' : value)));

            const recordId = await addScreenshot(screenshotRecord);
            console.log('Screenshot record saved to IDB for tabId:', tabId, 'ID:', recordId);
            chrome.runtime.sendMessage({ type: 'STORAGE_UPDATED' }).catch(e => console.debug("Error sending STORAGE_UPDATED after save, popup likely closed:", e));
            sendResponse({ success: true, dataUrlLength: dataUrl.length, recordId: recordId, thumbnailUrlLength: thumbnailDataUrl.length });

          } catch (error) {
            console.error('Error processing/saving screenshot for tabId:', tabId, error);
            sendResponse({ success: false, error: 'Processing/saving error: ' + error.message });
          }
        } else {
          console.error('captureVisibleTab returned undefined/empty dataUrl for tabId:', tabId);
          sendResponse({ success: false, error: 'Capture failed, no data URL returned' });
        }
      });
    });

    console.log('Service Worker: CLICK_DETECTED handler is about to return true, indicating async sendResponse.');
    return true; // Indicates that sendResponse will be called asynchronously
  } else if (message.type === 'DIAGNOSE_THUMBNAIL') {
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
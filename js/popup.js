import { initDB, addScreenshot, getUnassignedScreenshots } from './idb-helper.js'; // Assuming idb-helper.js exports these, or adjust as needed
import * as idbHelper from './idb-helper.js';

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
const homeButton = document.getElementById('homeButton');

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
  db = await idbHelper.initDB();
  return db;
}

async function deleteScreenshot(id) {
    try {
        await idbHelper.deleteScreenshot(id);
        await idbHelper.deleteTutorialStepsByScreenshotId(id);
        console.log(`[Popup] Deleted screenshot ${id} and associated tutorial steps.`);
        displayScreenshots();
        updatePopupState();
        chrome.runtime.sendMessage({ type: "STORAGE_UPDATED" });
    } catch (error) {
        console.error("Error deleting screenshot or its tutorial steps:", error);
        alert("Error deleting screenshot. Check console.");
    }
}

async function getScreenshotBlob(id) {
    return idbHelper.getScreenshotBlob(id);
}


// --- UI Rendering ---
async function displayScreenshots() {
  try {
    const screenshots = await idbHelper.getRecentScreenshots(10);
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
      const imageUrl = URL.createObjectURL(blob);
      chrome.tabs.create({ url: imageUrl }, (newTab) => {
        // The object URL should be revoked when it's no longer needed.
        // However, revoking it immediately might cause issues if the new tab hasn't loaded it yet.
        // A common strategy is to revoke it after a short delay, or rely on the user closing the tab.
        // For simplicity here, we'll let the browser manage it, though for long-lived blobs this could be an issue.
        // If the new tab is closed, the blob URL might be auto-revoked by some browsers, but not guaranteed.
        // A more robust solution might involve a listener for when the tab is closed, or using a different URL scheme if possible.
        console.log(`Opened image for screenshot ${item.id} in new tab ${newTab.id}. URL: ${imageUrl}`);
        // Optionally, to be safer, revoke after a delay, though this is not perfect:
        // setTimeout(() => { URL.revokeObjectURL(imageUrl); console.log(`Revoked URL for tab ${newTab.id}`), 60000});
      });
    } catch (e) {
      console.error("Could not load full image for new tab:", e);
      alert("Could not load full image into a new tab.");
    }
  });

  deleteButton.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete this screenshot?')) {
      try {
        await deleteScreenshot(item.id);
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
    // if (createTutorialButton) createTutorialButton.style.display = 'none'; // Hide when capturing -> This will be handled by updatePopupState
  } else {
    toggleCaptureButton.textContent = 'Start Capturing';
    toggleCaptureButton.title = 'Click to Start Screenshot Capture';
    toggleCaptureButton.classList.add('paused');
    toggleCaptureButton.classList.remove('active');
    // Visibility of createTutorialButton will be handled by updatePopupState
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
    
    chrome.storage.local.set({ captureEnabled: newStatus }, async () => {
      if (chrome.runtime.lastError) {
        console.error('[Popup] Error setting captureEnabled:', chrome.runtime.lastError.message);
        return;
      }
      if (newStatus) { // If capture is being started
        await chrome.storage.local.set({ stepCounter: 0 }); 
        console.log('[Popup] Capture explicitly started, stepCounter reset to 0.');
      }
      await updatePopupState();
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

// Modal close functionality (can be removed or kept if modal is used for other things later)
// Ensure these elements exist or guard these calls if removing modal HTML
if (closeModalButton && modal && modalImage) { 
    closeModalButton.onclick = function() {
      modal.style.display = "none";
      if (modalImage.src && modalImage.src.startsWith('blob:')) {
        URL.revokeObjectURL(modalImage.src); 
        modalImage.src = ""; 
      }
    }
} 
// if (modal) { // If modal object exists
//     window.onclick = function(event) {
//         if (event.target == modal) {
//             modal.style.display = "none";
//             if (modalImage.src && modalImage.src.startsWith('blob:')) {
//                 URL.revokeObjectURL(modalImage.src); 
//                 modalImage.src = "";
//             }
//         }
//     }
// }

async function displayStorageInfo(quotaMB) {
    try {
        const totalBytesUsed = await idbHelper.getTotalStorageUsed();
        const totalMbUsed = (totalBytesUsed / (1024 * 1024)).toFixed(2);
        storageUsedSpan.textContent = `${totalMbUsed} MB`;
        storageQuotaSpan.textContent = `${quotaMB} MB`;

    } catch (error) {
        console.error("Error displaying storage info:", error);
        storageUsedSpan.textContent = "Error";
        storageQuotaSpan.textContent = "Error";
    }
}

// --- Manage Capture State & Update UI ---
async function updatePopupState() {
  console.log('[Popup] Updating popup state...');
  try {
    const data = await chrome.storage.local.get(['captureEnabled', 'storageQuotaMB']);
    const captureEnabled = data.captureEnabled || false;
    const quotaMB = data.storageQuotaMB || 100; // Default or from settings

    console.log('[Popup] Current captureEnabled state:', captureEnabled);
    updateToggleButton(captureEnabled);

    const unassignedScreenshots = await idbHelper.getUnassignedScreenshots();
    const hasUnassigned = unassignedScreenshots && unassignedScreenshots.length > 0;
    console.log('[Popup] Has unassigned screenshots:', hasUnassigned, '(Count:', unassignedScreenshots.length, ')');

    if (createTutorialButton) {
      if (!captureEnabled && hasUnassigned) {
        createTutorialButton.style.display = 'block';
        console.log('[Popup] Create Tutorial button VISIBLE.');
      } else {
        createTutorialButton.style.display = 'none';
        console.log('[Popup] Create Tutorial button HIDDEN. (captureEnabled:', captureEnabled, ', hasUnassigned:', hasUnassigned, ')');
      }
    }

    await displayStorageInfo(quotaMB);
    await displayScreenshots(); // Refresh screenshot list (it filters assigned ones)

  } catch (error) {
    console.error('[Popup] Error updating popup state:', error);
    // Optionally display an error message in the popup itself
  }
}

// --- Initialize Popup ---
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
  chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && changes.captureEnabled !== undefined) {
      console.log("[Popup] chrome.storage.onChanged detected captureEnabled change. Calling updatePopupState.");
      await updatePopupState();
    }
    if (namespace === 'local' && (changes.storageQuotaMB || changes.retentionDays)) {
        await displayStorageInfo();
    }
  });

  await displayScreenshots();
  await displayStorageInfo(); 
}

document.addEventListener('DOMContentLoaded', initPopup);

// Listen for STORAGE_UPDATED message from service worker
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  console.log("popup.js: Message received", message);
  if (message.type === 'SCREENSHOT_TAKEN' || message.type === "STORAGE_UPDATED") {
    console.log("popup.js: SCREENSHOT_TAKEN or STORAGE_UPDATED received, refreshing UI.");
    await displayScreenshots();
    await displayStorageInfo();
    await updatePopupState(); // Refresh button states including Create Tutorial button
  } else if (message.type === 'CAPTURE_STATE_CHANGED') {
      console.log("popup.js: CAPTURE_STATE_CHANGED received", message.captureEnabled);
      await updatePopupState(); // Update all relevant UI based on new capture state
  }
  // Indicate that we are not sending an asynchronous response from this listener, 
  // unless specifically needed for a message type.
  // For these messages, we are just reacting.
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

// Event listener for Create Tutorial button
if (createTutorialButton) {
  createTutorialButton.addEventListener('click', async () => {
    const tutorialTitle = prompt("Enter a title for the new tutorial:");
    if (!tutorialTitle || tutorialTitle.trim() === "") {
      alert("Tutorial title cannot be empty.");
      return;
    }

    try {
      await idbHelper.initDB(); // Ensure DB is ready
      const unassignedScreenshots = await idbHelper.getUnassignedScreenshots();
      if (!unassignedScreenshots || unassignedScreenshots.length === 0) {
        alert("No unassigned screenshots to add to a tutorial.");
        await updatePopupState(); // Re-check and hide button if needed
        return;
      }

      const newTutorialId = await idbHelper.addTutorial({
        title: tutorialTitle.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        description: "", 
        coverImageId: null 
      });
      console.log("popup.js: Tutorial created with ID:", newTutorialId);

      // Create a default header for the new tutorial
      const defaultHeaderTitle = "Initial Content"; // You can make this dynamic or configurable if needed
      const nextHeaderOrder = await idbHelper.getNextHeaderOrder(newTutorialId);
      const newHeaderId = await idbHelper.addHeader({
          tutorialId: newTutorialId,
          title: defaultHeaderTitle,
          description: "", // Empty description for default header
          order: nextHeaderOrder 
      });
      console.log(`popup.js: Default header '${defaultHeaderTitle}' created with ID ${newHeaderId} for tutorial ${newTutorialId}`);

      let firstScreenshotIdForCover = null;
      for (let i = 0; i < unassignedScreenshots.length; i++) {
        const screenshot = unassignedScreenshots[i];
        
        let stepTitle = 'Untitled Step'; 
        if (screenshot.targetElementInfo && screenshot.targetElementInfo.text && screenshot.targetElementInfo.text.trim() !== "") {
          stepTitle = `Click on <strong>${screenshot.targetElementInfo.text.trim()}</strong>`;
        } else if (screenshot.pageTitle) { 
          stepTitle = screenshot.pageTitle; 
        }

        await idbHelper.assignScreenshotToTutorial(screenshot.id, newTutorialId); // Assigns to tutorial, not header. Still relevant.
        
        // Get next step order for the new header
        const nextStepOrderInHeader = await idbHelper.getNextStepOrder(newHeaderId);

        await idbHelper.addTutorialStep({
          headerId: newHeaderId, // Assign step to the new default header
          screenshotId: screenshot.id,
          order: nextStepOrderInHeader, // Order within the header
          notes: "", 
          title: stepTitle 
        });
        if (i === 0 && screenshot.id) { 
          firstScreenshotIdForCover = screenshot.id;
        }
        console.log(`popup.js: Assigned screenshot ${screenshot.id} to header ${newHeaderId} (tutorial ${newTutorialId}) and created step with order ${nextStepOrderInHeader}.`);
      }

      if (firstScreenshotIdForCover) {
        await idbHelper.updateTutorial(newTutorialId, { coverImageId: firstScreenshotIdForCover, updatedAt: new Date().toISOString() });
        console.log(`popup.js: Set screenshot ${firstScreenshotIdForCover} as cover for tutorial ${newTutorialId}`);
      }

      alert(`Tutorial "${tutorialTitle}" created successfully with a default header and ${unassignedScreenshots.length} steps!`);
      
      await updatePopupState();
      await displayScreenshots(); 
      await displayStorageInfo();

      chrome.tabs.create({ url: chrome.runtime.getURL('html/tutorials.html') });

    } catch (error) {
      console.error("popup.js: Error creating tutorial:", error);
      alert("Failed to create tutorial. Check console for details: " + error.message);
    }
  });
}

if (homeButton) {
  homeButton.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/tutorials.html') });
  });
}

console.log('Popup script loaded.'); 
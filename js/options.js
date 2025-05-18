const optionsForm = document.getElementById('optionsForm');
const captureEnabledInput = document.getElementById('captureEnabled');
const debounceMsInput = document.getElementById('debounceMs');
const scopeAllRadio = document.getElementById('scopeAll');
const scopeSpecificRadio = document.getElementById('scopeSpecific');
const specificDomainsTextarea = document.getElementById('specificDomains');
const screenshotFormatInput = document.getElementById('screenshotFormat');
const jpegQualitySettingDiv = document.getElementById('jpegQualitySetting');
const jpegQualityInput = document.getElementById('jpegQuality');
const saveButton = document.getElementById('saveButton');
const statusMessageSpan = document.getElementById('statusMessage');
const storageQuotaMBInput = document.getElementById('storageQuotaMB');
const retentionDaysInput = document.getElementById('retentionDays');
const clearAllDataButton = document.getElementById('clearAllDataButton');

// Function to save options
function saveOptions(event) {
  event.preventDefault(); // Prevent form submission
  const captureScope = {
    type: scopeSpecificRadio.checked ? 'specific' : 'all',
    domains: specificDomainsTextarea.value.split('\n').map(d => d.trim()).filter(d => d)
  };

  const settingsToSave = {
    captureEnabled: captureEnabledInput.checked,
    debounceMs: parseInt(debounceMsInput.value, 10),
    captureScope: captureScope,
    screenshotFormat: screenshotFormatInput.value,
    jpegQuality: parseInt(jpegQualityInput.value, 10),
    storageQuotaMB: parseInt(storageQuotaMBInput.value, 10),
    retentionDays: parseInt(retentionDaysInput.value, 10)
  };

  chrome.storage.local.set(settingsToSave, () => {
    if (chrome.runtime.lastError) {
      statusMessageSpan.textContent = 'Error saving settings: ' + chrome.runtime.lastError.message;
      statusMessageSpan.className = 'error';
      console.error('Error saving settings:', chrome.runtime.lastError);
    } else {
      statusMessageSpan.textContent = 'Settings saved!';
      statusMessageSpan.className = 'success';
      console.log('Settings saved:', settingsToSave);
      setTimeout(() => { statusMessageSpan.textContent = ''; }, 3000);
    }
  });
}

// Function to restore options
function restoreOptions() {
  chrome.storage.local.get([
    'captureEnabled',
    'debounceMs',
    'captureScope',
    'screenshotFormat',
    'jpegQuality',
    'storageQuotaMB',
    'retentionDays'
  ], (items) => {
    if (chrome.runtime.lastError) {
      console.error('Error restoring settings:', chrome.runtime.lastError);
      statusMessageSpan.textContent = 'Error loading settings.';
      statusMessageSpan.className = 'error';
      return;
    }

    captureEnabledInput.checked = items.captureEnabled !== undefined ? items.captureEnabled : true;
    debounceMsInput.value = items.debounceMs !== undefined ? items.debounceMs : 500;
    
    if (items.captureScope) {
      if (items.captureScope.type === 'specific') {
        scopeSpecificRadio.checked = true;
        specificDomainsTextarea.value = (items.captureScope.domains || []).join('\n');
        specificDomainsTextarea.disabled = false;
      } else {
        scopeAllRadio.checked = true;
        specificDomainsTextarea.disabled = true;
      }
    } else {
      scopeAllRadio.checked = true; // Default
      specificDomainsTextarea.disabled = true;
    }

    screenshotFormatInput.value = items.screenshotFormat || 'png';
    jpegQualityInput.value = items.jpegQuality || 90;
    storageQuotaMBInput.value = items.storageQuotaMB !== undefined ? items.storageQuotaMB : 100;
    retentionDaysInput.value = items.retentionDays !== undefined ? items.retentionDays : 7;
    
    toggleJpegQualityVisibility();
    toggleSpecificDomainsVisibility();
  });
}

function toggleSpecificDomainsVisibility() {
    specificDomainsTextarea.disabled = !scopeSpecificRadio.checked;
}

function toggleJpegQualityVisibility() {
  jpegQualitySettingDiv.style.display = screenshotFormatInput.value === 'jpeg' ? 'block' : 'none';
}

async function handleClearAllData() {
  if (confirm("Are you sure you want to delete ALL captured screenshot data? This action cannot be undone.")) {
    try {
      // We need to communicate with the service worker to ask it to clear the DB,
      // as direct DB access from options page is possible but SW might have a more robust way or handle locks.
      // Alternatively, if idb-helper is robust and can be imported here:
      const idbHelper = await import('../js/idb-helper.js');
      await idbHelper.initDB(); // ensure it's open
      
      // A new function in idb-helper.js would be cleaner, e.g., clearAllScreenshots()
      const db = idbHelper.db; // Assuming db instance is exposed or accessible via a getter
      if (!db) {
          console.error("DB not available in idbHelper after init for clearAllData");
          throw new Error("Database connection failed.");
      }
      await new Promise((resolve, reject) => {
        const transaction = db.transaction([idbHelper.STORE_NAME], 'readwrite'); // STORE_NAME needs to be exported or passed
        const store = transaction.objectStore(idbHelper.STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => {
          console.log('All screenshot data cleared from IndexedDB.');
          statusMessageSpan.textContent = 'All data cleared!';
          statusMessageSpan.className = 'success';
          resolve();
        };
        request.onerror = (event) => {
          console.error('Error clearing IndexedDB:', event.target.error);
          statusMessageSpan.textContent = 'Error clearing data.';
          statusMessageSpan.className = 'error';
          reject(event.target.error);
        };
      });

    } catch (error) {
      console.error('Failed to clear all data:', error);
      statusMessageSpan.textContent = 'Failed to clear data: ' + error.message;
      statusMessageSpan.className = 'error';
    }
    setTimeout(() => { statusMessageSpan.textContent = ''; }, 4000);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', restoreOptions);
optionsForm.addEventListener('submit', saveOptions);
clearAllDataButton.addEventListener('click', handleClearAllData);

scopeAllRadio.addEventListener('change', toggleSpecificDomainsVisibility);
scopeSpecificRadio.addEventListener('change', toggleSpecificDomainsVisibility);
screenshotFormatInput.addEventListener('change', toggleJpegQualityVisibility);

console.log('Options script loaded.'); 
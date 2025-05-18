console.log('Content script loaded.');

let settings = {
  captureEnabled: true,
  debounceMs: 500,
  captureScope: { type: 'all', domains: [] }
};
let lastClickTime = 0;

// Check if we have access to chrome APIs
const hasChromeAccess = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
if (!hasChromeAccess) {
  console.warn('Chrome extension APIs not available. This script may be running in a context without extension access.');
}

// Function to generate a basic CSS selector
function generateCssSelector(el) {
  if (!(el instanceof Element)) return;
  const parts = [];
  while (el) {
    let part = el.tagName.toLowerCase();
    if (el.id) {
      part += '#' + el.id;
      parts.unshift(part);
      break; // ID is unique enough
    }
    if (el.classList && el.classList.length > 0) {
      part += '.' + Array.from(el.classList).join('.');
    }
    let sibling = el, nth = 1;
    while (sibling = sibling.previousElementSibling) {
      if (sibling.tagName === el.tagName) nth++;
    }
    if (nth > 1) part += ':nth-of-type(' + nth + ')';
    parts.unshift(part);
    el = el.parentElement;
  }
  return parts.join(' > ');
}

// Load initial settings
if (hasChromeAccess && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['captureEnabled', 'debounceMs', 'captureScope'], (loadedSettings) => {
    if (chrome.runtime.lastError) {
      console.error('[CS] Error loading initial settings:', chrome.runtime.lastError.message);
      return;
    }
    settings = { ...settings, ...loadedSettings };
    console.log('[CS] Initial settings loaded:', settings);
  });
} else if (!hasChromeAccess) {
  console.warn('[CS] Cannot load initial settings: Chrome APIs not available.');
}

// Listen for settings changes from storage
if (hasChromeAccess && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      let updatedSettings = { ...settings }; // Clone to compare before applying
      let actualChangesMade = false;

      for (let key in changes) {
        if (updatedSettings.hasOwnProperty(key)) {
          // Check if the new value is actually different before logging/applying
          if (JSON.stringify(updatedSettings[key]) !== JSON.stringify(changes[key].newValue)) {
            updatedSettings[key] = changes[key].newValue;
            actualChangesMade = true;
            if (key === 'captureEnabled') {
              console.log(`[CS] storage.onChanged: captureEnabled detected change to ${updatedSettings.captureEnabled}`);
            }
          }
        }
      }

      if (actualChangesMade) {
        settings = updatedSettings; // Apply all accumulated changes at once
        console.log('[CS] Settings updated from chrome.storage.onChanged. New settings object:', settings);
      } else {
        // This can happen if onChanged fires but the values we care about didn't actually change, or weren't in `settings`.
        // console.log('[CS] storage.onChanged fired, but no relevant settings were updated.');
      }
    }
  });
}

// Listen for REFRESH_SETTINGS message from popup
if (hasChromeAccess && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'REFRESH_SETTINGS') {
      console.log('[CS] Received REFRESH_SETTINGS message.');
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['captureEnabled', 'debounceMs', 'captureScope'], (loadedSettings) => {
          if (chrome.runtime.lastError) {
            console.error('[CS] Error refreshing settings via message:', chrome.runtime.lastError.message);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          settings = { ...settings, ...loadedSettings };
          console.log('[CS] Settings refreshed via message:', settings);
          sendResponse({ success: true, newSettings: settings });
        });
        return true; // Indicates async response
      } else {
        console.warn('[CS] Cannot refresh settings via message: chrome.storage.local not available.');
        sendResponse({ success: false, error: 'chrome.storage.local not available' });
        return false;
      }
    }
    return false; // Important for other listeners if any
  });
}

function isNavigationElement(target) {
  if (!target) return false;
  if (target.tagName === 'A' && target.href) return true;
  if (target.tagName === 'BUTTON' && (target.type === 'submit' || target.type === 'button')) return true;
  if (target.closest('form')) return true;
  // Add more navigation detection as needed
  return false;
}

function handleDocumentClick(event) {
  console.log('[CS] handleDocumentClick triggered. Current settings.captureEnabled:', settings.captureEnabled, 'Full settings object:', settings);
  if (!settings.captureEnabled) {
    console.log('[CS] Capture is disabled (settings.captureEnabled is false), returning.');
    return;
  }

  // Check capture scope if specific domains are set
  if (settings.captureScope && settings.captureScope.type === 'specific') {
    const currentHostname = window.location.hostname;
    const allowedDomains = settings.captureScope.domains || [];
    const isAllowed = allowedDomains.some(domainPattern => {
      if (domainPattern.startsWith('*.')) {
        return currentHostname.endsWith(domainPattern.substring(1));
      }
      return currentHostname === domainPattern;
    });
    if (!isAllowed) {
      // console.log('Domain not in capture scope:', currentHostname);
      return;
    }
  }

  const currentTime = Date.now();
  if (currentTime - lastClickTime < settings.debounceMs) {
    // console.log('Click debounced');
    return;
  }
  lastClickTime = currentTime;

  const target = event.target;
  const isNav = isNavigationElement(target);

  const payload = {
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    pageTitle: document.title,
    clickCoordinates: { x: event.clientX, y: event.clientY },
    viewportDimensions: { width: window.innerWidth, height: window.innerHeight },
    targetElementInfo: {
      selector: generateCssSelector(target),
      tagName: target.tagName,
      id: target.id || '',
      classList: Array.from(target.classList),
      outerHTML: target.outerHTML ? target.outerHTML.substring(0, 1024) : ''
    }
  };

  if (!hasChromeAccess) {
    console.warn('Cannot capture screenshot: Chrome extension APIs not available');
    return;
  }

  if (isNav) {
    event.preventDefault();
    // Take screenshot, then proceed with navigation
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage({ type: 'CLICK_DETECTED', payload: payload }, (response) => {
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message !== "Extension context invalidated.") {
            console.error('Error sending message:', chrome.runtime.lastError.message);
          } else {
            console.warn('Message not sent: Extension context invalidated.');
          }
        } else {
          // After screenshot, proceed with navigation
          if (target.tagName === 'A' && target.href) {
            window.location.href = target.href;
          } else if (target.closest('form')) {
            target.closest('form').submit();
          }
        }
      });
    }
  } else {
    // For UI actions, take screenshot after action
    setTimeout(() => {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ type: 'CLICK_DETECTED', payload: payload }, (response) => {
          if (chrome.runtime.lastError) {
            if (chrome.runtime.lastError.message !== "Extension context invalidated.") {
              console.error('Error sending message:', chrome.runtime.lastError.message);
            } else {
              console.warn('Message not sent: Extension context invalidated.');
            }
          }
        });
      }
    }, 100); // Delay to allow UI state to update
  }

  // Optional: Visual feedback for the click (e.g., adding a class)
  // target.classList.add('screenshot-captured-highlight');
  // setTimeout(() => target.classList.remove('screenshot-captured-highlight'), 500);
}

// Add click listener to the document in the capture phase
document.addEventListener('click', handleDocumentClick, true); 
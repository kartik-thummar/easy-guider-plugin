console.log('Offscreen document script loaded.');

// Listen for direct connections from the service worker
chrome.runtime.onConnect.addListener((port) => {
  console.log('[Offscreen] Connected to port:', port.name);
  
  if (port.name === 'offscreen-thumbnail-port') {
    port.onMessage.addListener(async (message) => {
      console.log('[Offscreen] Message received on port ', port.name, ':', message);
      if (message.type === 'GENERATE_THUMBNAIL') {
        try {
          const thumbnailDataUrl = await generateThumbnail(
            message.dataUrl, 
            message.thumbnailWidth || 200, 
            message.thumbnailFormat || 'image/jpeg', 
            message.thumbnailQuality || 0.7
          );
          console.log('[Offscreen] Thumbnail generated via port. Length:', thumbnailDataUrl.length);
          port.postMessage({ success: true, thumbnailDataUrl: thumbnailDataUrl, originalRequestId: message.requestId });
        } catch (error) {
          console.error('[Offscreen] Error generating thumbnail via port:', error);
          const errorMessage = (error instanceof Error) ? error.message : String(error);
          port.postMessage({ success: false, error: errorMessage, originalRequestId: message.requestId });
        }
      } else {
        console.warn('[Offscreen] Unknown message type on port:', message.type);
        port.postMessage({ success: false, error: 'Unknown message type on port', originalRequestId: message.requestId });
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('[Offscreen] Port ', port.name, ' disconnected.');
      // Perform cleanup if necessary
    });
  }
});

// Keep the old onMessage listener for any direct messages not using connect (e.g., if other parts of the extension use it)
// However, for thumbnail generation, we will now exclusively use the connect method.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Offscreen document received direct message (legacy handler):', message);
  if (message.target === 'offscreen' && !message.portTransferSignal && message.type !== 'GENERATE_THUMBNAIL_VIA_PORT') {
    // Handle other simple, non-port messages if any
    console.warn('Offscreen: Received a direct message not handled by onConnect listener.');
    return false;
  }
  return false; // Indicate that response will not be sent synchronously or this listener didn't handle it fully.
});

/**
 * Generates a thumbnail from a data URL using a canvas.
 * @param {string} dataUrl The original image data URL.
 * @param {number} maxWidth The maximum width of the thumbnail.
 * @param {string} format The desired format (e.g., 'image/jpeg', 'image/png').
 * @param {number} quality The quality for JPEG (0.0 to 1.0).
 * @returns {Promise<string>} A promise that resolves with the thumbnail data URL.
 */
async function generateThumbnail(dataUrl, maxWidth, format, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    console.log('[Offscreen] Starting thumbnail generation. Data URL length:', dataUrl.length);
    img.onload = async () => {
      try {
        console.log('[Offscreen] Image loaded. Dimensions:', img.width, img.height);
        const canvas = new OffscreenCanvas(1, 1);
        const ctx = canvas.getContext('2d');
        const aspectRatio = img.width / img.height;
        const newWidth = Math.min(maxWidth, img.width);
        const newHeight = newWidth / aspectRatio;
        canvas.width = newWidth;
        canvas.height = newHeight;
        ctx.drawImage(img, 0, 0, newWidth, newHeight);
        console.log('[Offscreen] Image drawn to canvas. New dimensions:', newWidth, newHeight);
        const blob = await canvas.convertToBlob({ type: format, quality: quality });
        console.log('[Offscreen] Canvas converted to blob. Blob size:', blob.size);
        const reader = new FileReader();
        reader.onloadend = () => {
          console.log('[Offscreen] FileReader finished. Data URL length:', reader.result.length);
          resolve(reader.result);
        };
        reader.onerror = (err) => {
          console.error('[Offscreen] FileReader error:', err);
          reject(err);
        };
        reader.readAsDataURL(blob);
      } catch (err) {
        console.error('[Offscreen] Error during thumbnail generation:', err);
        reject(err);
      }
    };
    img.onerror = (err) => {
      console.error('[Offscreen] Image load error for thumbnail generation', err);
      reject('Image load error for thumbnail generation');
    };
    img.src = dataUrl;
    console.log('[Offscreen] Image src set.');
  });
}

console.log('Offscreen document fully initialized and listening for connections and messages.'); 
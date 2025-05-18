export const DB_NAME = 'ClickCaptureDB';
export const DB_VERSION = 1;
export const STORE_NAME = 'screenshots';

export let db = null;

/**
 * Initializes the IndexedDB database and object store.
 * @returns {Promise<IDBDatabase>} Promise that resolves with the DB instance.
 */
export async function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject('IndexedDB error: ' + event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('IndexedDB initialized successfully.');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const tempDb = event.target.result;
      console.log('Upgrading IndexedDB...');
      if (!tempDb.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = tempDb.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        // Define indexes
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        objectStore.createIndex('pageUrl', 'pageUrl', { unique: false });
        // Add other indexes as needed, e.g., for pageTitle, imageSizeBytes
        console.log(`Object store '${STORE_NAME}' created.`);
      }
    };
  });
}

/**
 * Adds a screenshot record to the IndexedDB.
 * @param {object} screenshotData - The screenshot data object to store.
 *   Expected properties: timestamp, pageUrl, pageTitle, clickCoordinates, 
 *   viewportDimensions, targetElementInfo, imageData (Blob), thumbnailDataUrl, imageSizeBytes
 * @returns {Promise<number>} Promise that resolves with the ID of the added record.
 */
export async function addScreenshot(screenshotData) {
  if (!db) {
    console.warn('DB not initialized. Trying to initialize now...');
    await initDB();
    if (!db) {
        return Promise.reject('Database not available.');
    }
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(screenshotData);

    request.onsuccess = (event) => {
      console.log('Screenshot added to DB with ID:', event.target.result);
      resolve(event.target.result); // Returns the key of the new record
    };

    request.onerror = (event) => {
      console.error('Error adding screenshot to DB:', event.target.error);
      reject('Error adding screenshot: ' + event.target.error);
    };
  });
}

/**
 * Retrieves screenshot records older than a given timestamp.
 * @param {string} isoTimestamp - ISO string timestamp.
 * @returns {Promise<Array<object>>} Promise that resolves with an array of screenshot records.
 */
export async function getScreenshotsOlderThan(isoTimestamp) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    // Create a key range for all timestamps less than the given one.
    const range = IDBKeyRange.upperBound(isoTimestamp, true); // true to exclude the exact match if not needed
    const request = index.getAll(range);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (event) => {
      console.error('Error fetching old screenshots:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Deletes multiple screenshot records by their IDs.
 * @param {Array<number>} ids - Array of screenshot IDs to delete.
 * @returns {Promise<void>} Promise that resolves when deletion is complete.
 */
export async function deleteScreenshots(ids) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    if (!ids || ids.length === 0) {
      resolve();
      return;
    }
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let deleteCount = 0;

    ids.forEach(id => {
      const request = store.delete(id);
      request.onsuccess = () => {
        deleteCount++;
        if (deleteCount === ids.length) {
          console.log(`Successfully deleted ${deleteCount} screenshots.`);
          resolve();
        }
      };
      request.onerror = (event) => {
        console.error(`Error deleting screenshot ID ${id}:`, event.target.error);
        // Continue trying to delete others
        deleteCount++; // Count as processed even if error to not hang promise
        if (deleteCount === ids.length) {
          reject('Some deletions failed, but process completed.'); // Or resolve if partial success is OK
        }
      };
    });

    transaction.oncomplete = () => {
        // This might resolve before all individual delete onsuccess/onerror fire
        // if not handled carefully. The per-request callbacks are more reliable for counting.
    };
    transaction.onerror = (event) => {
        console.error('Transaction error during bulk delete:', event.target.error);
        reject('Transaction error during bulk delete: ' + event.target.error);
    };
  });
}

/**
 * Calculates the total storage used by imageSizeBytes in IndexedDB.
 * @returns {Promise<number>} Promise that resolves with total size in bytes.
 */
export async function getTotalStorageUsed() {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    let totalSize = 0;

    request.onsuccess = () => {
      request.result.forEach(item => {
        if (item.imageSizeBytes && typeof item.imageSizeBytes === 'number') {
          totalSize += item.imageSizeBytes;
        }
      });
      resolve(totalSize);
    };
    request.onerror = (event) => {
      console.error('Error calculating total storage used:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Retrieves the oldest screenshot records, sorted by timestamp ascending.
 * @param {number} count - The number of oldest records to retrieve.
 * @returns {Promise<Array<object>>} Promise that resolves with an array of screenshot records.
 */
export async function getOldestScreenshots(count = 1) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp'); // Ensure you have a timestamp index
        const request = index.openCursor(null, 'next'); // 'next' gives ascending order (oldest first)
        const results = [];

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && results.length < count) {
                results.push(cursor.value);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        request.onerror = (event) => {
            console.error('Error fetching oldest screenshots:', event.target.error);
            reject(event.target.error);
        };
    });
}

// Ensure DB is initialized when the module is loaded if possible, or on first use.
initDB().catch(err => console.error("Initial DB init failed:", err)); 
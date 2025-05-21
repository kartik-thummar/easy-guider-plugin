export const DB_NAME = 'ClickCaptureDB';
export const DB_VERSION = 3;
export const STORE_SCREENSHOTS = 'screenshots';
export const STORE_TUTORIALS = 'tutorials';
export const STORE_HEADERS = 'tutorialHeaders';
export const STORE_TUTORIAL_STEPS = 'tutorialSteps';

export let db = null;

/**
 * Initializes the IndexedDB database and object stores.
 * @returns {Promise<IDBDatabase>} Promise that resolves with the DB instance.
 */
export async function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }
    console.log(`[IDB] Initializing DB: ${DB_NAME}, Version: ${DB_VERSION}`);
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('[IDB] IndexedDB error:', event.target.error);
      reject('IndexedDB error: ' + event.target.error);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('[IDB] IndexedDB initialized successfully.');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      db = event.target.result;
      const transaction = event.target.transaction;
      console.log(`[IDB] Upgrading IndexedDB from version ${event.oldVersion} to ${event.newVersion}`);

      let screenshotsStore;
      if (!db.objectStoreNames.contains(STORE_SCREENSHOTS)) {
        screenshotsStore = db.createObjectStore(STORE_SCREENSHOTS, { keyPath: 'id', autoIncrement: true });
        screenshotsStore.createIndex('timestamp', 'timestamp', { unique: false });
        screenshotsStore.createIndex('pageUrl', 'pageUrl', { unique: false });
      } else {
        screenshotsStore = transaction.objectStore(STORE_SCREENSHOTS);
      }
      if (!screenshotsStore.indexNames.contains('tutorialId')) {
        screenshotsStore.createIndex('tutorialId', 'tutorialId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_TUTORIALS)) {
        const tutorialsStore = db.createObjectStore(STORE_TUTORIALS, { keyPath: 'id', autoIncrement: true });
        tutorialsStore.createIndex('title', 'title', { unique: false });
        tutorialsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_HEADERS)) {
        const headersStore = db.createObjectStore(STORE_HEADERS, { keyPath: 'id', autoIncrement: true });
        headersStore.createIndex('tutorialId', 'tutorialId', { unique: false });
        headersStore.createIndex('order', 'order', { unique: false });
        headersStore.createIndex('tutorialId_order', ['tutorialId', 'order'], { unique: false });
        console.log(`[IDB] Object store '${STORE_HEADERS}' created.`);
      }
      
      let tutorialStepsStore;
      if (!db.objectStoreNames.contains(STORE_TUTORIAL_STEPS)) {
        tutorialStepsStore = db.createObjectStore(STORE_TUTORIAL_STEPS, { keyPath: 'id', autoIncrement: true });
        tutorialStepsStore.createIndex('screenshotId', 'screenshotId', { unique: false });
        tutorialStepsStore.createIndex('tutorialId', 'tutorialId', { unique: false }); 
      } else {
        tutorialStepsStore = transaction.objectStore(STORE_TUTORIAL_STEPS);
        if (tutorialStepsStore.indexNames.contains('tutorialId_order')) {
          tutorialStepsStore.deleteIndex('tutorialId_order');
          console.log(`[IDB] Deleted old index 'tutorialId_order' from '${STORE_TUTORIAL_STEPS}'.`);
        }
      }
      
      if (!tutorialStepsStore.indexNames.contains('headerId')) {
         tutorialStepsStore.createIndex('headerId', 'headerId', { unique: false });
         console.log(`[IDB] Index 'headerId' created on '${STORE_TUTORIAL_STEPS}'.`);
      }
      if (!tutorialStepsStore.indexNames.contains('headerId_order')) {
        tutorialStepsStore.createIndex('headerId_order', ['headerId', 'order'], { unique: true });
        console.log(`[IDB] Index 'headerId_order' created on '${STORE_TUTORIAL_STEPS}'.`);
      }

      console.log('[IDB] onupgradeneeded finished.');
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
    console.warn('[IDB] DB not initialized in addScreenshot. Trying to initialize now...');
    await initDB();
    if (!db) {
        console.error("[IDB] DB init failed in addScreenshot. Cannot add screenshot.");
        return Promise.reject('Database not available.');
    }
  }
  // Ensure tutorialId is explicitly null if not a valid existing ID.
  // For a new screenshot, screenshotData.tutorialId should be undefined or null.
  const currentTutorialId = screenshotData.tutorialId;
  const tutorialIdToSave = (typeof currentTutorialId === 'number' && currentTutorialId > 0) ? currentTutorialId : null;

  console.log(`[IDB] addScreenshot: Received tutorialId: ${currentTutorialId}, will save with: ${tutorialIdToSave}`);

  const dataToSave = { ...screenshotData, tutorialId: tutorialIdToSave };
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readwrite');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    const request = store.add(dataToSave);
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
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    const index = store.index('timestamp');
    const range = IDBKeyRange.upperBound(isoTimestamp, true); 
    const request = index.getAll(range);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (event) => reject(event.target.error);
  });
}

/**
 * Deletes a single screenshot record by its ID.
 * @param {number} id - The screenshot ID to delete.
 * @returns {Promise<void>} Promise that resolves when deletion is complete.
 */
export async function deleteScreenshot(id) {
  if (!db) await initDB();
  // Internally, we can reuse deleteScreenshots which expects an array
  return deleteScreenshots([id]);
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
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readwrite');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    let deleteCount = 0;
    let failedDeletes = 0;

    ids.forEach(id => {
      const request = store.delete(id);
      request.onsuccess = () => {
        deleteCount++;
        if (deleteCount + failedDeletes === ids.length) {
          console.log(`[IDB] Processed ${ids.length} deletions. Successful: ${deleteCount}, Failed: ${failedDeletes}.`);
          if (failedDeletes > 0) reject('Some screenshot deletions failed.');
          else resolve();
        }
      };
      request.onerror = (event) => {
        console.error(`[IDB] Error deleting screenshot ID ${id}:`, event.target.error);
        failedDeletes++;
        if (deleteCount + failedDeletes === ids.length) {
          reject('Some screenshot deletions failed.');
        }
      };
    });
    // transaction.oncomplete might be too early if individual requests are still pending.
  });
}

/**
 * Calculates the total storage used by imageSizeBytes in IndexedDB.
 * @returns {Promise<number>} Promise that resolves with total size in bytes.
 */
export async function getTotalStorageUsed() {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
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
        const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
        const store = transaction.objectStore(STORE_SCREENSHOTS);
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

/**
 * Retrieves screenshot records that are not yet assigned to any tutorial.
 * Screenshots are considered unassigned if their `tutorialId` is null or undefined.
 * @returns {Promise<Array<object>>} Promise that resolves with an array of unassigned screenshot records.
 */
export async function getUnassignedScreenshots() {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    const request = store.getAll(); // Get all screenshots

    request.onsuccess = () => {
      const allScreenshots = request.result || [];
      // Filter for screenshots where tutorialId is null or undefined
      const unassigned = allScreenshots.filter(s => s.tutorialId === null || s.tutorialId === undefined);
      console.log(`[IDB] Found ${unassigned.length} unassigned screenshots.`);
      resolve(unassigned);
    };
    request.onerror = (event) => {
      console.error('Error fetching unassigned screenshots:', event.target.error);
      reject(event.target.error);
    };
  });
}

export async function assignScreenshotToTutorial(screenshotId, tutorialId) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readwrite');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    const request = store.get(screenshotId);
    request.onsuccess = () => {
      const screenshot = request.result;
      if (screenshot) {
        screenshot.tutorialId = tutorialId;
        const updateRequest = store.put(screenshot);
        updateRequest.onsuccess = () => resolve();
        updateRequest.onerror = (event) => {
          console.error('[IDB] Error updating screenshot tutorialId:', event.target.error);
          reject(event.target.error);
        };
      } else {
        reject(new Error(`Screenshot with id ${screenshotId} not found`));
      }
    };
    request.onerror = (event) => reject(event.target.error);
  });
}

export async function addTutorial(tutorialData) {
  if (!db) await initDB();
  const now = new Date().toISOString();
  const dataToSave = {
    title: tutorialData.title,
    description: tutorialData.description || '',
    coverImageId: tutorialData.coverImageId || null,
    createdAt: now,
    updatedAt: now,
  };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIALS], 'readwrite');
    const store = transaction.objectStore(STORE_TUTORIALS);
    const request = store.add(dataToSave);
    request.onsuccess = (event) => resolve(event.target.result); // Returns the new tutorial ID
    request.onerror = (event) => {
      console.error('[IDB] Error adding tutorial:', event.target.error);
      reject(event.target.error);
    };
  });
}

export async function getAllTutorials() {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIALS], 'readonly');
    const store = transaction.objectStore(STORE_TUTORIALS);
    const index = store.index('createdAt'); // Sort by creation date or title
    const request = index.getAll(); // Or store.getAll() if no specific sort needed here
    request.onsuccess = () => resolve(request.result.reverse() || []); // Reverse for newest first
    request.onerror = (event) => {
      console.error('[IDB] Error fetching all tutorials:', event.target.error);
      reject(event.target.error);
    };
  });
}

export async function getTutorialById(tutorialId) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIALS], 'readonly');
    const store = transaction.objectStore(STORE_TUTORIALS);
    const request = store.get(tutorialId);
    request.onsuccess = (event) => {
      if (event.target.result) {
        resolve(event.target.result);
      } else {
        reject(`[IDB] Tutorial with ID ${tutorialId} not found.`);
      }
    };
    request.onerror = (event) => {
      console.error(`[IDB] Error fetching tutorial by ID ${tutorialId}:`, event.target.error);
      reject(event.target.error);
    };
  });
}

export async function updateTutorial(tutorialId, dataToUpdate) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIALS], 'readwrite');
    const store = transaction.objectStore(STORE_TUTORIALS);
    const getRequest = store.get(tutorialId);

    getRequest.onsuccess = () => {
      const tutorial = getRequest.result;
      if (!tutorial) {
        reject(`Tutorial with ID ${tutorialId} not found.`);
        return;
      }
      // Merge existing data with new data
      const updatedTutorial = { ...tutorial, ...dataToUpdate, updatedAt: new Date().toISOString() };
      const putRequest = store.put(updatedTutorial);
      putRequest.onsuccess = () => {
        console.log(`[IDB] Tutorial ${tutorialId} updated successfully.`);
        resolve(putRequest.result);
      };
      putRequest.onerror = (event) => {
        console.error(`[IDB] Error updating tutorial ${tutorialId}:`, event.target.error);
        reject(event.target.error);
      };
    };
    getRequest.onerror = (event) => {
      console.error(`[IDB] Error fetching tutorial ${tutorialId} for update:`, event.target.error);
      reject(event.target.error);
    };
  });
}

export async function addTutorialStep(stepData) {
  if (!db) await initDB();
  const dataToSave = {
    headerId: stepData.headerId,
    screenshotId: stepData.screenshotId,
    order: stepData.order,
    notes: stepData.notes || '', // Default to empty notes
    title: stepData.title || 'Untitled Step' // Added title, with a default
  };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIAL_STEPS], 'readwrite');
    const store = transaction.objectStore(STORE_TUTORIAL_STEPS);
    const request = store.add(dataToSave);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => {
      console.error('[IDB] Error adding tutorial step:', event.target.error);
      reject(event.target.error);
    };
  });
}

export async function getStepsForHeader(headerId) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIAL_STEPS], 'readonly');
    const store = transaction.objectStore(STORE_TUTORIAL_STEPS);
    const index = store.index('headerId_order');
    const range = IDBKeyRange.bound([headerId, -Infinity], [headerId, Infinity]);
    const request = index.getAll(range);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (event) => {
      console.error(`[IDB] Error fetching steps for header ${headerId}:`, event.target.error);
      reject(event.target.error);
    };
  });
}

export async function deleteTutorialStepsByScreenshotId(screenshotId) {
    if (!db) await initDB();
    return new Promise(async (resolve, reject) => {
        const transaction = db.transaction([STORE_TUTORIAL_STEPS], 'readwrite');
        const store = transaction.objectStore(STORE_TUTORIAL_STEPS);
        const index = store.index('screenshotId');
        const request = index.openCursor(IDBKeyRange.only(screenshotId));
        const deletePromises = [];

        await new Promise((resolveCursor, rejectCursor) => {
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    deletePromises.push(new Promise((res, rej) => {
                        const deleteSingleStepRequest = store.delete(cursor.primaryKey);
                        deleteSingleStepRequest.onsuccess = () => {
                            console.log(`[IDB] Deleted tutorial step ID ${cursor.primaryKey} (associated with screenshot ${screenshotId})`);
                            res();
                        };
                        deleteSingleStepRequest.onerror = (errEvent) => {
                             console.error(`[IDB] Error deleting tutorial step ID ${cursor.primaryKey}:`, errEvent.target.error);
                            rej(errEvent.target.error);
                        };
                    }));
                    cursor.continue();
                } else {
                    resolveCursor(); // All steps for this screenshot processed
                }
            };
            request.onerror = (event) => {
                console.error(`[IDB] Error finding tutorial steps for screenshot ID ${screenshotId}:`, event.target.error);
                rejectCursor(event.target.error);
            };
        });
        
        try {
            await Promise.all(deletePromises);
            console.log(`[IDB] All tutorial steps for screenshot ID ${screenshotId} processed for deletion.`);
            resolve();
        } catch (error) {
            console.error(`[IDB] Error in deleting one or more steps for screenshot ID ${screenshotId}:`, error);
            reject(error);
        }
    });
}

export async function getScreenshotBlob(id) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
        const store = transaction.objectStore(STORE_SCREENSHOTS);
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

export async function getRecentScreenshots(limit = 10) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
        const store = transaction.objectStore(STORE_SCREENSHOTS);
        const index = store.index('timestamp'); // Assuming a timestamp index exists for sorting
        const request = index.openCursor(null, 'prev'); // 'prev' for descending order (newest first)
        
        const results = [];
        let count = 0;

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && count < limit) {
                // Only include screenshots not assigned to a tutorial
                if (cursor.value.tutorialId === null || cursor.value.tutorialId === undefined) {
                    results.push(cursor.value);
                    count++;
                }
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        request.onerror = (event) => {
            console.error('Error fetching recent screenshots:', event.target.error);
            reject(event.target.error);
        };
    });
}

// New function to get a single screenshot by its ID
export async function getScreenshotById(id) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    const request = store.get(id);
    request.onsuccess = (event) => {
      if (event.target.result) {
        resolve(event.target.result);
      } else {
        reject(`Screenshot with ID ${id} not found.`);
      }
    };
    request.onerror = (event) => {
      console.error(`[IDB] Error fetching screenshot by ID ${id}:`, event.target.error);
      reject(event.target.error);
    };
  });
}

// New function to unassign a screenshot (set tutorialId to null)
async function unassignScreenshot(screenshotId) { // Not exported, as it's a helper for deleteTutorial
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readwrite');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    const request = store.get(screenshotId);
    request.onsuccess = () => {
      const screenshot = request.result;
      if (screenshot) {
        screenshot.tutorialId = null;
        const updateRequest = store.put(screenshot);
        updateRequest.onsuccess = () => {
          console.log(`[IDB] Screenshot ${screenshotId} unassigned from tutorial.`);
          resolve();
        };
        updateRequest.onerror = (event) => {
          console.error(`[IDB] Error unassigning screenshot ${screenshotId}:`, event.target.error);
          reject(event.target.error);
        };
      } else {
        // If screenshot not found, maybe it was already deleted. Resolve without error.
        console.warn(`[IDB] Screenshot ${screenshotId} not found during unassignment. Assuming already deleted or handled.`);
        resolve(); 
      }
    };
    request.onerror = (event) => {
        console.error(`[IDB] Error fetching screenshot ${screenshotId} for unassignment:`, event.target.error);
        reject(event.target.error);
    }
  });
}

// New function to delete all steps for a given tutorialId
async function deleteTutorialStepsByTutorialId(tutorialId) { // Not exported, helper for deleteTutorial
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIAL_STEPS], 'readwrite');
    const store = transaction.objectStore(STORE_TUTORIAL_STEPS);
    const index = store.index('tutorialId');
    const request = index.openCursor(IDBKeyRange.only(tutorialId));
    const deletePromises = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        deletePromises.push(new Promise((res, rej) => {
          const deleteRequest = store.delete(cursor.primaryKey);
          deleteRequest.onsuccess = () => {
            console.log(`[IDB] Deleted tutorial step with ID ${cursor.primaryKey} for tutorial ${tutorialId}`);
            res();
          };
          deleteRequest.onerror = (errEvent) => {
            console.error(`[IDB] Error deleting tutorial step ID ${cursor.primaryKey}:`, errEvent.target.error);
            rej(errEvent.target.error);
          };
        }));
        cursor.continue();
      } else {
        Promise.all(deletePromises)
          .then(() => {
            console.log(`[IDB] All tutorial steps for tutorial ID ${tutorialId} deleted.`);
            resolve();
          })
          .catch(reject);
      }
    };
    request.onerror = (event) => {
      console.error(`[IDB] Error finding tutorial steps for tutorial ID ${tutorialId}:`, event.target.error);
      reject(event.target.error);
    };
  });
}

// New function to delete a tutorial, its steps, and unassign screenshots
export async function deleteTutorial(tutorialId) {
  if (!db) await initDB();
  console.log(`[IDB] Attempting to delete tutorial ID: ${tutorialId}`);
  try {
    // 1. Get all headers for the tutorial
    const headers = await getHeadersForTutorial(tutorialId);
    console.log(`[IDB] Found ${headers.length} headers for tutorial ${tutorialId}.`);

    // 2. Delete each header (which will also delete its steps)
    for (const header of headers) {
      await deleteHeader(header.id); // This function now handles step deletion too
    }
    console.log(`[IDB] Successfully deleted headers (and their steps) for tutorial ${tutorialId}.`);

    // 3. Unassign all screenshots that were part of this tutorial's steps
    // This step needs careful thought: deleteHeader should have deleted steps.
    // We need to collect all screenshotIds from all steps of the tutorial *before* deleting them.
    // For simplicity now, this part is omitted as deleteHeader/deleteStepsForHeader does not return screenshotIds.
    // A more robust deleteTutorial would first collect all screenshotIds from its steps.
    // For now, screenshots might remain assigned if not handled carefully.
    // Let's assume for now that unassigning is handled elsewhere or not strictly required for this phase.
    // The assignScreenshotToTutorial sets tutorialId on screenshot. This should be cleared.
    // This requires getting all steps for the tutorial first, collect screenshotIds, then proceed.
    
    // Let's fetch all screenshots associated with this tutorial for unassignment
    const allScreenshotsInTutorial = await getAllScreenshotsForTutorial(tutorialId); // NEW HELPER NEEDED
    const unassignPromises = allScreenshotsInTutorial.map(s => unassignScreenshot(s.id));
    await Promise.all(unassignPromises);
    console.log(`[IDB] Successfully unassigned ${allScreenshotsInTutorial.length} screenshots from tutorial ${tutorialId}.`);


    // 4. Delete the tutorial itself from STORE_TUTORIALS
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_TUTORIALS], 'readwrite'); // Only STORE_TUTORIALS needed here
      const store = transaction.objectStore(STORE_TUTORIALS);
      const request = store.delete(tutorialId);
      request.onsuccess = () => {
        console.log(`[IDB] Tutorial ${tutorialId} deleted successfully from store.`);
        resolve();
      };
      request.onerror = (event) => {
        console.error(`[IDB] Error deleting tutorial ${tutorialId} from store:`, event.target.error);
        reject(event.target.error);
      };
    });
  } catch (error) {
    console.error(`[IDB] Comprehensive error in deleteTutorial for ID ${tutorialId}:`, error);
    throw error; // Re-throw to be caught by caller
  }
}

// Helper for deleteTutorial: Get all screenshot records associated with a tutorial
async function getAllScreenshotsForTutorial(tutorialId) {
    if (!db) await initDB();
    // This is a simplified way. A more direct way would be to query steps, then get screenshots.
    // For now, this queries screenshots store for the tutorialId.
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_SCREENSHOTS], 'readonly');
        const store = transaction.objectStore(STORE_SCREENSHOTS);
        const index = store.index('tutorialId'); // Assumes 'tutorialId' index on screenshots store
        const request = index.getAll(IDBKeyRange.only(tutorialId));
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => {
            console.error(`[IDB] Error fetching all screenshots for tutorial ${tutorialId}:`, event.target.error);
            reject(event.target.error);
        };
    });
}

// --- NEW HEADER FUNCTIONS ---
export async function addHeader(headerData) {
  if (!db) await initDB();
  const dataToSave = {
    tutorialId: headerData.tutorialId,
    title: headerData.title || 'Untitled Header',
    description: headerData.description || '',
    order: headerData.order // Should be pre-calculated using getNextHeaderOrder
  };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_HEADERS], 'readwrite');
    const store = transaction.objectStore(STORE_HEADERS);
    const request = store.add(dataToSave);
    request.onsuccess = (event) => resolve(event.target.result); // New Header ID
    request.onerror = (event) => {
      console.error('[IDB] Error adding header:', event.target.error);
      reject(event.target.error);
    };
  });
}

export async function getHeadersForTutorial(tutorialId) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_HEADERS], 'readonly');
    const store = transaction.objectStore(STORE_HEADERS);
    const index = store.index('tutorialId_order');
    const range = IDBKeyRange.bound([tutorialId, -Infinity], [tutorialId, Infinity]);
    const request = index.getAll(range);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (event) => {
      console.error(`[IDB] Error fetching headers for tutorial ${tutorialId}:`, event.target.error);
      reject(event.target.error);
    };
  });
}

export async function updateHeader(headerId, dataToUpdate) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_HEADERS], 'readwrite');
    const store = transaction.objectStore(STORE_HEADERS);
    const getRequest = store.get(headerId);
    getRequest.onsuccess = () => {
      const header = getRequest.result;
      if (!header) return reject(`Header with ID ${headerId} not found.`);
      const updatedHeader = { ...header, ...dataToUpdate };
      const putRequest = store.put(updatedHeader);
      putRequest.onsuccess = () => resolve(putRequest.result);
      putRequest.onerror = (event) => reject(event.target.error);
    };
    getRequest.onerror = (event) => reject(event.target.error);
  });
}

async function deleteStepsForHeader(headerId, transaction) { // Internal helper, uses existing transaction
    const store = transaction.objectStore(STORE_TUTORIAL_STEPS);
    const index = store.index('headerId'); // Assuming 'headerId' index exists
    const request = index.openCursor(IDBKeyRange.only(headerId));
    const deletePromises = [];
    await new Promise((resolveCursor, rejectCursor) => {
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                deletePromises.push(new Promise((res, rej) => {
                    const deleteRequest = cursor.delete(); // Use cursor.delete()
                    deleteRequest.onsuccess = () => {
                        console.log(`[IDB] Deleted tutorial step ID ${cursor.primaryKey} for header ${headerId}`);
                        res();
                    };
                    deleteRequest.onerror = (errEvent) => {
                         console.error(`[IDB] Error deleting tutorial step ID ${cursor.primaryKey}:`, errEvent.target.error);
                        rej(errEvent.target.error);
                    };
                }));
                cursor.continue();
            } else {
                resolveCursor(); // All steps for this header processed
            }
        };
        request.onerror = (event) => {
            console.error(`[IDB] Error finding steps for header ID ${headerId}:`, event.target.error);
            rejectCursor(event.target.error);
        };
    });
    return Promise.all(deletePromises);
}

export async function deleteHeader(headerId) {
  if (!db) await initDB();
  return new Promise(async (resolve, reject) => { // Outer promise for the whole operation
    const transaction = db.transaction([STORE_HEADERS, STORE_TUTORIAL_STEPS], 'readwrite');
    const headersStore = transaction.objectStore(STORE_HEADERS);
    
    // Define oncomplete and onerror for the transaction itself
    transaction.oncomplete = () => {
        console.log(`[IDB] Header ${headerId} and its steps deleted successfully.`);
        resolve();
    };
    transaction.onerror = (event) => {
        console.error(`[IDB] Transaction error deleting header ${headerId}:`, event.target.error);
        reject(event.target.error);
    };

    try {
        // 1. Delete all steps associated with this header
        await deleteStepsForHeader(headerId, transaction); // Pass the transaction
        console.log(`[IDB] Finished attempting to delete steps for header ${headerId}.`);

        // 2. Delete the header itself
        const deleteHeaderRequest = headersStore.delete(headerId);
        // We don't need individual onsuccess/onerror for deleteHeaderRequest if transaction.oncomplete/onerror handles it.
        // However, for clarity or specific error on this step:
        deleteHeaderRequest.onerror = (event) => { // This might be redundant if caught by transaction.onerror
            console.error(`[IDB] Error directly deleting header ${headerId} record:`, event.target.error);
            // transaction.abort() might be needed if we want to stop here
        };
        // No explicit resolve here, transaction.oncomplete handles it.

    } catch (error) { // Catch errors from deleteStepsForHeader
        console.error(`[IDB] Error during deleteHeader operation (likely from steps):`, error);
        transaction.abort(); // Abort transaction on failure
        reject(error); // Reject the main promise
    }
  });
}

export async function getNextHeaderOrder(tutorialId) {
    if (!db) await initDB();
    const headers = await getHeadersForTutorial(tutorialId);
    return headers.length > 0 ? Math.max(...headers.map(h => h.order)) + 1 : 0;
}

export async function getNextStepOrder(headerId) {
    if (!db) await initDB();
    const steps = await getStepsForHeader(headerId);
    return steps.length > 0 ? Math.max(...steps.map(s => s.order)) + 1 : 0;
}

export async function updateTutorialStep(stepId, dataToUpdate) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_TUTORIAL_STEPS], 'readwrite');
    const store = transaction.objectStore(STORE_TUTORIAL_STEPS);
    const getRequest = store.get(stepId);
    getRequest.onsuccess = () => {
      const step = getRequest.result;
      if (!step) return reject(`Tutorial step with ID ${stepId} not found.`);
      // Ensure headerId is not accidentally changed unless explicitly part of dataToUpdate for a "move step" operation
      const updatedStep = { ...step, ...dataToUpdate }; 
      const putRequest = store.put(updatedStep);
      putRequest.onsuccess = () => resolve(putRequest.result);
      putRequest.onerror = (event) => reject(event.target.error);
    };
    getRequest.onerror = (event) => reject(event.target.error);
  });
}

export async function updateScreenshot(screenshotId, dataToUpdate) {
  if (!db) await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_SCREENSHOTS], 'readwrite');
    const store = transaction.objectStore(STORE_SCREENSHOTS);
    const getRequest = store.get(screenshotId);

    getRequest.onsuccess = () => {
      const screenshot = getRequest.result;
      if (!screenshot) {
        console.error(`[IDB] Screenshot with ID ${screenshotId} not found for update.`);
        reject(`Screenshot with ID ${screenshotId} not found for update.`);
        return;
      }
      // Merge existing data with new data, or replace if dataToUpdate is the full new object.
      // In our case from edit-tutorial.js, dataToUpdate is intended to be the full new object.
      const updatedScreenshot = { ...screenshot, ...dataToUpdate, id: screenshotId }; // Ensure ID is preserved
      
      const putRequest = store.put(updatedScreenshot);
      putRequest.onsuccess = () => {
        console.log(`[IDB] Screenshot ${screenshotId} updated successfully.`);
        resolve(putRequest.result);
      };
      putRequest.onerror = (event) => {
        console.error(`[IDB] Error updating screenshot ${screenshotId}:`, event.target.error);
        reject(event.target.error);
      };
    };
    getRequest.onerror = (event) => {
      console.error(`[IDB] Error fetching screenshot ${screenshotId} for update:`, event.target.error);
      reject(event.target.error);
    };
  });
} 
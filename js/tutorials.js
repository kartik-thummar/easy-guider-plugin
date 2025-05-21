// js/tutorials.js
import * as idbHelper from './idb-helper.js';

console.log('Tutorials page script loaded.');

document.addEventListener('DOMContentLoaded', () => {
  const backToPopupButton = document.getElementById('backToPopup');
  // const createNewTutorialButton = document.getElementById('createNewTutorialFromListPage');
  const tutorialsListContainer = document.getElementById('tutorialsListContainer');
  const emptyMessageP = tutorialsListContainer.querySelector('.empty-message'); // Get the existing empty message p

  if (backToPopupButton) {
    backToPopupButton.addEventListener('click', () => {
      alert('To return to the capture view, please click the extension icon in your browser toolbar.');
    });
  }

  async function loadTutorials() {
    console.log('[TutorialsPage] Loading tutorials...');
    try {
      await idbHelper.initDB(); // Ensure DB is initialized
      const tutorials = await idbHelper.getAllTutorials();
      console.log('[TutorialsPage] Retrieved tutorials:', tutorials);

      if (!tutorialsListContainer) {
        console.error('[TutorialsPage] tutorialsListContainer not found in DOM.');
        return;
      }
      
      // Clear only if we are about to add items, keep empty message otherwise
      // tutorialsListContainer.innerHTML = ''; // Clear previous content

      if (tutorials && tutorials.length > 0) {
        if(emptyMessageP) emptyMessageP.style.display = 'none';
        tutorialsListContainer.innerHTML = ''; // Clear if we have tutorials to show

        for (const tutorial of tutorials) {
          console.log(`[TutorialsPage] Processing tutorial ${tutorial.id}:`, tutorial);
          // Get headers and their steps
          const headers = await idbHelper.getHeadersForTutorial(tutorial.id);
          console.log(`[TutorialsPage] Retrieved headers for tutorial ${tutorial.id}:`, headers);
          let totalSteps = 0;
          
          // Count total steps across all headers
          for (const header of headers) {
            const stepsForHeader = await idbHelper.getStepsForHeader(header.id);
            console.log(`[TutorialsPage] Retrieved steps for header ${header.id}:`, stepsForHeader);
            totalSteps += stepsForHeader.length;
          }
          console.log(`[TutorialsPage] Total steps for tutorial ${tutorial.id}: ${totalSteps}`);

          const tutorialElement = document.createElement('div');
          tutorialElement.classList.add('tutorial-item');
          tutorialElement.dataset.tutorialId = tutorial.id;

          let coverImageHTML = '<div class="tutorial-cover-placeholder">No Cover</div>';
          if (tutorial.coverImageId) {
            try {
                // We need the thumbnailDataUrl from the screenshot store for the cover image
                const coverScreenshot = await idbHelper.getScreenshotById(tutorial.coverImageId);
                if (coverScreenshot && coverScreenshot.thumbnailDataUrl) {
                    coverImageHTML = `<img src="${coverScreenshot.thumbnailDataUrl}" alt="${tutorial.title} Cover" class="tutorial-cover-image">`;
                }
            } catch (imgError) {
                console.warn(`[TutorialsPage] Could not load cover image for tutorial ${tutorial.id}:`, imgError);
            }
          }

          tutorialElement.innerHTML = `
            <div class="tutorial-item-header">
              <h3>${tutorial.title || 'Untitled Tutorial'}</h3>
              ${coverImageHTML}
            </div>
            <div class="tutorial-item-meta">
              <p>Steps: ${totalSteps}</p>
              <p>Headers: ${headers.length}</p>
              <p>Created: ${new Date(tutorial.createdAt).toLocaleDateString()}</p>
              <p>Updated: ${new Date(tutorial.updatedAt).toLocaleDateString()}</p>
              ${tutorial.description ? `<p class="description">${truncateText(tutorial.description, 100)}</p>` : ''}
            </div>
            <div class="tutorial-item-actions">
              <button class="view-tutorial" data-id="${tutorial.id}">View</button>
              <button class="edit-tutorial" data-id="${tutorial.id}">Edit</button>
              <button class="delete-tutorial" data-id="${tutorial.id}">Delete</button>
            </div>
          `;
          tutorialsListContainer.appendChild(tutorialElement);
        }
      } else {
        if(emptyMessageP) {
            emptyMessageP.textContent = 'No tutorials created yet.';
            emptyMessageP.style.display = 'block';
            // Ensure container is empty except for the message
            const otherContent = tutorialsListContainer.querySelectorAll(':not(.empty-message)');
            otherContent.forEach(node => node.remove());
            if (!tutorialsListContainer.contains(emptyMessageP)) {
                tutorialsListContainer.appendChild(emptyMessageP);
            }
        } else {
            tutorialsListContainer.innerHTML = '<p class="empty-message">No tutorials created yet.</p>';
        }
      }
    } catch (error) {
      console.error('[TutorialsPage] Error loading tutorials:', error);
      if (emptyMessageP) {
        emptyMessageP.textContent = 'Error loading tutorials.';
        emptyMessageP.style.display = 'block';
         if (!tutorialsListContainer.contains(emptyMessageP)) {
            tutorialsListContainer.appendChild(emptyMessageP);
        }
      } else {
        tutorialsListContainer.innerHTML = '<p class="empty-message">Error loading tutorials.</p>';
      }
    }
  }
  
  function truncateText(text, maxLength = 100) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  // Add event listeners for dynamically created buttons (using event delegation)
  tutorialsListContainer.addEventListener('click', async (event) => {
    const target = event.target;
    const tutorialIdString = target.dataset.id;

    if (!tutorialIdString) return;
    const tutorialId = parseInt(tutorialIdString, 10); // Ensure it's a number for IDB operations
    if (isNaN(tutorialId)) {
        console.error("[TutorialsPage] Invalid tutorialId:", tutorialIdString);
        return;
    }

    if (target.classList.contains('view-tutorial')) {
      console.log(`View tutorial ${tutorialId}`);
      window.location.href = `view-tutorial.html?id=${tutorialId}`;
    } else if (target.classList.contains('edit-tutorial')) {
      console.log(`Edit tutorial ${tutorialId}`);
      window.location.href = `edit-tutorial.html?id=${tutorialId}`;
    } else if (target.classList.contains('delete-tutorial')) {
      console.log(`[TutorialsPage] Delete button clicked for tutorial ID ${tutorialId}`);
      if (confirm(`Are you sure you want to delete this tutorial? Screenshots will be kept and marked as unassigned.`)) {
        try {
          await idbHelper.deleteTutorial(tutorialId);
          console.log(`[TutorialsPage] Tutorial ${tutorialId} successfully deleted. Reloading list.`);
          alert('Tutorial deleted successfully.');
          loadTutorials(); // Refresh the list of tutorials
        } catch (error) {
          console.error(`[TutorialsPage] Error deleting tutorial ${tutorialId}:`, error);
          alert('Failed to delete tutorial. Check console for details.');
        }
      }
    }
  });

  loadTutorials();
}); 
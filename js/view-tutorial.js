import * as idbHelper from './idb-helper.js';

document.addEventListener('DOMContentLoaded', async () => {
    const tutorialTitleH1 = document.getElementById('tutorialTitle');
    const tutorialDescriptionP = document.getElementById('tutorialDescription');
    const tutorialCreatedDateSpan = document.getElementById('tutorialCreatedDate');
    const tutorialUpdatedDateSpan = document.getElementById('tutorialUpdatedDate');
    const stepsListDiv = document.getElementById('stepsList');
    const editTutorialButton = document.getElementById('editTutorialButton');

    const urlParams = new URLSearchParams(window.location.search);
    const tutorialIdString = urlParams.get('id');

    if (!tutorialIdString) {
        tutorialTitleH1.textContent = 'Tutorial Not Found';
        stepsListDiv.innerHTML = '<p class="empty-message">No tutorial ID provided in the URL.</p>';
        if(tutorialDescriptionP) tutorialDescriptionP.textContent = ''
        return;
    }

    const tutorialId = parseInt(tutorialIdString, 10);
    if (isNaN(tutorialId)) {
        tutorialTitleH1.textContent = 'Invalid Tutorial ID';
        stepsListDiv.innerHTML = '<p class="empty-message">The provided tutorial ID is not valid.</p>';
        if(tutorialDescriptionP) tutorialDescriptionP.textContent = ''
        return;
    }
    
    if(editTutorialButton) {
        editTutorialButton.addEventListener('click', () => {
            window.location.href = `html/edit-tutorial.html?id=${tutorialId}`;
        });
    }

    try {
        await idbHelper.initDB(); // Ensure DB is initialized
        const tutorial = await idbHelper.getTutorialById(tutorialId);

        if (!tutorial) {
            tutorialTitleH1.textContent = 'Tutorial Not Found';
            stepsListDiv.innerHTML = `<p class="empty-message">Could not find a tutorial with ID ${tutorialId}.</p>`;
            if(tutorialDescriptionP) tutorialDescriptionP.textContent = ''
            return;
        }

        // Update the tutorial meta section
        tutorialTitleH1.textContent = tutorial.title || 'Untitled Tutorial';
        document.title = tutorial.title ? `View: ${tutorial.title}` : 'View Tutorial'; // Update page title
        tutorialDescriptionP.textContent = tutorial.description || 'No description provided.';
        
        // Update the meta info section
        const metaInfo = document.createElement('div');
        metaInfo.classList.add('meta-info');
        metaInfo.innerHTML = `
            <span>Created: <span id="tutorialCreatedDate">${new Date(tutorial.createdAt).toLocaleString()}</span></span>
            <span>Updated: <span id="tutorialUpdatedDate">${new Date(tutorial.updatedAt).toLocaleString()}</span></span>
        `;
        tutorialDescriptionP.after(metaInfo);

        // Get all headers for this tutorial
        const headers = await idbHelper.getHeadersForTutorial(tutorialId);
        
        if (headers && headers.length > 0) {
            stepsListDiv.innerHTML = ''; // Clear loading message
            
            // Sort headers by order
            headers.sort((a, b) => a.order - b.order);
            
            for (const header of headers) {
                // Create header element
                const headerElement = document.createElement('div');
                headerElement.classList.add('tutorial-header');
                headerElement.innerHTML = `
                    <h3>${header.title || 'Untitled Header'}</h3>
                    ${header.description ? `<div class="header-description">${header.description}</div>` : ''}
                    <div class="header-steps" data-header-id="${header.id}"></div>
                `;
                stepsListDiv.appendChild(headerElement);
                
                // Get steps for this header
                const steps = await idbHelper.getStepsForHeader(header.id);
                const stepsContainer = headerElement.querySelector(`.header-steps[data-header-id="${header.id}"]`);
                
                if (steps && steps.length > 0) {
                    // Sort steps by order
                    steps.sort((a, b) => a.order - b.order);
                    
                    for (const step of steps) {
                        const stepElement = document.createElement('div');
                        stepElement.classList.add('step-item');
                        stepElement.dataset.stepId = step.id;

                        let screenshot = null;
                        let thumbnailHTML = '<div class="step-thumbnail-placeholder">No Screenshot</div>';
                        
                        if (step.screenshotId) {
                            screenshot = await idbHelper.getScreenshotById(step.screenshotId);
                            if (screenshot && screenshot.thumbnailDataUrl) {
                                thumbnailHTML = `<img src="${screenshot.thumbnailDataUrl}" alt="Step thumbnail" class="step-thumbnail">`;
                            } else if (screenshot) {
                                thumbnailHTML = '<div class="step-thumbnail-placeholder">Thumbnail Missing</div>';
                            }
                        }
                        
                        const stepTitle = screenshot ? (screenshot.pageTitle || `Step ${step.order + 1}`) : `Step ${step.order + 1}`;

                        stepElement.innerHTML = `
                            ${thumbnailHTML}
                            <div class="step-info">
                                <h4>${stepTitle}</h4>
                                <p><strong>URL:</strong> ${screenshot ? screenshot.pageUrl : 'N/A'}</p>
                                <div class="step-notes">
                                    <strong>Notes:</strong>
                                    ${step.notes ? step.notes : '<p><em>No notes for this step.</em></p>'}
                                </div>
                            </div>
                        `;
                        stepsContainer.appendChild(stepElement);
                    }
                } else {
                    stepsContainer.innerHTML = '<p class="empty-message">This header has no steps.</p>';
                }
            }
        } else {
            stepsListDiv.innerHTML = '<p class="empty-message">This tutorial has no headers or steps.</p>';
        }

    } catch (error) {
        console.error('[ViewTutorialPage] Error loading tutorial:', error);
        tutorialTitleH1.textContent = 'Error Loading Tutorial';
        stepsListDiv.innerHTML = `<p class="empty-message">Error loading tutorial: ${error.message}. Check console for details.</p>`;
        if(tutorialDescriptionP) tutorialDescriptionP.textContent = 'Details unavailable.';
    }
}); 
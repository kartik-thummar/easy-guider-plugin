import * as idbHelper from './idb-helper.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[EditTutorial] Script loaded.');

    const tutorialNameDisplay = document.getElementById('tutorialNameDisplay');
    const tutorialTitleInput = document.getElementById('tutorialTitleInput');
    const tutorialDescriptionInput = document.getElementById('tutorialDescriptionInput');
    const tutorialHeadersContainer = document.getElementById('tutorialHeadersContainer');
    const saveTutorialChangesButton = document.getElementById('saveTutorialChanges');
    const deleteFullTutorialButton = document.getElementById('deleteFullTutorial');
    const cancelEditTutorialButton = document.getElementById('cancelEditTutorial');
    const addNewHeaderButton = document.getElementById('addNewHeader');
    const loadingMessageP = document.getElementById('loadingMessage') || tutorialHeadersContainer.querySelector('.loading-message');

    // Image Editor Modal Elements
    const imageEditorModal = document.getElementById('imageEditorModal');
    const imageEditorContainer = document.getElementById('tui-image-editor-container');
    const imageEditorSaveButton = document.getElementById('imageEditorSaveButton');
    const imageEditorCancelButton = document.getElementById('imageEditorCancelButton');
    const imageEditorCloseBtn = imageEditorModal.querySelector('.image-editor-close-btn');
    
    let tuiImageEditorInstance = null;
    let currentEditingStepId = null; // To know which step's image is being edited
    let currentEditingScreenshotBlob = null; // To store the blob being edited

    let currentTutorialId = null;
    let quillStepInstances = []; // For step notes
    let quillHeaderInstances = []; // For header descriptions (to be added later)
    let currentHeadersData = []; // Will store headers, each with its steps array: [{id, title, description, order, steps: [...]}, ...]

    const params = new URLSearchParams(window.location.search);
    currentTutorialId = parseInt(params.get('id'), 10);

    if (isNaN(currentTutorialId)) {
        console.error('[EditTutorial] Invalid or missing tutorial ID.');
        if (tutorialNameDisplay) tutorialNameDisplay.textContent = 'Invalid ID';
        if (loadingMessageP) loadingMessageP.textContent = 'Could not load tutorial: Invalid ID provided.';
        if (saveTutorialChangesButton) saveTutorialChangesButton.disabled = true;
        if (deleteFullTutorialButton) deleteFullTutorialButton.disabled = true;
        return;
    }

    console.log(`[EditTutorial] Editing tutorial ID: ${currentTutorialId}`);

    async function loadTutorialData() {
        if (loadingMessageP) loadingMessageP.style.display = 'block';
        tutorialHeadersContainer.innerHTML = '';
        if (loadingMessageP) tutorialHeadersContainer.appendChild(loadingMessageP); 
        quillStepInstances = [];
        quillHeaderInstances = []; // Reset header quill instances too
        currentHeadersData = []; // Reset headers data

        try {
            await idbHelper.initDB();
            const tutorial = await idbHelper.getTutorialById(currentTutorialId);
            if (!tutorial) {
                console.error(`[EditTutorial] Tutorial with ID ${currentTutorialId} not found.`);
                if (tutorialNameDisplay) tutorialNameDisplay.textContent = 'Not Found';
                if (loadingMessageP) loadingMessageP.textContent = 'Tutorial not found.';
                if (saveTutorialChangesButton) saveTutorialChangesButton.disabled = true;
                if (deleteFullTutorialButton) deleteFullTutorialButton.disabled = true;
                return;
            }

            console.log('[EditTutorial] Tutorial data:', tutorial);
            if (tutorialNameDisplay) tutorialNameDisplay.textContent = tutorial.title;
            if (tutorialTitleInput) tutorialTitleInput.value = tutorial.title;
            if (tutorialDescriptionInput) tutorialDescriptionInput.value = tutorial.description || '';

            const headersFromDB = await idbHelper.getHeadersForTutorial(currentTutorialId);
            console.log('[EditTutorial] Headers data loaded:', headersFromDB);

            for (const header of headersFromDB) {
                const stepsForHeader = await idbHelper.getStepsForHeader(header.id);
                // Ensure steps are sorted by their order property if not already guaranteed by getStepsForHeader
                // (getStepsForHeader uses 'headerId_order' index, so they should be sorted)
                header.steps = stepsForHeader; 
                currentHeadersData.push(header); // Add header with its steps to our main data array
            }
            console.log('[EditTutorial] currentHeadersData populated:', currentHeadersData);

            if (loadingMessageP) loadingMessageP.style.display = 'none';

            if (currentHeadersData && currentHeadersData.length > 0) {
                currentHeadersData.forEach((header, headerIndex) => {
                    renderHeaderEditor(header, headerIndex);
                });
            } else {
                const noContentMessage = document.createElement('p');
                noContentMessage.classList.add('empty-message');
                noContentMessage.textContent = 'This tutorial has no headers or steps yet.';
                tutorialHeadersContainer.appendChild(noContentMessage);
            }

        } catch (error) {
            console.error('[EditTutorial] Error loading tutorial data:', error);
            if (tutorialNameDisplay) tutorialNameDisplay.textContent = 'Error';
            if (loadingMessageP) {
                loadingMessageP.textContent = 'Error loading tutorial details. See console.';
                loadingMessageP.style.display = 'block'; 
            }
            if (saveTutorialChangesButton) saveTutorialChangesButton.disabled = true;
             if (deleteFullTutorialButton) deleteFullTutorialButton.disabled = true;
        }
    }

    async function moveHeader(headerId, direction) {
        console.log(`[EditTutorial] moveHeader called for headerId: ${headerId}, direction: ${direction}`);
        
        const headerIndex = currentHeadersData.findIndex(h => h.id === headerId);
        if (headerIndex === -1) {
            console.error('[EditTutorial] Header not found for reordering:', headerId);
            return;
        }

        if (direction === 'up' && headerIndex === 0) {
            console.log('[EditTutorial] Header already at the top.');
            return;
        }
        if (direction === 'down' && headerIndex === currentHeadersData.length - 1) {
            console.log('[EditTutorial] Header already at the bottom.');
            return;
        }

        const otherIndex = direction === 'up' ? headerIndex - 1 : headerIndex + 1;
        const headerToMove = currentHeadersData[headerIndex];
        const otherHeader = currentHeadersData[otherIndex];
        
        // Store original orders
        const originalOrderOfHeaderToMove = headerToMove.order;
        const originalOrderOfOtherHeader = otherHeader.order;
        
        try {
            // Use a temporary order value to avoid conflicts
            const tempOrder = -Date.now();
            
            // Update orders in the database
            await idbHelper.updateHeader(headerToMove.id, { order: tempOrder });
            await idbHelper.updateHeader(otherHeader.id, { order: originalOrderOfHeaderToMove });
            await idbHelper.updateHeader(headerToMove.id, { order: originalOrderOfOtherHeader });

            // Update the local data structure
            [currentHeadersData[headerIndex], currentHeadersData[otherIndex]] = 
            [currentHeadersData[otherIndex], currentHeadersData[headerIndex]];
            
            // Refresh the UI
            await loadTutorialData();
        } catch (error) {
            console.error('[EditTutorial] Error updating header orders:', error);
            try {
                // Revert the changes
                await idbHelper.updateHeader(headerToMove.id, { order: originalOrderOfHeaderToMove });
                await idbHelper.updateHeader(otherHeader.id, { order: originalOrderOfOtherHeader });
            } catch (revertError) {
                console.error('[EditTutorial] Error reverting header orders:', revertError);
            }
            await loadTutorialData();
        }
    }

    function renderHeaderEditor(headerData, headerIndex) {
        console.log(`[EditTutorial] Rendering header ${headerIndex}:`, headerData);
        const headerEditorItem = document.createElement('div');
        headerEditorItem.classList.add('tutorial-header-editor-item');
        headerEditorItem.dataset.headerId = headerData.id;

        const headerTitleInputId = `header-title-input-${headerData.id}`;
        const headerDescriptionEditorId = `header-description-editor-${headerData.id}`;

        headerEditorItem.innerHTML = `
            <div class="header-controls">
                <span class="header-number">Header ${headerIndex + 1}</span> 
                <input type="text" class="header-title-input" id="${headerTitleInputId}" value="${(headerData.title || '').replace(/"/g, '&quot;')}" placeholder="Header Title">
                <div class="header-move-buttons">
                    <button class="header-move-up" title="Move header up">&#8593;</button>
                    <button class="header-move-down" title="Move header down">&#8595;</button>
                </div>
            </div>
            <div id="${headerDescriptionEditorId}" class="header-description-editor-container"></div>
            <div class="header-steps-container"></div>
            <div class="add-step-container">
                <button class="add-step-button">+ Add New Step</button>
            </div>
        `;
        tutorialHeadersContainer.appendChild(headerEditorItem);

        // Add event listeners for header reordering
        const moveUpButton = headerEditorItem.querySelector('.header-move-up');
        const moveDownButton = headerEditorItem.querySelector('.header-move-down');
        
        moveUpButton.addEventListener('click', () => moveHeader(headerData.id, 'up'));
        moveDownButton.addEventListener('click', () => moveHeader(headerData.id, 'down'));

        // Attach event listener for header title input
        const headerTitleInput = headerEditorItem.querySelector('.header-title-input');
        headerTitleInput.addEventListener('input', (e) => {
            const foundHeader = currentHeadersData.find(h => h.id === headerData.id);
            if (foundHeader) {
                foundHeader.title = e.target.value;
            }
        });

        // TODO: Initialize Quill for headerData.description (later phase)
        // Initialize Quill for header description
        try {
            const headerQuill = new Quill(`#${headerDescriptionEditorId}`, {
                theme: 'snow',
                modules: {
                    toolbar: [
                        ['bold', 'italic', 'underline', 'link'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['clean']
                    ]
                },
                placeholder: 'Add a description for this header...'
            });
            if (headerData.description) {
                headerQuill.clipboard.dangerouslyPasteHTML(headerData.description);
            }
            quillHeaderInstances.push({ headerId: headerData.id, instance: headerQuill });
            console.log(`[EditTutorial] Quill editor initialized for header ${headerData.id}`);
        } catch (e) {
            console.error(`[EditTutorial] Failed to initialize Quill for header ${headerData.id}:`, e);
            const errorDiv = document.getElementById(headerDescriptionEditorId);
            if(errorDiv) errorDiv.innerHTML = '<p style="color:red;">Error loading text editor for header. Check console.</p>';
        }

        const stepsContainer = headerEditorItem.querySelector('.header-steps-container');
        if (headerData.steps && headerData.steps.length > 0) {
            headerData.steps.forEach((step, stepIndex) => {
                // Pass headerId to renderStepEditor if it needs it directly
                renderStepEditor(step, null, stepIndex, headerData.id, stepsContainer); 
            });
        } else {
            const noStepsMessage = document.createElement('p');
            noStepsMessage.classList.add('empty-message');
            noStepsMessage.textContent = 'This header has no steps.';
            stepsContainer.appendChild(noStepsMessage);
        }

        // Add event listener for the Add Step button
        const addStepButton = headerEditorItem.querySelector('.add-step-button');
        addStepButton.addEventListener('click', () => addNewStep(headerData.id));
    }

    async function moveStep(stepId, direction) {
        console.log(`[EditTutorial] moveStep called for stepId: ${stepId}, direction: ${direction}`);
        
        // Find the header containing this step
        let headerContainingStep = null;
        let stepToMove = null;
        
        for (const header of currentHeadersData) {
            stepToMove = header.steps.find(s => s.id === stepId);
            if (stepToMove) {
                headerContainingStep = header;
                break;
            }
        }

        if (!headerContainingStep || !stepToMove) {
            console.error('[EditTutorial] Step or header not found for reordering:', stepId);
            return;
        }

        const currentIndex = headerContainingStep.steps.findIndex(s => s.id === stepId);
        if (currentIndex === -1) {
            console.error('[EditTutorial] Step index not found:', stepId);
            return;
        }

        if (direction === 'up' && currentIndex === 0) {
            console.log('[EditTutorial] Step already at the top.');
            return;
        }
        if (direction === 'down' && currentIndex === headerContainingStep.steps.length - 1) {
            console.log('[EditTutorial] Step already at the bottom.');
            return;
        }

        const otherIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        const otherStep = headerContainingStep.steps[otherIndex];
        
        // Store original orders
        const originalOrderOfStepToMove = stepToMove.order;
        const originalOrderOfOtherStep = otherStep.order;
        
        try {
            // Use a temporary order value to avoid conflicts
            const tempOrder = -Date.now();
            
            // 1. Move stepToMove to temporary order
            console.log(`[EditTutorial] Step 1: Moving step ${stepToMove.id} (order ${originalOrderOfStepToMove}) to temporary order ${tempOrder}`);
            await idbHelper.updateTutorialStep(stepToMove.id, { order: tempOrder });

            // 2. Move otherStep to stepToMove's original order
            console.log(`[EditTutorial] Step 2: Moving step ${otherStep.id} (order ${originalOrderOfOtherStep}) to order ${originalOrderOfStepToMove}`);
            await idbHelper.updateTutorialStep(otherStep.id, { order: originalOrderOfStepToMove });

            // 3. Move stepToMove to otherStep's original order
            console.log(`[EditTutorial] Step 3: Moving step ${stepToMove.id} (from temp order ${tempOrder}) to order ${originalOrderOfOtherStep}`);
            await idbHelper.updateTutorialStep(stepToMove.id, { order: originalOrderOfOtherStep });

            // Update the local data structure
            [headerContainingStep.steps[currentIndex], headerContainingStep.steps[otherIndex]] = 
            [headerContainingStep.steps[otherIndex], headerContainingStep.steps[currentIndex]];
            
            // Refresh the UI
            await loadTutorialData(); 
        } catch (error) {
            console.error('[EditTutorial] Error updating step orders:', error);
            try {
                // Revert the changes
                await idbHelper.updateTutorialStep(stepToMove.id, { order: originalOrderOfStepToMove });
                await idbHelper.updateTutorialStep(otherStep.id, { order: originalOrderOfOtherStep });
            } catch (revertError) {
                console.error('[EditTutorial] Error reverting orders:', revertError);
            }
            await loadTutorialData();
        }
    }

    async function renderStepEditor(step, passedScreenshot, index, headerId, parentStepsContainer) {
        console.log(`[EditTutorial] renderStepEditor for step ID ${step.id} in header ID ${headerId}, index ${index}`);
        
        let hasImage = false;
        let imageUrl = null;
        let screenshot = null;

        if (step.screenshotId) {
            try {
                screenshot = passedScreenshot || await idbHelper.getScreenshotById(step.screenshotId);
        console.log('[EditTutorial] Screenshot object for rendering:', screenshot);

                if (screenshot && screenshot.imageData) {
        let blob;
        if (screenshot.imageData instanceof Blob) {
            blob = screenshot.imageData;
            console.log('[EditTutorial] imageData is already a Blob:', blob);
        } else if (typeof screenshot.imageData === 'string' && screenshot.imageData.startsWith('data:')) {
            blob = dataURLtoBlob(screenshot.imageData);
                        console.log('[EditTutorial] Converted dataURL to Blob:', blob);
        } else {
            blob = new Blob([screenshot.imageData], { type: screenshot.imageType || 'image/png' });
                        console.log('[EditTutorial] Fallback: Created Blob from raw data:', blob);
        }

        if (blob && blob.size > 0) {
            imageUrl = URL.createObjectURL(blob);
                        hasImage = true;
            console.log(`[EditTutorial] Created object URL for screenshot ID ${step.screenshotId}: ${imageUrl}`);
                    }
                }
            } catch (error) {
                console.warn(`[EditTutorial] Error loading screenshot for step ${step.id}:`, error);
            }
        } else {
            console.log(`[EditTutorial] No screenshot ID for step ${step.id}`);
        }

        const stepEditorItem = document.createElement('div');
        stepEditorItem.classList.add('tutorial-step-editor-item');
        stepEditorItem.dataset.stepId = step.id;
        stepEditorItem.dataset.screenshotId = step.screenshotId;
        stepEditorItem.dataset.headerId = headerId;

        const stepTitle = step.title || screenshot?.pageTitle || 'Untitled Step';
        const notesEditorId = `notes-editor-${step.id}`;
        const titleInputId = `step-title-input-${step.id}`;

        const screenshotContent = hasImage ? `
            <img src="${imageUrl}" alt="Step ${index + 1} screenshot" class="screenshot-image" id="img-${step.id}">
            <div class="image-actions">
                <button class="edit-image-btn" data-step-id="${step.id}" title="Edit Screenshot">Edit Image</button>
                <button class="remove-image-btn" data-step-id="${step.id}" title="Remove Screenshot">Remove Image</button>
            </div>
        ` : `
            <div class="screenshot-placeholder">No image added yet</div>
            <button class="import-image-button" data-step-id="${step.id}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                Import Image
            </button>
        `;

        stepEditorItem.innerHTML = `
            <div class="step-header">
                <span class="step-number">Step ${index + 1}</span>
                <input type="text" class="step-title-input" id="${titleInputId}" value="${stepTitle.replace(/"/g, '&quot;')}" />
                <button class="step-move-up" title="Move step up">&#8593;</button>
                <button class="step-move-down" title="Move step down">&#8595;</button>
            </div>
            <div class="step-content">
                <div id="${notesEditorId}" class="notes-editor-container"></div>
                <div class="screenshot-container">
                    ${screenshotContent}
                </div>
            </div>
        `;

        parentStepsContainer.appendChild(stepEditorItem);
        console.log(`[EditTutorial] Appended step editor item for step ID ${step.id} to container.`);

        // Add image load/error logging
        const imgEl = document.getElementById(`img-${step.id}`);
        if (imgEl) {
            imgEl.onload = function() {
                console.log(`[EditTutorial] Image loaded for step ID ${step.id}: naturalWidth=${imgEl.naturalWidth}, naturalHeight=${imgEl.naturalHeight}`);
            };
            imgEl.onerror = function(e) {
                console.error(`[EditTutorial] Image failed to load for step ID ${step.id}:`, imgEl.src, e);
            };
        }

        // Add event listener for import image button
        const importImageButton = stepEditorItem.querySelector('.import-image-button');
        if (importImageButton) {
            importImageButton.addEventListener('click', async () => {
                // Create a file input element
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'image/*';
                
                fileInput.addEventListener('change', async (e) => {
                    if (e.target.files && e.target.files[0]) {
                        const file = e.target.files[0];
                        try {
                            // Create a new screenshot entry
                            const screenshotData = {
                                imageData: file,
                                imageType: file.type,
                                imageSizeBytes: file.size,
                                pageTitle: step.title || 'Imported Image',
                                pageUrl: '',
                                createdAt: new Date().toISOString()
                            };

                            const screenshotId = await idbHelper.addScreenshot(screenshotData);
                            
                            // Update the step with the new screenshot ID
                            await idbHelper.updateTutorialStep(step.id, {
                                ...step,
                                screenshotId: screenshotId
                            });

                            // Refresh the UI
                            await loadTutorialData();
                        } catch (error) {
                            console.error('[EditTutorial] Error importing image:', error);
                            alert('Error importing image: ' + error.message);
                        }
                    }
                });

                fileInput.click();
            });
        }

        // Add event listener for remove image button
        const removeImageButton = stepEditorItem.querySelector('.remove-image-btn');
        if (removeImageButton) {
            removeImageButton.addEventListener('click', async () => {
                if (confirm('Are you sure you want to remove this image? This cannot be undone.')) {
                    try {
                        // Update the step to remove the screenshot ID
                        await idbHelper.updateTutorialStep(step.id, {
                            ...step,
                            screenshotId: null
                        });

                        // Refresh the UI
                        await loadTutorialData();
                    } catch (error) {
                        console.error('[EditTutorial] Error removing image:', error);
                        alert('Error removing image: ' + error.message);
                    }
                }
            });
        }

        // Add event listeners for title editing and reordering (handlers to be implemented)
        stepEditorItem.querySelector('.step-title-input').addEventListener('input', (e) => {
            // Find the correct step in currentHeadersData structure
            const headerContainingStep = currentHeadersData.find(h => h.id === headerId);
            if (headerContainingStep) {
                const stepToUpdate = headerContainingStep.steps.find(s => s.id === step.id);
                if (stepToUpdate) {
                    stepToUpdate.title = e.target.value;
                }
            }
        });
        stepEditorItem.querySelector('.step-move-up').addEventListener('click', () => moveStep(step.id, 'up'));
        stepEditorItem.querySelector('.step-move-down').addEventListener('click', () => moveStep(step.id, 'down'));

        // Placeholder for edit image button listener
        const editImageButton = stepEditorItem.querySelector('.edit-image-btn');
        if (editImageButton) {
            editImageButton.addEventListener('click', async (e) => {
                const stepIdForImageEdit = parseInt(e.target.dataset.stepId, 10);
                console.log(`[EditTutorial] Edit image clicked for step ID: ${stepIdForImageEdit}`);
                
                currentEditingStepId = stepIdForImageEdit;
                let stepToEditImageFor;
                for (const h of currentHeadersData) {
                    const found = h.steps.find(s => s.id === currentEditingStepId);
                    if (found) { stepToEditImageFor = found; break; }
                }
                if (!stepToEditImageFor) {
                    console.error('[EditTutorial] Step to edit not found:', currentEditingStepId);
                    alert('Error: Could not find step data to edit image.');
                    return;
                }

                try {
                    const screenshot = await idbHelper.getScreenshotById(stepToEditImageFor.screenshotId);
                    if (!screenshot || !screenshot.imageData) {
                        alert('Error: Screenshot data not found or image data is missing.');
                        return;
                    }

                    let imageBlob = screenshot.imageData;
                    if (!(imageBlob instanceof Blob)) {
                        // Attempt to convert if it's a dataURL (legacy or error case)
                        if (typeof imageBlob === 'string' && imageBlob.startsWith('data:')){
                            imageBlob = dataURLtoBlob(imageBlob); // Use existing utility
                        } else {
                            alert('Error: Image data is not in a recognizable Blob format.');
                            return;
                        }
                    }
                    currentEditingScreenshotBlob = imageBlob;
                    const imageUrlToEdit = URL.createObjectURL(imageBlob);

                    imageEditorModal.style.display = 'flex'; // Show modal
                    document.body.style.overflow = 'hidden'; // Prevent background scrolling

                    // Initialize or update TUI Image Editor
                    if (tuiImageEditorInstance) {
                        tuiImageEditorInstance.destroy();
                        tuiImageEditorInstance = null;
                    }
                    
                    // Verify global objects for TUI Image Editor
                    console.log('[EditTutorial] Checking for TUI dependencies:');
                    console.log('[EditTutorial] typeof tui:', typeof tui);
                    if (typeof tui !== 'undefined') {
                        console.log('[EditTutorial] typeof tui.ImageEditor:', typeof tui.ImageEditor);
                    }
                    console.log('[EditTutorial] typeof fabric:', typeof fabric);

                    if (typeof tui !== 'undefined' && tui.ImageEditor && typeof fabric !== 'undefined') {
                        try {
                            console.log('[EditTutorial] Attempting to initialize TUI Image Editor with minimal options...');
                            tuiImageEditorInstance = new tui.ImageEditor(imageEditorContainer, {
                                // Empty options or only the most basic includeUI if necessary
                                includeUI: {
                                    loadImage: {
                                        path: imageUrlToEdit, // Still need to load the image
                                        name: `step_${currentEditingStepId}_image`
                                    },
                                    //theme: 'dark', // All complex options commented out
                                    //initMenu: 'filter',
                                    //menuBarPosition: 'bottom',
                                    //menu: [], 
                                    uiSize: { width: '100%', height: '100%' } // Keep basic sizing
                                },
                                // cssMaxWidth: imageEditorContainer.offsetWidth,
                                // cssMaxHeight: imageEditorContainer.offsetHeight,
                                // selectionStyle: {
                                //     cornerSize: 20,
                                //     rotatingPointOffset: 70
                                // }
                            });
                            console.log('[EditTutorial] TUI Image Editor instance allegedly created.', tuiImageEditorInstance);
                        } catch (initError) {
                            console.error('[EditTutorial] Error during TUI Image Editor instantiation (minimal options):', initError);
                            alert('Critical error: Image editor failed to initialize. ' + initError.message);
                            closeImageEditorModal();
                            return;
                        }
                    } else {
                        console.error('[EditTutorial] TUI Image Editor or its dependencies (fabric) not found on global scope!');
                        alert('Error: Image editor libraries not loaded correctly. Check console for global scope issues.');
                        closeImageEditorModal(); 
                        return;
                    }

                } catch (error) {
                    console.error('[EditTutorial] Error preparing image for editing:', error);
                    alert('Error loading image into editor: ' + error.message);
                    closeImageEditorModal();
                }
            });
        }

        // Initialize Quill editor for the step's notes (with toolbar)
        try {
            const quill = new Quill(`#${notesEditorId}`, {
                theme: 'snow',
                modules: {
                    toolbar: [
                        ['bold', 'italic', 'underline', 'strike', 'link'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['clean']
                    ]
                },
                placeholder: 'Add a description for this step...'
            });
            if (step.notes) {
                quill.clipboard.dangerouslyPasteHTML(step.notes);
            }
            quillStepInstances.push({ stepId: step.id, headerId: headerId, instance: quill });
            console.log(`[EditTutorial] Quill editor initialized for step ${step.id}, editor target ID: #${notesEditorId}`);
        } catch(e) {
            console.error(`[EditTutorial] Failed to initialize Quill for step ${step.id}:`, e);
            console.error("[EditTutorial] Quill object available?", typeof Quill !== 'undefined' ? Quill : 'Quill object NOT FOUND');
            const targetElement = document.getElementById(notesEditorId);
            console.error(`[EditTutorial] Target element for Quill (#${notesEditorId}) exists?`, targetElement ? 'Yes' : 'No', targetElement);
            const errorDiv = document.getElementById(notesEditorId);
            if(errorDiv) errorDiv.innerHTML = '<p style="color:red;">Error loading text editor. Check console for details.</p>';
        }
    }
    
    function truncateText(text, maxLength = 60) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    if (saveTutorialChangesButton) {
        saveTutorialChangesButton.addEventListener('click', async () => {
            console.log('[EditTutorial] Save changes button clicked.');
            const newTutorialTitle = tutorialTitleInput.value.trim();
            const newTutorialDescription = tutorialDescriptionInput.value.trim();

            if (!newTutorialTitle) {
                alert('Tutorial title cannot be empty.');
                return;
            }

            try {
                await idbHelper.updateTutorial(currentTutorialId, {
                    title: newTutorialTitle,
                    description: newTutorialDescription,
                    updatedAt: new Date().toISOString()
                });
                console.log('[EditTutorial] Tutorial metadata updated.');

                for (const header of currentHeadersData) {
                    // Update header itself (title, description, order - later for order)
                    const headerQuillInstanceInfo = quillHeaderInstances.find(q => q.headerId === header.id);
                    const headerDescriptionContent = headerQuillInstanceInfo ? headerQuillInstanceInfo.instance.root.innerHTML : header.description;
                    
                    await idbHelper.updateHeader(header.id, {
                        title: header.title,
                        description: headerDescriptionContent,
                        order: header.order // Assuming order is already set or managed
                    });
                    console.log(`[EditTutorial] Header ${header.id} updated.`);

                    for (const step of header.steps) {
                        const quillInstanceInfo = quillStepInstances.find(q => q.stepId === step.id && q.headerId === header.id);
                        const notesContent = quillInstanceInfo ? quillInstanceInfo.instance.root.innerHTML : step.notes;
                        
                        await idbHelper.updateTutorialStep(step.id, { 
                            notes: notesContent, 
                            title: step.title, 
                            order: step.order, // Assuming order is managed
                            headerId: header.id // Ensure headerId is part of the update
                        });
                        console.log(`[EditTutorial] Step ${step.id} in header ${header.id} updated.`);
                    }
                }

                alert('Tutorial saved successfully!');
                if (tutorialNameDisplay) tutorialNameDisplay.textContent = newTutorialTitle;
                // No need to call loadTutorialData() here unless there are calculated fields from DB
                // Or if re-ordering might have happened and we want to be absolutely sure of DB state.
                // For now, local currentHeadersData should reflect the saved state.
            } catch (error) {
                console.error('[EditTutorial] Error saving tutorial changes:', error);
                alert('Error saving tutorial: ' + error.message);
            }
        });
    }

    if (deleteFullTutorialButton) {
        deleteFullTutorialButton.addEventListener('click', async () => {
            if (confirm('Are you sure you want to permanently delete this entire tutorial and all its steps? Screenshots will be unassigned.')) {
                try {
                    await idbHelper.deleteTutorial(currentTutorialId);
                    alert('Tutorial deleted successfully. You will be returned to the tutorials list.');
                    window.location.href = 'tutorials.html';
                } catch (error) {
                    console.error('[EditTutorial] Error deleting tutorial:', error);
                    alert('Error deleting tutorial: ' + error.message);
                }
            }
        });
    }

    // Add cancel button handler
    if (cancelEditTutorialButton) {
        cancelEditTutorialButton.addEventListener('click', () => {
            window.location.href = chrome.runtime.getURL('html/view-tutorial.html') + `?id=${currentTutorialId}`;
        });
    }

    // Add new header handler
    if (addNewHeaderButton) {
        addNewHeaderButton.addEventListener('click', async () => {
            try {
                const newHeader = {
                    tutorialId: currentTutorialId,
                    title: 'New Header',
                    description: '',
                    order: currentHeadersData.length // Add at the end
                };
                
                const newHeaderId = await idbHelper.addHeader(newHeader);
                newHeader.id = newHeaderId;
                newHeader.steps = []; // Initialize empty steps array
                currentHeadersData.push(newHeader);
                
                renderHeaderEditor(newHeader, currentHeadersData.length - 1);
            } catch (error) {
                console.error('[EditTutorial] Error adding new header:', error);
                alert('Error adding new header: ' + error.message);
            }
        });
    }

    // Function to add a new step to a header
    async function addNewStep(headerId) {
        try {
            const headerIndex = currentHeadersData.findIndex(h => h.id === headerId);
            if (headerIndex === -1) {
                throw new Error('Header not found');
            }

            const header = currentHeadersData[headerIndex];
            const newStep = {
                tutorialId: currentTutorialId,
                headerId: headerId,
                title: 'New Step',
                notes: '',
                order: header.steps.length, // Add at the end of this header's steps
                screenshotId: null // No screenshot initially
            };

            const newStepId = await idbHelper.addTutorialStep(newStep);
            newStep.id = newStepId;
            header.steps.push(newStep);

            // Find the steps container for this header
            const headerElement = document.querySelector(`[data-header-id="${headerId}"]`);
            const stepsContainer = headerElement.querySelector('.header-steps-container');
            
            // Render the new step
            await renderStepEditor(newStep, null, header.steps.length - 1, headerId, stepsContainer);
        } catch (error) {
            console.error('[EditTutorial] Error adding new step:', error);
            alert('Error adding new step: ' + error.message);
        }
    }

    // Initial load
    await loadTutorialData();

    // Image Editor Modal close/cancel/save handlers
    function closeImageEditorModal() {
        if (tuiImageEditorInstance) {
            // tuiImageEditorInstance.destroy(); // Destroy editor instance to free resources
            // tuiImageEditorInstance = null;
        }
        imageEditorModal.style.display = 'none';
        document.body.style.overflow = 'auto'; // Restore background scrolling
        currentEditingStepId = null;
        currentEditingScreenshotBlob = null;
        if (tuiImageEditorInstance) {
             // It's good practice to destroy the editor instance when modal closes to free resources
             // However, be careful if you want to preserve state across modal openings without re-init.
             // For this use-case, destroying is cleaner.
            tuiImageEditorInstance.destroy();
            tuiImageEditorInstance = null;
        }
    }

    if (imageEditorCloseBtn) {
        imageEditorCloseBtn.addEventListener('click', closeImageEditorModal);
    }
    if (imageEditorCancelButton) {
        imageEditorCancelButton.addEventListener('click', closeImageEditorModal);
    }

    if (imageEditorSaveButton) {
        imageEditorSaveButton.addEventListener('click', async () => {
            if (!tuiImageEditorInstance || !currentEditingStepId) {
                alert('No image loaded in editor or step context lost.');
                return;
            }

            try {
                const dataURL = tuiImageEditorInstance.toDataURL({format: 'png'}); // Or 'jpeg' based on original type or preference
                if (!dataURL) {
                    alert('Failed to get edited image data.');
                    return;
                }

                const newImageBlob = dataURLtoBlob(dataURL); // Use existing utility
                
                // Find the original screenshot record to update
                let stepToUpdateImageFor;
                for (const h of currentHeadersData) {
                    const found = h.steps.find(s => s.id === currentEditingStepId);
                    if (found) { stepToUpdateImageFor = found; break; }
                }
                if (!stepToUpdateImageFor) {
                    alert('Error: Could not find step data to save image.');
                    return;
                }
                const screenshotIdToUpdate = stepToUpdateImageFor.screenshotId;

                // Update the screenshot in IDB
                // We need to update the specific screenshot record, not just the step.
                // Assuming getScreenshotById gives full object, we can update parts of it.
                const originalScreenshot = await idbHelper.getScreenshotById(screenshotIdToUpdate);
                if (!originalScreenshot) {
                     alert('Error: Original screenshot record not found in DB.');
                     return;
                }

                const updatedScreenshotData = {
                    ...originalScreenshot,
                    imageData: newImageBlob,
                    imageType: newImageBlob.type,
                    imageSizeBytes: newImageBlob.size,
                    // Potentially update thumbnailDataUrl if we regenerate it here, or clear it
                    // For now, let's assume the main image data is what we edit.
                    // The thumbnail might become stale or could be regenerated.
                    // For simplicity, we only update imageData now. The thumbnail in UI will be from this new blob.
                };

                // This requires a new function in idbHelper: updateScreenshot(id, data)
                // or modify existing addScreenshot to handle updates if key exists (less ideal for clarity)
                // For now, let's assume an updateScreenshot function
                await idbHelper.updateScreenshot(screenshotIdToUpdate, updatedScreenshotData);
                console.log(`[EditTutorial] Screenshot ${screenshotIdToUpdate} updated in IDB.`);

                // Refresh the specific image in the UI
                const imgElement = document.getElementById(`img-${currentEditingStepId}`);
                if (imgElement) {
                    const newImageUrl = URL.createObjectURL(newImageBlob);
                    imgElement.src = newImageUrl;
                    // Clean up old object URL? Handled by browser, or explicitly if needed: URL.revokeObjectURL(oldUrl);
                }

                alert('Image updated successfully!');
                closeImageEditorModal();

            } catch (error) {
                console.error('[EditTutorial] Error saving edited image:', error);
                alert('Error saving image: ' + error.message);
            }
        });
    }
    
    // Utility for dataURL to Blob if not already in global scope or imported
    // Ensure this function is available where used (it's defined in renderStepEditor currently)
    // For clarity, define it at a higher scope or import if it becomes shared.
    // For this edit, I'll assume it's accessible or redefined within save handler if necessary.
    // The one in renderStepEditor is fine for now as it is used there too.
    function dataURLtoBlob(dataurl) { // Copied here for save handler context if needed, ensure it's available
        const arr = dataurl.split(',');
        if (arr.length < 2 || !arr[0].match(/:(.*?);/)) {
            console.error("Invalid dataURL format", dataurl.substring(0,100));
            throw new Error("Invalid dataURL format for blob conversion");
        }
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while(n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], {type: mime});
    }

}); 
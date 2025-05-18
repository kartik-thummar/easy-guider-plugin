// js/tutorials.js
console.log('Tutorials page script loaded.');

document.addEventListener('DOMContentLoaded', () => {
  const backToPopupButton = document.getElementById('backToPopup');
  // const createNewTutorialButton = document.getElementById('createNewTutorialFromListPage');
  const tutorialsListContainer = document.getElementById('tutorialsListContainer');

  if (backToPopupButton) {
    backToPopupButton.addEventListener('click', () => {
      // How to get back to the popup? 
      // Option 1: Try to focus an existing popup window (hard)
      // Option 2: Instruct user (simple)
      // Option 3: Open options page as a proxy?
      // For now, let's just go to the options page, or they can click the extension icon.
      console.log('Back to Popup clicked - user should click extension icon or go to options.');
      alert('Please click the extension icon in your browser toolbar to return to the capture view, or open extension options.');
      // chrome.runtime.openOptionsPage(); // Alternative
    });
  }

  // Placeholder function to load tutorials - will be implemented in Phase 2
  async function loadTutorials() {
    console.log('Loading tutorials...');
    // In Phase 2: Fetch from IndexedDB, render them into tutorialsListContainer
    tutorialsListContainer.innerHTML = '<p class="empty-message">Tutorial listing coming in Phase 2!</p>';
  }

  loadTutorials();
}); 
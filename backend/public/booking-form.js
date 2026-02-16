// ============================================
// STATE
// ============================================
let availabilitySlotsEnabled = false;
let selectedSlot = null;
let currentWeekOffset = 0; // 0 = current week, 1 = next week, etc.

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  // Check if availability display is enabled
  await checkAvailabilityFeatureFlag();

  // Set up form validation
  setupFormValidation();

  // Set up character counter
  setupCharacterCounter();

  // Set up form submission
  setupFormSubmission();

  // Set up week navigation
  setupWeekNavigation();
});

// ============================================
// FEATURE FLAG CHECK
// ============================================
async function checkAvailabilityFeatureFlag() {
  try {
    const response = await fetch('/api/calendar/config/show-slots');
    const data = await response.json();

    if (data.enabled) {
      availabilitySlotsEnabled = true;
      document.getElementById('availability-section').classList.remove('hidden');
      await fetchAvailability(currentWeekOffset);
    }
  } catch (error) {
    console.error('Failed to check feature flag:', error);
  }
}

// ============================================
// FETCH AVAILABILITY
// ============================================
async function fetchAvailability(weekOffset) {
  const slotsContainer = document.getElementById('slots-container');
  const prevBtn = document.getElementById('prev-week');
  const nextBtn = document.getElementById('next-week');

  // Show loading skeleton
  slotsContainer.innerHTML = `
    <div class="skeleton" style="height: 100px;"></div>
    <div class="skeleton" style="height: 100px;"></div>
    <div class="skeleton" style="height: 100px;"></div>
  `;

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + (weekOffset * 7));

    const response = await fetch(`/api/calendar/availability?duration=30&days=7&start=${startDate.toISOString()}`);
    const data = await response.json();

    // Update week display
    const weekEnd = new Date(startDate);
    weekEnd.setDate(weekEnd.getDate() + 6);
    document.getElementById('week-display').textContent =
      `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // Enable/disable navigation buttons
    prevBtn.disabled = weekOffset === 0;
    nextBtn.disabled = false;

    if (data.slots && data.slots.length > 0) {
      renderSlots(data.slots);
    } else {
      slotsContainer.innerHTML = `
        <div class="text-center text-muted" style="padding: 3rem;">
          <svg class="icon-xl" style="margin: 0 auto 1rem; opacity: 0.5;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <p style="font-weight: 500;">No available slots this week</p>
          <p>Try next week or contact us directly</p>
        </div>
      `;
    }
  } catch (error) {
    console.error('Failed to fetch availability:', error);
    slotsContainer.innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>Failed to load availability. Please try again.</div>
      </div>
    `;
  }
}

// ============================================
// RENDER SLOTS
// ============================================
function renderSlots(slots) {
  const slotsContainer = document.getElementById('slots-container');
  slotsContainer.innerHTML = '';

  slots.forEach(slot => {
    const slotCard = createSlotCard(slot);
    slotsContainer.appendChild(slotCard);
  });
}

function createSlotCard(slot) {
  const card = document.createElement('div');
  card.className = 'slot-card';

  const start = new Date(slot.start);
  const dateStr = start.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
  const timeStr = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York'
  });

  card.innerHTML = `
    <div style="display: flex; align-items: center; gap: 1rem;">
      <svg class="icon-lg" style="color: var(--royal-blue-600);" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <div style="flex: 1;">
        <div class="slot-date">${dateStr}</div>
        <div class="slot-time">${timeStr} EST</div>
        <div class="slot-duration">${slot.duration_minutes} min consultation</div>
      </div>
      <svg class="icon check-icon" style="opacity: 0; transition: opacity 0.2s;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>
    </div>
  `;

  card.addEventListener('click', () => {
    // Deselect all other slots
    document.querySelectorAll('.slot-card').forEach(c => {
      c.classList.remove('selected');
      c.querySelector('.check-icon').style.opacity = '0';
    });

    // Select this slot
    card.classList.add('selected');
    card.querySelector('.check-icon').style.opacity = '1';
    selectedSlot = slot;
    document.getElementById('selected-slot').value = JSON.stringify(slot);
  });

  return card;
}

// ============================================
// WEEK NAVIGATION
// ============================================
function setupWeekNavigation() {
  document.getElementById('prev-week')?.addEventListener('click', () => {
    if (currentWeekOffset > 0) {
      currentWeekOffset--;
      fetchAvailability(currentWeekOffset);
      // Clear selection when changing weeks
      selectedSlot = null;
      document.getElementById('selected-slot').value = '';
    }
  });

  document.getElementById('next-week')?.addEventListener('click', () => {
    currentWeekOffset++;
    fetchAvailability(currentWeekOffset);
    // Clear selection when changing weeks
    selectedSlot = null;
    document.getElementById('selected-slot').value = '';
  });
}

// ============================================
// FORM VALIDATION
// ============================================
function setupFormValidation() {
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const messageInput = document.getElementById('message');

  // Real-time validation
  nameInput.addEventListener('blur', () => validateField('name'));
  emailInput.addEventListener('blur', () => validateField('email'));
  messageInput.addEventListener('blur', () => validateField('message'));
}

function validateField(fieldName) {
  const input = document.getElementById(fieldName);
  const error = document.getElementById(`${fieldName}-error`);

  if (fieldName === 'name') {
    if (input.value.trim().length < 2) {
      showError(input, error, 'Please enter your name');
      return false;
    }
  }

  if (fieldName === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(input.value)) {
      showError(input, error, 'Please enter a valid email address');
      return false;
    }
  }

  if (fieldName === 'message') {
    if (input.value.trim().length < 10) {
      showError(input, error, 'Please tell us more about your needs (at least 10 characters)');
      return false;
    }
  }

  hideError(input, error);
  return true;
}

function showError(input, errorEl, message) {
  input.classList.add('error');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function hideError(input, errorEl) {
  input.classList.remove('error');
  errorEl.classList.add('hidden');
}

// ============================================
// CHARACTER COUNTER
// ============================================
function setupCharacterCounter() {
  const messageInput = document.getElementById('message');
  const charCount = document.getElementById('char-count');

  messageInput.addEventListener('input', () => {
    const count = messageInput.value.length;
    charCount.textContent = count;

    if (count > 1900) {
      charCount.style.color = 'var(--error)';
    } else {
      charCount.style.color = 'var(--gray-500)';
    }
  });
}

// ============================================
// FORM SUBMISSION
// ============================================
function setupFormSubmission() {
  const form = document.getElementById('booking-form');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validate all fields
    const isNameValid = validateField('name');
    const isEmailValid = validateField('email');
    const isMessageValid = validateField('message');

    if (!isNameValid || !isEmailValid || !isMessageValid) {
      return;
    }

    // Collect form data
    const formData = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      company: document.getElementById('company').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      message: document.getElementById('message').value.trim(),
    };

    // Add selected slot if availability enabled
    if (selectedSlot) {
      formData.preferred_date = new Date(selectedSlot.start).toISOString();
    }

    // Show loading state
    showLoading();

    try {
      const response = await fetch('/api/booking/booking-form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      hideLoading();

      if (result.success) {
        showSuccess(result);
        form.reset();
        document.getElementById('char-count').textContent = '0';
        if (selectedSlot) {
          document.querySelectorAll('.slot-card').forEach(c => {
            c.classList.remove('selected');
            c.querySelector('.check-icon').style.opacity = '0';
          });
          selectedSlot = null;
        }
      } else {
        showErrorMessage(result.error || 'Failed to submit booking request');
      }
    } catch (error) {
      hideLoading();
      showErrorMessage('Network error. Please check your connection and try again.');
      console.error('Submission error:', error);
    }
  });
}

function showLoading() {
  document.getElementById('booking-form').classList.add('hidden');
  document.getElementById('availability-section')?.classList.add('hidden');
  document.getElementById('success-message').classList.add('hidden');
  document.getElementById('error-message').classList.add('hidden');
  document.getElementById('loading-state').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('booking-form').classList.remove('hidden');
  if (availabilitySlotsEnabled) {
    document.getElementById('availability-section').classList.remove('hidden');
  }
}

function showSuccess(result) {
  document.getElementById('booking-id-display').textContent = result.booking_id;
  document.getElementById('success-message').classList.remove('hidden');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Auto-hide after 10 seconds
  setTimeout(() => {
    document.getElementById('success-message').classList.add('hidden');
  }, 10000);
}

function showErrorMessage(message) {
  document.getElementById('error-details').textContent = message;
  document.getElementById('error-message').classList.remove('hidden');

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Auto-hide after 8 seconds
  setTimeout(() => {
    document.getElementById('error-message').classList.add('hidden');
  }, 8000);
}

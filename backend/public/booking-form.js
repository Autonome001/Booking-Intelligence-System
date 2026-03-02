// ============================================
// STATE
// ============================================
let availabilitySlotsEnabled = false;
let selectedSlot = null;
let currentWeekOffset = 0;
let maxDisplayDays = 20;
let aiConciergeEnabled = true;
let bookingChatHistory = [];
let isBookingChatLoading = false;
let bookingSessionId = `booking_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
let selectedHoldId = null;
let isSlotSelectionPending = false;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  applyDisplayMode();
  document.getElementById('booking-session-id').value = bookingSessionId;
  setupFormValidation();
  setupCharacterCounter();
  setupFormSubmission();
  setupWeekNavigation();
  setupBookingChat();
  await checkAvailabilityFeatureFlag();
});

function applyDisplayMode() {
  const isEmbedded = window.location.pathname === '/embed'
    || new URLSearchParams(window.location.search).get('embed') === '1';

  if (isEmbedded) {
    document.body.classList.add('embedded-mode');
    document.title = 'Book Your Free Strategy Call | Autonome';
  }
}

function setSubmitButtonPending(isPending) {
  const submitButton = document.getElementById('submit-btn');
  if (!submitButton) {
    return;
  }

  submitButton.disabled = isPending;
}

// ============================================
// FEATURE FLAG CHECK
// ============================================
async function checkAvailabilityFeatureFlag() {
  try {
    const response = await fetch('/api/calendar/config/show-slots');
    const data = await response.json();

    maxDisplayDays = Math.max(7, Math.min(60, parseInt(data.display_window_days, 10) || 20));
    aiConciergeEnabled = data.ai_concierge_enabled !== false;

    const conciergeSection = document.getElementById('ai-concierge-section');
    if (aiConciergeEnabled) {
      conciergeSection.classList.remove('hidden');
    } else {
      conciergeSection.classList.add('hidden');
    }

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

    const weekEnd = new Date(startDate);
    weekEnd.setDate(weekEnd.getDate() + 6);
    document.getElementById('week-display').textContent =
      `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    prevBtn.disabled = weekOffset === 0;
    nextBtn.disabled = ((weekOffset + 1) * 7) >= maxDisplayDays;

    if (data.slots && data.slots.length > 0) {
      renderSlots(data.slots);
    } else {
      slotsContainer.innerHTML = `
        <div class="text-center text-muted" style="padding: 3rem;">
          <svg class="icon-xl" style="margin: 0 auto 1rem; opacity: 0.5;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <p style="font-weight: 500;">No available slots this week</p>
          <p>Try another visible week, or use the live booking chat below to find a better time.</p>
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

  slots.forEach((slot) => {
    const slotCard = createSlotCard(slot);
    slotsContainer.appendChild(slotCard);
  });
}

function syncSelectedSlotUI() {
  document.querySelectorAll('.slot-card').forEach((card) => {
    const matches = selectedSlot && card.dataset.slotStart === selectedSlot.start;
    card.classList.toggle('selected', Boolean(matches));
    card.classList.toggle('is-pending', Boolean(matches && isSlotSelectionPending));
    const checkIcon = card.querySelector('.check-icon');
    if (checkIcon) {
      checkIcon.style.opacity = matches ? '1' : '0';
    }
  });

  document.getElementById('selected-slot').value = selectedSlot ? JSON.stringify(selectedSlot) : '';
  document.getElementById('selected-hold-id').value = selectedHoldId || '';
}

async function reserveSelectedSlot(slot) {
  const response = await fetch('/api/calendar/holds/selection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: bookingSessionId,
      slot_start: slot.start,
      slot_end: slot.end,
      expiration_minutes: 15,
    }),
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to reserve the selected slot');
  }

  return result;
}

async function releaseSelectedSlotHold() {
  if (!selectedHoldId) {
    return;
  }

  try {
    await fetch(`/api/calendar/holds/selection/${encodeURIComponent(selectedHoldId)}`, {
      method: 'DELETE',
    });
  } catch (error) {
    console.warn('Failed to release slot hold:', error);
  } finally {
    selectedHoldId = null;
  }
}

async function selectSlot(slot) {
  if (isSlotSelectionPending) {
    return;
  }

  isSlotSelectionPending = true;
  setSubmitButtonPending(true);
  selectedSlot = slot;
  syncSelectedSlotUI();

  try {
    const holdResult = await reserveSelectedSlot(slot);
    selectedHoldId = holdResult.hold_id;
    selectedSlot = {
      ...slot,
      hold_expires_at: holdResult.expires_at,
    };
    syncSelectedSlotUI();
  } catch (error) {
    selectedSlot = null;
    selectedHoldId = null;
    syncSelectedSlotUI();
    if (
      typeof error?.message === 'string' &&
      (error.message.includes('no longer available') || error.message.includes('at least'))
    ) {
      fetchAvailability(currentWeekOffset);
    }
    showErrorMessage(error.message || 'We could not reserve that slot. Please try another time.');
  } finally {
    isSlotSelectionPending = false;
    setSubmitButtonPending(false);
    syncSelectedSlotUI();
  }
}

function createSlotCard(slot) {
  const card = document.createElement('div');
  card.className = 'slot-card';
  card.dataset.slotStart = slot.start;

  const start = new Date(slot.start);
  const dateStr = start.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });

  card.innerHTML = `
    <div style="display: flex; align-items: center; gap: 1.5rem;">
      <div style="color: var(--electric-blue); background: var(--electric-blue-glow); padding: 1rem; border-radius: 12px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div style="flex: 1;">
        <div class="slot-date">${dateStr}</div>
        <div class="slot-time">${timeStr} EST</div>
        <div class="slot-duration">${slot.duration_minutes} min consultation</div>
      </div>
      <div class="check-icon" style="opacity: 0; transition: var(--transition-smooth); color: var(--electric-blue);">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
    </div>
  `;

  card.addEventListener('click', () => {
    selectSlot(slot);
  });

  return card;
}

// ============================================
// WEEK NAVIGATION
// ============================================
function setupWeekNavigation() {
  document.getElementById('prev-week')?.addEventListener('click', async () => {
    if (currentWeekOffset > 0) {
      await releaseSelectedSlotHold();
      currentWeekOffset--;
      fetchAvailability(currentWeekOffset);
      selectedSlot = null;
      syncSelectedSlotUI();
    }
  });

  document.getElementById('next-week')?.addEventListener('click', async () => {
    if (((currentWeekOffset + 1) * 7) >= maxDisplayDays) {
      return;
    }

    await releaseSelectedSlotHold();
    currentWeekOffset++;
    fetchAvailability(currentWeekOffset);
    selectedSlot = null;
    syncSelectedSlotUI();
  });
}

// ============================================
// LIVE BOOKING CHAT
// ============================================
function getBookingChatContainer() {
  return document.getElementById('booking-chat-thread');
}

function createChatMessageElement(role, content) {
  const item = document.createElement('div');
  item.className = `chat-message ${role}`;

  const label = role === 'assistant' ? 'Autonome Concierge' : 'You';
  item.innerHTML = `
    <div class="chat-message-label ${role}">${label}</div>
    <div class="chat-bubble">${content.replace(/\n/g, '<br>')}</div>
  `;

  return item;
}

function appendChatMessage(role, content) {
  const container = getBookingChatContainer();
  const element = createChatMessageElement(role, content);
  container.appendChild(element);
  container.scrollTop = container.scrollHeight;
}

function renderSuggestedChatSlots(suggestedSlots) {
  if (!Array.isArray(suggestedSlots) || suggestedSlots.length === 0) {
    return;
  }

  const container = getBookingChatContainer();
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-message assistant chat-suggestions-group';

  const chips = suggestedSlots.map((slot) => `
    <button type="button" class="assistant-suggestion-chip" data-slot='${JSON.stringify({
      start: slot.start,
      end: slot.end,
      duration_minutes: slot.duration_minutes,
    })}'>
      ${slot.label}
    </button>
  `).join('');

  wrapper.innerHTML = `
    <div class="chat-message-label assistant">Closest Matches</div>
    <div class="chat-suggestions-panel">
      <div class="assistant-suggestion-list">${chips}</div>
    </div>
  `;

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;

  wrapper.querySelectorAll('.assistant-suggestion-chip').forEach((button) => {
    button.addEventListener('click', () => {
      const slot = JSON.parse(button.dataset.slot);
      selectSlot(slot);
      appendChatMessage('assistant', `I set ${button.textContent.trim()} as your current selection. If you want a tighter fit, tell me what to change and I will keep refining it with you.`);
    });
  });
}

function setBookingChatSendingState(isLoading) {
  isBookingChatLoading = isLoading;
  const sendButton = document.getElementById('send-booking-chat');
  const input = document.getElementById('booking-chat-input');

  sendButton.disabled = isLoading;
  input.disabled = isLoading;
  sendButton.classList.toggle('is-loading', isLoading);
  sendButton.innerHTML = isLoading
    ? `
      <span class="inline-spinner" aria-hidden="true"></span>
      <span>Thinking...</span>
    `
    : `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 2L11 13" />
        <polyline points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
      <span>Send</span>
    `;
}

function setupBookingChat() {
  const sendButton = document.getElementById('send-booking-chat');
  const input = document.getElementById('booking-chat-input');
  const container = getBookingChatContainer();

  if (!sendButton || !input || !container) {
    return;
  }

  bookingChatHistory = [];
  container.innerHTML = '';
  appendChatMessage('assistant', 'I can help like a live scheduling concierge. Tell me your ideal day, time range, urgency, or any constraints, and I will narrow the best options intelligently.');

  sendButton.addEventListener('click', sendBookingChatMessage);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendBookingChatMessage();
    }
  });
}

async function sendBookingChatMessage() {
  const input = document.getElementById('booking-chat-input');
  const message = input.value.trim();

  if (!message || isBookingChatLoading) {
    return;
  }

  bookingChatHistory.push({ role: 'user', content: message });
  appendChatMessage('user', message);
  input.value = '';
  setBookingChatSendingState(true);

  try {
    const response = await fetch('/api/calendar/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: bookingChatHistory,
        duration_minutes: 30,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Failed to reach the concierge');
    }

    bookingChatHistory.push({ role: 'assistant', content: result.reply });
    appendChatMessage('assistant', result.reply);
    renderSuggestedChatSlots(result.suggested_slots || []);
  } catch (error) {
    console.error('Booking chat failed:', error);
    const fallback = error.message || 'The concierge is temporarily unavailable right now. You can try again, or submit your preferred timing in the form below.';
    bookingChatHistory.push({ role: 'assistant', content: fallback });
    appendChatMessage('assistant', fallback);
  } finally {
    setBookingChatSendingState(false);
    input.focus();
  }
}

// ============================================
// FORM VALIDATION
// ============================================
function setupFormValidation() {
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const messageInput = document.getElementById('message');

  nameInput.addEventListener('blur', () => validateField('name'));
  emailInput.addEventListener('blur', () => validateField('email'));
  messageInput.addEventListener('blur', () => validateField('message'));
}

function hasUserChatContext() {
  return bookingChatHistory.some((message) => message.role === 'user');
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
    if (hasUserChatContext() && input.value.trim().length === 0) {
      hideError(input, error);
      return true;
    }

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
    charCount.style.color = count > 1900 ? 'var(--error)' : 'var(--gray-500)';
  });
}

// ============================================
// FORM SUBMISSION
// ============================================
function buildBookingChatTranscript() {
  const turns = bookingChatHistory
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-8);

  if (turns.length <= 1) {
    return '';
  }

  return turns
    .map((message) => `${message.role === 'assistant' ? 'Autonome Concierge' : 'Customer'}: ${message.content}`)
    .join('\n');
}

function setupFormSubmission() {
  const form = document.getElementById('booking-form');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (isSlotSelectionPending) {
      showErrorMessage('Please wait while we reserve your selected time slot.');
      return;
    }

    if (availabilitySlotsEnabled && !selectedHoldId) {
      showErrorMessage('Please select an available time before submitting your consultation request.');
      return;
    }

    const isNameValid = validateField('name');
    const isEmailValid = validateField('email');
    const isMessageValid = validateField('message');

    if (!isNameValid || !isEmailValid || !isMessageValid) {
      return;
    }

    const formData = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      company: document.getElementById('company').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      message: document.getElementById('message').value.trim(),
    };

    if (!formData.message && hasUserChatContext()) {
      formData.message = 'The customer used the live booking chat to request a better time than the visible availability.';
    }

    const chatTranscript = buildBookingChatTranscript();
    if (chatTranscript) {
      formData.message = `${formData.message}\n\nLive booking chat transcript:\n${chatTranscript}`;
    }

    if (selectedSlot) {
      formData.preferred_date = new Date(selectedSlot.start).toISOString();
      formData.selected_slot_end = new Date(selectedSlot.end).toISOString();
      formData.provisional_hold_id = selectedHoldId;
      formData.booking_session_id = bookingSessionId;
    }

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
        selectedSlot = null;
        selectedHoldId = null;
        bookingSessionId = `booking_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        document.getElementById('booking-session-id').value = bookingSessionId;
        syncSelectedSlotUI();
        setupBookingChat();
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
  document.getElementById('ai-concierge-section')?.classList.add('hidden');
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

  if (aiConciergeEnabled) {
    document.getElementById('ai-concierge-section').classList.remove('hidden');
  }
}

function showSuccess(result) {
  const successTitle = document.getElementById('success-title');
  const successBody = document.getElementById('success-body');
  const successDetails = document.getElementById('success-details');

  document.getElementById('booking-id-display').textContent = result.booking_id;

  if (result.calendar_confirmed) {
    successTitle.textContent = 'Consultation Booked';
    successBody.textContent = 'Your consultation is confirmed. A calendar invite has been sent to your email address.';

    const detailParts = [];
    if (result.confirmed_start) {
      const confirmedStart = new Date(result.confirmed_start);
      detailParts.push(`Scheduled for ${confirmedStart.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} EST`);
    }
    if (result.meeting_link) {
      detailParts.push(`Google Meet: ${result.meeting_link}`);
    }

    if (detailParts.length > 0) {
      successDetails.textContent = detailParts.join(' | ');
      successDetails.classList.remove('hidden');
    } else {
      successDetails.textContent = '';
      successDetails.classList.add('hidden');
    }
  } else {
    successTitle.textContent = 'Consultation Request Received';
    successBody.textContent = result.message || 'Your request has been processed. A strategist will contact you shortly via our official channels.';
    successDetails.textContent = '';
    successDetails.classList.toggle('hidden', !successDetails.textContent);
  }

  document.getElementById('success-message').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  setTimeout(() => {
    document.getElementById('success-message').classList.add('hidden');
  }, 10000);
}

function showErrorMessage(message) {
  document.getElementById('error-details').textContent = message;
  document.getElementById('error-message').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  setTimeout(() => {
    document.getElementById('error-message').classList.add('hidden');
  }, 8000);
}

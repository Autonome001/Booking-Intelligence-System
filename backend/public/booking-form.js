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
let currentAvailabilitySlots = [];
let activeDayFilter = 'all';
const ADMIN_USER_EMAIL_STORAGE_KEY = 'autonome_admin_user_email';
const AVAILABILITY_REFRESH_STORAGE_KEY = 'autonome_availability_refresh';
const BOOKING_USER_EMAIL = resolveBookingUserEmail();

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Load branding and feature config first
  await checkAvailabilityFeatureFlag();

  // 2. Initialize UI with the known branding context
  applyDisplayMode();
  document.getElementById('booking-session-id').value = bookingSessionId;
  setupFormValidation();
  setupCharacterCounter();
  setupFormSubmission();
  setupWeekNavigation();
  setupBookingChat();
  setupAvailabilityAutoRefresh();
});

function resolveBookingUserEmail() {
  const searchParams = new URLSearchParams(window.location.search);
  const queryUserEmail = searchParams.get('user_email')?.trim();
  const bodyUserEmail = document.body?.dataset?.userEmail?.trim();
  const storedUserEmail = window.localStorage.getItem(ADMIN_USER_EMAIL_STORAGE_KEY)?.trim();

  return queryUserEmail || bodyUserEmail || storedUserEmail || null;
}

function appendBookingUserEmail(path) {
  if (!BOOKING_USER_EMAIL) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}user_email=${encodeURIComponent(BOOKING_USER_EMAIL)}`;
}

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
    const response = await fetch(appendBookingUserEmail('/api/calendar/config/show-slots'), {
      cache: 'no-store',
    });
    const data = await response.json();
    
    // Check if this is a vanity URL view or a personal domain match
    const pathSegments = window.location.pathname.split('/').filter(s => s);
    const normalizeSlug = (s) => (s || '').replace(/^\/+|\/+$/g, '').toLowerCase().trim();
    
    const isPersonalDomain = data.isPersonalDomainMatch === true;
    const isPathSlugRequest = pathSegments.length > 0 && !['embed', 'waitlist', 'admin', 'personal.html'].includes(pathSegments[0].toLowerCase());

    if (isPersonalDomain || isPathSlugRequest) {
      let isMatch = false;
      
      if (isPersonalDomain) {
        console.log('[PersonalView] Hostname match detected. Applying identity...');
        isMatch = true;
      } else {
        const pathSlug = pathSegments[0].toLowerCase() === 'schedule' && pathSegments.length > 1 
          ? pathSegments[1] 
          : pathSegments[0];

        const normalizedPathSlug = normalizeSlug(decodeURIComponent(pathSlug));
        const normalizedConfigSlug = normalizeSlug(data.personalViewSlug);
        
        console.log('[PersonalView] Checking path slug match:', { 
          pathSlug: normalizedPathSlug, 
          configSlug: normalizedConfigSlug,
          enabled: data.personalViewEnabled,
          fullPath: window.location.pathname
        });

        isMatch = data.personalViewEnabled && normalizedConfigSlug === normalizedPathSlug;
      }

      if (isMatch) {
         console.log('[PersonalView] Identity verified. Applying tailored branding...');
         
         window.isPersonalViewActive = true;

         // 1. Page Title
         document.title = data.personalViewTitle || data.personalViewBrandName || "Your Consultation";
         
         // 2. Personal Logo & Tagline Logic
         const logoContainer = document.getElementById('personal-logo-container');
         const logoImg = document.getElementById('personal-logo-img');
         const logoTagline = document.getElementById('personal-brand-tagline');
         
         // Logo visibility (Only if URL is specified)
         if (logoContainer && logoImg && data.personalViewLogoUrl) {
           logoImg.src = data.personalViewLogoUrl;
           logoContainer.style.display = 'block';
         } else if (logoContainer) {
           logoContainer.style.display = 'none';
         }

         // Tagline visibility (Independent of Logo)
         if (logoTagline) {
           if (data.personalViewTagline) {
             logoTagline.textContent = data.personalViewTagline;
             logoTagline.style.display = 'block';
           } else {
             logoTagline.style.display = 'none';
           }
         }

         // 3. Name & Headers
         const brandNameDisplay = document.getElementById('personal-brand-name');
         if (brandNameDisplay) {
            brandNameDisplay.textContent = data.personalViewBrandName || "";
            brandNameDisplay.style.display = data.personalViewBrandName ? 'block' : 'none';
         }

         const h2 = document.getElementById('personal-header-title');
         if (h2) h2.textContent = data.personalViewTitle || "Schedule a Session";

         const desc = document.getElementById('personal-header-desc');
         if (desc && data.personalViewDescription) desc.textContent = data.personalViewDescription;

         // 4. Clean Footer (Name Only)
         const footerName = document.getElementById('footer-personal-name');
         if (footerName) {
           footerName.textContent = data.personalViewBrandName || "Booking System";
         }
         
         // 5. Force Hide Waitlist Banner
         const waitlistBanner = document.getElementById('waitlist-banner');
         if (waitlistBanner) {
           waitlistBanner.style.display = 'none';
           waitlistBanner.classList.add('hidden');
         }

         // 6. Set Assistant Identity
         window.personalAssistantName = data.personalViewBrandName 
            ? `${data.personalViewBrandName}'s Assistant` 
            : "Booking Assistant";

         // 7. Calendar Override
         if (data.personalViewCalendarEmail) {
            window.activeCalendarEmailOverride = data.personalViewCalendarEmail;
         }
      } else {
         console.warn('[PersonalView] Match check failed. Redirecting to home...');
         window.location.href = '/';
         return; // Stop execution
      }
    }

    const waitlistEnabled = data.waitlistEnabled === true;
    const waitlistUrl = typeof data.waitlistUrl === 'string' && data.waitlistUrl
      ? data.waitlistUrl
      : appendBookingUserEmail('/waitlist');

    maxDisplayDays = Math.max(
      7,
      Math.min(60, parseInt(data.displayWindowDays ?? data.display_window_days, 10) || 20)
    );
    
    // Priority: Personal View toggle if active, otherwise Corporate toggle
    const corporateConciergeEnabled = (data.aiConciergeEnabled ?? data.ai_concierge_enabled) !== false;
    if (window.isPersonalViewActive) {
      aiConciergeEnabled = data.personalViewAiConciergeEnabled !== false;
    } else {
      aiConciergeEnabled = corporateConciergeEnabled;
    }

    const waitlistBanner = document.getElementById('waitlist-banner');
    if (waitlistEnabled && waitlistBanner) {
      waitlistBanner.classList.remove('hidden');
      
      const ctaTitle = document.getElementById('waitlist-cta-title-display');
      const ctaDesc = document.getElementById('waitlist-cta-desc-display');
      const ctaBtn = document.getElementById('waitlist-cta-btn-display');

      if (ctaTitle && data.waitlistCtaTitle) ctaTitle.textContent = data.waitlistCtaTitle;
      if (ctaDesc && data.waitlistCtaDescription) ctaDesc.textContent = data.waitlistCtaDescription;
      if (ctaBtn) {
        if (data.waitlistCtaButtonText) ctaBtn.textContent = data.waitlistCtaButtonText;
        ctaBtn.href = waitlistUrl;
      }
    } else if (waitlistBanner) {
      waitlistBanner.classList.add('hidden');
    }

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
  const filterPanel = document.getElementById('availability-filter-panel');
  const filterBar = document.getElementById('availability-day-filter');
  const filterSummary = document.getElementById('availability-filter-summary');

  currentAvailabilitySlots = [];
  activeDayFilter = 'all';

  slotsContainer.innerHTML = `
    <div class="skeleton" style="height: 100px;"></div>
    <div class="skeleton" style="height: 100px;"></div>
    <div class="skeleton" style="height: 100px;"></div>
  `;
  filterPanel?.classList.add('hidden');
  if (filterBar) {
    filterBar.innerHTML = '';
  }
  if (filterSummary) {
    filterSummary.textContent = '';
  }

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + (weekOffset * 7));

    const response = await fetch(
      appendBookingUserEmail(
        `/api/calendar/availability?duration=30&days=7&start=${startDate.toISOString()}${window.activeCalendarEmailOverride ? '&calendar_email_override=' + encodeURIComponent(window.activeCalendarEmailOverride) : ''}`
      ),
      {
        cache: 'no-store',
      }
    );
    const data = await response.json();

    const weekEnd = new Date(startDate);
    weekEnd.setDate(weekEnd.getDate() + 6);
    document.getElementById('week-display').textContent =
      `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    prevBtn.disabled = weekOffset === 0;
    nextBtn.disabled = ((weekOffset + 1) * 7) >= maxDisplayDays;

    if (data.slots && data.slots.length > 0) {
      currentAvailabilitySlots = data.slots;
      renderAvailabilityFilter(data.slots);
      renderSlots(data.slots);
    } else {
      const waitlistUrl = typeof data.waitlistUrl === 'string' && data.waitlistUrl
        ? data.waitlistUrl
        : appendBookingUserEmail('/waitlist');
      const waitlistAction = data.waitlistEnabled ?
        `<p style="margin-top: 1rem;"><a href="${waitlistUrl}" class="btn btn-primary">Join the Priority Waitlist</a></p>` :
        `<p>Try another visible week, or use the live booking chat below to find a better time.</p>`;

      slotsContainer.innerHTML = `
        <div class="text-center text-muted" style="padding: 3rem;">
          <svg class="icon-xl" style="margin: 0 auto 1rem; opacity: 0.5;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <p style="font-weight: 500;">No available slots this week</p>
          ${waitlistAction}
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
function getDayFilterMetadata(slots) {
  const dayMap = new Map();

  slots.forEach((slot) => {
    const slotDate = new Date(slot.start);
    const dayKey = String(slotDate.getDay());
    const existing = dayMap.get(dayKey);

    if (existing) {
      existing.count += 1;
      return;
    }

    dayMap.set(dayKey, {
      key: dayKey,
      dayIndex: slotDate.getDay(),
      label: slotDate.toLocaleDateString('en-US', { weekday: 'long' }),
      shortLabel: slotDate.toLocaleDateString('en-US', { weekday: 'short' }),
      count: 1,
    });
  });

  return Array.from(dayMap.values()).sort((a, b) => a.dayIndex - b.dayIndex);
}

function renderAvailabilityFilter(slots) {
  const filterPanel = document.getElementById('availability-filter-panel');
  const filterBar = document.getElementById('availability-day-filter');
  const filterSummary = document.getElementById('availability-filter-summary');

  if (!filterPanel || !filterBar || !filterSummary) {
    return;
  }

  const dayOptions = getDayFilterMetadata(slots);

  if (!dayOptions.length) {
    filterPanel.classList.add('hidden');
    filterBar.innerHTML = '';
    filterSummary.textContent = '';
    return;
  }

  filterPanel.classList.remove('hidden');
  const totalSlots = slots.length;
  const activeOption = activeDayFilter === 'all'
    ? null
    : dayOptions.find((option) => option.key === activeDayFilter);

  filterSummary.textContent = activeOption
    ? `${activeOption.count} ${activeOption.count === 1 ? 'time' : 'times'} on ${activeOption.label}`
    : `${totalSlots} open ${totalSlots === 1 ? 'time' : 'times'} across ${dayOptions.length} day${dayOptions.length === 1 ? '' : 's'}`;

  const filterButtons = [
    `
      <button
        type="button"
        class="availability-filter-chip ${activeDayFilter === 'all' ? 'active' : ''}"
        data-day-filter="all"
      >
        <span>All Days</span>
        <span class="availability-filter-chip-count">${totalSlots}</span>
      </button>
    `,
    ...dayOptions.map((option) => `
      <button
        type="button"
        class="availability-filter-chip ${activeDayFilter === option.key ? 'active' : ''}"
        data-day-filter="${option.key}"
      >
        <span>${option.label}</span>
        <span class="availability-filter-chip-count">${option.count}</span>
      </button>
    `),
  ];

  filterBar.innerHTML = filterButtons.join('');
}

function renderSlots(slots) {
  const slotsContainer = document.getElementById('slots-container');
  const visibleSlots = activeDayFilter === 'all'
    ? slots
    : slots.filter((slot) => String(new Date(slot.start).getDay()) === activeDayFilter);

  slotsContainer.innerHTML = '';

  if (!visibleSlots.length) {
    const filteredDayLabel = new Date(
      currentAvailabilitySlots.find((slot) => String(new Date(slot.start).getDay()) === activeDayFilter)?.start
      || Date.now()
    ).toLocaleDateString('en-US', { weekday: 'long' });

    slotsContainer.innerHTML = `
      <div class="availability-empty-state">
        <div class="availability-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z"/>
          </svg>
        </div>
        <div>
          <div class="availability-empty-title">No open times for ${filteredDayLabel}</div>
          <p class="availability-empty-copy">Choose another day to see the rest of this week’s availability.</p>
        </div>
      </div>
    `;
    return;
  }

  const groupedSlots = visibleSlots.reduce((groups, slot) => {
    const slotDate = new Date(slot.start);
    const groupKey = slotDate.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }

    groups[groupKey].push(slot);
    return groups;
  }, {});

  Object.entries(groupedSlots).forEach(([groupLabel, groupSlots]) => {
    const daySection = document.createElement('section');
    daySection.className = 'availability-day-section';
    daySection.innerHTML = `
      <div class="availability-day-header">
        <div>
          <div class="availability-day-label">${groupLabel}</div>
          <div class="availability-day-count">${groupSlots.length} open ${groupSlots.length === 1 ? 'time' : 'times'}</div>
        </div>
      </div>
      <div class="availability-day-slots"></div>
    `;

    const daySlotsContainer = daySection.querySelector('.availability-day-slots');

    groupSlots.forEach((slot) => {
      const slotCard = createSlotCard(slot);
      daySlotsContainer.appendChild(slotCard);
    });

    slotsContainer.appendChild(daySection);
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
      ...(BOOKING_USER_EMAIL ? { user_email: BOOKING_USER_EMAIL } : {}),
      ...(window.activeCalendarEmailOverride ? { calendar_email_override: window.activeCalendarEmailOverride } : {}),
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

  document.getElementById('availability-day-filter')?.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-day-filter]') : null;

    if (!target) {
      return;
    }

    const nextFilter = target.getAttribute('data-day-filter') || 'all';

    if (nextFilter === activeDayFilter) {
      return;
    }

    const selectedSlotDay = selectedSlot ? String(new Date(selectedSlot.start).getDay()) : null;

    if (selectedSlot && nextFilter !== 'all' && selectedSlotDay !== nextFilter) {
      await releaseSelectedSlotHold();
      selectedSlot = null;
      syncSelectedSlotUI();
    }

    activeDayFilter = nextFilter;
    renderAvailabilityFilter(currentAvailabilitySlots);
    renderSlots(currentAvailabilitySlots);
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

  const assistantLabel = window.personalAssistantName || 'Autonome Concierge';
  const label = role === 'assistant' ? assistantLabel : 'You';
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
  const defaultGreeting = 'I can help like a live scheduling concierge. Tell me your ideal day, time range, urgency, or any constraints, and I will narrow the best options intelligently.';
  const personalGreeting = 'I can help you find the best time for our session. Just let me know your preferences, and I will assist you in mapping out our meeting.';
  const greeting = window.isPersonalViewActive ? personalGreeting : defaultGreeting;
  
  appendChatMessage('assistant', greeting);

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
        ...(BOOKING_USER_EMAIL ? { user_email: BOOKING_USER_EMAIL } : {}),
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

function refreshAvailabilityFromAdminUpdate() {
  if (!availabilitySlotsEnabled) {
    checkAvailabilityFeatureFlag();
    return;
  }

  fetchAvailability(currentWeekOffset);
}

function setupAvailabilityAutoRefresh() {
  window.addEventListener('storage', (event) => {
    if (event.key === AVAILABILITY_REFRESH_STORAGE_KEY && event.newValue) {
      refreshAvailabilityFromAdminUpdate();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAvailabilityFeatureFlag();
    }
  });

  window.addEventListener('focus', () => {
    checkAvailabilityFeatureFlag();
  });
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
      ai_concierge_engaged: hasUserChatContext(),
      calendar_email_override: window.activeCalendarEmailOverride || undefined,
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
    successBody.textContent = 'Your consultation is confirmed. A confirmation email with the meeting details has been sent to your email address.';

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

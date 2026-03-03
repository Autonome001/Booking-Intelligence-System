// ============================================
// STATE
// ============================================
const DEFAULT_ADMIN_USER_EMAIL = 'dev@autonome.us';
const ADMIN_USER_EMAIL_STORAGE_KEY = 'autonome_admin_user_email';
const AVAILABILITY_REFRESH_STORAGE_KEY = 'autonome_availability_refresh';
const USER_EMAIL = resolveAdminUserEmail();
let connectedCalendars = [];
const MAX_CALENDARS = 7;
const DEFAULT_WORKING_HOURS_TIMEZONE = 'America/New_York';
const MAX_NOTIFICATION_REMINDERS = 5;
let notificationSettingsState = null;
let expandedNotificationReminders = new Set();
let postMeetingDetailsExpanded = true;

function resolveAdminUserEmail() {
  const searchParams = new URLSearchParams(window.location.search);
  const queryUserEmail = searchParams.get('user_email')?.trim();
  const bodyUserEmail = document.body?.dataset?.userEmail?.trim();
  const storedUserEmail = window.localStorage.getItem(ADMIN_USER_EMAIL_STORAGE_KEY)?.trim();
  const resolvedUserEmail = queryUserEmail || bodyUserEmail || storedUserEmail || DEFAULT_ADMIN_USER_EMAIL;

  if (resolvedUserEmail) {
    window.localStorage.setItem(ADMIN_USER_EMAIL_STORAGE_KEY, resolvedUserEmail);
  }

  return resolvedUserEmail;
}

async function readJsonResponse(response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    const trimmedBody = rawBody.trim();

    if (trimmedBody.startsWith('<')) {
      throw new Error(
        `Server returned HTML instead of JSON (HTTP ${response.status}). Please refresh and try again.`
      );
    }

    throw new Error(
      `Server returned an unreadable response (HTTP ${response.status}). Please try again.`
    );
  }
}
// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  initAccessCodeProtection();
  await loadSystemStatus();
  await loadCalendars();
  setupConnectButton();
  setupBookingDestinationControls();
  setupAvailabilityTabs();
  setupDisplaySettingsForm();
  setupNotificationSettingsForm();
  await loadDisplaySettings();
  await loadNotificationSettings();
  switchTab('blackouts');
  checkOAuthCallback();
});

// ============================================
// SYSTEM STATUS
// ============================================
async function loadSystemStatus() {
  const statusContainer = document.getElementById('system-status');

  try {
    const response = await fetch('/api/calendar/health');
    const data = await response.json();

    const statusColor = data.status === 'healthy' ? 'var(--success)' : 'var(--error)';
    const statusIcon = data.status === 'healthy'
      ? '<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
      : '<svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

    const statusHtml = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem;">
        <div>
          <div class="text-small text-muted">Calendar Service</div>
          <div style="font-weight: 600; color: ${statusColor}; display: flex; align-items: center; gap: 0.5rem;">
            ${statusIcon}
            <span>${data.status === 'healthy' ? 'Active' : data.status}</span>
          </div>
        </div>

        <div>
          <div class="text-small text-muted">Connected Calendars</div>
          <div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span>${data.calendars_connected || 0} / ${MAX_CALENDARS}</span>
          </div>
        </div>

        <div>
          <div class="text-small text-muted">Last Updated</div>
          <div style="font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span>${new Date(data.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })}</span>
          </div>
        </div>
      </div>
    `;

    statusContainer.innerHTML = statusHtml;

  } catch (error) {
    console.error('Failed to load system status:', error);
    statusContainer.innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>Failed to load system status. Please refresh the page.</div>
      </div>
    `;
  }
}

// ============================================
// LOAD CALENDARS
// ============================================
async function loadCalendars() {
  const container = document.getElementById('calendars-container');
  const countDisplay = document.getElementById('calendar-count');
  const warningDisplay = document.getElementById('calendar-warning');
  const connectBtn = document.getElementById('connect-btn');

  try {
    const response = await fetch(`/api/calendar/oauth/accounts?user_email=${encodeURIComponent(USER_EMAIL)}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    connectedCalendars = data.calendars || [];
    renderBookingDestinationSelector();

    if (warningDisplay) {
      if (data.warning) {
        warningDisplay.textContent = data.details ? `${data.warning}: ${data.details}` : data.warning;
        warningDisplay.classList.remove('hidden');
      } else {
        warningDisplay.textContent = '';
        warningDisplay.classList.add('hidden');
      }
    }

    // Update count display
    countDisplay.textContent = `${connectedCalendars.length} / ${MAX_CALENDARS} calendars connected`;

    // Enable/disable connect button
    if (connectedCalendars.length >= MAX_CALENDARS) {
      connectBtn.disabled = true;
      connectBtn.innerHTML = `
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>Maximum calendars connected</span>
      `;
      connectBtn.classList.remove('btn-primary');
      connectBtn.classList.add('btn-secondary');
    } else {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        <span>Connect Google Calendar</span>
      `;
      connectBtn.classList.add('btn-primary');
      connectBtn.classList.remove('btn-secondary');
    }

    // Render calendar cards
    if (connectedCalendars.length === 0) {
      renderBookingDestinationSelector();
      container.innerHTML = `
        <div class="text-center text-muted" style="padding: 3rem;">
          <svg class="icon-xl" style="margin: 0 auto 1rem; opacity: 0.5;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <p style="font-weight: 500;">No calendars connected yet</p>
          <p>Click "Connect Google Calendar" below to get started</p>
        </div>
      `;
    } else {
      renderCalendarCards(connectedCalendars);
    }

  } catch (error) {
    console.error('Failed to load calendars:', error);
    container.innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <strong>Failed to load calendars</strong>
          <p>${error.message}</p>
        </div>
      </div>
    `;

    // Enable connect button even on error
    connectBtn.disabled = false;
  }
}

// ============================================
// RENDER CALENDAR CARDS
// ============================================
function renderCalendarCards(calendars) {
  const container = document.getElementById('calendars-container');
  container.innerHTML = '';

  calendars
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.priority - b.priority)
    .forEach(calendar => {
      const card = createCalendarCard(calendar);
      container.appendChild(card);
    });
}

function renderBookingDestinationSelector() {
  const panel = document.getElementById('booking-destination-panel');
  const select = document.getElementById('booking-destination-select');
  const summary = document.getElementById('booking-destination-summary');
  const saveButton = document.getElementById('save-booking-destination-btn');

  if (!panel || !select || !summary || !saveButton) {
    return;
  }

  if (!connectedCalendars.length) {
    panel.classList.add('hidden');
    select.innerHTML = '';
    summary.textContent = '';
    saveButton.disabled = true;
    return;
  }

  panel.classList.remove('hidden');

  const sortedCalendars = [...connectedCalendars]
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || a.priority - b.priority);

  select.innerHTML = sortedCalendars.map((calendar) => `
    <option value="${calendar.id}" ${calendar.is_primary ? 'selected' : ''}>
      ${calendar.calendar_email}${calendar.is_primary ? ' (Current Booking Destination)' : ''}
    </option>
  `).join('');

  const activeSelection = sortedCalendars.find((calendar) => calendar.is_primary) || sortedCalendars[0];
  updateBookingDestinationSummary(activeSelection.calendar_email);
  saveButton.disabled = false;
}

function updateBookingDestinationSummary(calendarEmail) {
  const summary = document.getElementById('booking-destination-summary');
  if (!summary) {
    return;
  }

  summary.textContent = `Confirmed consultations currently post to ${calendarEmail}. Customer-facing availability follows the booking destination calendar.`;
}

function setupBookingDestinationControls() {
  const saveButton = document.getElementById('save-booking-destination-btn');
  const select = document.getElementById('booking-destination-select');

  if (!saveButton || !select) {
    return;
  }

  select.addEventListener('change', () => {
    const selectedCalendar = connectedCalendars.find((calendar) => calendar.id === select.value);
    if (selectedCalendar?.calendar_email) {
      updateBookingDestinationSummary(selectedCalendar.calendar_email);
    }
  });

  saveButton.addEventListener('click', async () => {
    if (!select.value) {
      showNotification('error', 'Select a booking destination calendar first');
      return;
    }

    const selectedCalendar = connectedCalendars.find((calendar) => calendar.id === select.value);
    await setPrimaryCalendar(select.value, selectedCalendar?.calendar_email || 'Selected calendar', saveButton);
  });
}

function createCalendarCard(calendar) {
  const card = document.createElement('div');
  card.className = 'calendar-account';

  const connectedDate = new Date(calendar.created_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const webhookStatus = getWebhookStatus(calendar);
  const primaryBadge = calendar.is_primary
    ? '<svg class="icon" style="color: var(--warning);" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
    : '<svg class="icon" style="color: var(--electric-blue);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';

  card.innerHTML = `
    <div class="calendar-account-icon">
      ${primaryBadge}
    </div>

    <div class="calendar-account-info">
      <div class="calendar-account-email">
        ${calendar.calendar_email}
        ${calendar.is_primary ? '<span style="color: var(--warning); font-size: 0.875rem; margin-left: 0.5rem;">(Booking Destination)</span>' : ''}
      </div>
      <div class="calendar-account-meta">
        Connected: ${connectedDate} | Status: ${calendar.is_active ? '<span style="color: var(--success);">✓ Active</span>' : '<span style="color: var(--warning);">⚠ Inactive</span>'}
        ${webhookStatus ? ` | Webhook: ${webhookStatus}` : ''}
      </div>
    </div>

    <div class="calendar-account-actions">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          onclick="refreshCalendar('${calendar.id}')"
          title="Refresh webhook subscription"
      >
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        <span>Refresh</span>
      </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          onclick="disconnectCalendar('${calendar.id}', '${calendar.calendar_email}')"
          title="Disconnect this calendar"
      >
        <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
        <span>Disconnect</span>
      </button>
    </div>
  `;

  return card;
}

function getWebhookStatus(calendar) {
  if (!calendar.webhook_expires_at) {
    return '<span style="color: var(--warning);">⚠ Not subscribed</span>';
  }

  const expiresAt = new Date(calendar.webhook_expires_at);
  const now = new Date();
  const daysUntilExpiry = Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return '<span style="color: var(--error);">❌ Expired</span>';
  } else if (daysUntilExpiry < 2) {
    return `<span style="color: var(--warning);">⚠ Expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}</span>`;
  } else {
    return '<span style="color: var(--success);">✓ Subscribed</span>';
  }
}

// ============================================
// CONNECT CALENDAR
// ============================================
function setupConnectButton() {
  const connectBtn = document.getElementById('connect-btn');
  connectBtn.addEventListener('click', connectCalendar);
}

function connectCalendar() {
  // Redirect to OAuth authorization endpoint
  const authUrl = `/api/calendar/oauth/authorize?user_email=${encodeURIComponent(USER_EMAIL)}`;
  window.location.href = authUrl;
}

async function setPrimaryCalendar(calendarId, calendarEmail, triggerButton = null) {
  try {
    setButtonLoading(triggerButton, true, 'Saving...');

    const response = await fetch(`/api/calendar/oauth/accounts/${calendarId}/primary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        user_email: USER_EMAIL,
      }),
    });

    const result = await readJsonResponse(response);

    if (!response.ok || !result?.success) {
      throw new Error(result?.error || 'Failed to update the booking destination calendar');
    }

    broadcastAvailabilityRefresh('booking_destination_updated');
    showNotification('success', `${calendarEmail} is now the booking destination calendar`);
    await loadCalendars();
    await loadSystemStatus();
  } catch (error) {
    console.error('Failed to set primary calendar:', error);
    showNotification('error', error.message || 'Failed to update the booking destination calendar');
  } finally {
    setButtonLoading(triggerButton, false);
  }
}

// ============================================
// DISCONNECT CALENDAR
// ============================================
async function disconnectCalendar(calendarId, calendarEmail) {
  if (!confirm(`Are you sure you want to disconnect "${calendarEmail}"?\n\nThis will remove it from availability calculations.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/calendar/oauth/accounts/${calendarId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      broadcastAvailabilityRefresh('calendar_disconnected');
      showNotification('success', `Calendar "${calendarEmail}" disconnected successfully`);

      // Reload calendars and system status
      await loadCalendars();
      await loadSystemStatus();
    } else {
      showNotification('error', result.error || 'Failed to disconnect calendar');
    }

  } catch (error) {
    console.error('Disconnect error:', error);
    showNotification('error', 'Network error. Please try again.');
  }
}

// ============================================
// REFRESH CALENDAR
// ============================================
async function refreshCalendar(calendarId) {
  showNotification('info', 'Refreshing webhook subscription...');

  // For now, just reload the page to trigger webhook renewal on next cron
  setTimeout(() => {
    showNotification('success', 'Calendar refreshed. Webhook will renew on next maintenance cycle (2 AM).');
    loadCalendars();
    loadSystemStatus();
  }, 1000);
}

// ============================================
// NOTIFICATION SYSTEM
// ============================================
function showNotification(type, message) {
  // Remove any existing notifications
  const existing = document.querySelector('.notification-toast');
  if (existing) {
    existing.remove();
  }

  const notification = document.createElement('div');
  notification.className = `notification-toast alert alert-${type} fade-in`;
  notification.style.cssText = `
    position: fixed;
    top: 2rem;
    right: 2rem;
    max-width: 400px;
    z-index: 9999;
    box-shadow: var(--shadow-xl);
  `;

  const icons = {
    success: '<svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    error: '<svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    info: '<svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
  };

  notification.innerHTML = `
    ${icons[type] || icons.info}
    <div>${message}</div>
  `;

  document.body.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(-20px)';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function broadcastAvailabilityRefresh(reason = 'admin_update') {
  try {
    window.localStorage.setItem(
      AVAILABILITY_REFRESH_STORAGE_KEY,
      JSON.stringify({
        reason,
        userEmail: USER_EMAIL,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.warn('Failed to broadcast availability refresh:', error);
  }
}

function parseIntegerInput(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// ============================================
// BOOKING DISPLAY SETTINGS
// ============================================
function updateDisplayWindowPreview(days, minimumNoticeMinutes = document.getElementById('minimum-notice-minutes')?.value) {
  const normalizedDays = Math.max(7, Math.min(60, parseIntegerInput(days, 20)));
  const normalizedNoticeMinutes = Math.max(0, Math.min(1440, parseIntegerInput(minimumNoticeMinutes, 30)));
  const daysValue = document.getElementById('display-window-days-value');
  const summary = document.getElementById('display-settings-summary');
  const noticeSummary = document.getElementById('minimum-notice-summary');

  daysValue.textContent = normalizedDays;
  summary.textContent = `Customers can browse the next ${normalizedDays} day${normalizedDays === 1 ? '' : 's'} of availability and must book at least ${normalizedNoticeMinutes} minute${normalizedNoticeMinutes === 1 ? '' : 's'} ahead.`;
  noticeSummary.textContent = normalizedNoticeMinutes === 0
    ? 'Customers can book any currently open slot, including immediate same-day availability.'
    : `Customers must book at least ${normalizedNoticeMinutes} minute${normalizedNoticeMinutes === 1 ? '' : 's'} in advance.`;

  document.querySelectorAll('.admin-preset-button[data-days]').forEach((button) => {
    button.classList.toggle('active', parseInt(button.dataset.days, 10) === normalizedDays);
  });

  document.querySelectorAll('.admin-preset-button[data-notice]').forEach((button) => {
    button.classList.toggle('active', parseInt(button.dataset.notice, 10) === normalizedNoticeMinutes);
  });
}

async function loadDisplaySettings() {
  try {
    const response = await fetch(`/api/calendar/preferences?user_email=${encodeURIComponent(USER_EMAIL)}`);
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    const settings = data?.settings || {};
    const rangeInput = document.getElementById('display-window-days');
    const aiToggle = document.getElementById('ai-concierge-enabled');
    const minimumNoticeInput = document.getElementById('minimum-notice-minutes');

    rangeInput.value = settings.displayWindowDays || 20;
    aiToggle.checked = settings.aiConciergeEnabled !== false;
    minimumNoticeInput.value = settings.minimumNoticeMinutes ?? 30;
    updateDisplayWindowPreview(rangeInput.value, minimumNoticeInput.value);
  } catch (error) {
    console.error('Failed to load display settings:', error);
    showNotification('error', error.message || 'Failed to load booking display settings');
  }
}

function setupDisplaySettingsForm() {
  const form = document.getElementById('display-settings-form');
  const rangeInput = document.getElementById('display-window-days');
  const minimumNoticeInput = document.getElementById('minimum-notice-minutes');

  rangeInput.addEventListener('input', () => {
    updateDisplayWindowPreview(rangeInput.value, minimumNoticeInput.value);
  });

  minimumNoticeInput.addEventListener('input', () => {
    updateDisplayWindowPreview(rangeInput.value, minimumNoticeInput.value);
  });

  document.querySelectorAll('.admin-preset-button[data-days]').forEach((button) => {
    button.addEventListener('click', () => {
      rangeInput.value = button.dataset.days;
      updateDisplayWindowPreview(rangeInput.value, minimumNoticeInput.value);
    });
  });

  document.querySelectorAll('.admin-preset-button[data-notice]').forEach((button) => {
    button.addEventListener('click', () => {
      minimumNoticeInput.value = button.dataset.notice;
      updateDisplayWindowPreview(rangeInput.value, minimumNoticeInput.value);
    });
  });

  form.addEventListener('submit', saveDisplaySettings);
}

async function saveDisplaySettings(event) {
  event.preventDefault();

  const saveButton = document.getElementById('save-display-settings-btn');
  const displayWindowDays = parseInt(document.getElementById('display-window-days').value, 10);
  const aiConciergeEnabled = document.getElementById('ai-concierge-enabled').checked;
  const minimumNoticeMinutes = parseInt(document.getElementById('minimum-notice-minutes').value, 10);

  setButtonLoading(saveButton, true, 'Saving...');

  try {
    const response = await fetch('/api/calendar/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: USER_EMAIL,
        display_window_days: displayWindowDays,
        ai_concierge_enabled: aiConciergeEnabled,
        minimum_notice_minutes: minimumNoticeMinutes,
      }),
    });

    const result = await readJsonResponse(response);

    if (!response.ok || !result?.success) {
      throw new Error(result?.error || 'Failed to save booking display settings');
    }

    document.getElementById('display-window-days').value =
      result.settings?.displayWindowDays || displayWindowDays;
    document.getElementById('minimum-notice-minutes').value =
      result.settings?.minimumNoticeMinutes ?? minimumNoticeMinutes;
    document.getElementById('ai-concierge-enabled').checked =
      result.settings?.aiConciergeEnabled !== false;

    updateDisplayWindowPreview(
      result.settings?.displayWindowDays || displayWindowDays,
      result.settings?.minimumNoticeMinutes ?? minimumNoticeMinutes
    );
    broadcastAvailabilityRefresh('display_settings_saved');
    showNotification('success', 'Booking display settings saved and live availability refreshed');
  } catch (error) {
    console.error('Failed to save display settings:', error);
    showNotification('error', error.message || 'Failed to save booking display settings');
  } finally {
    setButtonLoading(saveButton, false);
  }
}

// ============================================
// MEETING NOTIFICATION SETTINGS
// ============================================
function getDefaultNotificationSettings() {
  return {
    timezone: DEFAULT_WORKING_HOURS_TIMEZONE,
    preMeeting: [
      {
        id: 'reminder_1',
        enabled: true,
        minutesBefore: 1440,
        subjectTemplate: 'Reminder: Your Autonome consultation is tomorrow, {customer_name}',
        bodyTemplate: 'Hi {customer_name},\n\nThis is a reminder that your Autonome consultation is scheduled for {meeting_datetime} ({timezone}).\n\nWe look forward to speaking with you.\n\nBest,\nThe Autonome Team',
      },
      {
        id: 'reminder_2',
        enabled: false,
        minutesBefore: 60,
        subjectTemplate: 'Reminder: Your Autonome consultation starts in 1 hour',
        bodyTemplate: 'Hi {customer_name},\n\nYour Autonome consultation is coming up at {meeting_datetime} ({timezone}).\n\nReply to this email if anything changes.\n\nBest,\nThe Autonome Team',
      },
      {
        id: 'reminder_3',
        enabled: false,
        minutesBefore: 15,
        subjectTemplate: 'Reminder: Your Autonome consultation starts soon',
        bodyTemplate: 'Hi {customer_name},\n\nThis is a quick reminder that your Autonome consultation begins at {meeting_datetime} ({timezone}).\n\nBest,\nThe Autonome Team',
      },
      {
        id: 'reminder_4',
        enabled: false,
        minutesBefore: 5,
        subjectTemplate: 'Reminder: Your Autonome consultation begins in 5 minutes',
        bodyTemplate: 'Hi {customer_name},\n\nYour Autonome consultation begins in about 5 minutes at {meeting_datetime} ({timezone}).\n\nBest,\nThe Autonome Team',
      },
      {
        id: 'reminder_5',
        enabled: false,
        minutesBefore: 2,
        subjectTemplate: 'Reminder: Your Autonome consultation is about to begin',
        bodyTemplate: 'Hi {customer_name},\n\nYour Autonome consultation is about to begin at {meeting_datetime} ({timezone}).\n\nBest,\nThe Autonome Team',
      },
    ],
    postMeeting: {
      enabled: false,
      minutesAfter: 5,
      subjectTemplate: 'Thank you for meeting with Autonome, {customer_name}',
      bodyTemplate: 'Hi {customer_name},\n\nThank you for taking the time to meet with Autonome. We appreciated the conversation about {company_name}.\n\nIf you have any follow-up questions, reply directly to this email and we will continue the conversation.\n\nBest,\nThe Autonome Team',
    },
  };
}

function normalizeNotificationSettings(settings) {
  const defaults = getDefaultNotificationSettings();
  const source = settings && typeof settings === 'object' ? settings : {};
  const preMeeting = Array.isArray(source.preMeeting) ? source.preMeeting : [];
  const postMeeting = source.postMeeting && typeof source.postMeeting === 'object'
    ? source.postMeeting
    : {};

  return {
    timezone:
      typeof source.timezone === 'string' && source.timezone.trim()
        ? source.timezone.trim()
        : defaults.timezone,
    preMeeting: Array.from({ length: MAX_NOTIFICATION_REMINDERS }, (_, index) => {
      const fallback = defaults.preMeeting[index];
      const reminder = preMeeting[index] && typeof preMeeting[index] === 'object'
        ? preMeeting[index]
        : {};

      return {
        id: reminder.id || fallback.id,
        enabled: reminder.enabled === undefined ? fallback.enabled : Boolean(reminder.enabled),
        minutesBefore: Math.max(
          1,
          Math.min(43200, parseIntegerInput(reminder.minutesBefore, fallback.minutesBefore))
        ),
        subjectTemplate:
          typeof reminder.subjectTemplate === 'string'
            ? reminder.subjectTemplate
            : fallback.subjectTemplate,
        bodyTemplate:
          typeof reminder.bodyTemplate === 'string'
            ? reminder.bodyTemplate
            : fallback.bodyTemplate,
      };
    }),
    postMeeting: {
      enabled:
        postMeeting.enabled === undefined
          ? defaults.postMeeting.enabled
          : Boolean(postMeeting.enabled),
      minutesAfter: Math.max(
        1,
        Math.min(10080, parseIntegerInput(postMeeting.minutesAfter, defaults.postMeeting.minutesAfter))
      ),
      subjectTemplate:
        typeof postMeeting.subjectTemplate === 'string'
          ? postMeeting.subjectTemplate
          : defaults.postMeeting.subjectTemplate,
      bodyTemplate:
        typeof postMeeting.bodyTemplate === 'string'
          ? postMeeting.bodyTemplate
          : defaults.postMeeting.bodyTemplate,
    },
  };
}

function formatNotificationLeadTime(minutesBefore) {
  if (minutesBefore % 1440 === 0) {
    const days = minutesBefore / 1440;
    return `${days} day${days === 1 ? '' : 's'} before`;
  }

  if (minutesBefore % 60 === 0) {
    const hours = minutesBefore / 60;
    return `${hours} hour${hours === 1 ? '' : 's'} before`;
  }

  return `${minutesBefore} minute${minutesBefore === 1 ? '' : 's'} before`;
}

function getNextHiddenNotificationIndex() {
  if (!notificationSettingsState) {
    return -1;
  }

  return notificationSettingsState.preMeeting.findIndex((reminder) => !reminder.enabled);
}

function renderNotificationReminderCards() {
  const container = document.getElementById('notification-reminders-grid');

  if (!container || !notificationSettingsState) {
    return;
  }

  const visibleReminderIndexes = notificationSettingsState.preMeeting
    .map((reminder, index) => ({ reminder, index }))
    .filter(({ reminder }) => reminder.enabled)
    .map(({ index }) => index);

  const cardsHtml = visibleReminderIndexes.map((index) => {
    const reminder = notificationSettingsState.preMeeting[index];
    const isExpanded = expandedNotificationReminders.has(reminder.id);

    return `
      <div class="notification-config-card">
        <div class="notification-config-header">
          <div>
            <h5>Reminder ${index + 1}</h5>
            <div class="text-small notification-card-meta">${formatNotificationLeadTime(reminder.minutesBefore)}</div>
          </div>
          <div class="notification-card-toolbar">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-reminder-toggle="${index}"
            >
              ${isExpanded ? 'Collapse' : 'Expand'}
            </button>
            <label class="day-toggle">
              <input
                type="checkbox"
                data-reminder-index="${index}"
                data-reminder-field="enabled"
                ${reminder.enabled ? 'checked' : ''}
              >
              <span class="text-small">Enabled</span>
            </label>
          </div>
        </div>

        <div class="notification-card-body ${isExpanded ? '' : 'hidden'}">
          <div class="notification-config-row">
            <div>
              <label class="form-label" for="notification-minutes-${index}">Minutes Before Meeting</label>
              <input
                type="number"
                id="notification-minutes-${index}"
                class="form-input"
                min="1"
                max="43200"
                value="${reminder.minutesBefore}"
                data-reminder-index="${index}"
                data-reminder-field="minutesBefore"
              >
            </div>
            <div>
              <label class="form-label" for="notification-subject-${index}">Subject Template</label>
              <input
                type="text"
                id="notification-subject-${index}"
                class="form-input"
                value="${escapeHtml(reminder.subjectTemplate)}"
                data-reminder-index="${index}"
                data-reminder-field="subjectTemplate"
              >
            </div>
          </div>

          <div>
            <label class="form-label" for="notification-body-${index}">Body Template</label>
            <textarea
              id="notification-body-${index}"
              class="form-textarea"
              style="min-height: 120px;"
              data-reminder-index="${index}"
              data-reminder-field="bodyTemplate"
            >${escapeHtml(reminder.bodyTemplate)}</textarea>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const addNotificationButton = getNextHiddenNotificationIndex() >= 0
    ? `
      <div class="notification-add-row">
        <button type="button" id="add-notification-btn" class="btn btn-secondary notification-add-btn">
          + Add a Notification
        </button>
      </div>
    `
    : '';

  const emptyState = visibleReminderIndexes.length === 0
    ? `
      <div class="notification-empty-state">
        No pre-meeting reminders are active right now. Add one when you want customers to receive a scheduled reminder.
      </div>
    `
    : '';

  container.innerHTML = `${emptyState}${cardsHtml}${addNotificationButton}`;
}

function syncPostMeetingCardUI() {
  const details = document.getElementById('post-notification-details');
  const toggleButton = document.getElementById('toggle-post-notification-btn');

  if (!details || !toggleButton) {
    return;
  }

  details.classList.toggle('hidden', !postMeetingDetailsExpanded);
  toggleButton.textContent = postMeetingDetailsExpanded ? 'Collapse' : 'Expand';
}

function renderNotificationSettings(settings) {
  notificationSettingsState = normalizeNotificationSettings(settings);
  expandedNotificationReminders = new Set(
    notificationSettingsState.preMeeting
      .filter((reminder) => reminder.enabled)
      .map((reminder) => reminder.id)
  );
  postMeetingDetailsExpanded = true;

  renderNotificationReminderCards();
  document.getElementById('notification-timezone').value =
    notificationSettingsState.timezone || DEFAULT_WORKING_HOURS_TIMEZONE;
  document.getElementById('post-enabled').checked =
    notificationSettingsState.postMeeting?.enabled === true;
  document.getElementById('post-minutes-after').value =
    notificationSettingsState.postMeeting?.minutesAfter || 5;
  document.getElementById('post-subject-template').value =
    notificationSettingsState.postMeeting?.subjectTemplate || '';
  document.getElementById('post-body-template').value =
    notificationSettingsState.postMeeting?.bodyTemplate || '';
  syncPostMeetingCardUI();
}

function handleNotificationReminderGridClick(event) {
  if (!notificationSettingsState) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;

  if (!target) {
    return;
  }

  const addButton = target.closest('#add-notification-btn');
  if (addButton) {
    const nextIndex = getNextHiddenNotificationIndex();

    if (nextIndex >= 0) {
      const reminder = notificationSettingsState.preMeeting[nextIndex];
      reminder.enabled = true;
      expandedNotificationReminders.add(reminder.id);
      renderNotificationReminderCards();
    }

    return;
  }

  const toggleButton = target.closest('[data-reminder-toggle]');
  if (!toggleButton) {
    return;
  }

  const reminderIndex = parseInt(toggleButton.dataset.reminderToggle, 10);
  const reminder = notificationSettingsState.preMeeting[reminderIndex];

  if (!reminder) {
    return;
  }

  if (expandedNotificationReminders.has(reminder.id)) {
    expandedNotificationReminders.delete(reminder.id);
  } else {
    expandedNotificationReminders.add(reminder.id);
  }

  renderNotificationReminderCards();
}

function handleNotificationReminderFieldChange(event) {
  if (!notificationSettingsState) {
    return;
  }

  const target = event.target instanceof HTMLElement ? event.target : null;

  if (!target) {
    return;
  }

  const reminderIndex = parseInt(target.dataset?.reminderIndex, 10);
  const field = target.dataset?.reminderField;

  if (Number.isNaN(reminderIndex) || reminderIndex < 0 || reminderIndex >= MAX_NOTIFICATION_REMINDERS || !field) {
    return;
  }

  const reminder = notificationSettingsState.preMeeting[reminderIndex];

  if (!reminder) {
    return;
  }

  if (field === 'enabled') {
    reminder.enabled = target.checked;

    if (reminder.enabled) {
      expandedNotificationReminders.add(reminder.id);
    } else {
      expandedNotificationReminders.delete(reminder.id);
    }

    renderNotificationReminderCards();
    return;
  }

  if (field === 'minutesBefore') {
    reminder.minutesBefore = Math.max(1, Math.min(43200, parseIntegerInput(target.value, reminder.minutesBefore)));
    return;
  }

  if (field === 'subjectTemplate') {
    reminder.subjectTemplate = target.value;
    return;
  }

  if (field === 'bodyTemplate') {
    reminder.bodyTemplate = target.value;
  }
}

async function loadNotificationSettings() {
  try {
    const response = await fetch(`/api/booking/notification-settings?user_email=${encodeURIComponent(USER_EMAIL)}`);
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    renderNotificationSettings(data?.settings || getDefaultNotificationSettings());
  } catch (error) {
    console.error('Failed to load notification settings:', error);
    renderNotificationSettings(notificationSettingsState || getDefaultNotificationSettings());
    showNotification('error', error.message || 'Failed to load notification settings');
  }
}

function setupNotificationSettingsForm() {
  const form = document.getElementById('notification-settings-form');
  const remindersGrid = document.getElementById('notification-reminders-grid');
  const timezoneInput = document.getElementById('notification-timezone');
  const postToggle = document.getElementById('toggle-post-notification-btn');
  const postEnabled = document.getElementById('post-enabled');
  const postMinutesAfter = document.getElementById('post-minutes-after');
  const postSubjectTemplate = document.getElementById('post-subject-template');
  const postBodyTemplate = document.getElementById('post-body-template');

  form?.addEventListener('submit', saveNotificationSettings);
  remindersGrid?.addEventListener('click', handleNotificationReminderGridClick);
  remindersGrid?.addEventListener('input', handleNotificationReminderFieldChange);
  remindersGrid?.addEventListener('change', handleNotificationReminderFieldChange);

  timezoneInput?.addEventListener('change', () => {
    if (notificationSettingsState) {
      notificationSettingsState.timezone = timezoneInput.value || DEFAULT_WORKING_HOURS_TIMEZONE;
    }
  });

  postToggle?.addEventListener('click', () => {
    postMeetingDetailsExpanded = !postMeetingDetailsExpanded;
    syncPostMeetingCardUI();
  });

  postEnabled?.addEventListener('change', () => {
    if (notificationSettingsState) {
      notificationSettingsState.postMeeting.enabled = postEnabled.checked;
    }
  });

  postMinutesAfter?.addEventListener('input', () => {
    if (notificationSettingsState) {
      notificationSettingsState.postMeeting.minutesAfter = Math.max(
        1,
        Math.min(10080, parseIntegerInput(postMinutesAfter.value, notificationSettingsState.postMeeting.minutesAfter))
      );
    }
  });

  postSubjectTemplate?.addEventListener('input', () => {
    if (notificationSettingsState) {
      notificationSettingsState.postMeeting.subjectTemplate = postSubjectTemplate.value;
    }
  });

  postBodyTemplate?.addEventListener('input', () => {
    if (notificationSettingsState) {
      notificationSettingsState.postMeeting.bodyTemplate = postBodyTemplate.value;
    }
  });
}

async function saveNotificationSettings(event) {
  event.preventDefault();

  const saveButton = document.getElementById('save-notification-settings-btn');

  if (!notificationSettingsState) {
    notificationSettingsState = normalizeNotificationSettings(getDefaultNotificationSettings());
  }

  notificationSettingsState.timezone =
    document.getElementById('notification-timezone').value || DEFAULT_WORKING_HOURS_TIMEZONE;
  notificationSettingsState.postMeeting = {
    enabled: document.getElementById('post-enabled').checked,
    minutesAfter: Math.max(
      1,
      Math.min(10080, parseIntegerInput(document.getElementById('post-minutes-after').value, 5))
    ),
    subjectTemplate: document.getElementById('post-subject-template').value.trim(),
    bodyTemplate: document.getElementById('post-body-template').value.trim(),
  };

  const settings = {
    timezone: notificationSettingsState.timezone,
    preMeeting: notificationSettingsState.preMeeting.map((reminder) => ({ ...reminder })),
    postMeeting: {
      ...notificationSettingsState.postMeeting,
    },
  };

  setButtonLoading(saveButton, true, 'Saving...');

  try {
    const response = await fetch('/api/booking/notification-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: USER_EMAIL,
        settings,
      }),
    });

    const result = await readJsonResponse(response);

    if (!response.ok || !result?.success) {
      throw new Error(result?.error || 'Failed to save notification settings');
    }

    renderNotificationSettings(result.settings || settings);
    showNotification('success', 'Meeting notification settings saved');
  } catch (error) {
    console.error('Failed to save notification settings:', error);
    showNotification('error', error.message || 'Failed to save notification settings');
  } finally {
    setButtonLoading(saveButton, false);
  }
}

// ============================================
// CHECK FOR OAUTH CALLBACK
// ============================================
function checkOAuthCallback() {
  const urlParams = new URLSearchParams(window.location.search);

  if (urlParams.has('connected')) {
    const calendarEmail = urlParams.get('email') || 'Calendar';
    const isConnected = urlParams.get('connected') === 'true';
    const error = urlParams.get('error');
    const reason = urlParams.get('reason');

    if (isConnected) {
      showNotification('success', `${calendarEmail} connected successfully!`);
    } else if (reason === 'already_connected') {
      showNotification('info', `${calendarEmail} is already connected`);
    } else if (error) {
      showNotification('error', `Failed to connect calendar: ${error}`);
    }

    // Clean up URL
    window.history.replaceState({}, document.title, '/admin');

    // Reload data to show changes
    setTimeout(() => {
      loadCalendars();
      loadSystemStatus();
    }, 1000);
  }
}

// ============================================
// AVAILABILITY SETTINGS - TAB SWITCHING
// ============================================
function switchTab(tabName) {
  const allowedTabs = new Set(['blackouts', 'working-hours']);
  const normalizedTabName = allowedTabs.has(tabName) ? tabName : 'blackouts';

  // Update tab buttons
  document.getElementById('blackouts-tab').classList.remove('active');
  document.getElementById('working-hours-tab').classList.remove('active');
  document.getElementById(`${normalizedTabName}-tab`).classList.add('active');

  // Update tab content
  document.getElementById('blackouts-content').classList.add('hidden');
  document.getElementById('working-hours-content').classList.add('hidden');
  document.getElementById(`${normalizedTabName}-content`).classList.remove('hidden');
}

function setupAvailabilityTabs() {
  document.querySelectorAll('.tab-button[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab);
    });
  });
}

// ============================================
// BLACKOUT PERIODS MANAGEMENT
// ============================================
async function loadBlackouts() {
  const container = document.getElementById('blackouts-container');

  try {
    const response = await fetch(`/api/calendar/blackouts?user_email=${encodeURIComponent(USER_EMAIL)}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.blackouts.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted" style="padding: 2rem;">
          <svg class="icon icon-xl" style="margin: 0 auto 1rem; opacity: 0.3;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
          </svg>
          <p>No blackout periods set. Add one above to block off time.</p>
        </div>
      `;
      return;
    }

    const blackoutsHtml = data.blackouts.map(blackout => {
      const startDate = new Date(blackout.start_time);
      const endDate = new Date(blackout.end_time);

      const formatOptions = {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      };

      return `
        <div class="blackout-card">
          <div class="blackout-info">
            <h4>${blackout.title}</h4>
            <p>${startDate.toLocaleString('en-US', formatOptions)} - ${endDate.toLocaleString('en-US', formatOptions)}</p>
            ${blackout.description ? `<p style="font-style: italic; margin-top: 0.25rem;">${blackout.description}</p>` : ''}
          </div>
          <button type="button" onclick="deleteBlackout('${blackout.id}', this)" class="btn btn-secondary btn-sm" style="background: var(--error); color: white;">
            <svg class="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            Delete
          </button>
        </div>
      `;
    }).join('');

    container.innerHTML = blackoutsHtml;

  } catch (error) {
    console.error('Failed to load blackouts:', error);
    container.innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>Failed to load blackout periods</div>
      </div>
    `;
  }
}

async function addBlackout(event) {
  event.preventDefault();

  const title = document.getElementById('blackout-title').value;
  const description = document.getElementById('blackout-description').value;
  const startTime = document.getElementById('blackout-start').value;
  const endTime = document.getElementById('blackout-end').value;

  if (!title || !startTime || !endTime) {
    showNotification('error', 'Please fill in all required fields');
    return;
  }

  try {
    const response = await fetch('/api/calendar/blackouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: USER_EMAIL,
        title,
        description: description || null,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create blackout');
    }

    broadcastAvailabilityRefresh('blackout_added');
    showNotification('success', 'Blackout period added successfully');

    // Clear form
    document.getElementById('blackout-form').reset();

    // Reload blackouts
    await loadBlackouts();

  } catch (error) {
    console.error('Failed to add blackout:', error);
    showNotification('error', error.message || 'Failed to add blackout period');
  }
}

function setButtonLoading(button, isLoading, loadingText = 'Working...') {
  if (!button) {
    return;
  }

  if (isLoading) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `
      <span class="inline-spinner" aria-hidden="true"></span>
      <span>${loadingText}</span>
    `;
    return;
  }

  button.disabled = false;
  button.classList.remove('is-loading');

  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
    delete button.dataset.originalHtml;
  }
}

async function deleteBlackout(blackoutId, button = null) {
  if (!confirm('Are you sure you want to delete this blackout period?')) {
    return;
  }

  setButtonLoading(button, true, 'Deleting...');

  try {
    const response = await fetch(`/api/calendar/blackouts/${blackoutId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Failed to delete blackout');
    }

    broadcastAvailabilityRefresh('blackout_deleted');
    showNotification('success', 'Blackout period deleted');
    await loadBlackouts();

  } catch (error) {
    console.error('Failed to delete blackout:', error);
    showNotification('error', error.message || 'Failed to delete blackout period');
    setButtonLoading(button, false);
  }
}

// ============================================
// WORKING HOURS MANAGEMENT
// ============================================
const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

async function loadWorkingHours() {
  const container = document.getElementById('working-hours-grid');
  const timezoneSelect = document.getElementById('working-hours-timezone');

  try {
    const response = await fetch(`/api/calendar/working-hours?user_email=${encodeURIComponent(USER_EMAIL)}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const effectiveTimezone = data.timezone || DEFAULT_WORKING_HOURS_TIMEZONE;

    if (timezoneSelect) {
      timezoneSelect.value = effectiveTimezone;
    }

    // Create a map of existing working hours
    const hoursMap = new Map(data.working_hours.map(wh => [wh.day_of_week, wh]));

    // Generate grid for all days
    const hoursHtml = DAYS_OF_WEEK.map(day => {
      const existingHours = hoursMap.get(day.value);
      const isActive = existingHours ? existingHours.is_active : false;
      const startTime = existingHours ? existingHours.start_time : '09:00:00';
      const endTime = existingHours ? existingHours.end_time : '17:00:00';

      return `
        <div class="working-hours-row">
          <div class="day-label">${day.label}</div>
          <input type="time"
                 class="time-input"
                 id="start-${day.value}"
                 value="${startTime.slice(0, 5)}"
                 ${!isActive ? 'disabled' : ''}>
          <input type="time"
                 class="time-input"
                 id="end-${day.value}"
                 value="${endTime.slice(0, 5)}"
                 ${!isActive ? 'disabled' : ''}>
          <div class="day-toggle">
            <input type="checkbox"
                   id="active-${day.value}"
                   ${isActive ? 'checked' : ''}
                   onchange="toggleDayInputs(${day.value})">
            <label for="active-${day.value}" class="text-small">Active</label>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = hoursHtml;

  } catch (error) {
    console.error('Failed to load working hours:', error);
    container.innerHTML = `
      <div class="alert alert-error">
        <svg class="alert-icon icon-lg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>Failed to load working hours</div>
      </div>
    `;
  }
}

function toggleDayInputs(dayOfWeek) {
  const isActive = document.getElementById(`active-${dayOfWeek}`).checked;
  document.getElementById(`start-${dayOfWeek}`).disabled = !isActive;
  document.getElementById(`end-${dayOfWeek}`).disabled = !isActive;
}

async function saveWorkingHours(event) {
  event.preventDefault();
  const timezoneSelect = document.getElementById('working-hours-timezone');
  const timezone = timezoneSelect?.value || DEFAULT_WORKING_HOURS_TIMEZONE;

  const hours = DAYS_OF_WEEK.map(day => {
    const isActive = document.getElementById(`active-${day.value}`).checked;
    const startTime = document.getElementById(`start-${day.value}`).value + ':00';
    const endTime = document.getElementById(`end-${day.value}`).value + ':00';

    return {
      day_of_week: day.value,
      start_time: startTime,
      end_time: endTime,
      is_active: isActive,
    };
  });

  try {
    const response = await fetch('/api/calendar/working-hours/batch', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_email: USER_EMAIL,
        hours,
        timezone,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save working hours');
    }

    broadcastAvailabilityRefresh('working_hours_saved');
    showNotification('success', 'Working hours saved and live availability refreshed');
    await loadWorkingHours();

  } catch (error) {
    console.error('Failed to save working hours:', error);
    showNotification('error', error.message || 'Failed to save working hours');
  }
}

// ============================================
// INITIALIZE AVAILABILITY SETTINGS
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  // Load blackouts and working hours on page load
  await loadBlackouts();
  await loadWorkingHours();

  // Setup form handlers
  document.getElementById('blackout-form').addEventListener('submit', addBlackout);
  document.getElementById('working-hours-form').addEventListener('submit', saveWorkingHours);
});

// Make functions globally available for onclick handlers
window.disconnectCalendar = disconnectCalendar;
window.refreshCalendar = refreshCalendar;
window.setPrimaryCalendar = setPrimaryCalendar;
window.switchTab = switchTab;
window.deleteBlackout = deleteBlackout;
window.toggleDayInputs = toggleDayInputs;

// ============================================
// ACCESS CODE PROTECTION
// ============================================
function initAccessCodeProtection() {
  const ACCESS_CODE = '102886';
  const STORAGE_KEY = 'autonome_admin_access_granted';
  const overlay = document.getElementById('admin-access-overlay');
  const body = document.body;
  const inputs = document.querySelectorAll('.passcode-digit');

  // Check if session is already verified
  if (window.sessionStorage.getItem(STORAGE_KEY) === 'true') {
    grantAccess();
    return;
  }

  // Handle digit input flow
  inputs.forEach((input, index) => {
    // Auto-focus first input
    if (index === 0) input.focus();

    input.addEventListener('input', (e) => {
      const value = e.target.value;
      if (value && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
      checkPasscode();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        inputs[index - 1].focus();
      }
    });

    // Handle paste
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = e.clipboardData.getData('text').slice(0, inputs.length);
      pasteData.split('').forEach((char, i) => {
        if (inputs[i]) inputs[i].value = char;
      });
      if (inputs[pasteData.length]) inputs[pasteData.length].focus();
      checkPasscode();
    });
  });

  function checkPasscode() {
    const enteredCode = Array.from(inputs).map(input => input.value).join('');

    if (enteredCode.length === inputs.length) {
      if (enteredCode === ACCESS_CODE) {
        grantAccess();
      } else {
        handleError();
      }
    }
  }

  function grantAccess() {
    window.sessionStorage.setItem(STORAGE_KEY, 'true');
    overlay.classList.add('hidden');
    body.classList.add('verified');
  }

  function handleError() {
    inputs.forEach(input => {
      input.classList.add('error');
      setTimeout(() => {
        input.classList.remove('error');
        input.value = '';
        if (inputs[0]) inputs[0].focus();
      }, 500);
    });
  }
}

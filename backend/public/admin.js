// ============================================
// STATE
// ============================================
const USER_EMAIL = 'dev@autonome.us'; // Hardcoded for now - could come from auth session
let connectedCalendars = [];
const MAX_CALENDARS = 7;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadSystemStatus();
  await loadCalendars();
  setupConnectButton();
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
  const connectBtn = document.getElementById('connect-btn');

  try {
    const response = await fetch(`/api/calendar/accounts?user_email=${encodeURIComponent(USER_EMAIL)}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    connectedCalendars = data.calendars || [];

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
    ? '<svg class="icon" style="color: var(--yellow-500);" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
    : '<svg class="icon" style="color: var(--royal-blue-600);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>';

  card.innerHTML = `
    <div class="calendar-account-icon">
      ${primaryBadge}
    </div>

    <div class="calendar-account-info">
      <div class="calendar-account-email">
        ${calendar.calendar_email}
        ${calendar.is_primary ? '<span style="color: var(--yellow-500); font-size: 0.875rem; margin-left: 0.5rem;">(Primary)</span>' : ''}
      </div>
      <div class="calendar-account-meta">
        Connected: ${connectedDate} | Status: ${calendar.is_active ? '<span style="color: var(--success);">✓ Active</span>' : '<span style="color: var(--warning);">⚠ Inactive</span>'}
        ${webhookStatus ? ` | Webhook: ${webhookStatus}` : ''}
      </div>
    </div>

    <div class="calendar-account-actions">
      <button
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

// ============================================
// DISCONNECT CALENDAR
// ============================================
async function disconnectCalendar(calendarId, calendarEmail) {
  if (!confirm(`Are you sure you want to disconnect "${calendarEmail}"?\n\nThis will remove it from availability calculations.`)) {
    return;
  }

  try {
    const response = await fetch(`/api/calendar/accounts/${calendarId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
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
  // Update tab buttons
  document.getElementById('blackouts-tab').classList.remove('active');
  document.getElementById('working-hours-tab').classList.remove('active');
  document.getElementById(`${tabName}-tab`).classList.add('active');

  // Update tab content
  document.getElementById('blackouts-content').style.display = 'none';
  document.getElementById('working-hours-content').style.display = 'none';
  document.getElementById(`${tabName}-content`).style.display = 'block';
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
          <button onclick="deleteBlackout('${blackout.id}')" class="btn btn-secondary btn-sm" style="background: var(--error); color: white;">
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

async function deleteBlackout(blackoutId) {
  if (!confirm('Are you sure you want to delete this blackout period?')) {
    return;
  }

  try {
    const response = await fetch(`/api/calendar/blackouts/${blackoutId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete blackout');
    }

    showNotification('success', 'Blackout period deleted');
    await loadBlackouts();

  } catch (error) {
    console.error('Failed to delete blackout:', error);
    showNotification('error', 'Failed to delete blackout period');
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

  try {
    const response = await fetch(`/api/calendar/working-hours?user_email=${encodeURIComponent(USER_EMAIL)}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

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
        timezone: 'America/New_York', // Could make this configurable
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save working hours');
    }

    showNotification('success', 'Working hours saved successfully');

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
window.switchTab = switchTab;
window.deleteBlackout = deleteBlackout;
window.toggleDayInputs = toggleDayInputs;

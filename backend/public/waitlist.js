const form = document.getElementById('waitlist-form');
const submitBtn = document.getElementById('submit-btn');
const waitlistContent = document.getElementById('waitlist-content');
const successMessage = document.getElementById('success-message');
const waitlistTitle = document.getElementById('waitlist-title-display');
const waitlistDescription = document.getElementById('waitlist-description-display');
const waitlistFooter = document.getElementById('waitlist-footer');
const waitlistResetBtn = document.getElementById('waitlist-reset-btn');

const ADMIN_USER_EMAIL_STORAGE_KEY = 'autonome_admin_user_email';
const DEFAULT_SUBMIT_BUTTON_HTML = `
  <span>Reserve My Spot</span>
  <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
  </svg>
`;

function resolveUserEmail() {
  const searchParams = new URLSearchParams(window.location.search);
  const queryUserEmail = searchParams.get('user_email')?.trim();
  const bodyUserEmail = document.body?.dataset?.userEmail?.trim();
  const storedUserEmail = window.localStorage.getItem(ADMIN_USER_EMAIL_STORAGE_KEY)?.trim();

  return queryUserEmail || bodyUserEmail || storedUserEmail || null;
}

const USER_EMAIL = resolveUserEmail();

function appendUserEmail(path) {
  if (!USER_EMAIL) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}user_email=${encodeURIComponent(USER_EMAIL)}`;
}

async function loadContent() {
  try {
    const response = await fetch(appendUserEmail('/api/calendar/config/show-slots'), {
      cache: 'no-store',
    });

    if (!response.ok) {
      console.error('Fetch failed with status:', response.status);
      return;
    }

    const settings = await response.json();

    if (settings.waitlistTitle && waitlistTitle) {
      waitlistTitle.textContent = settings.waitlistTitle;
    }

    if (settings.waitlistDescription && waitlistDescription) {
      waitlistDescription.textContent = settings.waitlistDescription;
    }

    if (waitlistFooter) {
      waitlistFooter.style.display = settings.showWaitlistCopyright === false ? 'none' : '';
    }
  } catch (error) {
    console.error('Failed to load waitlist personalization:', error);
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!form || !submitBtn || !waitlistContent || !successMessage) {
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>Processing...</span>';

  const formData = new FormData(form);
  const payload = {
    name: formData.get('name'),
    email: formData.get('email'),
    interest_level: formData.get('interest_level'),
  };

  try {
    const response = await fetch('/api/waitlist/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Submission failed');
    }

    waitlistContent.style.display = 'none';
    successMessage.style.display = 'block';
  } catch (error) {
    console.error('Waitlist submission failed:', error);
    window.alert('Oops! Something went wrong. Please try again later.');
    submitBtn.disabled = false;
    submitBtn.innerHTML = DEFAULT_SUBMIT_BUTTON_HTML;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadContent, { once: true });
} else {
  void loadContent();
}

if (form) {
  form.addEventListener('submit', handleSubmit);
}

if (waitlistResetBtn) {
  waitlistResetBtn.addEventListener('click', () => {
    window.location.reload();
  });
}

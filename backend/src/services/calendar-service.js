/**
 * Generate intelligent schedule suggestions based on customer analysis
 * @param {Object} analysis - AI analysis containing customer_tier and urgency_level
 * @returns {Array<string>} Array of formatted time slot suggestions
 */
function generateScheduleSuggestions(analysis) {
  const now = new Date();
  const suggestions = [];

  // Get timezone offset for EST/EDT (Eastern Time)
  const estOffset = -5; // EST is UTC-5, EDT is UTC-4
  const isEDT = now.getMonth() >= 2 && now.getMonth() <= 10; // Rough DST check
  const timeZone = isEDT ? 'EDT' : 'EST';

  // Calculate base scheduling based on urgency
  let startHours = 24; // Default 24 hours out

  switch (analysis.urgency_level) {
    case 'High':
      startHours = 4; // 4 hours for high urgency
      break;
    case 'Medium':
      startHours = 12; // 12 hours for medium urgency
      break;
    case 'Low':
    default:
      startHours = 48; // 48 hours for low urgency
      break;
  }

  // Adjust based on customer tier
  if (analysis.customer_tier === 'Enterprise') {
    startHours = Math.max(2, startHours / 2); // Halve the wait time, min 2 hours
  } else if (analysis.customer_tier === 'Professional') {
    startHours = Math.max(4, startHours * 0.75); // Reduce by 25%
  }

  // Generate 3-4 time slot options
  const baseTime = new Date(now.getTime() + (startHours * 60 * 60 * 1000));

  // Business hours: 9 AM - 6 PM EST/EDT
  const businessStart = 9;
  const businessEnd = 18;

  for (let i = 0; i < 4; i++) {
    const optionTime = new Date(baseTime.getTime() + (i * 24 * 60 * 60 * 1000)); // Add days

    // Skip weekends for regular scheduling
    if (optionTime.getDay() === 0 || optionTime.getDay() === 6) {
      if (analysis.urgency_level !== 'High') {
        continue; // Skip weekends unless high urgency
      }
    }

    // Set to business hours
    let hour = businessStart + (i * 2) % (businessEnd - businessStart);
    if (hour >= businessEnd) hour = businessStart + 1;

    optionTime.setHours(hour, 0, 0, 0);

    // Format the suggestion
    const dayName = optionTime.toLocaleDateString('en-US', { weekday: 'long' });
    const date = optionTime.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: optionTime.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
    const time = optionTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    // Add priority indicators for high-value customers
    let priority = '';
    if (analysis.customer_tier === 'Enterprise' && i === 0) {
      priority = '⭐ PRIORITY: ';
    } else if (analysis.urgency_level === 'High' && i === 0) {
      priority = '🚨 URGENT: ';
    }

    suggestions.push(`${priority}${dayName}, ${date} at ${time} ${timeZone}`);

    if (suggestions.length >= 3) break;
  }

  // Add alternative scheduling option
  if (analysis.customer_tier === 'Enterprise' || analysis.urgency_level === 'High') {
    suggestions.push('🕐 Alternative: Same-day emergency consultation available upon request');
  } else {
    suggestions.push('📅 Alternative: Additional times available - let us know your preferences');
  }

  return suggestions;
}

export { generateScheduleSuggestions };
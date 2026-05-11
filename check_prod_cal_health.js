
import fetch from 'node-fetch';

async function checkProductionCalendarHealth() {
  const url = 'https://booking.autonome.us/api/calendar/health';
  console.log(`Checking production calendar health: ${url}`);
  try {
    const response = await fetch(url);
    console.log(`Status: ${response.status} ${response.statusText}`);
    const data = await response.json();
    console.log(`Response:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`❌ Calendar health check failed: ${err.message}`);
  }
}

checkProductionCalendarHealth();

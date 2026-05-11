
import fetch from 'node-fetch';

async function checkProductionDiagnostics() {
  const url = 'https://booking.autonome.us/diagnostics';
  console.log(`Checking production diagnostics: ${url}`);
  try {
    const response = await fetch(url);
    console.log(`Status: ${response.status} ${response.statusText}`);
    const data = await response.json();
    console.log(`Response:`, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`❌ Diagnostics check failed: ${err.message}`);
  }
}

checkProductionDiagnostics();

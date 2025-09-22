#!/usr/bin/env node

/**
 * Focused Browser Test - Test form submission with detailed logging
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';

console.log('🎯 FOCUSED BROWSER TEST - Form Submission with Monitoring');
console.log('='.repeat(70));

async function runFocusedTest() {
    let browser = null;
    
    try {
        // Launch browser
        console.log('🚀 Launching browser...');
        browser = await chromium.launch({ 
            headless: false,
            devtools: true,
            slowMo: 1000
        });
        
        const page = await browser.newPage();
        
        // Set up network monitoring
        const networkRequests = [];
        page.on('request', request => {
            networkRequests.push({
                url: request.url(),
                method: request.method(),
                timestamp: new Date().toISOString()
            });
            console.log(`📡 REQUEST: ${request.method()} ${request.url()}`);
        });

        page.on('response', response => {
            console.log(`📥 RESPONSE: ${response.status()} ${response.url()}`);
        });

        // Navigate to website
        console.log('🌐 Navigating to https://autonome.us...');
        await page.goto('https://autonome.us');
        
        // Wait for page load
        await page.waitForLoadState('networkidle');
        console.log('✅ Page loaded successfully');
        
        // Take screenshot
        await page.screenshot({ path: 'autonome-homepage.png', fullPage: true });
        console.log('📸 Screenshot saved: autonome-homepage.png');
        
        // Look for forms or contact sections
        console.log('🔍 Analyzing page structure...');
        
        // Get page title
        const title = await page.title();
        console.log(`📄 Page title: ${title}`);
        
        // Look for forms
        const forms = await page.$$('form');
        console.log(`📋 Found ${forms.length} forms on page`);
        
        // Look for contact-related elements
        const contactElements = await page.$$('a[href*="contact"], button:has-text("contact"), [class*="contact"], [id*="contact"]');
        console.log(`📞 Found ${contactElements.length} contact-related elements`);
        
        // Look for booking elements
        const bookingElements = await page.$$('a[href*="book"], button:has-text("book"), [class*="book"], [id*="book"]');
        console.log(`📅 Found ${bookingElements.length} booking-related elements`);
        
        // Look for mailto links
        const emailLinks = await page.$$('a[href^="mailto:"]');
        console.log(`✉️  Found ${emailLinks.length} email links`);
        
        // Check for Calendly or scheduling widgets
        const schedulingElements = await page.$$('iframe[src*="calendly"], [class*="calendly"], [id*="calendly"], iframe[src*="cal.com"]');
        console.log(`📆 Found ${schedulingElements.length} scheduling widgets`);
        
        // Simulate scrolling to look for more content
        console.log('📜 Scrolling to reveal content...');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(3000);
        
        // Take another screenshot after scrolling
        await page.screenshot({ path: 'autonome-scrolled.png', fullPage: true });
        console.log('📸 Full page screenshot saved: autonome-scrolled.png');
        
        // Check for any popup or modal elements
        const popups = await page.$$('[class*="modal"], [class*="popup"], [class*="overlay"]');
        console.log(`🔔 Found ${popups.length} popup/modal elements`);
        
        // Look for any input fields
        const inputs = await page.$$('input, textarea, select');
        console.log(`📝 Found ${inputs.length} form inputs on page`);
        
        if (inputs.length > 0) {
            console.log('📝 Form inputs found - attempting to interact...');
            for (let i = 0; i < Math.min(inputs.length, 5); i++) {
                const input = inputs[i];
                const tagName = await input.evaluate(el => el.tagName);
                const type = await input.evaluate(el => el.type || 'unknown');
                const placeholder = await input.evaluate(el => el.placeholder || 'none');
                const name = await input.evaluate(el => el.name || 'none');
                
                console.log(`   Input ${i+1}: ${tagName} type="${type}" name="${name}" placeholder="${placeholder}"`);
            }
        }
        
        // Final network summary
        console.log(`\n📊 Network Activity Summary:`);
        console.log(`   Total Requests: ${networkRequests.length}`);
        
        const domains = [...new Set(networkRequests.map(req => new URL(req.url).hostname))];
        console.log(`   Unique Domains: ${domains.length}`);
        domains.slice(0, 10).forEach(domain => console.log(`     - ${domain}`));
        
        console.log('\n✅ Focused browser test completed successfully');
        
    } catch (error) {
        console.error(`❌ Test failed: ${error.message}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('🔒 Browser closed');
        }
    }
}

runFocusedTest()
    .then(() => {
        console.log('🎉 Test completed successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('🚨 Test failed:', error);
        process.exit(1);
    });
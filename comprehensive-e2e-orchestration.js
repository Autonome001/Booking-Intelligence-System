#!/usr/bin/env node

/**
 * Comprehensive End-to-End Orchestration Test for Autonome.us Booking System
 * 
 * This orchestrates complete monitoring across:
 * - Playwright browser automation for form filling
 * - Railway production server log monitoring
 * - Network traffic analysis and API tracking
 * - Supabase database change monitoring
 * - Real-time performance metrics and reporting
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { WebClient } from '@slack/web-api';
import fs from 'fs';
import path from 'path';

// Configuration
const CONFIG = {
    baseUrl: 'https://autonome.us',
    backendUrl: 'https://autonome-isaas-autonomeus.up.railway.app',
    supabaseUrl: 'https://usrouqkkqwdnfymxusbj.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzcm91cWtrcXdkbmZ5bXh1c2JqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM1ODcxOTQsImV4cCI6MjA2OTE2MzE5NH0.UYgsuLQeZok0bhN_OYTXsfWilRezxtOPkMFoGstZCA8',
    testData: {
        businessName: 'TechFlow Solutions',
        contactName: 'Sarah Mitchell, CTO',
        email: 'sarah.mitchell@techflow.solutions',
        phone: '+1 (555) 234-5678',
        service: 'AI automation and process optimization',
        timeline: 'Q1 2025 implementation',
        budget: '$50,000-100,000',
        details: 'Looking to automate our customer onboarding process and integrate AI for lead qualification'
    }
};

class EndToEndOrchestrator {
    constructor() {
        this.startTime = Date.now();
        this.metrics = {
            phases: {},
            apiCalls: [],
            database: [],
            slack: [],
            errors: []
        };
        this.browser = null;
        this.page = null;
        this.supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
        this.monitoring = {
            networkRequests: [],
            consoleMessages: [],
            errors: []
        };
    }

    log(phase, message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] [${phase}] [${type}] ${message}`;
        console.log(logMessage);
        
        // Write to log file
        fs.appendFileSync(
            path.join(process.cwd(), 'orchestration-log.txt'),
            logMessage + '\n'
        );
    }

    async startPhase(phaseName) {
        this.log('ORCHESTRATOR', `🚀 Starting Phase: ${phaseName}`, 'PHASE');
        this.metrics.phases[phaseName] = { start: Date.now() };
    }

    async endPhase(phaseName, success = true) {
        this.metrics.phases[phaseName].end = Date.now();
        this.metrics.phases[phaseName].duration = 
            this.metrics.phases[phaseName].end - this.metrics.phases[phaseName].start;
        this.metrics.phases[phaseName].success = success;
        
        this.log('ORCHESTRATOR', 
            `${success ? '✅' : '❌'} Completed Phase: ${phaseName} (${this.metrics.phases[phaseName].duration}ms)`, 
            'PHASE'
        );
    }

    // PHASE 1: Monitoring Setup
    async setupMonitoring() {
        await this.startPhase('MONITORING_SETUP');

        try {
            // Launch Playwright browser
            this.log('MONITORING', 'Launching Playwright browser for form interaction monitoring');
            this.browser = await chromium.launch({ 
                headless: false, // Keep visible for monitoring
                devtools: true,
                slowMo: 500 // Slow down for better monitoring
            });
            this.page = await this.browser.newPage();

            // Set up network monitoring
            this.page.on('request', request => {
                this.monitoring.networkRequests.push({
                    timestamp: Date.now(),
                    url: request.url(),
                    method: request.method(),
                    headers: request.headers(),
                    postData: request.postData()
                });
                this.log('NETWORK', `📡 REQUEST: ${request.method()} ${request.url()}`);
            });

            this.page.on('response', response => {
                this.log('NETWORK', `📥 RESPONSE: ${response.status()} ${response.url()}`);
                this.metrics.apiCalls.push({
                    timestamp: Date.now(),
                    url: response.url(),
                    status: response.status(),
                    timing: response.timing()
                });
            });

            // Set up console monitoring
            this.page.on('console', message => {
                this.monitoring.consoleMessages.push({
                    timestamp: Date.now(),
                    type: message.type(),
                    text: message.text()
                });
                this.log('CONSOLE', `💬 ${message.type()}: ${message.text()}`);
            });

            // Set up error monitoring
            this.page.on('pageerror', error => {
                this.monitoring.errors.push({
                    timestamp: Date.now(),
                    message: error.message,
                    stack: error.stack
                });
                this.log('ERROR', `🚨 PAGE ERROR: ${error.message}`, 'ERROR');
            });

            // Set up backend health monitoring
            this.log('MONITORING', 'Setting up backend health monitoring');
            await this.monitorBackendHealth();

            // Set up database monitoring
            this.log('MONITORING', 'Setting up Supabase database monitoring');
            await this.setupDatabaseMonitoring();

            await this.endPhase('MONITORING_SETUP', true);
        } catch (error) {
            this.log('ERROR', `Monitoring setup failed: ${error.message}`, 'ERROR');
            this.metrics.errors.push({ phase: 'MONITORING_SETUP', error: error.message });
            await this.endPhase('MONITORING_SETUP', false);
            throw error;
        }
    }

    async monitorBackendHealth() {
        try {
            const healthResponse = await fetch(`${CONFIG.backendUrl}/health`);
            const healthData = await healthResponse.json();
            
            this.log('HEALTH', `Backend health: ${healthData.status} (uptime: ${healthData.uptime}s)`);
            
            // Get diagnostics
            const diagResponse = await fetch(`${CONFIG.backendUrl}/diagnostics`);
            const diagData = await diagResponse.json();
            
            this.log('DIAGNOSTICS', `Services: ${JSON.stringify(diagData.services, null, 2)}`);
        } catch (error) {
            this.log('ERROR', `Backend health check failed: ${error.message}`, 'ERROR');
        }
    }

    async setupDatabaseMonitoring() {
        try {
            // Test database connection
            const { data, error } = await this.supabase
                .from('bookings')
                .select('count')
                .limit(1);
            
            if (error) throw error;
            
            this.log('DATABASE', 'Database connection established successfully');
            
            // Set up real-time subscription for new bookings
            const subscription = this.supabase
                .channel('booking-changes')
                .on('postgres_changes', 
                    { event: 'INSERT', schema: 'public', table: 'booking_inquiries' },
                    (payload) => {
                        this.log('DATABASE', `📥 NEW BOOKING INSERTED: ${JSON.stringify(payload.new)}`);
                        this.metrics.database.push({
                            timestamp: Date.now(),
                            event: 'INSERT',
                            data: payload.new
                        });
                    }
                )
                .on('postgres_changes',
                    { event: 'UPDATE', schema: 'public', table: 'booking_inquiries' },
                    (payload) => {
                        this.log('DATABASE', `📝 BOOKING UPDATED: ${JSON.stringify(payload.new)}`);
                        this.metrics.database.push({
                            timestamp: Date.now(),
                            event: 'UPDATE',
                            data: payload.new,
                            old: payload.old
                        });
                    }
                )
                .subscribe();

            this.log('DATABASE', 'Real-time database subscription established');
        } catch (error) {
            this.log('ERROR', `Database monitoring setup failed: ${error.message}`, 'ERROR');
        }
    }

    // PHASE 2: Form Submission
    async executeFormSubmission() {
        await this.startPhase('FORM_SUBMISSION');

        try {
            this.log('FORM', `Navigating to booking form: ${CONFIG.baseUrl}`);
            await this.page.goto(CONFIG.baseUrl);
            
            // Wait for page to load completely
            await this.page.waitForLoadState('networkidle');
            
            // Take screenshot for monitoring
            await this.page.screenshot({ path: 'form-loaded.png' });
            this.log('FORM', 'Form loaded - screenshot captured');

            // Find and fill the booking form
            this.log('FORM', 'Filling booking form with test data');
            
            // Look for common form field selectors
            const formSelectors = {
                business: ['input[name="business"]', 'input[name="businessName"]', '#business', '[placeholder*="business"]'],
                contact: ['input[name="contact"]', 'input[name="contactName"]', '#contact', '[placeholder*="contact"]'],
                email: ['input[name="email"]', 'input[type="email"]', '#email'],
                phone: ['input[name="phone"]', 'input[type="tel"]', '#phone'],
                service: ['textarea[name="service"]', 'select[name="service"]', '#service'],
                timeline: ['input[name="timeline"]', 'select[name="timeline"]', '#timeline'],
                budget: ['input[name="budget"]', 'select[name="budget"]', '#budget'],
                details: ['textarea[name="details"]', 'textarea[name="message"]', '#details', '#message']
            };

            // Try to fill each field
            for (const [fieldName, selectors] of Object.entries(formSelectors)) {
                for (const selector of selectors) {
                    try {
                        const element = await this.page.$(selector);
                        if (element) {
                            const value = CONFIG.testData[fieldName] || CONFIG.testData[fieldName + 'Name'] || '';
                            if (value) {
                                await element.fill(value);
                                this.log('FORM', `✅ Filled ${fieldName}: ${value.substring(0, 50)}...`);
                                break;
                            }
                        }
                    } catch (error) {
                        // Try next selector
                    }
                }
            }

            // Take screenshot after filling
            await this.page.screenshot({ path: 'form-filled.png' });
            this.log('FORM', 'Form filled - screenshot captured');

            // Find and click submit button
            const submitSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button:has-text("submit")',
                'button:has-text("Send")',
                'button:has-text("Book")',
                '.submit-btn',
                '#submit'
            ];

            let submitted = false;
            for (const selector of submitSelectors) {
                try {
                    const submitBtn = await this.page.$(selector);
                    if (submitBtn) {
                        this.log('FORM', `Submitting form using: ${selector}`);
                        await submitBtn.click();
                        submitted = true;
                        break;
                    }
                } catch (error) {
                    // Try next selector
                }
            }

            if (!submitted) {
                throw new Error('Could not find submit button');
            }

            // Wait for form submission to complete
            this.log('FORM', 'Waiting for form submission to complete...');
            await this.page.waitForTimeout(3000); // Give time for submission

            // Take screenshot after submission
            await this.page.screenshot({ path: 'form-submitted.png' });
            this.log('FORM', 'Form submitted - screenshot captured');

            await this.endPhase('FORM_SUBMISSION', true);
        } catch (error) {
            this.log('ERROR', `Form submission failed: ${error.message}`, 'ERROR');
            this.metrics.errors.push({ phase: 'FORM_SUBMISSION', error: error.message });
            await this.page.screenshot({ path: 'form-error.png' });
            await this.endPhase('FORM_SUBMISSION', false);
            throw error;
        }
    }

    // PHASE 3: End-to-End Workflow Monitoring
    async monitorWorkflow() {
        await this.startPhase('WORKFLOW_MONITORING');

        try {
            this.log('WORKFLOW', 'Monitoring AI email generation and Slack workflow...');
            
            // Monitor for 60 seconds to capture the complete workflow
            const monitoringDuration = 60000;
            const startTime = Date.now();

            while (Date.now() - startTime < monitoringDuration) {
                // Check for new API calls
                const recentCalls = this.metrics.apiCalls.filter(call => 
                    call.timestamp > startTime
                );

                // Look for OpenAI API calls
                const openAICalls = recentCalls.filter(call => 
                    call.url.includes('openai') || call.url.includes('api.openai.com')
                );

                if (openAICalls.length > 0) {
                    this.log('AI', `🤖 OpenAI API calls detected: ${openAICalls.length}`);
                }

                // Check for Slack API calls
                const slackCalls = recentCalls.filter(call => 
                    call.url.includes('slack.com') || call.url.includes('/slack/')
                );

                if (slackCalls.length > 0) {
                    this.log('SLACK', `💬 Slack API calls detected: ${slackCalls.length}`);
                }

                // Monitor database changes
                if (this.metrics.database.length > 0) {
                    this.log('DATABASE', `📊 Database changes detected: ${this.metrics.database.length}`);
                    for (const change of this.metrics.database) {
                        this.log('DATABASE', `   - ${change.event} at ${new Date(change.timestamp).toISOString()}`);
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
            }

            await this.endPhase('WORKFLOW_MONITORING', true);
        } catch (error) {
            this.log('ERROR', `Workflow monitoring failed: ${error.message}`, 'ERROR');
            this.metrics.errors.push({ phase: 'WORKFLOW_MONITORING', error: error.message });
            await this.endPhase('WORKFLOW_MONITORING', false);
        }
    }

    // PHASE 4: Real-time Reporting
    async generateReport() {
        await this.startPhase('REPORTING');

        try {
            const totalDuration = Date.now() - this.startTime;
            
            const report = {
                timestamp: new Date().toISOString(),
                totalDuration: `${totalDuration}ms`,
                phases: this.metrics.phases,
                summary: {
                    totalApiCalls: this.metrics.apiCalls.length,
                    databaseChanges: this.metrics.database.length,
                    slackEvents: this.metrics.slack.length,
                    networkRequests: this.monitoring.networkRequests.length,
                    consoleMessages: this.monitoring.consoleMessages.length,
                    errors: this.metrics.errors.length
                },
                performance: {
                    averageResponseTime: this.calculateAverageResponseTime(),
                    slowestApiCall: this.findSlowestApiCall(),
                    fastestApiCall: this.findFastestApiCall()
                },
                apiCalls: this.metrics.apiCalls,
                databaseChanges: this.metrics.database,
                networkRequests: this.monitoring.networkRequests,
                errors: this.metrics.errors,
                recommendations: this.generateRecommendations()
            };

            // Save detailed report
            const reportPath = path.join(process.cwd(), `e2e-orchestration-report-${Date.now()}.json`);
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
            
            this.log('REPORT', `📊 Detailed report saved to: ${reportPath}`);

            // Print summary to console
            this.printSummary(report);

            await this.endPhase('REPORTING', true);
            return report;
        } catch (error) {
            this.log('ERROR', `Report generation failed: ${error.message}`, 'ERROR');
            await this.endPhase('REPORTING', false);
        }
    }

    calculateAverageResponseTime() {
        const responseTimes = this.metrics.apiCalls
            .filter(call => call.timing)
            .map(call => call.timing.responseEnd - call.timing.requestStart);
        
        return responseTimes.length > 0 
            ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
            : 0;
    }

    findSlowestApiCall() {
        return this.metrics.apiCalls.reduce((slowest, call) => {
            if (!call.timing) return slowest;
            const duration = call.timing.responseEnd - call.timing.requestStart;
            return !slowest || duration > slowest.duration 
                ? { url: call.url, duration } 
                : slowest;
        }, null);
    }

    findFastestApiCall() {
        return this.metrics.apiCalls.reduce((fastest, call) => {
            if (!call.timing) return fastest;
            const duration = call.timing.responseEnd - call.timing.requestStart;
            return !fastest || duration < fastest.duration 
                ? { url: call.url, duration } 
                : fastest;
        }, null);
    }

    generateRecommendations() {
        const recommendations = [];

        if (this.metrics.errors.length > 0) {
            recommendations.push(`⚠️  ${this.metrics.errors.length} errors detected - review error log`);
        }

        if (this.metrics.database.length === 0) {
            recommendations.push(`📋 No database changes detected - verify booking persistence`);
        }

        const avgResponseTime = this.calculateAverageResponseTime();
        if (avgResponseTime > 3000) {
            recommendations.push(`🐌 Average response time (${avgResponseTime}ms) exceeds 3s Slack requirement`);
        }

        if (this.metrics.apiCalls.length === 0) {
            recommendations.push(`🔍 No API calls detected - verify form submission workflow`);
        }

        return recommendations;
    }

    printSummary(report) {
        console.log('\n' + '='.repeat(80));
        console.log('🎯 END-TO-END ORCHESTRATION SUMMARY REPORT');
        console.log('='.repeat(80));
        
        console.log('\n📊 EXECUTION OVERVIEW:');
        console.log(`   Total Duration: ${report.totalDuration}`);
        console.log(`   Phases Completed: ${Object.keys(report.phases).length}`);
        console.log(`   Success Rate: ${Object.values(report.phases).filter(p => p.success).length}/${Object.keys(report.phases).length}`);

        console.log('\n🔍 ACTIVITY SUMMARY:');
        console.log(`   📡 API Calls: ${report.summary.totalApiCalls}`);
        console.log(`   📊 Database Changes: ${report.summary.databaseChanges}`);
        console.log(`   🌐 Network Requests: ${report.summary.networkRequests}`);
        console.log(`   💬 Console Messages: ${report.summary.consoleMessages}`);
        console.log(`   🚨 Errors: ${report.summary.errors}`);

        console.log('\n⚡ PERFORMANCE METRICS:');
        console.log(`   Average Response Time: ${Math.round(report.performance.averageResponseTime)}ms`);
        if (report.performance.slowestApiCall) {
            console.log(`   Slowest API Call: ${report.performance.slowestApiCall.duration}ms (${report.performance.slowestApiCall.url})`);
        }
        if (report.performance.fastestApiCall) {
            console.log(`   Fastest API Call: ${report.performance.fastestApiCall.duration}ms (${report.performance.fastestApiCall.url})`);
        }

        if (report.databaseChanges.length > 0) {
            console.log('\n📊 DATABASE ACTIVITY:');
            report.databaseChanges.forEach((change, index) => {
                console.log(`   ${index + 1}. ${change.event} at ${new Date(change.timestamp).toLocaleTimeString()}`);
            });
        }

        if (report.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            report.recommendations.forEach(rec => console.log(`   ${rec}`));
        }

        console.log('\n' + '='.repeat(80));
    }

    async cleanup() {
        this.log('CLEANUP', 'Cleaning up resources...');
        
        if (this.browser) {
            await this.browser.close();
            this.log('CLEANUP', 'Browser closed');
        }
    }

    // Main orchestration execution
    async execute() {
        try {
            console.log('🚀 AUTONOME.US BOOKING SYSTEM - COMPREHENSIVE E2E ORCHESTRATION');
            console.log('=' .repeat(80));
            console.log(`📅 Started at: ${new Date().toISOString()}`);
            console.log(`🎯 Target: ${CONFIG.baseUrl}`);
            console.log(`🔧 Backend: ${CONFIG.backendUrl}`);
            console.log('=' .repeat(80));

            // Execute all phases
            await this.setupMonitoring();
            await this.executeFormSubmission();
            await this.monitorWorkflow();
            const report = await this.generateReport();

            this.log('ORCHESTRATOR', '🎉 ORCHESTRATION COMPLETED SUCCESSFULLY', 'SUCCESS');
            return report;

        } catch (error) {
            this.log('ERROR', `🚨 ORCHESTRATION FAILED: ${error.message}`, 'ERROR');
            throw error;
        } finally {
            await this.cleanup();
        }
    }
}

// Execute orchestration if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const orchestrator = new EndToEndOrchestrator();
    orchestrator.execute()
        .then((report) => {
            console.log('\n🎯 ORCHESTRATION SUCCESS - Report generated');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n🚨 ORCHESTRATION FAILED:', error.message);
            process.exit(1);
        });
}

export default EndToEndOrchestrator;
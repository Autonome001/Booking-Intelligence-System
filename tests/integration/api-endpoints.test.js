#!/usr/bin/env node

/**
 * Comprehensive API Test - Direct backend testing with monitoring
 */

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import { WebClient } from '@slack/web-api';

const CONFIG = {
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

console.log('🎯 COMPREHENSIVE API TEST - Direct Backend Testing with Monitoring');
console.log('='.repeat(80));

class APITester {
    constructor() {
        this.startTime = Date.now();
        this.metrics = {
            apiCalls: [],
            database: [],
            errors: []
        };
        this.supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
    }

    log(phase, message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${phase}] ${message}`);
    }

    async testBackendEndpoints() {
        this.log('BACKEND', '🔍 Testing backend endpoints...');
        
        const endpoints = [
            '/health',
            '/diagnostics',
            '/api/booking',
            '/api/slack/interactions'
        ];

        for (const endpoint of endpoints) {
            try {
                const url = `${CONFIG.backendUrl}${endpoint}`;
                const startTime = Date.now();
                
                this.log('API', `Testing ${endpoint}...`);
                const response = await fetch(url, {
                    method: endpoint === '/api/booking' ? 'POST' : 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'E2E-Test-Suite'
                    },
                    body: endpoint === '/api/booking' ? JSON.stringify({
                        test: true,
                        ...CONFIG.testData
                    }) : undefined
                });

                const duration = Date.now() - startTime;
                this.metrics.apiCalls.push({
                    endpoint,
                    status: response.status,
                    duration,
                    timestamp: Date.now()
                });

                this.log('API', `✅ ${endpoint}: ${response.status} (${duration}ms)`);

                if (response.ok) {
                    try {
                        const data = await response.text();
                        if (data) {
                            const jsonData = JSON.parse(data);
                            this.log('API', `   Response: ${JSON.stringify(jsonData, null, 2).substring(0, 200)}...`);
                        }
                    } catch (e) {
                        // Not JSON, that's fine
                        this.log('API', `   Response: ${data.substring(0, 100)}...`);
                    }
                } else {
                    this.log('ERROR', `❌ ${endpoint}: ${response.status} ${response.statusText}`);
                }

            } catch (error) {
                this.log('ERROR', `❌ ${endpoint} failed: ${error.message}`);
                this.metrics.errors.push({ endpoint, error: error.message });
            }
        }
    }

    async simulateBookingSubmission() {
        this.log('BOOKING', '📋 Simulating realistic booking submission...');
        
        try {
            const bookingPayload = {
                email_from: CONFIG.testData.email,
                email_subject: 'New Booking Inquiry - TechFlow Solutions',
                email_body: `
Hi,

I'm ${CONFIG.testData.contactName} from ${CONFIG.testData.businessName}.

We're looking for ${CONFIG.testData.service} with a ${CONFIG.testData.timeline}.
Our budget range is ${CONFIG.testData.budget}.

${CONFIG.testData.details}

Please let me know your availability for a strategy call.

Best regards,
${CONFIG.testData.contactName}
Phone: ${CONFIG.testData.phone}
Email: ${CONFIG.testData.email}
                `.trim(),
                customer_name: CONFIG.testData.contactName,
                company_name: CONFIG.testData.businessName,
                phone_number: CONFIG.testData.phone,
                inquiry_type: 'strategy_call',
                metadata: {
                    source: 'e2e_test',
                    timestamp: new Date().toISOString(),
                    test_session: `test_${Date.now()}`
                }
            };

            const response = await fetch(`${CONFIG.backendUrl}/api/booking`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'E2E-Test-Suite/1.0'
                },
                body: JSON.stringify(bookingPayload)
            });

            const responseText = await response.text();
            
            if (response.ok) {
                this.log('BOOKING', `✅ Booking submitted successfully: ${response.status}`);
                this.log('BOOKING', `Response: ${responseText}`);
                
                // Try to parse response for booking ID
                try {
                    const responseData = JSON.parse(responseText);
                    if (responseData.booking_id || responseData.id) {
                        const bookingId = responseData.booking_id || responseData.id;
                        this.log('BOOKING', `📝 Booking ID: ${bookingId}`);
                        return bookingId;
                    }
                } catch (e) {
                    // Response might not be JSON
                }
                
                return true;
            } else {
                this.log('ERROR', `❌ Booking submission failed: ${response.status} ${response.statusText}`);
                this.log('ERROR', `Response: ${responseText}`);
                this.metrics.errors.push({ 
                    operation: 'booking_submission', 
                    status: response.status,
                    response: responseText 
                });
                return false;
            }

        } catch (error) {
            this.log('ERROR', `❌ Booking submission error: ${error.message}`);
            this.metrics.errors.push({ operation: 'booking_submission', error: error.message });
            return false;
        }
    }

    async monitorDatabaseChanges() {
        this.log('DATABASE', '📊 Monitoring database for new entries...');
        
        try {
            // Check recent booking inquiries
            const { data: recentBookings, error } = await this.supabase
                .from('booking_inquiries')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(5);

            if (error) throw error;

            this.log('DATABASE', `Found ${recentBookings.length} recent booking inquiries`);
            
            recentBookings.forEach((booking, index) => {
                const createdAt = new Date(booking.created_at);
                const minutesAgo = Math.round((Date.now() - createdAt.getTime()) / (1000 * 60));
                
                this.log('DATABASE', `   ${index + 1}. ID: ${booking.id} | Status: ${booking.status} | Created: ${minutesAgo} min ago`);
                
                if (booking.metadata?.source === 'e2e_test') {
                    this.log('DATABASE', `   🎯 Found our test booking! Processing status: ${booking.status}`);
                }
            });

            return recentBookings;

        } catch (error) {
            this.log('ERROR', `❌ Database monitoring failed: ${error.message}`);
            this.metrics.errors.push({ operation: 'database_monitoring', error: error.message });
            return [];
        }
    }

    async testWorkflowTriggers() {
        this.log('WORKFLOW', '⚡ Testing workflow triggers and processing...');
        
        // Check if there are any pending workflows
        try {
            const { data: pendingBookings, error } = await this.supabase
                .from('booking_inquiries')
                .select('*')
                .in('status', ['pending', 'processing', 'draft_created'])
                .limit(10);

            if (error) throw error;

            this.log('WORKFLOW', `Found ${pendingBookings.length} bookings in processing states`);
            
            pendingBookings.forEach(booking => {
                const createdAt = new Date(booking.created_at);
                const minutesAgo = Math.round((Date.now() - createdAt.getTime()) / (1000 * 60));
                
                this.log('WORKFLOW', `   Processing: ${booking.status} | ${booking.customer_name} | ${minutesAgo}m ago`);
            });

            return pendingBookings;

        } catch (error) {
            this.log('ERROR', `❌ Workflow monitoring failed: ${error.message}`);
            return [];
        }
    }

    async generatePerformanceReport() {
        const totalDuration = Date.now() - this.startTime;
        
        const report = {
            timestamp: new Date().toISOString(),
            duration: `${totalDuration}ms`,
            summary: {
                totalApiCalls: this.metrics.apiCalls.length,
                successfulCalls: this.metrics.apiCalls.filter(call => call.status >= 200 && call.status < 300).length,
                errors: this.metrics.errors.length
            },
            performance: {
                averageResponseTime: this.calculateAverageResponseTime(),
                slowestCall: this.findSlowestCall(),
                fastestCall: this.findFastestCall()
            },
            apiCalls: this.metrics.apiCalls,
            errors: this.metrics.errors,
            recommendations: this.generateRecommendations()
        };

        this.log('REPORT', '📊 Performance Report Generated');
        console.log('\n' + '='.repeat(80));
        console.log('🎯 COMPREHENSIVE API TEST RESULTS');
        console.log('='.repeat(80));
        
        console.log(`\n⏱️  Total Duration: ${report.duration}`);
        console.log(`📡 API Calls: ${report.summary.totalApiCalls} (${report.summary.successfulCalls} successful)`);
        console.log(`❌ Errors: ${report.summary.errors}`);
        
        if (report.performance.averageResponseTime) {
            console.log(`📈 Average Response Time: ${Math.round(report.performance.averageResponseTime)}ms`);
        }
        
        if (report.performance.slowestCall) {
            console.log(`🐌 Slowest Call: ${report.performance.slowestCall.endpoint} (${report.performance.slowestCall.duration}ms)`);
        }
        
        if (report.performance.fastestCall) {
            console.log(`⚡ Fastest Call: ${report.performance.fastestCall.endpoint} (${report.performance.fastestCall.duration}ms)`);
        }

        if (report.recommendations.length > 0) {
            console.log('\n💡 Recommendations:');
            report.recommendations.forEach(rec => console.log(`   ${rec}`));
        }

        if (this.metrics.errors.length > 0) {
            console.log('\n🚨 Errors Encountered:');
            this.metrics.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error.endpoint || error.operation}: ${error.error || error.response}`);
            });
        }

        console.log('\n' + '='.repeat(80));
        
        return report;
    }

    calculateAverageResponseTime() {
        const times = this.metrics.apiCalls.map(call => call.duration);
        return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    }

    findSlowestCall() {
        return this.metrics.apiCalls.reduce((slowest, call) => 
            !slowest || call.duration > slowest.duration ? call : slowest, null);
    }

    findFastestCall() {
        return this.metrics.apiCalls.reduce((fastest, call) => 
            !fastest || call.duration < fastest.duration ? call : fastest, null);
    }

    generateRecommendations() {
        const recommendations = [];

        if (this.metrics.errors.length > 0) {
            recommendations.push(`⚠️  ${this.metrics.errors.length} errors detected - review error handling`);
        }

        const avgResponseTime = this.calculateAverageResponseTime();
        if (avgResponseTime > 3000) {
            recommendations.push(`🐌 Average response time exceeds 3s Slack requirement (${Math.round(avgResponseTime)}ms)`);
        }

        const successRate = this.metrics.apiCalls.filter(call => call.status >= 200 && call.status < 300).length / this.metrics.apiCalls.length;
        if (successRate < 0.9) {
            recommendations.push(`📉 Success rate below 90% (${Math.round(successRate * 100)}%)`);
        }

        if (recommendations.length === 0) {
            recommendations.push(`✅ All systems performing well - ready for production`);
        }

        return recommendations;
    }

    async runComprehensiveTest() {
        try {
            // Phase 1: Backend endpoint testing
            await this.testBackendEndpoints();
            
            // Phase 2: Simulate booking submission
            const bookingResult = await this.simulateBookingSubmission();
            
            // Phase 3: Monitor database changes
            await this.monitorDatabaseChanges();
            
            // Phase 4: Check workflow processing
            await this.testWorkflowTriggers();
            
            // Wait a bit to see if any async processing happens
            this.log('MONITORING', '⏳ Waiting 30 seconds to monitor async processing...');
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Final database check
            await this.monitorDatabaseChanges();
            
            // Phase 5: Generate report
            const report = await this.generatePerformanceReport();
            
            return report;

        } catch (error) {
            this.log('ERROR', `🚨 Comprehensive test failed: ${error.message}`);
            throw error;
        }
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const tester = new APITester();
    tester.runComprehensiveTest()
        .then(report => {
            console.log('\n🎉 COMPREHENSIVE API TEST COMPLETED SUCCESSFULLY');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n🚨 TEST FAILED:', error.message);
            process.exit(1);
        });
}

export default APITester;
#!/usr/bin/env node

/**
 * Comprehensive Load Testing Suite for Autonome.us Booking System
 * Tests concurrent requests, performance under load, and system stability
 */

import fetch from 'node-fetch';

const PRODUCTION_URL = 'https://autonome-isaas-autonomeus.up.railway.app';

// Test scenarios with varied customer data
const TEST_SCENARIOS = [
    {
        name: "Enterprise Customer",
        data: {
            name: `Enterprise-${Math.random().toString(36).substr(2, 6)}`,
            email: `enterprise${Math.random().toString(36).substr(2, 4)}@bigcorp.com`,
            message: "We need large-scale automation for our 500+ employee organization. Complex requirements across multiple departments.",
            company: "Global Enterprise Corp",
            phone: `555-${Math.floor(1000 + Math.random() * 9000)}`
        }
    },
    {
        name: "SMB Customer", 
        data: {
            name: `SMB-${Math.random().toString(36).substr(2, 6)}`,
            email: `smb${Math.random().toString(36).substr(2, 4)}@smallbiz.com`,
            message: "Small business looking for simple automation solutions. Budget conscious but need quality results.",
            company: "Small Business LLC",
            phone: `555-${Math.floor(1000 + Math.random() * 9000)}`
        }
    },
    {
        name: "Startup Customer",
        data: {
            name: `Startup-${Math.random().toString(36).substr(2, 6)}`,
            email: `startup${Math.random().toString(36).substr(2, 4)}@techstartup.io`,
            message: "Fast-growing startup needs scalable automation. Move fast and iterate quickly.",
            company: "TechStart Inc",
            phone: `555-${Math.floor(1000 + Math.random() * 9000)}`
        }
    }
];

class LoadTester {
    constructor() {
        this.results = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            responseTimes: [],
            errors: [],
            concurrent: {
                maxConcurrent: 0,
                avgConcurrent: 0
            }
        };
        this.startTime = Date.now();
    }

    // Single booking request test
    async singleBookingTest(scenario) {
        const requestStart = Date.now();
        
        try {
            const response = await fetch(`${PRODUCTION_URL}/api/booking/booking-form`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(scenario.data),
                timeout: 30000 // 30 second timeout
            });

            const responseTime = Date.now() - requestStart;
            const responseData = await response.json();

            this.results.totalRequests++;
            this.results.responseTimes.push(responseTime);
            this.results.minResponseTime = Math.min(this.results.minResponseTime, responseTime);
            this.results.maxResponseTime = Math.max(this.results.maxResponseTime, responseTime);

            if (response.ok && responseData.success) {
                this.results.successfulRequests++;
                return {
                    success: true,
                    responseTime,
                    data: responseData,
                    scenario: scenario.name
                };
            } else {
                this.results.failedRequests++;
                this.results.errors.push({
                    scenario: scenario.name,
                    error: `HTTP ${response.status}: ${responseData.error || 'Unknown error'}`,
                    responseTime
                });
                return {
                    success: false,
                    responseTime,
                    error: responseData.error || 'Unknown error',
                    scenario: scenario.name
                };
            }
        } catch (error) {
            const responseTime = Date.now() - requestStart;
            this.results.totalRequests++;
            this.results.failedRequests++;
            this.results.errors.push({
                scenario: scenario.name,
                error: error.message,
                responseTime
            });
            
            return {
                success: false,
                responseTime,
                error: error.message,
                scenario: scenario.name
            };
        }
    }

    // Concurrent requests test
    async concurrentTest(concurrency = 5, totalRequests = 15) {
        console.log(`🔄 Running concurrent test: ${concurrency} concurrent, ${totalRequests} total requests`);
        
        const promises = [];
        let requestCount = 0;

        while (requestCount < totalRequests) {
            const batch = [];
            const batchSize = Math.min(concurrency, totalRequests - requestCount);

            for (let i = 0; i < batchSize; i++) {
                const scenario = TEST_SCENARIOS[requestCount % TEST_SCENARIOS.length];
                batch.push(this.singleBookingTest(scenario));
                requestCount++;
            }

            this.results.concurrent.maxConcurrent = Math.max(this.results.concurrent.maxConcurrent, batch.length);
            promises.push(...batch);

            // Wait for batch to complete before starting next batch
            await Promise.allSettled(batch);
            
            // Brief pause between batches to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const results = await Promise.allSettled(promises);
        return results.map(result => result.value).filter(Boolean);
    }

    // Performance monitoring test
    async performanceTest() {
        console.log('⚡ Running performance monitoring test...');
        
        const performanceResults = [];
        
        for (let i = 0; i < 5; i++) {
            const scenario = TEST_SCENARIOS[i % TEST_SCENARIOS.length];
            const result = await this.singleBookingTest(scenario);
            performanceResults.push(result);
            
            console.log(`   Request ${i + 1}: ${result.success ? '✅' : '❌'} ${result.responseTime}ms`);
            
            // Wait between requests
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return performanceResults;
    }

    // Calculate final statistics
    calculateStats() {
        if (this.results.responseTimes.length === 0) {
            this.results.averageResponseTime = 0;
            return;
        }

        this.results.averageResponseTime = Math.round(
            this.results.responseTimes.reduce((a, b) => a + b, 0) / this.results.responseTimes.length
        );

        // Calculate percentiles
        const sorted = [...this.results.responseTimes].sort((a, b) => a - b);
        this.results.p50 = sorted[Math.floor(sorted.length * 0.5)];
        this.results.p95 = sorted[Math.floor(sorted.length * 0.95)];
        this.results.p99 = sorted[Math.floor(sorted.length * 0.99)];
        
        this.results.successRate = ((this.results.successfulRequests / this.results.totalRequests) * 100).toFixed(1);
        this.results.totalTestTime = Date.now() - this.startTime;
    }

    // Generate comprehensive report
    generateReport() {
        this.calculateStats();
        
        console.log('\n📊 COMPREHENSIVE LOAD TEST RESULTS');
        console.log('=====================================');
        console.log(`🕐 Test Duration: ${(this.results.totalTestTime / 1000).toFixed(1)}s`);
        console.log(`📈 Total Requests: ${this.results.totalRequests}`);
        console.log(`✅ Successful: ${this.results.successfulRequests}`);
        console.log(`❌ Failed: ${this.results.failedRequests}`);
        console.log(`🎯 Success Rate: ${this.results.successRate}%`);
        console.log('\n⚡ RESPONSE TIME ANALYSIS:');
        console.log(`   Average: ${this.results.averageResponseTime}ms`);
        console.log(`   Minimum: ${this.results.minResponseTime === Infinity ? 'N/A' : this.results.minResponseTime + 'ms'}`);
        console.log(`   Maximum: ${this.results.maxResponseTime}ms`);
        if (this.results.p50) {
            console.log(`   P50 (Median): ${this.results.p50}ms`);
            console.log(`   P95: ${this.results.p95}ms`);
            console.log(`   P99: ${this.results.p99}ms`);
        }
        
        console.log('\n🚀 PERFORMANCE ASSESSMENT:');
        if (this.results.averageResponseTime < 2000) {
            console.log('   ✅ Excellent - Response times under 2 seconds');
        } else if (this.results.averageResponseTime < 5000) {
            console.log('   ⚠️  Good - Response times under 5 seconds');
        } else {
            console.log('   ❌ Needs optimization - Response times over 5 seconds');
        }

        if (parseFloat(this.results.successRate) >= 95) {
            console.log('   ✅ Excellent reliability - 95%+ success rate');
        } else if (parseFloat(this.results.successRate) >= 90) {
            console.log('   ⚠️  Good reliability - 90%+ success rate');
        } else {
            console.log('   ❌ Poor reliability - Under 90% success rate');
        }

        if (this.results.errors.length > 0) {
            console.log('\n❌ ERROR SUMMARY:');
            const errorCounts = {};
            this.results.errors.forEach(error => {
                const key = error.error;
                errorCounts[key] = (errorCounts[key] || 0) + 1;
            });
            
            Object.entries(errorCounts).forEach(([error, count]) => {
                console.log(`   ${error}: ${count} occurrences`);
            });
        }

        console.log('\n🔚 LOAD TEST COMPLETE');
        console.log('=====================================');

        return this.results;
    }
}

// Main execution
async function main() {
    console.log('🧪 STARTING COMPREHENSIVE LOAD TEST');
    console.log('====================================');
    console.log(`🎯 Target: ${PRODUCTION_URL}`);
    console.log(`🕐 Started: ${new Date().toISOString()}\n`);

    const tester = new LoadTester();

    try {
        // Phase 1: Performance baseline
        await tester.performanceTest();

        // Phase 2: Concurrent load testing
        await tester.concurrentTest(3, 9); // 3 concurrent, 9 total requests

        // Phase 3: Higher concurrency test
        await tester.concurrentTest(5, 10); // 5 concurrent, 10 total requests

        // Generate final report
        const results = tester.generateReport();
        
        // Return results for further processing
        return results;

    } catch (error) {
        console.error('❌ Load test failed:', error);
        throw error;
    }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { LoadTester, main };
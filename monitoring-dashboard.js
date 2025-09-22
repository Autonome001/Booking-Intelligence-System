#!/usr/bin/env node

/**
 * Real-time Monitoring Dashboard for E2E Orchestration
 * Provides live updates during test execution
 */

import fs from 'fs';
import path from 'path';

class MonitoringDashboard {
    constructor() {
        this.logFile = path.join(process.cwd(), 'orchestration-log.txt');
        this.lastPosition = 0;
        this.startTime = Date.now();
        this.stats = {
            phases: [],
            apiCalls: 0,
            errors: 0,
            warnings: 0
        };
    }

    clearScreen() {
        console.clear();
    }

    displayHeader() {
        const elapsed = Math.round((Date.now() - this.startTime) / 1000);
        console.log('🎯 AUTONOME.US BOOKING SYSTEM - REAL-TIME MONITORING DASHBOARD');
        console.log('='.repeat(80));
        console.log(`⏱️  Elapsed Time: ${elapsed}s | 📊 API Calls: ${this.stats.apiCalls} | ❌ Errors: ${this.stats.errors}`);
        console.log('='.repeat(80));
    }

    readNewLogs() {
        try {
            if (!fs.existsSync(this.logFile)) return [];

            const stats = fs.statSync(this.logFile);
            if (stats.size <= this.lastPosition) return [];

            const buffer = Buffer.alloc(stats.size - this.lastPosition);
            const fd = fs.openSync(this.logFile, 'r');
            fs.readSync(fd, buffer, 0, buffer.length, this.lastPosition);
            fs.closeSync(fd);

            this.lastPosition = stats.size;
            
            const newContent = buffer.toString();
            return newContent.split('\n').filter(line => line.trim());
        } catch (error) {
            return [];
        }
    }

    processLogEntry(logLine) {
        if (logLine.includes('[PHASE]')) {
            if (logLine.includes('Starting Phase:')) {
                const phase = logLine.split('Starting Phase: ')[1];
                this.stats.phases.push({ name: phase, status: 'RUNNING', start: Date.now() });
            } else if (logLine.includes('Completed Phase:')) {
                const phase = logLine.split('Completed Phase: ')[1].split(' ')[0];
                const existingPhase = this.stats.phases.find(p => p.name === phase);
                if (existingPhase) {
                    existingPhase.status = logLine.includes('✅') ? 'SUCCESS' : 'FAILED';
                    existingPhase.end = Date.now();
                }
            }
        }

        if (logLine.includes('[NETWORK]') && logLine.includes('REQUEST:')) {
            this.stats.apiCalls++;
        }

        if (logLine.includes('[ERROR]')) {
            this.stats.errors++;
        }
    }

    displayPhases() {
        console.log('\n📋 PHASE PROGRESS:');
        this.stats.phases.forEach((phase, index) => {
            const statusIcon = phase.status === 'SUCCESS' ? '✅' : 
                              phase.status === 'FAILED' ? '❌' : '🔄';
            const duration = phase.end ? `(${Math.round((phase.end - phase.start) / 1000)}s)` : '(running...)';
            console.log(`   ${index + 1}. ${statusIcon} ${phase.name} ${duration}`);
        });
    }

    displayRecentLogs(logs) {
        console.log('\n📝 RECENT ACTIVITY:');
        const recentLogs = logs.slice(-10); // Show last 10 log entries
        recentLogs.forEach(log => {
            // Format log entry for display
            const timestamp = log.match(/\[(.*?)\]/)?.[1] || '';
            const phase = log.match(/\[([^\]]+)\]/g)?.[1]?.replace(/[\[\]]/g, '') || '';
            const type = log.match(/\[([^\]]+)\]/g)?.[2]?.replace(/[\[\]]/g, '') || '';
            const message = log.split('] ').pop() || '';
            
            if (message) {
                const time = new Date(timestamp).toLocaleTimeString();
                console.log(`   ${time} [${phase}] ${message.substring(0, 60)}${message.length > 60 ? '...' : ''}`);
            }
        });
    }

    displayFooter() {
        console.log('\n' + '='.repeat(80));
        console.log('🔄 Monitoring in progress... Press Ctrl+C to stop');
        console.log('📊 Dashboard updates every 2 seconds');
    }

    async start() {
        console.log('🚀 Starting Real-time Monitoring Dashboard...\n');
        
        const updateInterval = setInterval(() => {
            const newLogs = this.readNewLogs();
            
            if (newLogs.length > 0) {
                newLogs.forEach(log => this.processLogEntry(log));
                
                this.clearScreen();
                this.displayHeader();
                this.displayPhases();
                this.displayRecentLogs(newLogs);
                this.displayFooter();
            }
        }, 2000);

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            clearInterval(updateInterval);
            console.log('\n\n👋 Monitoring dashboard stopped.');
            process.exit(0);
        });
    }
}

// Start dashboard if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const dashboard = new MonitoringDashboard();
    dashboard.start();
}

export default MonitoringDashboard;
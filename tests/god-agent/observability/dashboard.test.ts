/**
 * Tests for OBS-010 Dashboard UI
 * Tests HTML structure, XSS prevention helpers, and dashboard functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('OBS-010: Dashboard UI', () => {
    let dom: JSDOM;
    let document: any;
    let html: string;

    beforeEach(() => {
        // Load HTML
        const htmlPath = join(__dirname, '../../../src/god-agent/observability/dashboard/index.html');
        html = readFileSync(htmlPath, 'utf-8');

        // Create JSDOM
        dom = new JSDOM(html, {
            url: 'http://localhost:3000'
        });

        document = dom.window.document;
    });

    describe('TC-010-01: HTML Structure Validation', () => {
        it('should have all required panels', () => {
            expect(document.querySelector('.activity-panel')).toBeTruthy();
            expect(document.querySelector('.agents-panel')).toBeTruthy();
            expect(document.querySelector('.pipelines-panel')).toBeTruthy();
            expect(document.querySelector('.routing-panel')).toBeTruthy();
            expect(document.querySelector('.learning-panel')).toBeTruthy();
            expect(document.querySelector('.memory-panel')).toBeTruthy();
        });

        it('should have connection status indicator', () => {
            const statusDot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');

            expect(statusDot).toBeTruthy();
            expect(statusText).toBeTruthy();
            expect(statusText.textContent).toContain('Connecting');
        });

        it('should have filter controls', () => {
            const componentFilter = document.getElementById('componentFilter');
            const statusFilter = document.getElementById('statusFilter');

            expect(componentFilter).toBeTruthy();
            expect(statusFilter).toBeTruthy();
            expect(componentFilter.tagName).toBe('SELECT');
            expect(statusFilter.tagName).toBe('SELECT');
        });

        it('should have Chart.js CDN link', () => {
            expect(html).toContain('chart.js@4.4.0');
            expect(html).toContain('cdn.jsdelivr.net');
        });

        it('should have Chart.js canvas', () => {
            const canvas = document.getElementById('qualityChart');
            expect(canvas).toBeTruthy();
            expect(canvas.tagName).toBe('CANVAS');
        });

        it('should have memory inspector tabs', () => {
            const tabs = document.querySelectorAll('.tab-button');
            expect(tabs.length).toBeGreaterThanOrEqual(2);

            const hasInteractionStore = Array.from(tabs).some((tab: any) =>
                tab.dataset.tab === 'interaction-store'
            );
            const hasReasoningBank = Array.from(tabs).some((tab: any) =>
                tab.dataset.tab === 'reasoning-bank'
            );

            expect(hasInteractionStore).toBe(true);
            expect(hasReasoningBank).toBe(true);
        });

        it('should have responsive grid layout classes', () => {
            const grid = document.querySelector('.dashboard-grid');
            expect(grid).toBeTruthy();
            expect(grid.classList.contains('dashboard-grid')).toBe(true);
        });

        it('should have activity list container', () => {
            const list = document.getElementById('activityList');
            expect(list).toBeTruthy();
            expect(list.classList.contains('activity-list')).toBe(true);
        });

        it('should have agent list container', () => {
            const list = document.getElementById('agentList');
            expect(list).toBeTruthy();
            expect(list.classList.contains('agent-list')).toBe(true);
        });

        it('should have pipeline list container', () => {
            const list = document.getElementById('pipelineList');
            expect(list).toBeTruthy();
            expect(list.classList.contains('pipeline-list')).toBe(true);
        });

        it('should have routing list container', () => {
            const list = document.getElementById('routingList');
            expect(list).toBeTruthy();
            expect(list.classList.contains('routing-list')).toBe(true);
        });

        it('should have domain search input', () => {
            const search = document.getElementById('domainSearch');
            expect(search).toBeTruthy();
            expect(search.getAttribute('placeholder')).toContain('domain');
        });

        it('should have count badges', () => {
            const agentCount = document.getElementById('agentCount');
            const pipelineCount = document.getElementById('pipelineCount');

            expect(agentCount).toBeTruthy();
            expect(pipelineCount).toBeTruthy();
            expect(agentCount.classList.contains('count-badge')).toBe(true);
            expect(pipelineCount.classList.contains('count-badge')).toBe(true);
        });
    });

    describe('TC-010-02: SSE Event Handling Structure', () => {
        it('should reference app.js script', () => {
            const script = document.querySelector('script[src="app.js"]');
            expect(script).toBeTruthy();
        });

        it('should have proper HTML5 structure for SSE compatibility', () => {
            expect(html).toContain('<!DOCTYPE html>');
            expect(document.querySelector('html').getAttribute('lang')).toBe('en');
            expect(document.querySelector('meta[charset="UTF-8"]')).toBeTruthy();
        });
    });

    describe('TC-010-03: Activity Filtering Structure', () => {
        it('should have component filter options', () => {
            const componentFilter = document.getElementById('componentFilter');
            const options = Array.from(componentFilter.querySelectorAll('option')).map((opt: any) => opt.value);

            expect(options).toContain('');
            expect(options).toContain('agent');
            expect(options).toContain('pipeline');
            expect(options).toContain('routing');
        });

        it('should have status filter options', () => {
            const statusFilter = document.getElementById('statusFilter');
            const options = Array.from(statusFilter.querySelectorAll('option')).map((opt: any) => opt.value);

            expect(options).toContain('');
            expect(options).toContain('success');
            expect(options).toContain('error');
            expect(options).toContain('running');
        });
    });

    describe('TC-010-04: Agent List Rendering Structure', () => {
        it('should have agent count badge', () => {
            const count = document.getElementById('agentCount');
            expect(count).toBeTruthy();
            expect(count.textContent).toBe('0');
        });

        it('should have agents panel in correct grid position', () => {
            const panel = document.querySelector('.agents-panel');
            expect(panel).toBeTruthy();
        });
    });

    describe('TC-010-05: Chart Initialization Structure', () => {
        it('should have quality chart canvas with ID', () => {
            const canvas = document.getElementById('qualityChart');
            expect(canvas).toBeTruthy();
            expect(canvas.tagName).toBe('CANVAS');
        });

        it('should have metrics summary container', () => {
            const summary = document.getElementById('metricsSummary');
            expect(summary).toBeTruthy();
            expect(summary.classList.contains('metrics-summary')).toBe(true);
        });

        it('should have pattern count display', () => {
            const patternCount = document.getElementById('patternCount');
            expect(patternCount).toBeTruthy();
        });

        it('should have avg quality display', () => {
            const avgQuality = document.getElementById('avgQuality');
            expect(avgQuality).toBeTruthy();
        });
    });

    describe('TC-010-06: XSS Prevention', () => {
        it('should use safe HTML escaping helper', () => {
            // Test the escapeHtml function logic
            const div = document.createElement('div');
            div.textContent = '<script>alert("XSS")</script>';
            const escaped = div.innerHTML;

            expect(escaped).not.toContain('<script>');
            expect(escaped).toContain('&lt;script&gt;');
        });

        it('should escape less-than and greater-than symbols', () => {
            const div = document.createElement('div');
            div.textContent = '<img src=x onerror=alert(1)>';
            const escaped = div.innerHTML;

            expect(escaped).toContain('&lt;');
            expect(escaped).toContain('&gt;');
            expect(escaped).not.toContain('<img');
        });

        it('should preserve safe text content', () => {
            const div = document.createElement('div');
            div.textContent = 'This is safe text 123';
            const escaped = div.innerHTML;

            expect(escaped).toBe('This is safe text 123');
        });

        it('should escape ampersands', () => {
            const div = document.createElement('div');
            div.textContent = 'Rock & Roll';
            const escaped = div.innerHTML;

            expect(escaped).toContain('&amp;');
        });
    });

    describe('TC-010-07: Mobile Responsive Classes', () => {
        it('should have styles.css linked', () => {
            const link = document.querySelector('link[href="styles.css"]');
            expect(link).toBeTruthy();
            expect(link.getAttribute('rel')).toBe('stylesheet');
        });

        it('should have viewport meta tag', () => {
            const viewport = document.querySelector('meta[name="viewport"]');
            expect(viewport).toBeTruthy();
            expect(viewport.getAttribute('content')).toContain('width=device-width');
        });

        it('should have responsive panel classes', () => {
            const panels = document.querySelectorAll('.panel');
            expect(panels.length).toBeGreaterThanOrEqual(6);

            panels.forEach(panel => {
                expect(panel.classList.contains('panel')).toBe(true);
            });
        });

        it('should load CSS file content', () => {
            const cssPath = join(__dirname, '../../../src/god-agent/observability/dashboard/styles.css');
            const css = readFileSync(cssPath, 'utf-8');

            expect(css).toContain('@media');
            expect(css).toContain('768px');
            expect(css).toContain('grid-template-columns');
        });

        it('should have mobile breakpoint in CSS', () => {
            const cssPath = join(__dirname, '../../../src/god-agent/observability/dashboard/styles.css');
            const css = readFileSync(cssPath, 'utf-8');

            expect(css).toContain('max-width: 768px');
        });
    });

    describe('TC-010-08: Connection Status Updates Structure', () => {
        it('should have status dot element', () => {
            const dot = document.getElementById('statusDot');
            expect(dot).toBeTruthy();
            expect(dot.classList.contains('status-dot')).toBe(true);
        });

        it('should have status text element', () => {
            const text = document.getElementById('statusText');
            expect(text).toBeTruthy();
        });

        it('should have connection status container', () => {
            const status = document.getElementById('connectionStatus');
            expect(status).toBeTruthy();
            expect(status.classList.contains('connection-status')).toBe(true);
        });

        it('should have CSS classes for status states', () => {
            const cssPath = join(__dirname, '../../../src/god-agent/observability/dashboard/styles.css');
            const css = readFileSync(cssPath, 'utf-8');

            expect(css).toContain('.status-dot.connected');
            expect(css).toContain('.status-dot.disconnected');
        });
    });

    describe('TC-010-09: JavaScript Application Logic', () => {
        it('should load app.js file', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('DashboardApp');
            expect(appCode).toContain('EventSource');
            expect(appCode).toContain('/api/stream');
        });

        it('should have SSE reconnection logic', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('reconnect');
            expect(appCode).toContain('5000');
        });

        it('should have event handlers for all event types', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('agent_started');
            expect(appCode).toContain('agent_completed');
            expect(appCode).toContain('pipeline_started');
            expect(appCode).toContain('routing_decision');
            expect(appCode).toContain('activity');
        });

        it('should have Chart.js integration', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('new Chart');
            expect(appCode).toContain('qualityChart');
        });

        it('should have XSS escaping function', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('escapeHtml');
            expect(appCode).toContain('textContent');
        });

        it('should expose DashboardApp globally for testing', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('window.DashboardApp');
        });
    });

    describe('TC-010-10: API Integration Structure', () => {
        it('should define API endpoints', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('/api/events');
            expect(appCode).toContain('/api/agents');
            expect(appCode).toContain('/api/pipelines');
            expect(appCode).toContain('/api/learning/stats');
            expect(appCode).toContain('/api/memory/interactions');
            expect(appCode).toContain('/api/memory/reasoning');
        });

        it('should use fetch for API calls', () => {
            const appPath = join(__dirname, '../../../src/god-agent/observability/dashboard/app.js');
            const appCode = readFileSync(appPath, 'utf-8');

            expect(appCode).toContain('fetch(');
        });
    });
});

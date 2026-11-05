import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { createTaskPoller } from './task-poller.js';

const required = [
    'BOSS_URL',
    'WORKER_JOIN_SECRET',
    'WORKER_NAME',
    'NODELINK_URI',
    'NODELINK_PASSWORD'
];

for (const key of required) {
    if (!process.env[key]) {
        throw new Error(`Missing environment variable: ${key}`);
    }
}

const boss = process.env.BOSS_URL.replace(/\/+$/, '');
const nodeLink = process.env.NODELINK_URI.replace(/\/+$/, '');

const interval = Number(process.env.HEARTBEAT_INTERVAL || 15000);
const capacity = Number(process.env.WORKER_CAPACITY || 100);

const identityFile = path.resolve('data/identity.json');

fs.mkdirSync('data', { recursive: true });

let identity = null;
let busy = false;

const taskPoller = createTaskPoller({
    bossUrl: boss,
    getIdentity: () => identity,
    interval: Number(process.env.TASK_POLL_INTERVAL || 2000)
});

function saveIdentity(data) {
    const temp = `${identityFile}.tmp`;

    fs.writeFileSync(temp, JSON.stringify(data, null, 2), {
        mode: 0o600
    });

    fs.renameSync(temp, identityFile);
    identity = data;
}

function loadIdentity() {
    try {
        return JSON.parse(fs.readFileSync(identityFile, 'utf8'));
    } catch {
        return null;
    }
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(10000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
}

async function register() {
    console.log('[AGENT] Registering with BOSS...');

    const result = await request(`${boss}/agent/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-worker-join-secret': process.env.WORKER_JOIN_SECRET
        },
        body: JSON.stringify({
            name: process.env.WORKER_NAME,
            endpoint: nodeLink,
            capacity
        })
    });

    saveIdentity({
        id: result.worker.id,
        token: result.token,
        registeredAt: Date.now()
    });

    console.log('[AGENT] Registered:', result.worker.name);
}

async function getNodeMetrics() {
    const result = await request(`${nodeLink}/v4/stats`, {
        headers: {
            Authorization: process.env.NODELINK_PASSWORD
        }
    });

    const cpuRaw = Number(result.cpu?.systemLoad || 0);
    const cpu = Math.min(100, Math.max(0, cpuRaw <= 1 ? cpuRaw * 100 : cpuRaw));

    const used = Number(result.memory?.used || 0);
    const reservable = Number(result.memory?.reservable || 0);

    const memory = reservable > 0
        ? Math.min(100, (used / reservable) * 100)
        : 0;

    return {
        players: Number(result.players || 0),
        cpu,
        memory,
        nodeHealthy: true
    };
}

async function sendHeartbeat() {
    if (!identity) await register();

    let metrics;

    try {
        metrics = await getNodeMetrics();
    } catch (error) {
        console.error('[NODELINK]', error.message);

        metrics = {
            players: 0,
            cpu: 100,
            memory: 100,
            nodeHealthy: false
        };
    }

    try {
        await request(`${boss}/agent/${identity.id}/heartbeat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${identity.token}`
            },
            body: JSON.stringify(metrics)
        });

        console.log(
            `[HEARTBEAT] ${process.env.WORKER_NAME} | players=${metrics.players} | cpu=${metrics.cpu.toFixed(1)}% | ram=${metrics.memory.toFixed(1)}% | nodeLink=${metrics.nodeHealthy}`
        );
    } catch (error) {
        console.error('[BOSS]', error.message);

        if (
            /INVALID_WORKER_TOKEN|WORKER_NOT_FOUND/.test(error.message)
        ) {
            identity = null;
            try {
                await register();
            } catch (registerError) {
                console.error('[REGISTER]', registerError.message);
            }
        }
    }
}

async function tick() {
    if (busy) return;

    busy = true;

    try {
        await sendHeartbeat();
    } catch (error) {
        console.error('[AGENT ERROR]', error.message);
    } finally {
        busy = false;
    }
}

async function start() {
    console.log('================================');
    console.log('      ZOMA WORKER AGENT');
    console.log('================================');

    identity = loadIdentity();

    if (identity) {
        try {
            await sendHeartbeat();
        } catch {
            identity = null;
        }
    }

    if (!identity) {
        await register();
        await sendHeartbeat();
    }

    setInterval(tick, interval);
    taskPoller.start();
}

process.on('SIGINT', () => {
    console.log('[AGENT] Stopping...');
    taskPoller.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('[AGENT] Stopping...');
    process.exit(0);
});

start().catch(error => {
    console.error('[FATAL]', error);
    process.exit(1);
});

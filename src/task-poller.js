import { executeTask } from './executor/index.js';

export function createTaskPoller({
    bossUrl,
    getIdentity,
    interval = 2000
}) {
    let running = false;
    let stopped = false;
    let timer = null;

    async function request(url, identity, body) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${identity.token}`
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000)
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || `BOSS HTTP ${response.status}`);
        }

        return data;
    }

    async function processTask(task, identity) {
        console.log(
            `[TASK] Executing ${task.type} | ${task.id} | attempt=${task.attempts}`
        );

        try {
            const result = await executeTask(task, {
                workerId: identity.id
            });

            await request(
                `${bossUrl}/agent/tasks/${task.id}/ack`,
                identity,
                {
                    workerId: identity.id,
                    result
                }
            );

            console.log(`[TASK] ACK ${task.id}`);
        } catch (error) {
            console.error(`[TASK] FAILED ${task.id}:`, error.message);

            try {
                await request(
                    `${bossUrl}/agent/tasks/${task.id}/fail`,
                    identity,
                    {
                        workerId: identity.id,
                        error: error.message,
                        retryDelayMs: 5000
                    }
                );

                console.log(`[TASK] FAIL reported ${task.id}`);
            } catch (reportError) {
                console.error(
                    '[TASK] Could not report failure:',
                    reportError.message
                );
            }
        }
    }

    async function poll() {
        if (stopped || running) return;

        running = true;

        try {
            const identity = getIdentity();

            if (!identity?.id || !identity?.token) {
                return;
            }

            const result = await request(
                `${bossUrl}/agent/tasks/claim`,
                identity,
                {
                    workerId: identity.id,
                    capabilities: [
                        'WORKER_PING',
                        'NODELINK_HEALTH_CHECK',
                        'NODELINK_STATS',
                        'NODELINK_PLAYER_UPDATE',
                        'NODELINK_PLAYER_DESTROY',
                        'NODELINK_PLAYER_GET'
                    ]
                }
            );

            if (result.task) {
                await processTask(result.task, identity);
            }
        } catch (error) {
            console.error('[TASK POLLER]', error.message);
        } finally {
            running = false;

            if (!stopped) {
                timer = setTimeout(poll, interval);
            }
        }
    }

    return {
        start() {
            if (timer || stopped) return;

            console.log(`[TASK POLLER] Active | interval=${interval}ms`);
            poll();
        },

        stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
            timer = null;
        }
    };
}

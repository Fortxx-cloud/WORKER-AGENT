import {
    nodeLinkHealth,
    nodeLinkStats,
    updatePlayer,
    destroyPlayer,
    getPlayer
} from './nodelink.js';

export async function executeTask(task, context = {}) {
    if (!task || typeof task.type !== 'string') {
        throw new Error('INVALID_TASK');
    }

    const payload = task.payload || {};

    switch (task.type) {
        case 'WORKER_PING':
            return {
                status: 'ok',
                workerId: context.workerId,
                workerName: process.env.WORKER_NAME,
                timestamp: new Date().toISOString()
            };

        case 'NODELINK_HEALTH_CHECK':
            return await nodeLinkHealth();

        case 'NODELINK_STATS':
            return await nodeLinkStats();

        case 'NODELINK_PLAYER_UPDATE':
            return await updatePlayer(payload);

        case 'NODELINK_PLAYER_DESTROY':
            return await destroyPlayer(payload);

        case 'NODELINK_PLAYER_GET':
            return await getPlayer(payload);

        default:
            throw new Error(`UNSUPPORTED_TASK_TYPE: ${task.type}`);
    }
}

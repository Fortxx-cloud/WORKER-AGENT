const nodeLink = process.env.NODELINK_URI.replace(/\/+$/, '');
const password = process.env.NODELINK_PASSWORD;

async function request(path, options = {}) {
    const response = await fetch(`${nodeLink}${path}`, {
        ...options,
        headers: {
            Authorization: password,
            'Content-Type': 'application/json',
            ...options.headers
        },
        signal: AbortSignal.timeout(15000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || data.error || `NodeLink HTTP ${response.status}`);
    }

    return data;
}

function validateIds(sessionId, guildId) {
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
        throw new Error('NODELINK_SESSION_ID_REQUIRED');
    }

    if (!/^\d{17,20}$/.test(String(guildId || ''))) {
        throw new Error('INVALID_GUILD_ID');
    }
}

export async function nodeLinkHealth() {
    const version = await request('/version');

    return {
        healthy: true,
        version
    };
}

export async function nodeLinkStats() {
    return request('/v4/stats');
}

export async function updatePlayer(payload = {}) {
    const { sessionId, guildId, body, noReplace } = payload;

    validateIds(sessionId, guildId);

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('PLAYER_BODY_REQUIRED');
    }

    const query = noReplace ? '?noReplace=true' : '';

    return request(
        `/v4/sessions/${encodeURIComponent(sessionId)}/players/${guildId}${query}`,
        {
            method: 'PATCH',
            body: JSON.stringify(body)
        }
    );
}

export async function destroyPlayer(payload = {}) {
    const { sessionId, guildId } = payload;

    validateIds(sessionId, guildId);

    return request(
        `/v4/sessions/${encodeURIComponent(sessionId)}/players/${guildId}`,
        { method: 'DELETE' }
    );
}

export async function getPlayer(payload = {}) {
    const { sessionId, guildId } = payload;

    validateIds(sessionId, guildId);

    return request(
        `/v4/sessions/${encodeURIComponent(sessionId)}/players/${guildId}`
    );
}

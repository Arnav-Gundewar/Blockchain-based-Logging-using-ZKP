const fs = require('fs');

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomIP() {
    return `192.168.${randomInt(0,255)}.${randomInt(1,254)}`;
}

function randomUser() {
    return `u_${randomInt(100, 999)}`;
}

const events = [
    { type: "failed_login",     code: 1, severityRange: [3, 5] },
    { type: "successful_login", code: 0, severityRange: [1, 2] },
    { type: "file_access",      code: 0, severityRange: [1, 3] },
    { type: "config_change",    code: 0, severityRange: [2, 4] },
    { type: "port_scan",        code: 1, severityRange: [4, 5] },
    { type: "privilege_escalation", code: 1, severityRange: [4, 5] },
];

const logs = [];

for (let i = 0; i < 8; i++) {
    const event = events[randomInt(0, events.length - 1)];
    logs.push({
        id: i,
        timestamp: new Date(Date.now() - randomInt(0, 3600000)).toISOString(),
        severity: randomInt(event.severityRange[0], event.severityRange[1]),
        event: event.type,
        event_code: event.code,   // 1 = failed/suspicious, 0 = normal
        user: randomUser(),
        ip: randomIP()
    });
}

fs.writeFileSync('batch4.json', JSON.stringify(logs, null, 2));
console.log("Generated 8 log entries:");
console.table(logs.map(l => ({
    id: l.id,
    event: l.event,
    severity: l.severity,
    event_code: l.event_code,
    ip: l.ip
})));

const failedCount = logs.filter(l => l.event_code === 1).length;
console.log(`\nFailed/suspicious events: ${failedCount}/8`);
console.log(`Severity values: [${logs.map(l => l.severity).join(', ')}]`);
let push;
let pushAvailable = false;

try {
    push = require('web-push');
    push.setVapidDetails('mailto:' + process.env.VAPID_ADMIN_EMAIL, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    pushAvailable = true;
} catch (err) {
    console.warn('web-push not available (likely Node version incompatibility):', err.message);
}

const sqlite = require('./sqlite.js');

exports.send = (subscription, title, body, url) => {
    if (!pushAvailable) return;

    var json;

    if (body) {
        json = JSON.stringify({
            title: title,
            body: body,
            url: url
        })
    } else {
        json = JSON.stringify({
            title: title,
            url: url
        })
    }

    push.sendNotification(subscription, json)
    .catch(error => {
        if (error.statusCode == '410') {
            sqlite.delete("subscriptions", { endpoint: error.endpoint });
            console.log("deleted expired notification subscription.");
        }
    })
}

exports.broadcast = (title, url, excluded_endpoint) => {
    if (!pushAvailable) return;

    const subs = sqlite.queryall("subscriptions", {});
    for (let sub of subs) {
        if (sub.endpoint != excluded_endpoint)
            exports.send(JSON.parse(sub.json), title, null, url)
    }
}
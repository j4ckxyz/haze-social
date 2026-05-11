if (navigator.serviceWorker) {
    navigator.serviceWorker.register('/serviceworker.js')
        .catch((err) => console.error(err))
}

apply_theme(get_theme_preference());

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (get_theme_preference() === 'system') {
        apply_theme('system');
    }
});

window.addEventListener('haze-theme-changed', () => {
    apply_theme(get_theme_preference());
});

function get_theme_preference() {
    const pref = localStorage.getItem('haze-theme');
    if (pref === 'light' || pref === 'dark' || pref === 'system') return pref;
    return 'system';
}

function apply_theme(pref) {
    if (pref === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        set_light_mode();
        return;
    }

    if (pref === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        set_dark_mode();
        return;
    }

    document.documentElement.removeAttribute('data-theme');

    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        set_dark_mode();
    } else {
        set_light_mode();
    }
}

function set_dark_mode() {
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#1b1b1c');
    document.querySelector('meta[name="background-color"]').setAttribute('content', '#1b1b1c');
}

function set_light_mode() {
    document.querySelector('meta[name="theme-color"]').setAttribute('content', 'white');
    document.querySelector('meta[name="background-color"]').setAttribute('content', 'white');
}

document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    if (is_typing_context(event.target)) return;

    const key = String(event.key || '').toLowerCase();

    if (key === 'h') {
        event.preventDefault();
        window.location.href = '/';
    } else if (key === 'n') {
        event.preventDefault();
        window.location.href = '/new';
    } else if (key === 'b') {
        event.preventDefault();
        window.location.href = '/posts';
    } else if (key === 's') {
        event.preventDefault();
        window.location.href = '/settings';
    }
});

function is_typing_context(target) {
    if (!target) return false;

    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;

    return !!target.closest('[contenteditable="true"]');
}

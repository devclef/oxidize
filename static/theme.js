const THEME_KEY = 'oxidize_theme';

// Browser chrome colors per theme (PWA <meta name="theme-color">)
const THEME_COLORS = {
    light: '#3b82f6',
    dark: '#1e1b4b',
};

function updateThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute('content', THEME_COLORS[theme] || THEME_COLORS.light);
    }
}

function getInitialTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return (savedTheme === 'dark' || (!savedTheme && prefersDark)) ? 'dark' : 'light';
}

function updateThemeIcons(theme) {
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    if (sunIcon && moonIcon) {
        sunIcon.style.display = theme === 'light' ? 'block' : 'none';
        moonIcon.style.display = theme === 'dark' ? 'block' : 'none';
    }
}

function initTheme() {
    // Apply the theme as early as possible (script loads in <head>) to avoid
    // a flash of the wrong theme; icons are updated once the DOM is ready.
    const theme = getInitialTheme();
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeColor(theme);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => updateThemeIcons(theme));
    } else {
        updateThemeIcons(theme);
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    updateThemeIcons(newTheme);
    updateThemeColor(newTheme);

    window.dispatchEvent(new CustomEvent('themeChanged', { detail: newTheme }));
}

function attachThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

initTheme();

// Same readyState guard as initTheme: the toggle button may already exist
// if this script runs after the DOM is ready.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachThemeToggle);
} else {
    attachThemeToggle();
}

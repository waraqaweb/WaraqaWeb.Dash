// Test-time polyfills for jsdom so Recharts' ResponsiveContainer works in Jest
// Provide a minimal ResizeObserver and a bounding rect for elements.
class ResizeObserver {
	constructor(callback) {
		this.callback = callback;
	}
	observe() {
		// no-op
	}
	unobserve() {}
	disconnect() {}
}

if (typeof global.ResizeObserver === 'undefined') {
	global.ResizeObserver = ResizeObserver;
}

// Ensure elements have a non-zero bounding box for ResponsiveContainer
if (!HTMLElement.prototype.getBoundingClientRect || HTMLElement.prototype.getBoundingClientRect.toString().includes('[native code]') === false) {
	// if a custom implementation already exists, don't override.
} else {
	HTMLElement.prototype.getBoundingClientRect = function () {
		return { width: 800, height: 200, top: 0, left: 0, bottom: 200, right: 800 };
	};
}

// Also guard window.matchMedia which some libraries may call
if (typeof window.matchMedia !== 'function') {
	window.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
}

// Suppress known benign warnings in test output
// These warnings are noisy in CI/tests but do not affect behavior.
(() => {
	const _warn = console.warn.bind(console);
	console.warn = (...args) => {
		try {
			const msg = args[0];
			if (typeof msg === 'string') {
				// React Router future-flag deprecation (no-op in tests)
				if (msg.includes('React Router Future Flag Warning')) return;

				// Recharts ResponsiveContainer emits layout warnings in jsdom (zero or negative size)
				// which are benign for our unit tests. Filter them to keep test output clean.
				if ((msg.includes('The width(') && msg.includes('of chart should be greater than 0')) ||
					msg.includes('please check the style of container')) {
					return;
				}
			}
		} catch (e) {
			// fall through to original
		}
		_warn(...args);
	};
})();

// Force axios to resolve to its CommonJS bundle during Jest runs so we avoid the ESM import error
jest.mock('axios', () => {
	const axios = require('axios/dist/node/axios.cjs');
	axios.default = axios;
	return axios;
});

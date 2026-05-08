import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// On GitHub Pages the app is served under `/Stundenplan27/`; locally we want `/`.
// `npm run build` runs in production mode → base = '/Stundenplan27/'.
// `npm run dev` and `vitest` run with mode != 'production' → base = '/'.
export default defineConfig(({ mode }) => ({
	plugins: [svelte()],
	base: mode === 'production' ? '/Stundenplan27/' : '/',
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.test.ts']
	}
}));

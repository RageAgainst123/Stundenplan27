import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// On GitHub Pages the app is served under `/Stundenplan27/`; locally we want `/`.
// `npm run build` runs in production mode → base = '/Stundenplan27/'.
// `npm run dev` and `vitest` run with mode != 'production' → base = '/'.
export default defineConfig(({ mode }) => ({
	plugins: [svelte()],
	base: mode === 'production' ? '/Stundenplan27/' : '/',
	// strictPort: localStorage (Plan + Snapshots!) hängt am Origin inkl.
	// PORT. Ohne strictPort weicht Vite bei belegtem Port still auf
	// 4174/5174 aus — die App startet dann mit LEEREM Speicher und der
	// User glaubt, seine Daten seien weg. Lieber laut scheitern.
	server: { strictPort: true },
	preview: { strictPort: true },
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.test.ts']
	}
}));

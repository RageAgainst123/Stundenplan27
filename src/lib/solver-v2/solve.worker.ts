// Solver v2 — Web-Worker-Entry (R2 Schritt 5).
//
// Führt startSolve UNVERÄNDERT im Worker-Thread aus und spiegelt alle
// Session-Events via postMessage an die Bridge (worker-bridge.ts). Weil
// startSolve intern bereits async-gechunkt ist (250-ms-Chunks mit
// setTimeout-Yields), atmet der Worker-Event-Loop zwischen den Chunks —
// message-basiertes Abort funktioniert damit OHNE SharedArrayBuffer
// (kein COOP/COEP-Problem auf GitHub Pages).
//
// Protokoll-Typen: siehe worker-bridge.ts (WorkerInMsg / WorkerOutMsg).

import { startSolve } from './index';
import type { WorkerInMsg, WorkerOutMsg } from './worker-bridge';

const ctx = self as unknown as {
	postMessage(m: WorkerOutMsg): void;
	onmessage: ((e: MessageEvent<WorkerInMsg>) => void) | null;
};

let session: ReturnType<typeof startSolve> | null = null;

ctx.onmessage = (e: MessageEvent<WorkerInMsg>) => {
	const msg = e.data;
	if (msg.type === 'start') {
		if (session) return; // Ein Worker fährt genau EINE Session.
		session = startSolve(msg.doc, msg.opts);
		session.on('phase', p => ctx.postMessage({ kind: 'phase', payload: p }));
		session.on('progress', p => ctx.postMessage({ kind: 'progress', payload: p }));
		session.on('solution', s => ctx.postMessage({ kind: 'solution', payload: s }));
		session.on('relaxation', r => ctx.postMessage({ kind: 'relaxation', payload: r }));
		session.on('log', l => ctx.postMessage({ kind: 'log', payload: l }));
		// Error-Objekte sind zwar structured-cloneable, aber nur die Message
		// wird gebraucht — schlanker und ohne Browser-Altlasten-Risiko.
		session.on('error', err => ctx.postMessage({ kind: 'error', message: err.message }));
		session.on('done', d => {
			// DZN-Snapshot huckepack: getDzn() ist eine synchrone API — die
			// Bridge kann nicht nachfragen, also liefert done ihn gleich mit.
			ctx.postMessage({ kind: 'done', payload: d, dzn: session!.getDzn() });
		});
	} else if (msg.type === 'abort') {
		// Flag setzen — greift beim nächsten Chunk-Yield der Session.
		session?.abort();
	}
};

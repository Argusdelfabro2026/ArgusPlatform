// frontend/lib/api.ts
// Typed API client for the ARGUS backend.
// SSE streaming uses fetch + ReadableStream (not EventSource) to support POST.

import type {
  Run,
  Transaction,
  ReconciliationLine,
  OutputFile,
  TransactionPage,
  SSEEvent,
  ControlDrillDown,
} from './types';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

// ── REST helpers ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function getRuns(): Promise<Run[]> {
  const data = await apiFetch<{ runs: Run[]; count: number }>('/api/runs');
  return data.runs;
}

export async function getRun(id: string): Promise<Run> {
  return apiFetch<Run>(`/api/runs/${id}`);
}

export async function getTransactions(
  runId: string,
  page = 1,
  limit = 100
): Promise<TransactionPage> {
  return apiFetch<TransactionPage>(
    `/api/runs/${runId}/transactions?page=${page}&limit=${limit}`
  );
}

export async function getReconciliation(
  runId: string
): Promise<ReconciliationLine[]> {
  const data = await apiFetch<{
    run_id: string;
    lines: ReconciliationLine[];
    count: number;
  }>(`/api/runs/${runId}/reconciliation`);
  return data.lines;
}

export async function getOutputFiles(runId: string): Promise<OutputFile[]> {
  const data = await apiFetch<{ run_id: string; files: OutputFile[] }>(
    `/api/runs/${runId}/files`
  );
  return data.files;
}

export function downloadFile(runId: string, step: number): void {
  window.open(`${BACKEND_URL}/api/runs/${runId}/files/${step}`, '_blank');
}

export async function deleteRun(runId: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/runs/${runId}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Delete failed: ${res.status}`);
  }
}

// ── SSE streaming helpers ─────────────────────────────────────────────────────
// Returns a cancel function. Call it to abort the stream early.

function streamSSE(
  url: string,
  formData: FormData,
  onEvent: (e: SSEEvent) => void
): () => void {
  const controller = new AbortController();

  void (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        onEvent({ type: 'error', msg: `HTTP ${res.status}: ${text}` });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const json = trimmed.slice(5).trim();
            if (json) {
              try {
                const event = JSON.parse(json) as SSEEvent;
                onEvent(event);
              } catch {
                // malformed JSON — ignore
              }
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onEvent({ type: 'error', msg: String(err) });
      }
    }
  })();

  return () => controller.abort();
}

export function streamPaso1(
  file: File,
  onEvent: (e: SSEEvent) => void
): () => void {
  const fd = new FormData();
  fd.append('movimientos', file);
  return streamSSE(`${BACKEND_URL}/api/process/paso1`, fd, onEvent);
}

export function streamPaso2(
  runId: string,
  cobros: File,
  pagos: File,
  onEvent: (e: SSEEvent) => void
): () => void {
  const fd = new FormData();
  fd.append('cobros', cobros);
  fd.append('pagos', pagos);
  return streamSSE(`${BACKEND_URL}/api/process/paso2/${runId}`, fd, onEvent);
}

export function streamPaso3(
  runId: string,
  caja: File,
  onEvent: (e: SSEEvent) => void
): () => void {
  const fd = new FormData();
  fd.append('caja', caja);
  return streamSSE(`${BACKEND_URL}/api/process/paso3/${runId}`, fd, onEvent);
}

export async function fetchControlDrilldown(
  runId: string,
  mes: string,
  categoria: string
): Promise<ControlDrillDown> {
  const params = new URLSearchParams({ mes, categoria });
  return apiFetch<ControlDrillDown>(
    `/api/process/control/${runId}/drilldown?${params}`
  );
}

export async function downloadOdooExport(runId: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/process/odoo-export/${runId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odoo export failed: ${res.status} ${text}`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `argus_odoo_export_${runId}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadOdooZip(runId: string): Promise<void> {
  const res = await fetch(`${BACKEND_URL}/api/process/odoo-export-zip/${runId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odoo ZIP export failed: ${res.status} ${text}`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `argus_odoo_${runId}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function streamControl(
  runId: string,
  cajaDir: File,
  onEvent: (e: SSEEvent) => void
): () => void {
  const fd = new FormData();
  fd.append('caja_dir', cajaDir);
  return streamSSE(`${BACKEND_URL}/api/process/control/${runId}`, fd, onEvent);
}

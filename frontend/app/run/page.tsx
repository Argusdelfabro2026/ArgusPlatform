'use client';

import { useState, useCallback, useRef } from 'react';
import type { LogLine, StepState, SSEEvent, RunStats, ControlVariance } from '@/lib/types';
import {
  streamPaso1,
  streamPaso3,
  streamControl,
  downloadFile,
  downloadOdooZip,
} from '@/lib/api';
import TerminalLog from '@/components/TerminalLog';
import StepPanel from '@/components/StepPanel';
import RunSummary from '@/components/RunSummary';
import ControlResultsTable from '@/components/ControlResultsTable';
import MissingCategoriesPanel from '@/components/MissingCategoriesPanel';
import DrillDownModal from '@/components/DrillDownModal';

let lineCounter = 0;

function makeId(): string {
  return `line-${Date.now()}-${lineCounter++}`;
}

function detectType(msg: string): LogLine['type'] {
  if (msg.includes('✓') || msg.includes('COMPLETADO') || msg.includes('completados'))
    return 'success';
  if (
    msg.includes('⚠') ||
    msg.includes('ERROR HUMANO') ||
    msg.includes('FALTA') ||
    msg.includes('alerta') ||
    msg.includes('⚠️')
  )
    return 'warning';
  if (msg.includes('✗') || msg.startsWith('Error') || msg.startsWith('error'))
    return 'error';
  if (msg.startsWith('═') || msg.startsWith('─') || msg.startsWith('━'))
    return 'separator';
  return 'info';
}

function makeLogLine(msg: string, ts?: string): LogLine {
  return {
    id: makeId(),
    ts: ts ?? new Date().toLocaleTimeString('es-AR', { hour12: false }),
    msg,
    type: detectType(msg),
  };
}

function makeSeparator(): LogLine {
  return { id: makeId(), ts: '', msg: '', type: 'separator' };
}

const INITIAL_IDLE: StepState = { status: 'idle', progress: 0 };
const INITIAL_LOCKED: StepState = { status: 'locked', progress: 0 };

const BOOT_LINES: LogLine[] = [
  makeLogLine('root@argus:~/run$ ./argus --interactive', '00:00:00'),
  makeLogLine('ARGUS v3.0.0 — Sistema de Reconciliación Bancaria', '00:00:00'),
  makeLogLine('Delfabro Group — pipeline listo', '00:00:00'),
  makeSeparator(),
  makeLogLine('Seleccioná un archivo para comenzar el Paso 1', '00:00:00'),
];

export default function RunPage() {
  const [logLines, setLogLines] = useState<LogLine[]>(BOOT_LINES);

  const [step1, setStep1]     = useState<StepState>({ ...INITIAL_IDLE });
  const [stepCtrl, setStepCtrl] = useState<StepState>({ ...INITIAL_LOCKED });
  const [step3, setStep3]     = useState<StepState>({ ...INITIAL_LOCKED });

  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runStats, setRunStats] = useState<RunStats | null>(null);
  const [controlVariances, setControlVariances] = useState<ControlVariance[] | null>(null);
  const [drilldown, setDrilldown] = useState<ControlVariance | null>(null);

  const cancelRef = useRef<(() => void) | null>(null);
  const [odooDownloading, setOdooDownloading] = useState(false);

  const addLog = useCallback((msg: string, ts?: string) => {
    setLogLines((prev) => [...prev, makeLogLine(msg, ts)]);
  }, []);

  const addSep = useCallback(() => {
    setLogLines((prev) => [...prev, makeSeparator()]);
  }, []);

  // ── Step 1: Bank Transactions ───────────────────────────────────────────────

  function executeStep1() {
    if (!step1.file) return;
    setStep1((s) => ({ ...s, status: 'running', progress: 5 }));
    setIsRunning(true);
    addLog('⚡ Iniciando ARGUS v3.0.0 — Paso 1: Movimientos Bancarios');
    addLog(`📂 Cargando ${step1.file.name}...`);

    cancelRef.current = streamPaso1(step1.file, (event: SSEEvent) => {
      if (event.type === 'log') {
        addLog(event.msg, event.ts);
      } else if (event.type === 'progress') {
        setStep1((s) => ({ ...s, progress: event.pct }));
      } else if (event.type === 'done') {
        const rid = event.run_id;
        setRunId(rid);
        if (event.stats) setRunStats(event.stats);
        setStep1((s) => ({ ...s, status: 'done', progress: 100 }));
        setStepCtrl((s) => ({ ...s, status: 'idle' }));
        setStep3((s) => ({ ...s, status: 'idle' }));
        setIsRunning(false);
        addSep();
        addLog('✓ PASO 1 COMPLETADO');
        addLog(`  run_id: ${rid}`);
        addLog('  Subí Caja Digital para el Control (Paso 2) o Caja.xlsx para el Export (Paso 3)');
        addSep();
      } else if (event.type === 'error') {
        setStep1((s) => ({ ...s, status: 'error', errorMsg: event.msg }));
        setIsRunning(false);
        addSep();
        addLog(`✗ ERROR en Paso 1: ${event.msg}`);
        addSep();
      }
    });
  }

  // ── Step 2: Caja Digital Control ────────────────────────────────────────────

  function executeStepControl() {
    if (!runId || !stepCtrl.file) return;
    setStepCtrl((s) => ({ ...s, status: 'running', progress: 5 }));
    setIsRunning(true);
    addLog('⚡ Paso 2 — Control Caja Digital vs Banco (solo canal=1 Transfer)');
    addLog(`📂 Cargando ${stepCtrl.file.name}...`);

    cancelRef.current = streamControl(runId, stepCtrl.file, (event: SSEEvent) => {
      if (event.type === 'log') {
        addLog(event.msg, event.ts);
      } else if (event.type === 'progress') {
        setStepCtrl((s) => ({ ...s, progress: event.pct }));
      } else if (event.type === 'done') {
        setStepCtrl((s) => ({ ...s, status: 'done', progress: 100 }));
        if (event.variances) setControlVariances(event.variances);
        setIsRunning(false);
        addSep();
        addLog('✓ PASO 2 COMPLETADO — Control Caja Digital');
        addLog('  Descargá el reporte de varianzas por categoría');
        if (event.variances) addLog(`  ${event.variances.length} categorías analizadas — hacé click en una fila para ver el detalle`);
        addSep();
      } else if (event.type === 'error') {
        setStepCtrl((s) => ({ ...s, status: 'error', errorMsg: event.msg }));
        setIsRunning(false);
        addSep();
        addLog(`✗ ERROR en Paso 2: ${event.msg}`);
        addSep();
      }
    });
  }

  // ── Step 3: Caja Fábrica Digital export ─────────────────────────────────────

  function executeStep3() {
    if (!runId || !step3.file) return;
    setStep3((s) => ({ ...s, status: 'running', progress: 5 }));
    setIsRunning(true);
    addLog('⚡ Paso 3 — Export Caja Fábrica Digital');
    addLog(`📂 Cargando ${step3.file.name}...`);

    cancelRef.current = streamPaso3(runId, step3.file, (event: SSEEvent) => {
      if (event.type === 'log') {
        addLog(event.msg, event.ts);
      } else if (event.type === 'progress') {
        setStep3((s) => ({ ...s, progress: event.pct }));
      } else if (event.type === 'done') {
        setStep3((s) => ({ ...s, status: 'done', progress: 100 }));
        setIsRunning(false);
        addSep();
        addLog('✓ PASO 3 COMPLETADO — Export Caja Fábrica Digital');
        addLog(`  run_id: ${event.run_id}`);
        addLog('  ↓ Descargá los archivos desde los pasos');
        addSep();
        addLog('🎉 Pipeline finalizado exitosamente');
      } else if (event.type === 'error') {
        setStep3((s) => ({ ...s, status: 'error', errorMsg: event.msg }));
        setIsRunning(false);
        addSep();
        addLog(`✗ ERROR en Paso 3: ${event.msg}`);
        addSep();
      }
    });
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  function handleReset() {
    cancelRef.current?.();
    cancelRef.current = null;
    setStep1({ ...INITIAL_IDLE });
    setStepCtrl({ ...INITIAL_LOCKED });
    setStep3({ ...INITIAL_LOCKED });
    setRunId(null);
    setIsRunning(false);
    setRunStats(null);
    setControlVariances(null);
    setDrilldown(null);
    setOdooDownloading(false);
    setLogLines([
      makeLogLine('root@argus:~/run$ ./argus --reset'),
      makeLogLine('Pipeline reset — listo para nuevo run'),
      makeSeparator(),
    ]);
  }

  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
      {/* ── Left: Step controls ─────────────────────────────────────────── */}
      <aside className="w-full md:w-72 lg:w-80 border-b md:border-b-0 md:border-r border-terminal-border bg-terminal-bg-secondary overflow-y-auto p-3 shrink-0">
        {/* Pipeline header */}
        <div className="text-terminal-gray mb-3 border-b border-terminal-border pb-2 flex items-center justify-between">
          <span className="text-terminal-green font-bold text-xs">PIPELINE</span>
          <span className="text-terminal-gray text-xs">
            {runId ? `run_${runId.slice(0, 8)}` : 'no active run'}
          </span>
        </div>

        <StepPanel
          step={1}
          title="MOVIMIENTOS"
          description="Normalizar movimientos bancarios de todas las cuentas"
          status={step1.status}
          accent="cyan"
          progress={step1.progress}
          fileLabel="Seleccionar Movimientos.xlsx"
          file={step1.file}
          onFileChange={(f) => setStep1((s) => ({ ...s, file: f }))}
          onExecute={executeStep1}
          onDownload={runId ? () => downloadFile(runId, 1) : undefined}
          errorMsg={step1.errorMsg}
        />

        {/* Odoo export — available after Step 1 completes */}
        {step1.status === 'done' && runId && (
          <div className="mb-2 px-1">
            <button
              onClick={async () => {
                setOdooDownloading(true);
                try {
                  await downloadOdooZip(runId);
                  addLog('✓ Odoo ZIP descargado — un Excel por cuenta bancaria');
                } catch (e) {
                  addLog(`✗ Odoo export error: ${e}`);
                } finally {
                  setOdooDownloading(false);
                }
              }}
              disabled={odooDownloading}
              className="w-full px-3 py-1.5 border border-terminal-green/50 text-terminal-green
                rounded text-xs font-mono hover:bg-terminal-green/10 hover:border-terminal-green
                transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              {odooDownloading ? '⏳ generando...' : '↓ EXPORT FOR ODOO (ZIP)'}
            </button>
          </div>
        )}

        <StepPanel
          step={2}
          title="CONTROL CAJA DIGITAL"
          description="Comparar Caja Digital vs banco por categoría (solo canal=1 Transfer)"
          status={stepCtrl.status}
          accent="amber"
          progress={stepCtrl.progress}
          fileLabel="Seleccionar CajaDigital.xlsx"
          file={stepCtrl.file}
          onFileChange={(f) => setStepCtrl((s) => ({ ...s, file: f }))}
          onExecute={executeStepControl}
          onDownload={runId && stepCtrl.status === 'done' ? () => downloadFile(runId, 4) : undefined}
          errorMsg={stepCtrl.errorMsg}
          runId={runId ?? undefined}
        />

        <StepPanel
          step={3}
          title="CAJA"
          description="Generar export Caja Fábrica Digital"
          status={step3.status}
          accent="purple"
          progress={step3.progress}
          fileLabel="Seleccionar Caja.xlsx"
          file={step3.file}
          onFileChange={(f) => setStep3((s) => ({ ...s, file: f }))}
          onExecute={executeStep3}
          onDownload={runId ? () => downloadFile(runId, 3) : undefined}
          errorMsg={step3.errorMsg}
          runId={runId ?? undefined}
        />

        {/* Bottom controls */}
        <div className="border-t border-terminal-border pt-3 mt-1 space-y-2">
          <button
            onClick={handleReset}
            disabled={isRunning}
            className="w-full px-3 py-2 border border-terminal-red text-terminal-red
              rounded text-xs font-mono hover:bg-terminal-red hover:text-terminal-bg
              transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          >
            ↺ RESET PIPELINE
          </button>
        </div>

        {/* Active run ID */}
        {runId && (
          <div className="mt-3 p-2 border border-terminal-border-bright rounded bg-terminal-bg text-xs">
            <div className="text-terminal-gray-dim text-xs">run_id:</div>
            <div className="text-terminal-cyan break-all text-xs mt-0.5">{runId}</div>
          </div>
        )}
      </aside>

      {/* ── Right: Terminal log + Run Summary + Control Results ─────────── */}
      <section className="flex-1 p-3 min-h-0 min-w-0 flex flex-col gap-3 overflow-y-auto">
        <TerminalLog
          lines={logLines}
          isRunning={isRunning}
          title={
            runId
              ? `root@argus:~/run$ ./argus --run=${runId.slice(0, 8)}`
              : 'root@argus:~/run$ ./argus --interactive'
          }
        />
        {runStats && runId && (
          <RunSummary stats={runStats} runId={runId} />
        )}
        {controlVariances && controlVariances.length > 0 && (
          <ControlResultsTable
            variances={controlVariances}
            onRowClick={setDrilldown}
          />
        )}
        {controlVariances && controlVariances.length > 0 && (
          <MissingCategoriesPanel
            variances={controlVariances}
            onRowClick={setDrilldown}
          />
        )}
      </section>

      {/* ── Drill-down modal ─────────────────────────────────────────────── */}
      {drilldown && runId && (
        <DrillDownModal
          runId={runId}
          variance={drilldown}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}

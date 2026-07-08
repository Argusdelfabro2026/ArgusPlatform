# app/services/processor.py
# ARGUS three-step pipeline:
#
# Step 1: Movimientos Bancarios  → normalize + classify + detect human errors
# Step 2: ERP COBROS + PAGOS     → reconcile bank vs Coliseo ERP (Wave 2)
# Step 3: Caja Fábrica Digital   → generate cash register export

import logging
from pathlib import Path
from typing import Callable, Optional

from app.models import ProcessResult
from app.services.loader      import ExcelLoader
from app.services.normalizer  import Normalizer
from app.services.summary     import SummaryGenerator
from app.services.exporter    import Exporter
from app.services.reconciler  import Reconciler, load_erp_cobros, load_erp_pagos

logger = logging.getLogger("argus.processor")


class Processor:

    def __init__(self):
        self.loader      = ExcelLoader()
        self.normalizer  = Normalizer()
        self.summarizer  = SummaryGenerator()
        self.exporter    = Exporter()
        self.reconciler  = Reconciler()
        self._result: Optional[ProcessResult] = None
        self._control_drilldown: dict = {}  # (mes, cat) → {banco:[...], caja:[...]}

    def reset(self):
        """Reset all state — called when the user starts over."""
        self.loader      = ExcelLoader()
        self.normalizer  = Normalizer()
        self.summarizer  = SummaryGenerator()
        self.exporter    = Exporter()
        self.reconciler  = Reconciler()
        self._result     = None
        logger.info("Processor reset — all state cleared")

    # ── Step 1: Movimientos Bancarios ─────────────────────────────────────────

    def run_paso1(
        self,
        path_movimientos: str,
        output_folder: str,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> ProcessResult:
        """
        Step 1 — Load Movimientos Bancarios.
        Normalizes all bank sheets, classifies transactions,
        detects human categorization errors, exports normalized Excel.
        """
        result = ProcessResult()
        self._result = None

        def progress(msg: str):
            logger.info(msg)
            if on_progress:
                on_progress(msg)

        progress("Loading Movimientos Bancarios...")
        ok, msg = self.loader.load_movimientos(path_movimientos)
        if not ok:
            result.errors.append(f"Movimientos: {msg}")
            return result

        progress("Reading accounting categories table...")
        categories = self.loader.get_categories()
        if not categories:
            result.warnings.append("Category table not found.")

        bank_sheets = self.loader.get_bank_sheets()
        if not bank_sheets:
            result.errors.append("No known bank sheets detected.")
            return result
        progress(f"Sheets detected: {', '.join(bank_sheets)}")

        all_transactions = []
        for sheet_name in bank_sheets:
            progress(f"Processing: {sheet_name}...")
            rows = self.loader.get_sheet_rows(sheet_name)
            if not rows:
                result.warnings.append(f"'{sheet_name}': no data")
                continue
            txs, warns = self.normalizer.normalize_sheet(sheet_name, rows, categories)
            all_transactions.extend(txs)
            result.warnings.extend(warns)
            result.sheets_processed += 1
            progress(f"  → {len(txs)} transactions")

        result.transactions       = all_transactions
        result.transactions_total = len(all_transactions)

        if result.transactions_total == 0:
            result.errors.append("No transactions extracted. Check file format.")
            return result

        human_errors = sum(1 for tx in all_transactions if tx.alerta)
        progress(f"Total normalized: {result.transactions_total}")
        if human_errors:
            progress(f"  ⚠ Human errors detected: {human_errors}")

        progress("Exporting normalized transactions Excel...")
        generated = self.exporter.export_paso1(
            transactions  = result.transactions,
            output_folder = output_folder,
        )
        for f in generated:
            progress(f"  ✓ {Path(f).name}")

        progress("─" * 50)
        progress(f"✅ Step 1 complete — {result.transactions_total} transactions, {human_errors} alerts")

        self._result = result
        return result

    # ── Step 2: ERP Reconciliation (Wave 2) ───────────────────────────────────

    def run_paso2(
        self,
        path_cobros: str,
        path_pagos: str,
        output_folder: str,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> ProcessResult:
        """
        Step 2 — Reconcile bank transactions against ERP Coliseo.
        Loads COBROS + PAGOS exports and crosses them against Step 1 results.
        Generates a color-coded reconciliation Excel report.
        """
        def progress(msg: str):
            logger.info(msg)
            if on_progress:
                on_progress(msg)

        if self._result is None:
            result = ProcessResult()
            result.errors.append("Step 1 must complete before Step 2.")
            return result

        result = self._result

        progress("Loading ERP COBROS file...")
        cobros, msg1 = load_erp_cobros(path_cobros)
        if not cobros:
            result.warnings.append(f"COBROS: {msg1}")
        progress(f"  → {len(cobros)} cobros from ERP")

        progress("Loading ERP PAGOS file...")
        pagos, msg2 = load_erp_pagos(path_pagos)
        if not pagos:
            result.warnings.append(f"PAGOS: {msg2}")
        progress(f"  → {len(pagos)} pagos from ERP")

        progress("Running reconciliation engine...")
        recon_lines = self.reconciler.reconcile(
            bank_transactions = result.transactions,
            erp_cobros        = cobros,
            erp_pagos         = pagos,
        )

        conciliados = sum(1 for l in recon_lines if l.estado == "CONCILIADO")
        pend_banco  = sum(1 for l in recon_lines if l.estado == "PENDIENTE BANCO")
        pend_erp    = sum(1 for l in recon_lines if l.estado == "PENDIENTE ERP")

        progress(f"  → {conciliados} conciliados")
        progress(f"  → {pend_banco} pendiente en banco")
        progress(f"  → {pend_erp} pendiente en ERP")

        progress("Exporting reconciliation report...")
        generated = self.exporter.export_reconciliation(
            lines         = recon_lines,
            output_folder = output_folder,
        )
        for f in generated:
            progress(f"  ✓ {Path(f).name}")

        progress("─" * 50)
        progress(f"✅ Step 2 complete — {conciliados} conciliados, "
                 f"{pend_banco} pendiente banco, {pend_erp} pendiente ERP")

        result.recon_lines = recon_lines
        return result

    # ── Control: Caja Dirección vs Banco ─────────────────────────────────────

    def run_control_caja_dir(
        self,
        path_caja_dir: str,
        output_folder: str,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> "ProcessResult":
        """
        Control step — compare bank categorized transactions vs Caja Dirección
        records by (month, category).  Requires Step 1 to have completed.
        """
        from app.services.caja_dir_loader import load_caja_direccion
        from app.services.control_engine import run_control

        def progress(msg: str):
            logger.info(msg)
            if on_progress:
                on_progress(msg)

        if self._result is None:
            result = ProcessResult()
            result.errors.append("Step 1 must complete before running Control Caja Dir.")
            return result

        result = self._result

        # Clear previous control state so stale drilldown data is never served
        # while a new run is in progress.
        self._control_drilldown = {}
        result.control_variances = []

        progress("Cargando Caja Dirección...")
        caja_rows, warns = load_caja_direccion(path_caja_dir)
        for w in warns:
            if w.startswith("__CANAL_DIST__"):
                # Canal distribution info — log as normal progress, not a warning
                progress(f"  ℹ {w[len('__CANAL_DIST__'):].strip()}")
            else:
                result.warnings.append(f"Caja Dir: {w}")
                progress(f"  ⚠ {w}")
        progress(f"  → {len(caja_rows)} registros cargados (canal=1 / Transferencia)")

        progress("Construyendo pivotes mensuales por categoría...")
        variances, drilldown = run_control(result.transactions, caja_rows)
        self._control_drilldown = drilldown

        critical = sum(1 for v in variances if v.estado == "CRITICAL")
        alert    = sum(1 for v in variances if v.estado == "ALERT")
        ok       = sum(1 for v in variances if v.estado == "OK")

        progress(f"  → {ok} categorías OK (varianza ≤10%)")
        if alert:
            progress(f"  ⚠ {alert} categorías ALERT (varianza 10-25%)")
        if critical:
            progress(f"  ✗ {critical} categorías CRITICAL (varianza >25% o solo en una fuente)")

        progress("Exportando reporte de control...")
        generated = self.exporter.export_control(
            variances=variances,
            output_folder=output_folder,
            drilldown=drilldown,
        )
        for f in generated:
            progress(f"  ✓ {Path(f).name}")

        progress("─" * 50)
        progress(
            f"✅ Control Caja Dir completo — {len(variances)} categorías, "
            f"{critical} critical, {alert} alert"
        )

        result.control_variances = variances
        return result

    def get_control_drilldown(self, mes: str, categoria: str) -> dict:
        """Return individual transactions for a (month, category) pair."""
        key = (mes, categoria.strip().upper())
        return self._control_drilldown.get(key, {"banco": [], "caja": []})

    def get_odoo_export_bytes(self) -> bytes:
        """Generate Odoo-compatible Excel bytes from Step 1 transactions."""
        if self._result is None:
            raise ValueError("Step 1 must complete before generating Odoo export.")
        return self.exporter.export_odoo_bytes(self._result.transactions)

    # ── Step 3: Caja Fábrica Digital ─────────────────────────────────────────

    def run_paso3(
        self,
        path_caja: str,
        output_folder: str,
        on_progress: Optional[Callable[[str], None]] = None,
    ) -> ProcessResult:
        """
        Step 3 — Load Caja Fábrica Digital.
        Generates cash register export using transactions from Step 1.
        """
        def progress(msg: str):
            logger.info(msg)
            if on_progress:
                on_progress(msg)

        if self._result is None:
            result = ProcessResult()
            result.errors.append("Step 1 must complete before Step 3.")
            return result

        result = self._result

        progress("Loading Caja Fábrica Digital...")
        ok, msg = self.loader.load_caja(path_caja)
        if not ok:
            result.warnings.append(f"Caja (non-critical): {msg}")

        progress("Generating cash register entries...")
        result.caja_entries = self.summarizer.generate_caja_entries(result.transactions)
        progress(f"  → {len(result.caja_entries)} entries generated")

        progress("Exporting Caja Excel...")
        generated = self.exporter.export_paso3(
            caja_entries  = result.caja_entries,
            output_folder = output_folder,
        )
        for f in generated:
            progress(f"  ✓ {Path(f).name}")

        progress("─" * 50)
        progress("✅ Step 3 complete — Cash register export ready")
        progress("🎉 All 3 steps completed — check output folder")

        return result

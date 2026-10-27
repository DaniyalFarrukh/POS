# Spec (phases and acceptance tests)

Phase 0: Scaffold. Installable HexaPharm Windows app that creates its DB file on launch.
Phase 1: Core data and inventory. Import CSV, receive purchase, see per-batch stock. Balance equals sum of movements (tested).
Phase 2: Offline checkout. 100 offline sales, crash mid-sale recovers with no duplicates or lost data, stock and cash reconcile to the paisa.
Phase 3: Cloud sync. Two counters selling the same batch offline sync with correct final stock. Duplicate pushes create no duplicates. Server outage mid-push recovers.
Phase 4: Owner dashboard. Cross-branch sales, stock, expiry, supplier ledger.
Phase 5: Hardening. Backups, logging, auto-update, Urdu/English, low-end hardware, pilot.
Phase 6: FBR integration (only after integrator API spec is obtained).

Out of scope until after pilot: insurance billing, loyalty, accounting export, mobile apps.
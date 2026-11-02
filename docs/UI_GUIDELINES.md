# UI Guidelines (apps/web and shared packages/ui)

## Layout (generic ERP pattern, our own design)
- Left sidebar: logo and pharmacy name, module search box, collapsible groups with icons, active item highlight, collapse-to-icons mode. Items come from one nav config filtered by the permission matrix.
- Top bar: sidebar toggle, global search (also Ctrl+K command palette: search pages, invoices, customers, products, suppliers), quick actions (New Sale, New Customer, New Purchase Order), notifications bell with unread count, branch switcher, user menu with role badge.
- Page: title and subtitle, primary action on the right, KPI summary cards, then a card with search, filters and a data table.
- Patterns: tabs (e.g. By Customer / By Product), expandable rows for detail, side drawers for create and edit, confirmation dialogs for destructive actions, skeleton loading, helpful empty states, toasts for results.

## Tokens and quality
- One design token file (colors, spacing, radius, shadows, typography). Light theme first, dark theme optional later.
- Money is displayed by one shared formatter (Rs. 1,234.50), numbers are right-aligned with tabular digits, dates are shown in Asia/Karachi.
- Tables: search, column sort, filters, pagination or virtualization, column toggle, CSV export, sticky header, keyboard navigation.
- Accessibility: focus states, labels, color is never the only signal, contrast checked.
- English and Urdu with RTL-safe layout (logical CSS properties). No external CDNs or fonts: everything is bundled.
- Performance: first table render under 1 second for 10,000 rows (server-side pagination), no layout shift.
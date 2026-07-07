# POS Cloud

## Local Frontend

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Local Supabase Backend

The app can run in two modes:

- Demo mode: no Supabase env vars. API routes validate inputs and return demo data.
- Supabase mode: set the env vars below and API routes read/write the local database.

```bash
cp .env.example .env.local
npm run db:start
npm run db:reset
npm run dev
```

After `supabase start`, copy the local API URL, anon key, and service role key into `.env.local`.

Required env vars:

```text
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
DEMO_CASHIER_ID=00000000-0000-4000-8000-000000000001
```

Local demo users seeded into Supabase (email/password login on `/login`):

```text
staff-a@example.local / password123   (staff)
staff-b@example.local / password123   (staff)
staff-c@example.local / password123   (staff)
manager@example.local / password123   (manager)
```

With Supabase env vars set, the app uses real Supabase Auth sessions: staff accounts
cannot see or open the manager console, order/inventory records are bound to the
logged-in user, and managers can create/delete employee accounts from `/manager/staff`.
Without env vars the app falls back to demo mode (role buttons on `/login`).

## Backend Scope Implemented

- Supabase schema and RLS migrations.
- Deterministic seed data for products, counters, discounts, flavors, targets, staff, and manager.
- `public.create_pos_order(...)` RPC for transactional order creation.
- `GET /api/catalog` for catalog/staff/counter data.
- `POST /api/orders` for POS order submission.
- `GET/POST/PATCH /api/inventory` for inventory movements and manager review.
- `GET/POST /api/shifts` for schedule reads and per-slot upserts.
- `POST /api/shifts/publish` to validate conflicts and publish a month.
- `POST /api/shifts/apply-previous` to copy the previous month schedule as drafts.
- `GET /api/reports` for daily/monthly performance, summary KPIs, and counter targets.
- `GET /api/payroll` for scheduled hours, base pay, and commission estimates.
- `GET/POST/PATCH /api/products`, `/api/discounts`, `/api/counters` for manager settings.
- `GET /api/me` for the logged-in profile; Supabase Auth session enforced in middleware.
- `GET/POST/PATCH/DELETE /api/staff` for employee account management (manager only).
- `GET /api/orders` order history for the manager console.
- Inventory tracks bag products AND gift-box flavors per counter; gift-box sales deduct
  flavor stock (plus the bundled scallion cracker), and orders are rejected when stock
  is insufficient (`public.current_stock`). Movements support edit/delete with
  `updated_by` audit and manager review.

## Verification

```bash
npm test
npm run build
```

## Cloud Deployment Later

Do this only after local flows are stable:

1. Create a Supabase cloud project.
2. Apply migrations and seed only the production-safe data.
3. Move secrets into Vercel environment variables.
4. Deploy Next.js to Vercel.

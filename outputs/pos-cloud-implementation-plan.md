# POS Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production MVP of POS Cloud from the approved mockup and design documents.

**Architecture:** Use Next.js App Router as the web application and Supabase as the auth/database backend. Keep employee workflows and manager workflows route-separated, with Supabase RLS enforcing data access.

**Tech Stack:** Next.js, TypeScript, Supabase Auth, Supabase Postgres, Tailwind CSS, Vitest or Jest, Playwright.

---

## File Structure

Recommended project layout:

```text
app/
  login/
  pos/
  staff/schedule/
  staff/inventory/
  manager/
  manager/reports/
  manager/schedule/
  manager/inventory/
  manager/products/
  manager/counters/
components/
  pos/
  staff/
  manager/
  shared/
lib/
  auth/
  db/
  domain/
  reports/
supabase/
  migrations/
tests/
```

## Task 1: Project Scaffold

- [ ] Create a Next.js TypeScript app.
- [ ] Add Tailwind CSS.
- [ ] Add Supabase packages.
- [ ] Configure environment variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] Add a basic route guard that redirects unauthenticated users to `/login`.

## Task 2: Supabase Schema

- [ ] Create migrations for:
  - `profiles`
  - `counters`
  - `counter_monthly_targets`
  - `products`
  - `gift_box_rules`
  - `flavors`
  - `gift_box_fixed_flavors`
  - `discounts`
  - `orders`
  - `order_items`
  - `order_item_gift_flavors`
  - `shifts`
  - `inventory_movements`
- [ ] Enable RLS on every public table.
- [ ] Add staff and manager policies.
- [ ] Seed sample products, flavors, gift boxes, counters, employees, and discounts.

## Task 3: Domain Logic

- [ ] Implement discount calculation.
- [ ] Implement gift box validation:
  - 小禮盒 requires 3 selected flavors.
  - 大禮盒 requires 8 selected flavors and includes one scallion cracker.
  - 發禮盒 and 財禮盒 use fixed flavors.
- [ ] Implement order total calculation:
  - `salesAmount`
  - `discountAmount`
  - `receivableAmount`
  - `receivedAmount = receivableAmount`
- [ ] Implement daily commission calculation.
- [ ] Implement schedule conflict validation.

## Task 4: Employee POS

- [ ] Build `/pos` layout from the mockup.
- [ ] Load active products and discounts.
- [ ] Show product categories:
  - 袋裝
  - 禮盒
  - 常用
- [ ] Support gift box flavor modal.
- [ ] Support seller selection from current shift staff.
- [ ] Remove manual received amount input.
- [ ] Submit order through a server action or route handler.
- [ ] Create order, order items, gift flavor details, and sale inventory movements in one transaction.

## Task 5: Staff Schedule

- [ ] Build `/staff/schedule`.
- [ ] Show only the logged-in staff member's published shifts.
- [ ] Display date, shift code, time range, and counter.
- [ ] Add reminders for opening and closing inventory counts.

## Task 6: Staff Inventory

- [ ] Build `/staff/inventory`.
- [ ] Allow opening count, closing count, purchase, sampling, waste, and adjustment entries.
- [ ] Require notes for sampling, waste, and adjustment.
- [ ] Show today's inventory movement history for the current counter.

## Task 7: Manager Dashboard And Reports

- [ ] Build `/manager`.
- [ ] Build `/manager/reports`.
- [ ] Show daily employee performance.
- [ ] Show monthly employee performance.
- [ ] Show total sales, revenue, actual cash flow, average order value, and target achievement.
- [ ] Support filtering by date range and counter.

## Task 8: Manager Monthly Scheduling

- [ ] Build `/manager/schedule`.
- [ ] Display monthly calendar with two shifts per day:
  - morning 10:00-16:00
  - evening 16:00-22:00
- [ ] Allow manager to assign staff per counter/date/shift.
- [ ] Support applying previous month schedule.
- [ ] Validate conflicts before publishing.
- [ ] Publish shifts to staff schedule.
- [ ] Show payroll estimate from scheduled hours and commission.

## Task 9: Manager Inventory

- [ ] Build `/manager/inventory`.
- [ ] Show stock summary by counter and product.
- [ ] Show low stock warnings.
- [ ] Show inventory differences.
- [ ] Allow manager review of waste, adjustment, and abnormal count records.

## Task 10: Manager Settings

- [ ] Build `/manager/products`.
- [ ] Manage bag products.
- [ ] Manage gift box prices and rules.
- [ ] Manage selectable flavors and fixed gift box flavors.
- [ ] Manage discounts.
- [ ] Build `/manager/counters`.
- [ ] Manage counters and monthly targets.

## Task 11: Verification

- [ ] Run unit tests for domain logic.
- [ ] Run integration tests for order creation.
- [ ] Run RLS permission tests for staff and manager.
- [ ] Run Playwright flows:
  - staff creates bag order
  - staff creates small gift box order
  - staff creates large gift box order
  - staff submits opening and closing inventory count
  - manager publishes monthly schedule
  - manager reviews reports
- [ ] Verify responsive layouts on mobile and tablet widths.


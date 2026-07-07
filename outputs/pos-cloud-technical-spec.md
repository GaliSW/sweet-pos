# POS Cloud 技術規格文件

## 1. 技術選型

建議技術棧：

- Frontend / Backend：Next.js App Router
- Language：TypeScript
- Database：Supabase Postgres
- Auth：Supabase Auth
- Data access：Supabase SSR client + Server Actions / Route Handlers
- Styling：Tailwind CSS 或既有設計系統
- Deployment：Vercel + Supabase

原因：

- 員工使用手機/平板網頁操作，Next.js 適合做響應式 Web App。
- Supabase 內建 Auth、Postgres、RLS，適合雲端多人櫃位系統。
- 店長可遠端查看報表，資料集中於雲端。

## 2. 應用分區

建議路由：

```text
/login
/pos
/staff/schedule
/staff/inventory
/manager
/manager/reports
/manager/schedule
/manager/inventory
/manager/products
/manager/counters
```

權限策略：

- `staff`：可進入 `/pos`、`/staff/schedule`、`/staff/inventory`
- `manager`：可進入所有 manager route
- 員工不可透過 URL 直接讀取 manager 資料
- 店長可讀取與管理所有櫃位資料

角色資料不可依賴可被使用者修改的 user metadata。應存於資料庫 profile/role 表，或使用受信任的 app metadata。

## 3. 資料模型

### profiles

使用者基本資料。

```sql
profiles (
  id uuid primary key references auth.users(id),
  display_name text not null,
  role text not null check (role in ('staff', 'manager')),
  hourly_wage numeric(10,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)
```

### counters

櫃位。

```sql
counters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)
```

### counter_monthly_targets

櫃位每月業績目標。

```sql
counter_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references counters(id),
  month date not null,
  target_amount numeric(12,2) not null,
  unique (counter_id, month)
)
```

`month` 儲存該月第一天，例如 `2026-07-01`。

### products

可銷售商品。

```sql
products (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bag', 'gift_box')),
  name text not null,
  spec text not null,
  price numeric(10,2) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)
```

袋裝商品與禮盒商品都放在 `products`。

### gift_box_rules

禮盒規則。

```sql
gift_box_rules (
  product_id uuid primary key references products(id),
  selection_mode text not null check (selection_mode in ('select', 'fixed')),
  required_flavor_count integer not null default 0,
  includes_scallion_cracker boolean not null default false
)
```

範例：

- 小禮盒：`selection_mode = select`，`required_flavor_count = 3`
- 大禮盒：`selection_mode = select`，`required_flavor_count = 8`，`includes_scallion_cracker = true`
- 發禮盒：`selection_mode = fixed`
- 財禮盒：`selection_mode = fixed`

### flavors

禮盒可選口味。

```sql
flavors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spec text not null default '6入/袋',
  is_active boolean not null default true
)
```

口味不單獨計價。

### gift_box_fixed_flavors

固定禮盒口味組合。

```sql
gift_box_fixed_flavors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  flavor_id uuid not null references flavors(id),
  quantity integer not null default 1,
  unique (product_id, flavor_id)
)
```

### discounts

折扣。

```sql
discounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed_amount')),
  value numeric(10,2) not null,
  min_order_amount numeric(10,2),
  is_active boolean not null default true
)
```

### orders

訂單主檔。

```sql
orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  counter_id uuid not null references counters(id),
  seller_id uuid not null references profiles(id),
  cashier_id uuid not null references profiles(id),
  discount_id uuid references discounts(id),
  payment_method text not null,
  sales_amount numeric(12,2) not null,
  discount_amount numeric(12,2) not null default 0,
  receivable_amount numeric(12,2) not null,
  received_amount numeric(12,2) not null,
  status text not null check (status in ('completed', 'voided')),
  created_at timestamptz not null default now()
)
```

金額規則：

- `sales_amount`：原價小計
- `discount_amount`：折扣金額
- `receivable_amount`：應收金額
- `received_amount`：實收金額
- 第一版 `received_amount = receivable_amount`

`seller_id` 是業績歸屬人員。`cashier_id` 是實際登入操作人員。兩者可能不同。

### order_items

訂單明細。

```sql
order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  product_id uuid not null references products(id),
  product_name text not null,
  spec text not null,
  unit_price numeric(10,2) not null,
  quantity integer not null,
  line_total numeric(12,2) not null
)
```

### order_item_gift_flavors

禮盒明細口味。

```sql
order_item_gift_flavors (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id),
  flavor_id uuid references flavors(id),
  flavor_name text not null,
  spec text not null,
  quantity integer not null default 1
)
```

禮盒口味只用於記錄組成，不影響價格。

### shifts

排班。

```sql
shifts (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references counters(id),
  staff_id uuid not null references profiles(id),
  shift_date date not null,
  shift_code text not null check (shift_code in ('morning', 'evening')),
  starts_at time not null,
  ends_at time not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (counter_id, shift_date, shift_code)
)
```

第一版每日兩班制：

- `morning`：10:00-16:00
- `evening`：16:00-22:00

檢查規則：

- 同一櫃位同一天同班只能有一位主要員工。
- 同一員工不可在重疊時段被排到不同櫃位。
- 發布後員工可在自己的班表看到。

### inventory_movements

庫存異動。

```sql
inventory_movements (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references counters(id),
  product_id uuid not null references products(id),
  movement_type text not null check (
    movement_type in ('opening_count', 'closing_count', 'purchase', 'sampling', 'waste', 'adjustment', 'sale')
  ),
  quantity integer not null,
  counted_quantity integer,
  note text,
  created_by uuid not null references profiles(id),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
)
```

建議：

- 銷售完成時建立 `sale` 異動。
- 開班與下班盤點用 `opening_count`、`closing_count`。
- 試吃、報廢需填備註。
- 異常調整需店長覆核。

## 4. 前台 POS 行為

### 商品載入

前台只載入啟用商品與啟用折扣。

商品分區：

- 袋裝
- 禮盒
- 常用

### 建立訂單

建立訂單時前端送出：

```ts
type CreateOrderInput = {
  counterId: string;
  sellerId: string;
  discountId: string | null;
  paymentMethod: 'cash' | 'credit_card' | 'line_pay' | 'jkopay';
  items: Array<{
    productId: string;
    quantity: number;
    giftFlavors?: Array<{
      flavorId: string | null;
      flavorName: string;
      spec: string;
      quantity: number;
    }>;
  }>;
};
```

後端負責：

- 查商品價格
- 檢查禮盒口味數是否符合規則
- 計算原價小計
- 套用折扣
- 寫入 `orders`
- 寫入 `order_items`
- 寫入 `order_item_gift_flavors`
- 寫入庫存銷售異動

前端不可自行信任價格計算結果。

## 5. 店長排班行為

### 排班頁流程

1. 店長選擇月份與櫃位。
2. 系統顯示該月月曆。
3. 每日顯示早班、晚班兩格。
4. 店長在每格選員工。
5. 店長可套用上月班表。
6. 儲存草稿。
7. 系統檢查：
   - 同員工撞班
   - 缺班
   - 非啟用員工
   - 同櫃位同班重複
8. 店長發布班表。
9. 員工端只看到自己的已發布班次。

### 薪資試算

薪資試算資料來源：

- `shifts`：排班時數
- `profiles.hourly_wage`：員工時薪
- `orders`：每日個人業績

抽成計算：

```ts
function calculateDailyCommission(dailySales: number): number {
  if (dailySales > 5000) return Math.round(dailySales * 0.02);
  if (dailySales >= 3000) return Math.round(dailySales * 0.01);
  return 0;
}
```

## 6. 報表查詢

### 每日員工業績

群組：

- 日期
- 銷售人員
- 櫃位

指標：

- 訂單數
- 銷售金額
- 折扣金額
- 實收金額
- 抽成

### 每月員工業績

群組：

- 月份
- 銷售人員

### 櫃位目標達成率

公式：

```text
櫃位當月折扣後業績 / counter_monthly_targets.target_amount
```

## 7. RLS 與安全

所有 public schema 資料表都必須啟用 RLS。

原則：

- 員工只能讀取自己的 profile、自己的班表、自己可操作櫃位的前台資料。
- 員工可建立訂單與庫存異動。
- 員工不可讀取店長報表彙總。
- 店長可讀取與管理所有櫃位資料。
- 不使用可被使用者修改的 metadata 做授權判斷。
- 不在前端暴露 Supabase service role key。

建議建立 helper function 或 policy view 前，需確認不會繞過 RLS。若使用 Postgres view，需使用 security invoker 或放在非公開 schema。

## 8. 測試計畫

### 單元測試

- 折扣計算
- 禮盒口味數驗證
- 每日抽成計算
- 排班撞班檢查
- 應收等於實收邏輯

### 整合測試

- 員工建立袋裝訂單
- 員工建立小禮盒訂單，選 3 個口味
- 員工建立大禮盒訂單，選 8 個口味並自動包含蔥餅
- 發禮盒與財禮盒使用固定口味
- 訂單完成後建立庫存銷售異動
- 員工開班盤點與下班盤點
- 店長發布月班表
- 員工只看到自己的班表

### 權限測試

- staff 不能進入 manager route
- staff 不能讀取全員薪資報表
- staff 不能修改商品價格
- manager 可以讀取報表與庫存覆核資料

## 9. 建議實作順序

1. 建立 Next.js 專案與 Supabase 連線。
2. 建立 Auth、profile 與角色權限。
3. 建立商品、禮盒、折扣資料模型。
4. 實作前台 POS 與訂單建立。
5. 實作報表查詢。
6. 實作員工班表與店長月排班。
7. 實作庫存盤點與庫存管理。
8. 實作薪資與抽成試算。
9. 補齊 RLS policy、測試與部署設定。


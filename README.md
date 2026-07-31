# Trove — marketplace demo

**Discover more. Own better.**

Full shopping structure (catalog → cart → checkout → orders) with original UI and a real SQLite database. Behavior events are logged for later ML training.

## Brand

| | |
|--|--|
| **Name** | Trove |
| **Tagline** | Discover more. Own better. |
| **Look** | Editorial cream + violet + ember — not an Amazon skin |

## Stack

- **DB:** SQLite (`server/db/data/harbor.db`) via `better-sqlite3`
- **API:** Express, JWT auth, bcrypt passwords
- **UI:** React + Vite + React Router

## Run (local)

```bash
# API
cd server && npm install && npm start
# http://localhost:8000

# Storefront
cd client && npm install && npm run dev
# http://localhost:5173
```

### Production build (one process serves UI + API)

```bash
cd client && npm install && npm run build
cd ../server && npm start
# open http://localhost:8000  (shop + /admin)
```

## Deploy free on Oracle Cloud

Always Free VM — full stack (UI, bots, Tiny AI) for **$0**:

→ **[deploy/oracle/ORACLE.md](deploy/oracle/ORACLE.md)**

```bash
# on the VM after clone:
chmod +x deploy/oracle/*.sh
./deploy/oracle/setup.sh
sudo ./deploy/oracle/install-service.sh
# http://YOUR_PUBLIC_IP:8000
```

### Demo account

- Email: `demo@trove.shop`
- Password: `password123`

Or create a new account on the Sign in page.

### Reseed DB

```bash
cd server && node db/seed.js --force
```

## What works

- Search, categories, brand filter, sort, pagination
- Product detail, reviews, related products
- Server-side cart (guest + signed-in; merges on login)
- Checkout with tax / free shipping $35+
- Orders history
- Register / login
- **Per-profile activity tracking** → consumer behavior engine
- **Admin AI console** at `/admin`

## Consumer behavior AI

Every shop action (`page_view`, `view_product`, `search`, `add_to_cart`, `begin_checkout`, `purchase`, `login`, …) is stored in SQLite and rebuilds a **consumer profile**:

| Signal | Meaning |
|--------|---------|
| Persona | Window shopper, researcher, bargain hunter, cart abandoner, loyal buyer, … |
| Scores | Engagement, purchase intent, price sensitivity, loyalty, abandon risk |
| Affinities | Categories, brands, top products |
| Journey | Token path of the session history |
| Insights | Natural-language summary + merchandising recommendations |

### Admin console

| URL | |
|-----|--|
| http://localhost:5173/admin | Intelligence dashboard |
| Login | `admin@trove.shop` / `admin123` |

Pages: Overview · **Active bots** · Manage bots · **Tiny AI** · Profiles · Live feed

### Active bots (`/admin/bots/active`)

Live fleet of synthetic shoppers that have run (or are running) sessions — events, orders, persona DNA, quick Run.

### Manage bots (`/admin/bots`)

- Create single or batch bots with **unique DNA**
- Each bot logs in, searches, views, carts, purchases
- Edit funnel probabilities per bot

Bot password default: `botpass123`

### Tiny AI (`/admin/ai`) + real-time data

Every shop/bot event is processed **immediately**:

1. Written to SQLite  
2. Consumer profile rebuilt  
3. Tiny Transformer re-classifies the journey (on cart/view/buy/etc.)  
4. Pushed to admin over **SSE** (`/api/admin/stream`)

- **Live feed** (`/admin/live`) — real-time events + AI labels (no polling)  
- **Tiny AI** — live classification table + training curves  
- **Active bots** — live AI strip while bots run  
- Model file: `ml_transformer/models/shop_tf.npz`

### Admin API

- `GET /api/admin/overview`
- `GET /api/admin/profiles`
- `GET /api/admin/profiles/:key`
- `POST /api/admin/profiles/:key/analyze`
- `POST /api/admin/rebuild`
- `GET /api/admin/events`

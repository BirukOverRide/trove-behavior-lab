# Deploy Trove on Oracle Cloud (Always Free)

Everything runs on **one free VM**: React UI + Express API + SQLite + Python Tiny AI.

**Cost:** $0 if you stay on Always Free shapes (ARM Ampere A1 or x86 micro).

---

## 1. Create the free VM

1. Sign up: [https://cloud.oracle.com](https://cloud.oracle.com)  
   (free tier; may ask for card for verification — stay in Always Free limits = $0)
2. **Compute → Instances → Create instance**
3. Suggested shape (Always Free eligible):
   - **VM.Standard.A1.Flex** (Ampere ARM) — 1–4 OCPU, 6–24 GB RAM  
     or **VM.Standard.E2.1.Micro** if ARM is full in your region
4. Image: **Ubuntu 22.04** or **Oracle Linux 8/9**
5. Networking: assign a **public IP**
6. SSH keys: add your public key
7. Create → wait until **Running**

### Open the web port (required)

**Networking → Virtual Cloud Networks → your VCN → Security Lists** (or NSG):

| Direction | Source | Protocol | Port |
|-----------|--------|----------|------|
| Ingress | `0.0.0.0/0` | TCP | **8000** |
| Ingress | your IP (safer) | TCP | **22** (SSH) |

Also allow port **8000** in the instance OS firewall if enabled (Ubuntu `ufw`, OL `firewalld`).

---

## 2. SSH in

```bash
ssh -i ~/.ssh/your_key ubuntu@YOUR_PUBLIC_IP
# or opc@... on Oracle Linux
```

---

## 3. Get the code onto the VM

### Option A — GitHub (recommended)

On your laptop (if not already):

```bash
cd /path/to/behavior_analysis
git init
git add .
git commit -m "Trove ready for Oracle"
# create empty repo on GitHub, then:
git remote add origin https://github.com/YOU/trove.git
git push -u origin main
```

On the Oracle VM:

```bash
sudo apt update && sudo apt install -y git   # Ubuntu
git clone https://github.com/YOU/trove.git
cd trove
```

### Option B — scp (no GitHub)

From your laptop:

```bash
rsync -avz --exclude node_modules --exclude '**/node_modules' \
  --exclude ml_transformer/models/runs \
  -e "ssh -i ~/.ssh/your_key" \
  ./behavior_analysis/ ubuntu@YOUR_PUBLIC_IP:~/trove/
```

---

## 4. One-time setup on the VM

```bash
cd ~/trove   # or wherever you cloned
chmod +x deploy/oracle/*.sh
./deploy/oracle/setup.sh
```

This installs Node, Python, deps, builds the UI, and creates `server/.env`.

Optional secrets:

```bash
nano server/.env
# XAI_API_KEY=...   only needed for Trove Chat, not for bots/Tiny AI
```

---

## 5. Run it

### Quick test (foreground)

```bash
./deploy/oracle/start.sh
```

Open: `http://YOUR_PUBLIC_IP:8000`  
Admin: `http://YOUR_PUBLIC_IP:8000/admin`  
- `admin@trove.shop` / `admin123`  
- Shop demo: `demo@trove.shop` / `password123`

### Always-on (survives reboot)

```bash
sudo ./deploy/oracle/install-service.sh
```

```bash
sudo systemctl status trove
sudo journalctl -u trove -f
```

---

## 6. After code updates

```bash
cd ~/trove
git pull
./deploy/oracle/setup.sh          # rebuild client + refresh deps
sudo systemctl restart trove
```

---

## Free-tier tips (CPU / memory)

Oracle free VMs are smaller than your laptop. Recommended:

| Setting | Why |
|---------|-----|
| Smaller bot batches (50–200) | Less DB + train load |
| Let **Play all** finish, then **one** full train | Already how auto-train works |
| `AUTO_TRAIN=0` in `.env` | If train still melts the VM; train manually on Tiny AI |
| Prefer **A1.Flex** with 2 OCPU / 12 GB if available | Better for Python train |

Env knobs (`server/.env`):

```bash
HOST=0.0.0.0
PORT=8000
AUTO_TRAIN=1
AUTO_TRAIN_EPOCHS=12
AUTO_TRAIN_INTERVAL_MS=120000
# AUTO_TRAIN=0
```

---

## Architecture on Oracle (one box)

```
Internet → :8000
            ├─ React UI   (client/dist, served by Express)
            ├─ REST + SSE (/api/...)
            ├─ SQLite     (server/db/data/)
            └─ Python     (ml_transformer train + infer)
```

No second host required. No paid add-ons.

---

## Security checklist (do this)

- [ ] Change admin password after first login (or reseed with new admin)
- [ ] Prefer SSH key only (disable password SSH)
- [ ] Restrict port 22 to your IP in security list
- [ ] Do **not** commit `server/.env` or API keys
- [ ] Optional: put free Cloudflare in front later for HTTPS

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Page won’t load | Security list ingress **8000** + `systemctl status trove` |
| API works, blank UI | Run `cd client && npm run build` then restart |
| Train kills the VM | Set `AUTO_TRAIN=0`, train fewer bots, or more OCPU |
| `better-sqlite3` build fails | Install `build-essential` / `gcc-c++` then `cd server && npm rebuild` |
| ARM vs x86 | Use Node 20+ official for your arch; rebuild native modules on the VM |

---

## What stays free

- Oracle Always Free VM (within shape limits)
- Public IP on free tier (check your region’s free IP rules)
- Your app serving shop + admin + bots + Tiny AI

GitHub is only for **code storage** — the live app is this Oracle VM.

const { v4: uuid } = require('uuid');
const { db, mapProduct } = require('../db');

/**
 * Get or create a cart for a signed-in user and/or browser session.
 * Avoids UNIQUE(session_id) collisions when a guest cart already owns the session.
 */
function getOrCreateCart({ userId, sessionId }) {
  if (userId) {
    let cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);
    if (cart) return cart;

    // Claim guest cart for this session (login path / first authed request)
    if (sessionId) {
      const guest = db
        .prepare('SELECT * FROM carts WHERE session_id = ? AND user_id IS NULL')
        .get(sessionId);
      if (guest) {
        db.prepare(
          `UPDATE carts SET user_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(userId, guest.id);
        return db.prepare('SELECT * FROM carts WHERE id = ?').get(guest.id);
      }
    }

    const id = uuid();
    let sid = sessionId || null;
    if (sid) {
      const taken = db.prepare('SELECT id FROM carts WHERE session_id = ?').get(sid);
      if (taken) sid = null;
    }
    db.prepare(
      'INSERT INTO carts (id, user_id, session_id) VALUES (?, ?, ?)'
    ).run(id, userId, sid);
    return db.prepare('SELECT * FROM carts WHERE id = ?').get(id);
  }

  if (!sessionId) return null;

  let cart = db.prepare('SELECT * FROM carts WHERE session_id = ?').get(sessionId);
  if (!cart) {
    const id = uuid();
    db.prepare(
      'INSERT INTO carts (id, user_id, session_id) VALUES (?, NULL, ?)'
    ).run(id, sessionId);
    cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(id);
  }
  return cart;
}

/**
 * Merge anonymous session cart items into the user's cart on login/register.
 * Must never throw in a way that blocks authentication.
 */
function mergeSessionCartIntoUser(sessionId, userId) {
  if (!sessionId || !userId) return;

  const merge = db.transaction(() => {
    const sessionCart = db
      .prepare('SELECT * FROM carts WHERE session_id = ? AND user_id IS NULL')
      .get(sessionId);

    let userCart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(userId);

    // No guest cart — just ensure user has a cart and optional session link
    if (!sessionCart) {
      if (!userCart) {
        const id = uuid();
        const taken = db.prepare('SELECT id FROM carts WHERE session_id = ?').get(sessionId);
        db.prepare(
          'INSERT INTO carts (id, user_id, session_id) VALUES (?, ?, ?)'
        ).run(id, userId, taken ? null : sessionId);
      } else {
        // Safe session attach
        db.prepare(
          `UPDATE carts SET session_id = NULL WHERE session_id = ? AND id != ?`
        ).run(sessionId, userCart.id);
        db.prepare(
          `UPDATE carts SET session_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(sessionId, userCart.id);
      }
      return;
    }

    // Guest cart exists, user has no cart → promote guest cart
    if (!userCart) {
      db.prepare(
        `UPDATE carts SET user_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(userId, sessionCart.id);
      return;
    }

    // Both exist and are different → merge line items, drop guest cart
    if (sessionCart.id !== userCart.id) {
      const items = db
        .prepare('SELECT * FROM cart_items WHERE cart_id = ?')
        .all(sessionCart.id);
      const upsert = db.prepare(`
        INSERT INTO cart_items (id, cart_id, product_id, qty)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(cart_id, product_id) DO UPDATE SET qty = qty + excluded.qty
      `);
      for (const item of items) {
        upsert.run(uuid(), userCart.id, item.product_id, item.qty);
      }
      db.prepare('DELETE FROM carts WHERE id = ?').run(sessionCart.id);
    }

    db.prepare(
      `UPDATE carts SET session_id = NULL WHERE session_id = ? AND id != ?`
    ).run(sessionId, userCart.id);
    db.prepare(
      `UPDATE carts SET session_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(sessionId, userCart.id);
  });

  merge();
}

function getCartDetail(cartId) {
  const rows = db
    .prepare(
      `
    SELECT ci.qty, p.*, c.name AS category_name, c.slug AS category_slug
    FROM cart_items ci
    JOIN products p ON p.id = ci.product_id
    JOIN categories c ON c.id = p.category_id
    WHERE ci.cart_id = ?
    ORDER BY ci.rowid
  `
    )
    .all(cartId);

  const items = rows.map((row) => {
    const product = mapProduct(row);
    const lineCents = product.price.cents * row.qty;
    return {
      productId: product.id,
      qty: row.qty,
      product,
      lineTotal: {
        cents: lineCents,
        amount: (lineCents / 100).toFixed(2),
        formatted: `$${(lineCents / 100).toFixed(2)}`,
      },
    };
  });

  const subtotalCents = items.reduce((s, i) => s + i.lineTotal.cents, 0);
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  return {
    items,
    itemCount,
    subtotal: {
      cents: subtotalCents,
      amount: (subtotalCents / 100).toFixed(2),
      formatted: `$${(subtotalCents / 100).toFixed(2)}`,
    },
  };
}

module.exports = { getOrCreateCart, mergeSessionCartIntoUser, getCartDetail };

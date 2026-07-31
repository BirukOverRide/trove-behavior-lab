/**
 * Seed a real catalog — run: node db/seed.js [--force]
 */
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { db } = require('./index');

const isMain = require.main === module;
const force = process.argv.includes('--force');
const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (count > 0 && !force) {
  if (isMain) {
    console.log(`DB already has ${count} products. Use --force to reseed.`);
    process.exit(0);
  }
  // imported by server — leave existing data alone
  module.exports = { seeded: false };
  return;
}

if (force) {
  db.exec(`
    DELETE FROM behavior_events;
    DELETE FROM order_items;
    DELETE FROM orders;
    DELETE FROM cart_items;
    DELETE FROM carts;
    DELETE FROM reviews;
    DELETE FROM products;
    DELETE FROM categories;
    DELETE FROM addresses;
    DELETE FROM users;
  `);
}

const img = (seed, w = 600, h = 600) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

const categories = [
  { id: 'cat-electronics', name: 'Electronics', slug: 'electronics', parent: null, sort: 1 },
  { id: 'cat-computers', name: 'Computers', slug: 'computers', parent: 'cat-electronics', sort: 2 },
  { id: 'cat-home', name: 'Home & Kitchen', slug: 'home-kitchen', parent: null, sort: 3 },
  { id: 'cat-sports', name: 'Sports & Outdoors', slug: 'sports-outdoors', parent: null, sort: 4 },
  { id: 'cat-books', name: 'Books', slug: 'books', parent: null, sort: 5 },
  { id: 'cat-fashion', name: 'Clothing & Fashion', slug: 'fashion', parent: null, sort: 6 },
  { id: 'cat-beauty', name: 'Beauty & Personal Care', slug: 'beauty', parent: null, sort: 7 },
  { id: 'cat-toys', name: 'Toys & Games', slug: 'toys-games', parent: null, sort: 8 },
  { id: 'cat-grocery', name: 'Grocery', slug: 'grocery', parent: null, sort: 9 },
  { id: 'cat-tools', name: 'Tools & Home Improvement', slug: 'tools', parent: null, sort: 10 },
  { id: 'cat-auto', name: 'Automotive', slug: 'automotive', parent: null, sort: 11 },
  { id: 'cat-pet', name: 'Pet Supplies', slug: 'pet-supplies', parent: null, sort: 12 },
];

const products = [
  // Electronics
  p('prod-echo-dot', 'echo-dot-5', 'Echo Dot (5th Gen) Smart speaker with Alexa', 'Amazon', 'cat-electronics', 4999, 5999, 1200, 4.7, 18420, true, true, true,
    'Our best sounding Echo Dot yet. Voice control your music, lights, and more.',
    ['Bigger vibrant sound', 'LED display for time & timers', 'Alexa built-in', 'Privacy controls', 'Smart home hub']),
  p('prod-fire-tv', 'fire-tv-stick-4k', 'Fire TV Stick 4K Max streaming device', 'Amazon', 'cat-electronics', 5999, 6499, 800, 4.6, 9200, true, true, false,
    'Wi-Fi 6E support, free and live TV, Alexa voice remote.',
    ['4K Ultra HD', 'Dolby Vision', 'Alexa Voice Remote', 'App support', 'Gaming support']),
  p('prod-kindle', 'kindle-paperwhite', 'Kindle Paperwhite (16 GB) – Now with a 6.8" display', 'Amazon', 'cat-electronics', 14999, 15999, 450, 4.8, 22100, true, true, true,
    'Adjustable warm light, USB-C, up to 10 weeks battery.',
    ['6.8" glare-free display', 'Adjustable warm light', 'Waterproof IPX8', '16 GB storage', 'Weeks of battery']),
  p('prod-buds', 'sony-wf1000xm5', 'Sony WF-1000XM5 Wireless Noise Canceling Earbuds', 'Sony', 'cat-electronics', 27800, 29999, 210, 4.6, 5400, true, false, true,
    'Industry-leading noise cancellation with exceptional sound quality.',
    ['Best-in-class ANC', '8h battery + case', 'LDAC support', 'IPX4', 'Multipoint Bluetooth']),
  p('prod-watch', 'apple-watch-se', 'Apple Watch SE (2nd Gen) GPS 40mm', 'Apple', 'cat-electronics', 24900, 27900, 180, 4.7, 11200, true, true, false,
    'Crash Detection, heart rate notifications, and fitness tracking.',
    ['Retina display', 'Swimproof', 'Fitness app', 'Crash Detection', 'watchOS']),
  p('prod-cam', 'gopro-hero12', 'GoPro HERO12 Black - Waterproof Action Camera', 'GoPro', 'cat-electronics', 34999, 39999, 95, 4.5, 3100, true, false, false,
    '5.3K video, HyperSmooth 6.0, HDR photo and video.',
    ['5.3K60 video', 'HyperSmooth 6.0', 'Waterproof to 33ft', 'Enduro battery', 'Horizon Lock']),
  p('prod-tablet', 'samsung-tab-s9', 'Samsung Galaxy Tab S9 11" 128GB Wi-Fi', 'Samsung', 'cat-computers', 64999, 79999, 70, 4.6, 1800, true, false, true,
    'Dynamic AMOLED 2X, IP68, includes S Pen.',
    ['Dynamic AMOLED 2X', 'IP68', 'S Pen included', 'Snapdragon 8 Gen 2', 'DeX mode']),
  p('prod-laptop', 'asus-vivobook', 'ASUS VivoBook 16 Laptop 16" Ryzen 7 16GB 512GB', 'ASUS', 'cat-computers', 69999, 84999, 55, 4.4, 920, true, false, false,
    'Everyday performance laptop with expansive 16" display.',
    ['AMD Ryzen 7', '16GB RAM', '512GB SSD', '16" FHD+', 'Windows 11']),
  p('prod-monitor', 'lg-ultragear', 'LG UltraGear 27" QHD 165Hz Gaming Monitor', 'LG', 'cat-computers', 24999, 32999, 140, 4.6, 4300, true, true, false,
    '1ms response, NVIDIA G-SYNC Compatible, HDR10.',
    ['27" QHD', '165Hz', '1ms GtG', 'G-SYNC Compatible', 'HDR10']),
  p('prod-kb', 'logitech-mx-keys', 'Logitech MX Keys Advanced Wireless Illuminated Keyboard', 'Logitech', 'cat-computers', 9999, 11999, 320, 4.7, 8900, true, true, false,
    'Perfect stroke keys, multi-device, smart illumination.',
    ['Multi-device', 'Backlit keys', 'USB-C rechargeable', 'Mac/Windows', 'Quiet typing']),

  // Home
  p('prod-instant-pot', 'instant-pot-duo', 'Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart', 'Instant Pot', 'cat-home', 8999, 11999, 600, 4.7, 145000, true, true, true,
    'Pressure cook, slow cook, rice cooker, steamer, sauté, yogurt, warmer.',
    ['7-in-1 appliance', '6-quart', '11+ one-touch programs', 'Stainless steel pot', 'Safety lid lock']),
  p('prod-dyson', 'dyson-v8', 'Dyson V8 Origin Cordless Vacuum', 'Dyson', 'cat-home', 34999, 42999, 90, 4.5, 7200, true, false, true,
    'Powerful suction, up to 40 minutes runtime, whole-machine filtration.',
    ['Fade-free suction', 'Up to 40 min', 'Cord-free', 'Hygienic bin empty', 'Converts to handheld']),
  p('prod-nespresso', 'nespresso-vertuo', 'Nespresso Vertuo Next Coffee and Espresso Machine', 'Nespresso', 'cat-home', 12999, 15999, 250, 4.4, 15600, true, false, false,
    'Brew coffee and espresso with Centrifusion technology.',
    ['5 cup sizes', 'One-touch brewing', 'Fast heat-up', 'Automatic ejection', 'Energy saving']),
  p('prod-airfryer', 'ninja-air-fryer', 'Ninja AF101 Air Fryer 4-Quart', 'Ninja', 'cat-home', 8999, 11999, 400, 4.7, 62000, true, true, false,
    'Crisp, roast, reheat, dehydrate with little to no oil.',
    ['4-qt capacity', '400F max', 'Dishwasher safe', '4 functions', 'Nonstick basket']),
  p('prod-sheets', 'bamboo-sheets', 'Cooling Bamboo Sheet Set Queen - 4 Piece', 'Bedsure', 'cat-home', 4499, 6999, 900, 4.5, 28000, true, true, false,
    'Breathable bamboo-derived rayon sheets, deep pocket.',
    ['Cooling fabric', 'Queen 4-piece', '16" deep pocket', 'OEKO-TEX', 'Machine washable']),
  p('prod-pillow', 'coop-pillow', 'Coop Home Goods Original Adjustable Loft Pillow Queen', 'Coop', 'cat-home', 7299, 7999, 500, 4.4, 41000, true, true, true,
    'Cross-cut memory foam fill you can adjust for perfect loft.',
    ['Adjustable loft', 'CertiPUR-US foam', 'Machine washable cover', 'Queen size', 'Made in USA options']),

  // Sports
  p('prod-yeti', 'yeti-rambler-30', 'YETI Rambler 30 oz Tumbler with MagSlider Lid', 'YETI', 'cat-sports', 3800, 4000, 1500, 4.8, 52000, true, true, false,
    'Double-wall vacuum insulation keeps drinks cold or hot.',
    ['18/8 stainless', 'No Sweat Design', 'MagSlider lid', 'Dishwasher safe', 'Over-the-nose fit']),
  p('prod-hydro', 'hydroflask-32', 'Hydro Flask Wide Mouth Bottle 32 oz with Flex Cap', 'Hydro Flask', 'cat-sports', 4495, 4995, 1100, 4.7, 34000, true, true, false,
    'TempShield insulation keeps cold 24hrs, hot 12hrs.',
    ['32 oz', 'BPA-free', 'Lifetime-life warranty', 'Wide mouth', 'Color powder coat']),
  p('prod-yoga', 'manduka-mat', 'Manduka PRO Yoga Mat 71" - Black', 'Manduka', 'cat-sports', 12000, 14000, 200, 4.8, 8900, true, false, true,
    'High-density mat with lifetime guarantee, superior grip.',
    ['6mm thickness', 'Closed-cell surface', 'Non-toxic', 'Lifetime guarantee', 'Standard 71"']),
  p('prod-dumbbell', 'bowflex-selecttech', 'Bowflex SelectTech 552 Adjustable Dumbbells (Pair)', 'Bowflex', 'cat-sports', 42900, 54900, 80, 4.6, 21000, true, true, false,
    'Adjust from 5 to 52.5 lb with the turn of a dial.',
    ['5–52.5 lb each', 'Space-saving', '15 weights in one', 'Durable molding', 'Rapid change']),
  p('prod-tent', 'coleman-tent', 'Coleman Sundome Camping Tent 4 Person', 'Coleman', 'cat-sports', 6999, 9999, 340, 4.5, 19000, true, true, false,
    'WeatherTec system, easy setup in about 10 minutes.',
    ['4-person', 'WeatherTec floor', 'Rainfly included', 'Large windows', 'Carry bag']),

  // Books
  p('prod-book-atomic', 'atomic-habits', 'Atomic Habits: An Easy & Proven Way to Build Good Habits', 'Avery', 'cat-books', 1399, 2700, 2000, 4.8, 142000, true, true, true,
    'James Clear’s guide to tiny changes that deliver remarkable results.',
    ['#1 NYT bestseller', 'Practical frameworks', 'Habit stacking', 'Identity-based habits', 'Paperback/hardcover']),
  p('prod-book-psych', 'psychology-of-money', 'The Psychology of Money', 'Harriman House', 'cat-books', 1299, 1899, 1600, 4.7, 78000, true, true, false,
    'Timeless lessons on wealth, greed, and happiness by Morgan Housel.',
    ['19 short stories', 'Behavioral finance', 'Bestseller', 'Easy read', 'Practical wisdom']),
  p('prod-book-dune', 'dune-hardcover', 'Dune (Deluxe Edition Hardcover)', 'Ace', 'cat-books', 2499, 4000, 400, 4.8, 45000, true, false, false,
    'Frank Herbert’s masterpiece in a collectible deluxe edition.',
    ['Deluxe hardcover', 'Sci-fi classic', 'Collectible', 'Epic worldbuilding', 'Movie tie-in interest']),

  // Fashion
  p('prod-hoodie', 'champion-hoodie', 'Champion Men’s Powerblend Fleece Hoodie', 'Champion', 'cat-fashion', 3500, 4500, 900, 4.6, 62000, true, true, false,
    'Midweight fleece hoodie with a soft cotton-blend feel.',
    ['Powerblend fleece', 'Kangaroo pocket', 'Multiple colors', 'Machine wash', 'Classic fit']),
  p('prod-shoes', 'brooks-ghost', 'Brooks Ghost 15 Neutral Running Shoe', 'Brooks', 'cat-fashion', 13995, 14995, 220, 4.7, 18000, true, true, true,
    'Soft cushioning and smooth transitions for daily miles.',
    ['DNA LOFT cushioning', 'Segmented Crash Pad', 'Engineered mesh', 'Men’s & women’s', 'Neutral ride']),
  p('prod-jeans', 'levis-511', 'Levi’s Men’s 511 Slim Fit Jeans', 'Levi\'s', 'cat-fashion', 4980, 6980, 700, 4.5, 34000, true, true, false,
    'A modern slim with room to move — the 511 sits below the waist.',
    ['Slim fit', 'Stretch denim', 'Iconic 5-pocket', 'Multiple washes', 'Everyday style']),
  p('prod-backpack', 'northface-borealis', 'The North Face Borealis Commuter Laptop Backpack', 'The North Face', 'cat-fashion', 9900, 10900, 350, 4.7, 15000, true, false, true,
    'FlexVent suspension, 28L, dedicated 15" laptop sleeve.',
    ['28 liters', 'Laptop sleeve', 'Sternum strap', 'Water-repellent', 'Lifetime warranty*']),

  // Beauty
  p('prod-cerave', 'cerave-moisturizer', 'CeraVe Moisturizing Cream 19 oz', 'CeraVe', 'cat-beauty', 1899, 2499, 1800, 4.8, 98000, true, true, true,
    'Developed with dermatologists, with 3 essential ceramides.',
    ['Ceramide formula', 'Hyaluronic acid', 'Fragrance-free', 'Non-comedogenic', 'FSA eligible']),
  p('prod-oralb', 'oralb-io', 'Oral-B iO Series 5 Electric Toothbrush', 'Oral-B', 'cat-beauty', 9999, 12999, 260, 4.6, 7200, true, false, false,
    'Magnetic iO technology, smart pressure sensor, app guided.',
    ['iO technology', 'Pressure sensor', 'Interactive display', '5 modes', 'Charger included']),
  p('prod-dyson-hair', 'dyson-airwrap', 'Dyson Airwrap Multi-styler Complete Long', 'Dyson', 'cat-beauty', 59999, 59999, 40, 4.4, 5100, true, false, true,
    'Curl, shape, smooth and hide flyaways with no extreme heat.',
    ['Coanda airflow', 'Multiple attachments', 'Intelligent heat control', 'Travel pouch', 'Long barrels']),

  // Toys
  p('prod-lego-star', 'lego-millennium', 'LEGO Star Wars Millennium Falcon 75375', 'LEGO', 'cat-toys', 8499, 9999, 150, 4.8, 4200, true, true, false,
    'Buildable Millennium Falcon with minifigures for display or play.',
    ['Ages 9+', 'Minifigures included', 'Display model', 'Star Wars license', 'Detailed build']),
  p('prod-switch', 'nintendo-switch-oled', 'Nintendo Switch – OLED Model w/ White Joy-Con', 'Nintendo', 'cat-toys', 34999, 34999, 120, 4.8, 28000, true, true, true,
    'Vibrant 7" OLED screen, wide adjustable stand, enhanced audio.',
    ['7" OLED', '64GB storage', 'Dock with wired LAN', 'Enhanced audio', 'White Joy-Con']),
  p('prod-puzzle', 'ravensburger-puzzle', 'Ravensburger Venice Evening 1000 Piece Puzzle', 'Ravensburger', 'cat-toys', 1999, 2499, 500, 4.7, 8900, true, false, false,
    'Softclick technology — pieces fit perfectly together.',
    ['1000 pieces', 'Premium quality', 'Glare-free', 'Made in Europe', 'Great gift']),

  // Grocery
  p('prod-kind', 'kind-bars', 'KIND Bars, Dark Chocolate Nuts & Sea Salt, 12 Count', 'KIND', 'cat-grocery', 1498, 1899, 2000, 4.6, 45000, true, true, false,
    'Gluten free, low sodium, no artificial flavors.',
    ['12 bars', '5g sugar', 'Nuts & spices', 'Gluten free', 'Non-GMO']),
  p('prod-coffee', 'lavazza-super', 'Lavazza Super Crema Whole Bean Coffee 2.2 lb', 'Lavazza', 'cat-grocery', 1899, 2499, 900, 4.7, 38000, true, true, true,
    'Medium espresso roast, creamy and full-bodied.',
    ['2.2 lb bag', 'Arabica/Robusta', 'Espresso roast', 'Aromatic crema', 'Italy’s favorite']),
  p('prod-protein', 'optimum-whey', 'Optimum Nutrition Gold Standard 100% Whey 5 lb', 'Optimum Nutrition', 'cat-grocery', 6499, 7999, 600, 4.7, 92000, true, true, false,
    '24g protein per serving, isolate primary source.',
    ['5 lb tub', '24g protein', 'Whey isolate', 'Multiple flavors', 'Banned substance tested']),

  // Tools
  p('prod-dewalt', 'dewalt-drill', 'DEWALT 20V MAX Cordless Drill/Driver Kit', 'DEWALT', 'cat-tools', 12900, 16900, 400, 4.8, 34000, true, true, true,
    'Compact high-performance drill with battery and charger.',
    ['20V MAX', '2-speed transmission', 'LED light', 'Battery + charger', 'Belt hook']),
  p('prod-laser', 'bosch-laser', 'BOSCH GLL30 30ft Cross-Line Laser Level', 'BOSCH', 'cat-tools', 6900, 9900, 280, 4.6, 12000, true, false, false,
    'Horizontal and vertical lines, VisiMax technology.',
    ['30ft range', 'Self-leveling', 'Flexible mounting', 'Pendulum lock', 'Compact']),
  p('prod-multitool', 'leatherman-wave', 'Leatherman Wave+ Multi-Tool with Nylon Sheath', 'Leatherman', 'cat-tools', 11995, 11995, 300, 4.8, 21000, true, true, false,
    '18 tools including replaceable wire cutters. 25-year warranty.',
    ['18 tools', 'Outside-accessible blades', 'Bit drivers', 'Nylon sheath', 'Made in USA']),

  // Auto
  p('prod-dashcam', 'garmin-dash', 'Garmin Dash Cam Mini 2', 'Garmin', 'cat-auto', 9999, 12999, 400, 4.5, 8900, true, false, false,
    '1080p tiny dash cam with voice control and incident detection.',
    ['1080p', 'Voice control', 'Incident detection', 'Wi-Fi sync', 'Discrete design']),
  p('prod-charger', 'anker-car', 'Anker 335 Car Charger 67W (2-Port)', 'Anker', 'cat-auto', 2499, 3299, 1500, 4.7, 16000, true, true, false,
    'USB-C Power Delivery for phones, tablets, and laptops on the road.',
    ['67W total', 'USB-C + USB-A', 'Compact', 'MultiProtect safety', 'Fast charge']),
  p('prod-wiper', 'bosch-wiper', 'Bosch ICON Wiper Blade 24A (Pack of 1)', 'Bosch', 'cat-auto', 2497, 2999, 2000, 4.6, 54000, true, true, false,
    'Asymmetrical wind spoiler, soft rubber compound for quiet wipe.',
    ['24 inch', 'OE quality', 'Quiet wipe', 'Easy install', 'All-season']),

  // Pet
  p('prod-dogfood', 'blue-buffalo', 'Blue Buffalo Life Protection Formula Adult Dog Food 30 lb', 'Blue Buffalo', 'cat-pet', 5499, 6499, 400, 4.7, 28000, true, true, false,
    'Real chicken first ingredient, no chicken/poultry by-product meals.',
    ['30 lb bag', 'Real chicken', 'LifeSource Bits', 'No corn/wheat/soy', 'Adult dogs']),
  p('prod-litter', 'prettylitter', 'PrettyLitter Health Monitoring Cat Litter 8 lb (1 month)', 'PrettyLitter', 'cat-pet', 2499, 2499, 800, 4.3, 19000, true, false, false,
    'Color-changing silica litter that can indicate health issues.',
    ['8 lb bag', 'Color-changing', 'Low tracking', 'Odor control', '1 month supply']),
  p('prod-bed', 'petbed-orthopedic', 'Orthopedic Dog Bed Waterproof Washable Cover Large', 'PetFusion', 'cat-pet', 5999, 7999, 350, 4.6, 11000, true, true, false,
    'CertiPUR-US foam, waterproof liner, machine-washable cover.',
    ['Large size', 'Orthopedic foam', 'Waterproof liner', 'Washable cover', 'Non-slip bottom']),
];

function p(id, sku, title, brand, categoryId, price, list, stock, rating, reviews, prime, best, choice, desc, bullets) {
  return {
    id, sku, title, brand, categoryId,
    price_cents: price,
    list_price_cents: list,
    stock,
    rating_avg: rating,
    rating_count: reviews,
    is_prime: prime ? 1 : 0,
    is_bestseller: best ? 1 : 0,
    is_amazon_choice: choice ? 1 : 0,
    description: desc,
    bullets: bullets || [],
  };
}

const insertCat = db.prepare(`
  INSERT INTO categories (id, name, slug, parent_id, sort_order)
  VALUES (@id, @name, @slug, @parent_id, @sort_order)
`);

const insertProd = db.prepare(`
  INSERT INTO products (
    id, sku, title, brand, description,
    bullet_1, bullet_2, bullet_3, bullet_4, bullet_5,
    category_id, price_cents, list_price_cents, stock,
    rating_avg, rating_count, image_url, image_url_2, image_url_3,
    is_prime, is_bestseller, is_amazon_choice
  ) VALUES (
    @id, @sku, @title, @brand, @description,
    @b1, @b2, @b3, @b4, @b5,
    @category_id, @price_cents, @list_price_cents, @stock,
    @rating_avg, @rating_count, @image_url, @image_url_2, @image_url_3,
    @is_prime, @is_bestseller, @is_amazon_choice
  )
`);

const insertUser = db.prepare(`
  INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)
`);

const insertReview = db.prepare(`
  INSERT INTO reviews (id, product_id, user_id, rating, title, body, verified, helpful)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?)
`);

const insertAddr = db.prepare(`
  INSERT INTO addresses (id, user_id, label, full_name, line1, city, state, postal_code, country, phone, is_default)
  VALUES (?, ?, 'Home', ?, ?, ?, ?, ?, 'US', ?, 1)
`);

const seed = db.transaction(() => {
  for (const c of categories) {
    insertCat.run({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parent_id: c.parent,
      sort_order: c.sort,
    });
  }

  for (const prod of products) {
    const b = prod.bullets;
    insertProd.run({
      id: prod.id,
      sku: prod.sku,
      title: prod.title,
      brand: prod.brand,
      description: prod.description,
      b1: b[0] || null,
      b2: b[1] || null,
      b3: b[2] || null,
      b4: b[3] || null,
      b5: b[4] || null,
      category_id: prod.categoryId,
      price_cents: prod.price_cents,
      list_price_cents: prod.list_price_cents,
      stock: prod.stock,
      rating_avg: prod.rating_avg,
      rating_count: prod.rating_count,
      image_url: img(prod.sku, 800, 800),
      image_url_2: img(prod.sku + '-b', 800, 800),
      image_url_3: img(prod.sku + '-c', 800, 800),
      is_prime: prod.is_prime,
      is_bestseller: prod.is_bestseller,
      is_amazon_choice: prod.is_amazon_choice,
    });
  }

  const demoId = 'user-demo';
  const hash = bcrypt.hashSync('password123', 10);
  insertUser.run(demoId, 'demo@trove.shop', hash, 'Alex Rivera');
  insertAddr.run(
    uuid(),
    demoId,
    'Alex Rivera',
    '410 Terry Ave N',
    'Seattle',
    'WA',
    '98109',
    '206-555-0100'
  );

  // Extra review accounts
  const reviewers = [];
  for (let i = 1; i <= 8; i++) {
    const id = `user-rev-${i}`;
    insertUser.run(id, `reviewer${i}@example.com`, hash, `Customer ${i}`);
    reviewers.push(id);
  }

  const reviewSnippets = [
    [5, 'Exactly as described', 'Arrived fast and works perfectly. Would buy again.'],
    [5, 'Great value', 'Quality feels premium for the price. Highly recommend.'],
    [4, 'Solid purchase', 'Minor packaging issue but product itself is excellent.'],
    [5, 'Daily driver', 'I use this every day. Build quality is impressive.'],
    [3, 'It’s fine', 'Does the job. Not mind-blowing but acceptable.'],
    [4, 'Happy overall', 'Took a day to get used to, now I love it.'],
    [5, 'Gift hit', 'Bought as a gift — they were thrilled.'],
    [2, 'Mixed feelings', 'Works, but customer expectations might be higher.'],
  ];

  let r = 0;
  for (const prod of products) {
    const n = 2 + (r % 3);
    for (let j = 0; j < n; j++) {
      const sn = reviewSnippets[(r + j) % reviewSnippets.length];
      insertReview.run(
        uuid(),
        prod.id,
        reviewers[(r + j) % reviewers.length],
        sn[0],
        sn[1],
        sn[2],
        5 + ((r + j) % 40)
      );
    }
    r++;
  }
});

seed();
console.log(
  `Seeded ${categories.length} categories, ${products.length} products, demo user demo@trove.shop / password123`
);
console.log('DB ready.');
module.exports = { seeded: true };

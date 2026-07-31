/**
 * Product catalog for Harbor & Helm maritime shop.
 * Categories and product tokens are stable so behavior sequences
 * can later be used to train the visitor transformer.
 */
const products = [
  {
    id: 'compass-brass',
    slug: 'brass-marine-compass',
    name: 'Brass Marine Compass',
    category: 'navigation',
    price: 89.0,
    stock: 24,
    badge: 'Bestseller',
    description:
      'Hand-finished brass compass with liquid-damped dial. Built for coastal cruising and coastal chart work.',
    details: [
      'Liquid-damped card, 70mm dial',
      'Brass housing with leather pouch',
      'Works in true and magnetic bearings',
    ],
    image: '🧭',
  },
  {
    id: 'sextant-pro',
    slug: 'sextant-pro',
    name: 'Sextant Pro',
    category: 'navigation',
    price: 249.0,
    stock: 8,
    badge: 'Pro',
    description:
      'Precision metal sextant for celestial navigation practice and offshore training.',
    details: [
      'Aluminum frame, arc to 1′',
      'Telescope and filters included',
      'Hard carry case',
    ],
    image: '🔭',
  },
  {
    id: 'logbook-v2',
    slug: 'ship-logbook-v2',
    name: 'Ship Logbook V2',
    category: 'charts',
    price: 28.0,
    stock: 60,
    badge: null,
    description:
      'Waterproof-cover deck log with weather, engine hours, and crew notes pages.',
    details: [
      '200 pages, A5',
      'Spill-resistant cover',
      'Lay-flat binding',
    ],
    image: '📘',
  },
  {
    id: 'chart-plotter-kit',
    slug: 'coastal-chart-kit',
    name: 'Coastal Chart Kit',
    category: 'charts',
    price: 54.0,
    stock: 35,
    badge: null,
    description:
      'Paper coastal charts set with parallel rulers and dividers for passage planning.',
    details: [
      '3 coastal sheets (region pack)',
      'Brass dividers + parallel rule',
      'Pencil & eraser set',
    ],
    image: '🗺️',
  },
  {
    id: 'binoculars-7x50',
    slug: 'marine-binoculars-7x50',
    name: 'Marine Binoculars 7×50',
    category: 'safety',
    price: 179.0,
    stock: 18,
    badge: 'Waterproof',
    description:
      'Fog-proof marine binoculars with compass reticle for buoy and landfall spotting.',
    details: [
      '7×50, nitrogen purged',
      'Floating strap',
      'Built-in bearing compass',
    ],
    image: '🔎',
  },
  {
    id: 'life-vest-iso',
    slug: 'iso-life-vest',
    name: 'ISO 150N Life Vest',
    category: 'safety',
    price: 119.0,
    stock: 40,
    badge: 'Safety',
    description:
      'Automatic inflatable PFD rated 150N. Ideal for coastal and offshore crew.',
    details: [
      'ISO 12402-3',
      'Automatic + manual inflate',
      'Harness loops',
    ],
    image: '🦺',
  },
  {
    id: 'anchor-light-led',
    slug: 'led-anchor-light',
    name: 'LED Anchor Light',
    category: 'deck',
    price: 42.0,
    stock: 50,
    badge: null,
    description:
      'Low-draw LED anchor light with 2 NM visibility for overnight mooring.',
    details: [
      '2 NM all-round white',
      '12V DC, <0.2A',
      'Masthead mount hardware',
    ],
    image: '💡',
  },
  {
    id: 'rope-dyneema-10',
    slug: 'dyneema-halyard-10mm',
    name: 'Dyneema Halyard 10mm',
    category: 'deck',
    price: 96.0,
    stock: 22,
    badge: 'New',
    description:
      'Low-stretch Dyneema core halyard, sold by 30m coil for main or genoa.',
    details: [
      '10mm × 30m coil',
      'Cover: polyester',
      'Breaking load ~4500 kg',
    ],
    image: '🪢',
  },
  {
    id: 'foul-weather-jacket',
    slug: 'offshore-jacket',
    name: 'Offshore Foul-Weather Jacket',
    category: 'apparel',
    price: 289.0,
    stock: 14,
    badge: 'Premium',
    description:
      'Fully taped offshore jacket with high collar and fleece-lined handwarmers.',
    details: [
      'Waterproof / breathable shell',
      'Hi-vis hood',
      'Sizes S–XXL',
    ],
    image: '🧥',
  },
  {
    id: 'deck-shoes',
    slug: 'non-slip-deck-shoes',
    name: 'Non-Slip Deck Shoes',
    category: 'apparel',
    price: 78.0,
    stock: 30,
    badge: null,
    description:
      'Siping sole deck shoes that grip wet teak without marking the deck.',
    details: [
      'Quick-dry upper',
      'Razor-cut sole',
      'Unisex sizing',
    ],
    image: '👟',
  },
  {
    id: 'handheld-vhf',
    slug: 'handheld-vhf-radio',
    name: 'Handheld VHF Radio',
    category: 'electronics',
    price: 134.0,
    stock: 16,
    badge: 'DSC',
    description:
      'Submersible handheld VHF with DSC distress and rechargeable pack.',
    details: [
      'IPX7, floating',
      'DSC + GPS option',
      '12h battery life',
    ],
    image: '📻',
  },
  {
    id: 'fishfinder-portable',
    slug: 'portable-fishfinder',
    name: 'Portable Fishfinder',
    category: 'electronics',
    price: 159.0,
    stock: 12,
    badge: null,
    description:
      'Castable wireless sonar for dinghy, kayak, and shallow anchorage scouting.',
    details: [
      'Phone app display',
      '40m depth range',
      'USB rechargeable',
    ],
    image: '📡',
  },
];

const categories = [
  { id: 'all', name: 'All gear' },
  { id: 'navigation', name: 'Navigation' },
  { id: 'charts', name: 'Charts & logs' },
  { id: 'safety', name: 'Safety' },
  { id: 'deck', name: 'Deck hardware' },
  { id: 'apparel', name: 'Apparel' },
  { id: 'electronics', name: 'Electronics' },
];

function getAll() {
  return products;
}

function getById(id) {
  return products.find((p) => p.id === id || p.slug === id) || null;
}

function getByCategory(category) {
  if (!category || category === 'all') return products;
  return products.filter((p) => p.category === category);
}

module.exports = { products, categories, getAll, getById, getByCategory };

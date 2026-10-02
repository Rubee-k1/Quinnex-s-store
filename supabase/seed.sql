-- Sample catalogue for local development / first deploy.
-- Safe to re-run: rows are matched on slug and updated in place.
insert into public.categories (slug, name, description, sort_order) values
  ('apparel', 'Apparel', 'Everyday clothing made from natural fibres.', 1),
  ('accessories', 'Accessories', 'Bags, wallets and small leather goods.', 2),
  ('home', 'Home', 'Objects for a calm, well-made home.', 3)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

insert into public.products (slug, name, description, category_id, price_cents, currency, image_url, stock, is_active)
select v.slug, v.name, v.description, c.id, v.price_cents, 'USD', v.image_url, v.stock, true
from (values
  ('classic-white-tee', 'Classic White Tee',
   'Heavyweight 100% organic cotton tee with a relaxed fit. Pre-shrunk and garment dyed.',
   'apparel', 2800, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=1200&q=80', 50),
  ('everyday-denim-jacket', 'Everyday Denim Jacket',
   'A timeless mid-wash denim jacket with copper buttons and two chest pockets.',
   'apparel', 8900, 'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?w=1200&q=80', 20),
  ('canvas-tote-bag', 'Canvas Tote Bag',
   'Sturdy 16oz canvas tote with an interior pocket. Fits a 15" laptop.',
   'accessories', 3200, 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=1200&q=80', 75),
  ('leather-card-wallet', 'Leather Card Wallet',
   'Slim full-grain leather wallet with four card slots and a centre pocket.',
   'accessories', 4500, 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=1200&q=80', 40),
  ('wool-beanie', 'Merino Wool Beanie',
   'Fine-knit merino beanie. Warm, breathable and itch-free.',
   'accessories', 2400, 'https://images.unsplash.com/photo-1576871337622-98d48d1cf531?w=1200&q=80', 60),
  ('ceramic-pour-over-set', 'Ceramic Pour-Over Set',
   'Hand-glazed ceramic dripper and carafe. Brews up to four cups.',
   'home', 5600, 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80', 3),
  ('linen-throw-blanket', 'Linen Throw Blanket',
   'Stonewashed European linen throw, 130 x 170 cm. Softens with every wash.',
   'home', 7400, 'https://images.unsplash.com/photo-1580301762395-21ce84d00bc6?w=1200&q=80', 0),
  ('minimal-desk-lamp', 'Minimal Desk Lamp',
   'Aluminium LED desk lamp with three colour temperatures and a dimmer.',
   'home', 6900, 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=1200&q=80', 25)
) as v(slug, name, description, category_slug, price_cents, image_url, stock)
join public.categories c on c.slug = v.category_slug
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  category_id = excluded.category_id,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  image_url = excluded.image_url,
  stock = excluded.stock,
  is_active = excluded.is_active;

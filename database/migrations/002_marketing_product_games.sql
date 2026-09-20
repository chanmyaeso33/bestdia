-- Allow the product catalog to store the games supported by Marketing OS.
-- The server has a backward-compatible fallback for deployments where this
-- migration has not yet been executed.

alter table public.products
  drop constraint if exists products_game_check;

alter table public.products
  add constraint products_game_check
  check (game in (
    'mlbb',
    'pubg',
    'hok',
    'free-fire',
    'genshin-impact',
    'magic-chess-go-go',
    'other'
  ));

-- Upgrade the temporary fallback seed rows when they already exist.
update public.products
set game = case name
  when 'Honor of Kings Tokens' then 'hok'
  when 'Free Fire Diamonds' then 'free-fire'
  when 'Genshin Impact Genesis Crystals' then 'genshin-impact'
  when 'Magic Chess: Go Go Diamonds' then 'magic-chess-go-go'
  else game
end
where name in (
  'Honor of Kings Tokens',
  'Free Fire Diamonds',
  'Genshin Impact Genesis Crystals',
  'Magic Chess: Go Go Diamonds'
);

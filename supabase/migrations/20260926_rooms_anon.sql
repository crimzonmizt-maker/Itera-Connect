-- Hosted Supabase grants the anon role privileges on every new table by default. ic_rooms was
-- created after the foundation migration's blanket revoke, so anon kept SELECT on it. Row-level
-- security already returned nothing (the read policy is for authenticated only); this removes
-- the grant as well, so an anonymous read is refused outright like every other ic_ table.
revoke all on public.ic_rooms from anon;

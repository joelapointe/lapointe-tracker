-- =====================================================================
-- ÉTAPE 2 — INVENTAIRE DU SCHÉMA SUPABASE (LECTURE SEULE)
-- Ne modifie rien. Ne lit aucune donnée réelle : seulement la structure
-- (tables, colonnes, règles, déclencheurs, fonctions) et le nombre de lignes.
-- Où l'exécuter : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

select 'tables' as section,
  coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname,
    'rls_active', c.relrowsecurity,
    'rls_forcee', c.relforcerowsecurity,
    'nb_lignes', (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::int,
    'colonnes', (
      select jsonb_agg(jsonb_build_object(
        'nom', a.attname,
        'type', format_type(a.atttypid, a.atttypmod),
        'obligatoire', a.attnotnull,
        'defaut', pg_get_expr(d.adbin, d.adrelid)
      ) order by a.attnum)
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    )
  ) order by c.relname), '[]'::jsonb) as contenu
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')

union all
select 'contraintes', coalesce(jsonb_agg(jsonb_build_object(
    'table', conrelid::regclass::text,
    'nom', conname,
    'type', contype::text,
    'definition', pg_get_constraintdef(oid)
  ) order by conrelid::regclass::text, conname), '[]'::jsonb)
from pg_constraint
where connamespace = 'public'::regnamespace and conrelid <> 0::oid

union all
select 'politiques_rls', coalesce(jsonb_agg(jsonb_build_object(
    'table', tablename,
    'nom', policyname,
    'permissive', permissive,
    'commande', cmd,
    'roles', roles,
    'using', qual,
    'with_check', with_check
  ) order by tablename, policyname), '[]'::jsonb)
from pg_policies
where schemaname = 'public'

union all
select 'declencheurs', coalesce(jsonb_agg(jsonb_build_object(
    'table', tgrelid::regclass::text,
    'nom', tgname,
    'definition', pg_get_triggerdef(oid)
  ) order by tgrelid::regclass::text, tgname), '[]'::jsonb)
from pg_trigger
where not tgisinternal
  and (tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
       or tgrelid = 'auth.users'::regclass)

union all
select 'fonctions_public', coalesce(jsonb_agg(jsonb_build_object(
    'nom', p.proname,
    'arguments', pg_get_function_arguments(p.oid),
    'security_definer', p.prosecdef
  ) order by p.proname), '[]'::jsonb)
from pg_proc p
where p.pronamespace = 'public'::regnamespace

union all
select 'temps_reel', coalesce(jsonb_agg(jsonb_build_object(
    'schema', schemaname,
    'table', tablename
  ) order by schemaname, tablename), '[]'::jsonb)
from pg_publication_tables
where pubname = 'supabase_realtime'

union all
select 'index', coalesce(jsonb_agg(jsonb_build_object(
    'table', tablename,
    'definition', indexdef
  ) order by tablename, indexname), '[]'::jsonb)
from pg_indexes
where schemaname = 'public'

union all
select 'extensions', coalesce(jsonb_agg(jsonb_build_object(
    'nom', extname,
    'version', extversion
  ) order by extname), '[]'::jsonb)
from pg_extension

union all
select 'droits_anon_et_authenticated', coalesce(jsonb_agg(to_jsonb(g) order by g.table_name, g.grantee), '[]'::jsonb)
from (
  select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as droits
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
  group by table_name, grantee
) g

union all
select 'comptes_auth_existants', to_jsonb((select count(*) from auth.users))

union all
select 'version_postgres', to_jsonb(version());
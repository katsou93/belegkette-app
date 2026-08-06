-- Belegkette — Datenbankschema
-- Grundsätze:
--   1. Mandantentrennung wird von der Datenbank erzwungen (RLS), nicht vom Anwendungscode.
--   2. Vermerke sind Beweismittel: nach dem Anlegen inhaltlich unveränderlich.
--   3. Jede Änderung am Status wird protokolliert.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- Betriebe und Mitgliedschaften
-- ---------------------------------------------------------------
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table memberships (
  user_id   uuid not null references auth.users on delete cascade,
  org_id    uuid not null references orgs on delete cascade,
  role      text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);
create index on memberships (org_id);

-- Hilfsfunktion: Betriebe des angemeldeten Nutzers.
-- security definer + stabiler search_path, damit RLS sich nicht selbst aufruft.
create or replace function auth_org_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$ select org_id from memberships where user_id = auth.uid() $$;

-- ---------------------------------------------------------------
-- Projekte
-- ---------------------------------------------------------------
create table projects (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs on delete cascade,
  name           text not null,
  contract_value numeric(14,2),
  -- Token für die Weiterleitungsadresse: p-<token>@in.belegkette.de
  inbound_token  text not null unique default encode(gen_random_bytes(9),'hex'),
  status         text not null default 'aktiv' check (status in ('aktiv','archiviert')),
  created_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create index on projects (org_id, status);

-- ---------------------------------------------------------------
-- Vermerke — der Kern. Inhaltlich unveränderlich.
-- ---------------------------------------------------------------
create table entries (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects on delete cascade,
  seq            integer not null,                    -- lückenlose Nummer je Projekt
  occurred_on    date not null,                       -- Datum des Vorgangs
  source         text not null,                       -- Mail, Protokoll, Telefonat …
  source_meta    jsonb not null default '{}'::jsonb,  -- Absender, Betreff, Message-ID
  raw_text       text not null,                       -- Original, unverändert

  title          text not null,
  facts          text not null,
  quote          text not null,
  affected_scope text,
  change_type    text,
  deviation      text not null check (deviation in ('ja','unklar','nein')),
  reasoning      text,
  open_questions jsonb not null default '[]'::jsonb,
  suggestion     text,

  -- veränderbar (Arbeitsstand), Änderungen werden protokolliert
  status         text not null default 'offen' check (status in ('offen','angezeigt','erledigt','verworfen')),
  note           text,

  model          text,
  created_by     uuid references auth.users,
  created_at     timestamptz not null default now(),
  unique (project_id, seq)
);
create index on entries (project_id, seq desc);
create index on entries (project_id, deviation);

-- Lückenlose Nummerierung je Projekt, race-condition-sicher
create or replace function set_entry_seq() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  select coalesce(max(seq),0)+1 into new.seq from entries where project_id = new.project_id;
  return new;
end $$;
create trigger trg_entry_seq before insert on entries
  for each row when (new.seq is null) execute function set_entry_seq();

-- Unveränderlichkeit: Beweisinhalte dürfen nach dem Anlegen nicht mehr geändert werden
create or replace function entries_immutable() returns trigger
language plpgsql as $$
begin
  if new.seq is distinct from old.seq
     or new.project_id is distinct from old.project_id
     or new.occurred_on is distinct from old.occurred_on
     or new.raw_text is distinct from old.raw_text
     or new.title is distinct from old.title
     or new.facts is distinct from old.facts
     or new.quote is distinct from old.quote
     or new.deviation is distinct from old.deviation
     or new.created_at is distinct from old.created_at then
    raise exception 'Vermerkinhalte sind unveraenderlich. Nur status und note duerfen geaendert werden.';
  end if;
  return new;
end $$;
create trigger trg_entries_immutable before update on entries
  for each row execute function entries_immutable();

-- Löschen verboten: Vermerke werden verworfen, nicht entfernt
create or replace function entries_no_delete() returns trigger
language plpgsql as $$
begin raise exception 'Vermerke koennen nicht geloescht werden. Status auf verworfen setzen.'; end $$;
create trigger trg_entries_no_delete before delete on entries
  for each row execute function entries_no_delete();

-- ---------------------------------------------------------------
-- Änderungsprotokoll
-- ---------------------------------------------------------------
create table entry_events (
  id         bigserial primary key,
  entry_id   uuid not null references entries on delete cascade,
  actor      uuid references auth.users,
  action     text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on entry_events (entry_id, created_at);

create or replace function log_entry_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into entry_events(entry_id, actor, action, payload)
      values (new.id, new.created_by, 'angelegt', jsonb_build_object('seq',new.seq,'deviation',new.deviation));
  elsif new.status is distinct from old.status then
    insert into entry_events(entry_id, actor, action, payload)
      values (new.id, auth.uid(), 'status', jsonb_build_object('von',old.status,'nach',new.status));
  end if;
  return new;
end $$;
create trigger trg_entry_log after insert or update on entries
  for each row execute function log_entry_change();

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
alter table orgs         enable row level security;
alter table memberships  enable row level security;
alter table projects     enable row level security;
alter table entries      enable row level security;
alter table entry_events enable row level security;

create policy org_read    on orgs        for select using (id in (select auth_org_ids()));
create policy mem_read    on memberships for select using (org_id in (select auth_org_ids()));

create policy proj_read   on projects for select using (org_id in (select auth_org_ids()));
create policy proj_write  on projects for insert with check (org_id in (select auth_org_ids()));
create policy proj_update on projects for update using (org_id in (select auth_org_ids()));

create policy entry_read on entries for select
  using (project_id in (select id from projects where org_id in (select auth_org_ids())));
create policy entry_write on entries for insert
  with check (project_id in (select id from projects where org_id in (select auth_org_ids())));
create policy entry_update on entries for update
  using (project_id in (select id from projects where org_id in (select auth_org_ids())));

create policy event_read on entry_events for select
  using (entry_id in (select e.id from entries e join projects p on p.id = e.project_id
                      where p.org_id in (select auth_org_ids())));

-- Der Service-Role-Schlüssel (nur serverseitig) umgeht RLS und schreibt
-- die per E-Mail eingehenden Vorgänge.

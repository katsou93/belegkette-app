-- Beim ersten Login automatisch einen Betrieb anlegen und den Nutzer zuordnen.
-- Ohne das hätte ein neuer Nutzer keinen org_id und könnte kein Projekt anlegen.

create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare neue_org uuid;
begin
  insert into orgs (name)
    values (coalesce(split_part(new.email, '@', 2), 'Mein Betrieb'))
    returning id into neue_org;
  insert into memberships (user_id, org_id, role) values (new.id, neue_org, 'owner');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

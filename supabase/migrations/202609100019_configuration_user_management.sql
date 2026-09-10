-- Permite que administradores da organização gerenciem configurações e membros.

-- Configurações da organização: superadmin global e admins da organização podem editar.
drop policy if exists "superadmin updates organizations" on public.organizations;
drop policy if exists "admins update organizations" on public.organizations;
create policy "admins update organizations" on public.organizations
for update
using (
  public.is_superadmin()
  or public.member_role(id) in ('superadmin','admin')
)
with check (
  public.is_superadmin()
  or public.member_role(id) in ('superadmin','admin')
);

create or replace function public.list_org_members(target_org uuid)
returns table (
  user_id uuid,
  email text,
  full_name text,
  role public.app_role,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select om.user_id,
         u.email::text,
         p.full_name,
         om.role,
         om.created_at
  from public.organization_members om
  join auth.users u on u.id = om.user_id
  left join public.profiles p on p.id = om.user_id
  where om.organization_id = target_org
    and (
      public.is_superadmin()
      or public.member_role(target_org) in ('superadmin','admin')
    )
  order by case om.role when 'superadmin' then 0 when 'admin' then 1 when 'manager' then 2 else 3 end,
           coalesce(p.full_name, u.email);
$$;

create or replace function public.add_org_member_by_email(
  target_org uuid,
  target_email text,
  target_role public.app_role default 'operator'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_user uuid;
  caller_role public.app_role;
begin
  caller_role := public.member_role(target_org);
  if not public.is_superadmin() and caller_role not in ('superadmin','admin') then
    raise exception 'Sem permissão para gerenciar usuários.';
  end if;
  if target_role = 'superadmin' and not public.is_superadmin() then
    raise exception 'Somente o superadministrador pode conceder o perfil superadmin.';
  end if;

  select id into target_user
  from auth.users
  where lower(email) = lower(trim(target_email))
  limit 1;
  if target_user is null then
    raise exception 'Usuário não encontrado no Supabase Auth. Cadastre o usuário primeiro.';
  end if;

  insert into public.organization_members(organization_id,user_id,role)
  values(target_org,target_user,target_role)
  on conflict(organization_id,user_id) do update set role = excluded.role;

  return target_user;
end;
$$;

create or replace function public.update_org_member_role(
  target_org uuid,
  target_user uuid,
  target_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.app_role;
begin
  caller_role := public.member_role(target_org);
  if not public.is_superadmin() and caller_role not in ('superadmin','admin') then
    raise exception 'Sem permissão para gerenciar usuários.';
  end if;
  if target_role = 'superadmin' and not public.is_superadmin() then
    raise exception 'Somente o superadministrador pode conceder o perfil superadmin.';
  end if;
  if target_user = auth.uid() and not public.is_superadmin() then
    raise exception 'Você não pode alterar o seu próprio perfil administrativo.';
  end if;

  update public.organization_members
     set role = target_role
   where organization_id = target_org and user_id = target_user;
  if not found then raise exception 'Usuário não pertence a esta organização.'; end if;
end;
$$;

create or replace function public.remove_org_member(
  target_org uuid,
  target_user uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.app_role;
  removing_role public.app_role;
begin
  caller_role := public.member_role(target_org);
  if not public.is_superadmin() and caller_role not in ('superadmin','admin') then
    raise exception 'Sem permissão para gerenciar usuários.';
  end if;
  if target_user = auth.uid() and not public.is_superadmin() then
    raise exception 'Você não pode remover o seu próprio acesso administrativo.';
  end if;
  select role into removing_role from public.organization_members
   where organization_id = target_org and user_id = target_user;
  if removing_role = 'superadmin' and not public.is_superadmin() then
    raise exception 'Somente o superadministrador pode remover outro superadmin.';
  end if;

  delete from public.organization_members
   where organization_id = target_org and user_id = target_user;
end;
$$;

grant execute on function public.list_org_members(uuid) to authenticated;
grant execute on function public.add_org_member_by_email(uuid,text,public.app_role) to authenticated;
grant execute on function public.update_org_member_role(uuid,uuid,public.app_role) to authenticated;
grant execute on function public.remove_org_member(uuid,uuid) to authenticated;

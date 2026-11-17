create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid not null,
  full_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade,
  constraint profiles_full_name_check check (char_length(btrim(full_name)) between 1 and 120)
);

do $preflight_profiles$
declare
  expected_column record;
  actual_type text;
  actual_nullable text;
  constraint_spec record;
  actual_kind "char";
  actual_definition text;
  actual_valid boolean;
  expected_definition text;
  probe_table text;
  equivalent_index_name text;
  equivalent_index_oid oid;
  equivalent_index_constraint text;
begin
  for expected_column in
    select * from (values
      ('id', 'uuid', 'NO'),
      ('full_name', 'text', 'NO'),
      ('email', 'text', 'NO'),
      ('created_at', 'timestamp with time zone', 'NO'),
      ('updated_at', 'timestamp with time zone', 'NO')
    ) as expected(column_name, data_type, is_nullable)
  loop
    select column_info.data_type, column_info.is_nullable
    into actual_type, actual_nullable
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'profiles'
      and column_info.column_name = expected_column.column_name;

    if not found then
      raise exception 'public.profiles is missing required column %', expected_column.column_name;
    end if;
    if actual_type is distinct from expected_column.data_type
      or actual_nullable is distinct from expected_column.is_nullable then
      raise exception 'public.profiles column % is incompatible: expected % nullable %, found % nullable %',
        expected_column.column_name, expected_column.data_type, expected_column.is_nullable,
        actual_type, actual_nullable;
    end if;
  end loop;

  probe_table := '_account_profiles_constraint_probe_' || replace(gen_random_uuid()::text, '-', '');
  execute format('CREATE TEMP TABLE IF NOT EXISTS %I (LIKE public.profiles) ON COMMIT DROP', probe_table);

  for constraint_spec in
    select * from (values
      ('profiles_pkey', 'p', null::text, 'PRIMARY KEY (id)', array['id']::text[]),
      ('profiles_id_fkey', 'f', 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE',
        'FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE', null::text[]),
      ('profiles_full_name_check', 'c', null::text,
        'CHECK (char_length(btrim(full_name)) between 1 and 120)', null::text[])
    ) as expected(name, kind, definition, add_definition, key_columns)
  loop
    if constraint_spec.kind = 'f' then
      expected_definition := constraint_spec.definition;
    else
      execute format(
        'ALTER TABLE pg_temp.%I ADD CONSTRAINT %I %s',
        probe_table,
        'expected_account_constraint',
        constraint_spec.add_definition
      );
      select pg_get_constraintdef(constraint_info.oid)
      into expected_definition
      from pg_constraint as constraint_info
      where constraint_info.conrelid = to_regclass(format('pg_temp.%I', probe_table))
        and constraint_info.conname = 'expected_account_constraint';
      execute format(
        'ALTER TABLE pg_temp.%I DROP CONSTRAINT %I',
        probe_table,
        'expected_account_constraint'
      );
    end if;

    select constraint_info.contype, pg_get_constraintdef(constraint_info.oid), constraint_info.convalidated
    into actual_kind, actual_definition, actual_valid
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.profiles'::regclass
      and constraint_info.conname = constraint_spec.name;

    if found then
      if not actual_valid
        or actual_kind::text is distinct from constraint_spec.kind
        or regexp_replace(lower(actual_definition), '[[:space:]"]', '', 'g')
          is distinct from regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g') then
        raise exception 'public.profiles has conflicting constraint %: found %',
          constraint_spec.name, actual_definition;
      end if;
      continue;
    end if;

    if exists (
      select 1
      from pg_constraint as constraint_info
      where constraint_info.conrelid = 'public.profiles'::regclass
        and constraint_info.convalidated
        and constraint_info.contype::text = constraint_spec.kind
        and regexp_replace(lower(pg_get_constraintdef(constraint_info.oid)), '[[:space:]"]', '', 'g')
          = regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g')
    ) then
      continue;
    end if;

    equivalent_index_name := null;
    equivalent_index_oid := null;
    if constraint_spec.kind in ('p', 'u') and constraint_spec.key_columns is not null then
      select index_relation.relname, index_info.indexrelid
      into equivalent_index_name, equivalent_index_oid
      from pg_index as index_info
      join pg_class as index_relation on index_relation.oid = index_info.indexrelid
      join pg_am as access_method on access_method.oid = index_relation.relam
      where index_info.indrelid = 'public.profiles'::regclass
        and access_method.amname = 'btree'
        and index_info.indisunique
        and index_info.indisvalid
        and index_info.indpred is null
        and index_info.indexprs is null
        and array(
          select attribute.attname::text
          from unnest(index_info.indkey) with ordinality as index_key(attnum, ordinal)
          join pg_attribute as attribute
            on attribute.attrelid = index_info.indrelid
            and attribute.attnum = index_key.attnum
          where index_key.ordinal <= index_info.indnkeyatts
          order by attribute.attname::text
        ) = array(
          select expected_key.column_name
          from unnest(constraint_spec.key_columns) as expected_key(column_name)
          order by expected_key.column_name
        )
      order by exists (
        select 1 from pg_constraint as existing_constraint
        where existing_constraint.conindid = index_info.indexrelid
      ), index_info.indexrelid
      limit 1;
    end if;

    if equivalent_index_oid is not null then
      if constraint_spec.kind = 'p' then
        select constraint_info.conname
        into equivalent_index_constraint
        from pg_constraint as constraint_info
        where constraint_info.conindid = equivalent_index_oid;
        if found then
          raise exception 'public.profiles equivalent unique index % is already owned by constraint %',
            equivalent_index_name, equivalent_index_constraint;
        end if;
        execute format(
          'ALTER TABLE public.profiles ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
          constraint_spec.name,
          equivalent_index_name
        );
      end if;
      continue;
    end if;

    if constraint_spec.kind in ('p', 'u') and exists (
      select 1
      from pg_class as relation
      join pg_namespace as schema_info on schema_info.oid = relation.relnamespace
      where schema_info.nspname = 'public'
        and relation.relname = constraint_spec.name
        and relation.relkind = 'i'
    ) then
      raise exception 'public.profiles index % conflicts with required constraint %',
        constraint_spec.name, constraint_spec.name;
    end if;

    execute format(
      'ALTER TABLE public.profiles ADD CONSTRAINT %I %s',
      constraint_spec.name,
      constraint_spec.add_definition
    );
  end loop;
end;
$preflight_profiles$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), 'SabiBody member'),
    new.email
  )
  on conflict (id) do update
  set email = excluded.email;
  return new;
end;
$$;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = new.email
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_profile_email();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

do $guard_profile_policies$
declare
  unexpected_policy text;
begin
  select policy.policyname into unexpected_policy
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'profiles'
    and policy.policyname not in ('profiles_select_own', 'profiles_update_own')
  limit 1;
  if found then
    raise exception 'Unexpected policy % on public.profiles; review it before rerunning this migration',
      unexpected_policy;
  end if;
end;
$guard_profile_policies$;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select to authenticated
using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;
revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.sync_profile_email() from public;

create table if not exists public.workout_sessions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  client_session_id uuid not null,
  exercise_name text not null,
  exercise_type text not null,
  completed_reps integer,
  target_reps integer,
  target_duration_seconds integer,
  duration_seconds integer not null,
  completed boolean not null default false,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint workout_sessions_pkey primary key (id),
  constraint workout_sessions_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint workout_sessions_exercise_name_check check (
    exercise_name in ('Squats', 'Jumping Jacks', 'Plank', 'Push-ups', 'Sit-ups', 'Lunges', 'High Knees')
  ),
  constraint workout_sessions_exercise_type_check check (exercise_type in ('reps', 'duration')),
  constraint workout_sessions_duration_seconds_check check (duration_seconds >= 0),
  constraint workout_sessions_time_order check (ended_at >= started_at),
  constraint workout_sessions_completion_time check (
    completed_at is null or (completed_at >= started_at and completed_at <= ended_at)
  ),
  constraint workout_sessions_completion_status check (completed = (completed_at is not null)),
  constraint workout_sessions_quantity_bounds check (
    (completed_reps is null or completed_reps >= 0)
    and (target_reps is null or target_reps > 0)
    and (target_duration_seconds is null or target_duration_seconds > 0)
  ),
  constraint workout_sessions_exercise_measure check (
    (
      exercise_type = 'reps'
      and exercise_name <> 'Plank'
      and completed_reps is not null
      and target_reps is not null
      and target_duration_seconds is null
    )
    or (
      exercise_type = 'duration'
      and exercise_name = 'Plank'
      and completed_reps is null
      and target_reps is null
      and target_duration_seconds is not null
    )
  ),
  constraint workout_sessions_completed_target check (
    not completed
    or (
      (exercise_type = 'reps' and completed_reps >= target_reps)
      or (exercise_type = 'duration' and duration_seconds >= target_duration_seconds)
    )
  ),
  constraint workout_sessions_user_attempt_unique unique (user_id, client_session_id)
);

do $preflight_workout_sessions$
declare
  expected_column record;
  actual_type text;
  actual_nullable text;
  constraint_spec record;
  actual_kind "char";
  actual_definition text;
  actual_valid boolean;
  expected_definition text;
  probe_table text;
  equivalent_index_name text;
  equivalent_index_oid oid;
  equivalent_index_constraint text;
begin
  for expected_column in
    select * from (values
      ('id', 'uuid', 'NO'),
      ('user_id', 'uuid', 'NO'),
      ('client_session_id', 'uuid', 'NO'),
      ('exercise_name', 'text', 'NO'),
      ('exercise_type', 'text', 'NO'),
      ('completed_reps', 'integer', 'YES'),
      ('target_reps', 'integer', 'YES'),
      ('target_duration_seconds', 'integer', 'YES'),
      ('duration_seconds', 'integer', 'NO'),
      ('completed', 'boolean', 'NO'),
      ('started_at', 'timestamp with time zone', 'NO'),
      ('ended_at', 'timestamp with time zone', 'NO'),
      ('completed_at', 'timestamp with time zone', 'YES'),
      ('created_at', 'timestamp with time zone', 'NO')
    ) as expected(column_name, data_type, is_nullable)
  loop
    select column_info.data_type, column_info.is_nullable
    into actual_type, actual_nullable
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'workout_sessions'
      and column_info.column_name = expected_column.column_name;

    if not found then
      raise exception 'public.workout_sessions is missing required column %', expected_column.column_name;
    end if;
    if actual_type is distinct from expected_column.data_type
      or actual_nullable is distinct from expected_column.is_nullable then
      raise exception 'public.workout_sessions column % is incompatible: expected % nullable %, found % nullable %',
        expected_column.column_name, expected_column.data_type, expected_column.is_nullable,
        actual_type, actual_nullable;
    end if;
  end loop;

  probe_table := '_account_workout_constraint_probe_' || replace(gen_random_uuid()::text, '-', '');
  execute format('CREATE TEMP TABLE IF NOT EXISTS %I (LIKE public.workout_sessions) ON COMMIT DROP', probe_table);

  for constraint_spec in
    select * from (values
      ('workout_sessions_pkey', 'p', null::text, 'PRIMARY KEY (id)', array['id']::text[]),
      ('workout_sessions_user_id_fkey', 'f',
        'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
        'FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE', null::text[]),
      ('workout_sessions_exercise_name_check', 'c', null::text,
        'CHECK (exercise_name in (''Squats'', ''Jumping Jacks'', ''Plank'', ''Push-ups'', ''Sit-ups'', ''Lunges'', ''High Knees''))', null::text[]),
      ('workout_sessions_exercise_type_check', 'c', null::text,
        'CHECK (exercise_type in (''reps'', ''duration''))', null::text[]),
      ('workout_sessions_duration_seconds_check', 'c', null::text,
        'CHECK (duration_seconds >= 0)', null::text[]),
      ('workout_sessions_time_order', 'c', null::text, 'CHECK (ended_at >= started_at)', null::text[]),
      ('workout_sessions_completion_time', 'c', null::text,
        'CHECK (completed_at is null or (completed_at >= started_at and completed_at <= ended_at))', null::text[]),
      ('workout_sessions_completion_status', 'c', null::text,
        'CHECK (completed = (completed_at is not null))', null::text[]),
      ('workout_sessions_quantity_bounds', 'c', null::text,
        'CHECK ((completed_reps is null or completed_reps >= 0) and (target_reps is null or target_reps > 0) and (target_duration_seconds is null or target_duration_seconds > 0))', null::text[]),
      ('workout_sessions_exercise_measure', 'c', null::text,
        'CHECK (((exercise_type = ''reps'' and exercise_name <> ''Plank'' and completed_reps is not null and target_reps is not null and target_duration_seconds is null) or (exercise_type = ''duration'' and exercise_name = ''Plank'' and completed_reps is null and target_reps is null and target_duration_seconds is not null))', null::text[]),
      ('workout_sessions_completed_target', 'c', null::text,
        'CHECK (not completed or ((exercise_type = ''reps'' and completed_reps >= target_reps) or (exercise_type = ''duration'' and duration_seconds >= target_duration_seconds)))', null::text[]),
      ('workout_sessions_user_attempt_unique', 'u', null::text, 'UNIQUE (user_id, client_session_id)',
        array['user_id', 'client_session_id']::text[])
    ) as expected(name, kind, definition, add_definition, key_columns)
  loop
    if constraint_spec.kind = 'f' then
      expected_definition := constraint_spec.definition;
    else
      execute format(
        'ALTER TABLE pg_temp.%I ADD CONSTRAINT %I %s',
        probe_table,
        'expected_account_constraint',
        constraint_spec.add_definition
      );
      select pg_get_constraintdef(constraint_info.oid)
      into expected_definition
      from pg_constraint as constraint_info
      where constraint_info.conrelid = to_regclass(format('pg_temp.%I', probe_table))
        and constraint_info.conname = 'expected_account_constraint';
      execute format(
        'ALTER TABLE pg_temp.%I DROP CONSTRAINT %I',
        probe_table,
        'expected_account_constraint'
      );
    end if;

    select constraint_info.contype, pg_get_constraintdef(constraint_info.oid), constraint_info.convalidated
    into actual_kind, actual_definition, actual_valid
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.workout_sessions'::regclass
      and constraint_info.conname = constraint_spec.name;

    if found then
      if not actual_valid
        or actual_kind::text is distinct from constraint_spec.kind
        or regexp_replace(lower(actual_definition), '[[:space:]"]', '', 'g')
          is distinct from regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g') then
        raise exception 'public.workout_sessions has conflicting constraint %: found %',
          constraint_spec.name, actual_definition;
      end if;
      continue;
    end if;

    if exists (
      select 1
      from pg_constraint as constraint_info
      where constraint_info.conrelid = 'public.workout_sessions'::regclass
        and constraint_info.convalidated
        and constraint_info.contype::text = constraint_spec.kind
        and regexp_replace(lower(pg_get_constraintdef(constraint_info.oid)), '[[:space:]"]', '', 'g')
          = regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g')
    ) then
      continue;
    end if;

    equivalent_index_name := null;
    equivalent_index_oid := null;
    if constraint_spec.kind in ('p', 'u') and constraint_spec.key_columns is not null then
      select index_relation.relname, index_info.indexrelid
      into equivalent_index_name, equivalent_index_oid
      from pg_index as index_info
      join pg_class as index_relation on index_relation.oid = index_info.indexrelid
      join pg_am as access_method on access_method.oid = index_relation.relam
      where index_info.indrelid = 'public.workout_sessions'::regclass
        and access_method.amname = 'btree'
        and index_info.indisunique
        and index_info.indisvalid
        and index_info.indpred is null
        and index_info.indexprs is null
        and array(
          select attribute.attname::text
          from unnest(index_info.indkey) with ordinality as index_key(attnum, ordinal)
          join pg_attribute as attribute
            on attribute.attrelid = index_info.indrelid
            and attribute.attnum = index_key.attnum
          where index_key.ordinal <= index_info.indnkeyatts
          order by attribute.attname::text
        ) = array(
          select expected_key.column_name
          from unnest(constraint_spec.key_columns) as expected_key(column_name)
          order by expected_key.column_name
        )
      order by exists (
        select 1 from pg_constraint as existing_constraint
        where existing_constraint.conindid = index_info.indexrelid
      ), index_info.indexrelid
      limit 1;
    end if;

    if equivalent_index_oid is not null then
      if constraint_spec.kind = 'p' then
        select constraint_info.conname
        into equivalent_index_constraint
        from pg_constraint as constraint_info
        where constraint_info.conindid = equivalent_index_oid;
        if found then
          raise exception 'public.workout_sessions equivalent unique index % is already owned by constraint %',
            equivalent_index_name, equivalent_index_constraint;
        end if;
        execute format(
          'ALTER TABLE public.workout_sessions ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
          constraint_spec.name,
          equivalent_index_name
        );
      end if;
      continue;
    end if;

    if constraint_spec.kind in ('p', 'u') and exists (
      select 1
      from pg_class as relation
      join pg_namespace as schema_info on schema_info.oid = relation.relnamespace
      where schema_info.nspname = 'public'
        and relation.relname = constraint_spec.name
        and relation.relkind = 'i'
    ) then
      raise exception 'public.workout_sessions index % conflicts with required constraint %',
        constraint_spec.name, constraint_spec.name;
    end if;

    execute format(
      'ALTER TABLE public.workout_sessions ADD CONSTRAINT %I %s',
      constraint_spec.name,
      constraint_spec.add_definition
    );
  end loop;
end;
$preflight_workout_sessions$;

create index if not exists workout_sessions_user_started_at_idx
on public.workout_sessions (user_id, started_at desc);

do $verify_workout_started_index$
declare
  actual_definition text;
begin
  select regexp_replace(lower(index_info.indexdef), '[[:space:]"]', '', 'g')
  into actual_definition
  from pg_indexes as index_info
  where index_info.schemaname = 'public'
    and index_info.tablename = 'workout_sessions'
    and index_info.indexname = 'workout_sessions_user_started_at_idx';

  if actual_definition is distinct from
    'createindexworkout_sessions_user_started_at_idxonpublic.workout_sessionsusingbtree(user_id,started_atdesc)' then
    raise exception 'public.workout_sessions index workout_sessions_user_started_at_idx has conflicting definition: %',
      actual_definition;
  end if;
end;
$verify_workout_started_index$;

create index if not exists workout_sessions_user_completed_started_at_idx
on public.workout_sessions (user_id, completed, started_at desc);

do $verify_workout_completed_index$
declare
  actual_definition text;
begin
  select regexp_replace(lower(index_info.indexdef), '[[:space:]"]', '', 'g')
  into actual_definition
  from pg_indexes as index_info
  where index_info.schemaname = 'public'
    and index_info.tablename = 'workout_sessions'
    and index_info.indexname = 'workout_sessions_user_completed_started_at_idx';

  if actual_definition is distinct from
    'createindexworkout_sessions_user_completed_started_at_idxonpublic.workout_sessionsusingbtree(user_id,completed,started_atdesc)' then
    raise exception 'public.workout_sessions index workout_sessions_user_completed_started_at_idx has conflicting definition: %',
      actual_definition;
  end if;
end;
$verify_workout_completed_index$;

alter table public.workout_sessions enable row level security;

do $guard_workout_policies$
declare
  unexpected_policy text;
begin
  select policy.policyname into unexpected_policy
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'workout_sessions'
    and policy.policyname not in (
      'workout_sessions_select_own',
      'workout_sessions_insert_own',
      'workout_sessions_update_own',
      'workout_sessions_delete_own'
    )
  limit 1;
  if found then
    raise exception 'Unexpected policy % on public.workout_sessions; review it before rerunning this migration',
      unexpected_policy;
  end if;
end;
$guard_workout_policies$;

drop policy if exists workout_sessions_select_own on public.workout_sessions;
create policy workout_sessions_select_own
on public.workout_sessions for select to authenticated
using (user_id = auth.uid());

drop policy if exists workout_sessions_insert_own on public.workout_sessions;
create policy workout_sessions_insert_own
on public.workout_sessions for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists workout_sessions_update_own on public.workout_sessions;
create policy workout_sessions_update_own
on public.workout_sessions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists workout_sessions_delete_own on public.workout_sessions;
create policy workout_sessions_delete_own
on public.workout_sessions for delete to authenticated
using (user_id = auth.uid());

revoke all on table public.workout_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.workout_sessions to authenticated;

create or replace function public.get_workout_summary()
returns table (
  total_workouts bigint,
  total_reps bigint,
  total_duration_seconds bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*)::bigint,
    coalesce(sum(completed_reps), 0)::bigint,
    coalesce(sum(duration_seconds), 0)::bigint
  from public.workout_sessions
  where user_id = auth.uid()
    and completed = true;
$$;

revoke all on function public.get_workout_summary() from public, anon;
grant execute on function public.get_workout_summary() to authenticated;

create table if not exists public.reminder_preferences (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  email_reminders_enabled boolean not null default false,
  morning_reminder_enabled boolean not null default false,
  morning_reminder_time time not null default time '07:00',
  evening_reminder_enabled boolean not null default false,
  evening_reminder_time time not null default time '19:00',
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_preferences_pkey primary key (id),
  constraint reminder_preferences_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint reminder_preferences_user_id_key unique (user_id),
  constraint reminder_preferences_timezone_check check (char_length(timezone) between 1 and 100)
);

do $preflight_reminder_preferences$
declare
  expected_column record;
  actual_type text;
  actual_nullable text;
  constraint_spec record;
  actual_kind "char";
  actual_definition text;
  actual_valid boolean;
  expected_definition text;
  probe_table text;
  equivalent_index_name text;
  equivalent_index_oid oid;
  equivalent_index_constraint text;
begin
  for expected_column in
    select * from (values
      ('id', 'uuid', 'NO'),
      ('user_id', 'uuid', 'NO'),
      ('email_reminders_enabled', 'boolean', 'NO'),
      ('morning_reminder_enabled', 'boolean', 'NO'),
      ('morning_reminder_time', 'time without time zone', 'NO'),
      ('evening_reminder_enabled', 'boolean', 'NO'),
      ('evening_reminder_time', 'time without time zone', 'NO'),
      ('timezone', 'text', 'NO'),
      ('created_at', 'timestamp with time zone', 'NO'),
      ('updated_at', 'timestamp with time zone', 'NO')
    ) as expected(column_name, data_type, is_nullable)
  loop
    select column_info.data_type, column_info.is_nullable
    into actual_type, actual_nullable
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'reminder_preferences'
      and column_info.column_name = expected_column.column_name;

    if not found then
      raise exception 'public.reminder_preferences is missing required column %', expected_column.column_name;
    end if;
    if actual_type is distinct from expected_column.data_type
      or actual_nullable is distinct from expected_column.is_nullable then
      raise exception 'public.reminder_preferences column % is incompatible: expected % nullable %, found % nullable %',
        expected_column.column_name, expected_column.data_type, expected_column.is_nullable,
        actual_type, actual_nullable;
    end if;
  end loop;

  probe_table := '_account_reminders_constraint_probe_' || replace(gen_random_uuid()::text, '-', '');
  execute format('CREATE TEMP TABLE IF NOT EXISTS %I (LIKE public.reminder_preferences) ON COMMIT DROP', probe_table);

  for constraint_spec in
    select * from (values
      ('reminder_preferences_pkey', 'p', null::text, 'PRIMARY KEY (id)', array['id']::text[]),
      ('reminder_preferences_user_id_fkey', 'f',
        'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
        'FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE', null::text[]),
      ('reminder_preferences_user_id_key', 'u', null::text, 'UNIQUE (user_id)', array['user_id']::text[]),
      ('reminder_preferences_timezone_check', 'c', null::text,
        'CHECK (char_length(timezone) between 1 and 100)', null::text[])
    ) as expected(name, kind, definition, add_definition, key_columns)
  loop
    if constraint_spec.kind = 'f' then
      expected_definition := constraint_spec.definition;
    else
      execute format(
        'ALTER TABLE pg_temp.%I ADD CONSTRAINT %I %s',
        probe_table,
        'expected_account_constraint',
        constraint_spec.add_definition
      );
      select pg_get_constraintdef(constraint_info.oid)
      into expected_definition
      from pg_constraint as constraint_info
      where constraint_info.conrelid = to_regclass(format('pg_temp.%I', probe_table))
        and constraint_info.conname = 'expected_account_constraint';
      execute format(
        'ALTER TABLE pg_temp.%I DROP CONSTRAINT %I',
        probe_table,
        'expected_account_constraint'
      );
    end if;

    select constraint_info.contype, pg_get_constraintdef(constraint_info.oid), constraint_info.convalidated
    into actual_kind, actual_definition, actual_valid
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.reminder_preferences'::regclass
      and constraint_info.conname = constraint_spec.name;

    if found then
      if not actual_valid
        or actual_kind::text is distinct from constraint_spec.kind
        or regexp_replace(lower(actual_definition), '[[:space:]"]', '', 'g')
          is distinct from regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g') then
        raise exception 'public.reminder_preferences has conflicting constraint %: found %',
          constraint_spec.name, actual_definition;
      end if;
      continue;
    end if;

    if exists (
      select 1
      from pg_constraint as constraint_info
      where constraint_info.conrelid = 'public.reminder_preferences'::regclass
        and constraint_info.convalidated
        and constraint_info.contype::text = constraint_spec.kind
        and regexp_replace(lower(pg_get_constraintdef(constraint_info.oid)), '[[:space:]"]', '', 'g')
          = regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g')
    ) then
      continue;
    end if;

    equivalent_index_name := null;
    equivalent_index_oid := null;
    if constraint_spec.kind in ('p', 'u') and constraint_spec.key_columns is not null then
      select index_relation.relname, index_info.indexrelid
      into equivalent_index_name, equivalent_index_oid
      from pg_index as index_info
      join pg_class as index_relation on index_relation.oid = index_info.indexrelid
      join pg_am as access_method on access_method.oid = index_relation.relam
      where index_info.indrelid = 'public.reminder_preferences'::regclass
        and access_method.amname = 'btree'
        and index_info.indisunique
        and index_info.indisvalid
        and index_info.indpred is null
        and index_info.indexprs is null
        and array(
          select attribute.attname::text
          from unnest(index_info.indkey) with ordinality as index_key(attnum, ordinal)
          join pg_attribute as attribute
            on attribute.attrelid = index_info.indrelid
            and attribute.attnum = index_key.attnum
          where index_key.ordinal <= index_info.indnkeyatts
          order by attribute.attname::text
        ) = array(
          select expected_key.column_name
          from unnest(constraint_spec.key_columns) as expected_key(column_name)
          order by expected_key.column_name
        )
      order by exists (
        select 1 from pg_constraint as existing_constraint
        where existing_constraint.conindid = index_info.indexrelid
      ), index_info.indexrelid
      limit 1;
    end if;

    if equivalent_index_oid is not null then
      if constraint_spec.kind = 'p' then
        select constraint_info.conname
        into equivalent_index_constraint
        from pg_constraint as constraint_info
        where constraint_info.conindid = equivalent_index_oid;
        if found then
          raise exception 'public.reminder_preferences equivalent unique index % is already owned by constraint %',
            equivalent_index_name, equivalent_index_constraint;
        end if;
        execute format(
          'ALTER TABLE public.reminder_preferences ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
          constraint_spec.name,
          equivalent_index_name
        );
      end if;
      continue;
    end if;

    if constraint_spec.kind in ('p', 'u') and exists (
      select 1
      from pg_class as relation
      join pg_namespace as schema_info on schema_info.oid = relation.relnamespace
      where schema_info.nspname = 'public'
        and relation.relname = constraint_spec.name
        and relation.relkind = 'i'
    ) then
      raise exception 'public.reminder_preferences index % conflicts with required constraint %',
        constraint_spec.name, constraint_spec.name;
    end if;

    execute format(
      'ALTER TABLE public.reminder_preferences ADD CONSTRAINT %I %s',
      constraint_spec.name,
      constraint_spec.add_definition
    );
  end loop;
end;
$preflight_reminder_preferences$;

drop trigger if exists reminder_preferences_set_updated_at on public.reminder_preferences;
create trigger reminder_preferences_set_updated_at
before update on public.reminder_preferences
for each row execute function public.set_updated_at();

alter table public.reminder_preferences enable row level security;

do $guard_reminder_policies$
declare
  unexpected_policy text;
begin
  select policy.policyname into unexpected_policy
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'reminder_preferences'
    and policy.policyname not in (
      'reminder_preferences_select_own',
      'reminder_preferences_insert_own',
      'reminder_preferences_update_own',
      'reminder_preferences_delete_own'
    )
  limit 1;
  if found then
    raise exception 'Unexpected policy % on public.reminder_preferences; review it before rerunning this migration',
      unexpected_policy;
  end if;
end;
$guard_reminder_policies$;

drop policy if exists reminder_preferences_select_own on public.reminder_preferences;
create policy reminder_preferences_select_own
on public.reminder_preferences for select to authenticated
using (user_id = auth.uid());

drop policy if exists reminder_preferences_insert_own on public.reminder_preferences;
create policy reminder_preferences_insert_own
on public.reminder_preferences for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists reminder_preferences_update_own on public.reminder_preferences;
create policy reminder_preferences_update_own
on public.reminder_preferences for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists reminder_preferences_delete_own on public.reminder_preferences;
create policy reminder_preferences_delete_own
on public.reminder_preferences for delete to authenticated
using (user_id = auth.uid());

revoke all on table public.reminder_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.reminder_preferences to authenticated;

create table if not exists public.admin_users (
  user_id uuid not null,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  constraint admin_users_pkey primary key (user_id),
  constraint admin_users_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint admin_users_role_check check (role = 'admin')
);

do $preflight_admin_users$
declare
  expected_column record;
  actual_type text;
  actual_nullable text;
  constraint_spec record;
  actual_kind "char";
  actual_definition text;
  actual_valid boolean;
  expected_definition text;
  probe_table text;
  equivalent_index_name text;
  equivalent_index_oid oid;
  equivalent_index_constraint text;
begin
  for expected_column in
    select * from (values
      ('user_id', 'uuid', 'NO'),
      ('role', 'text', 'NO'),
      ('created_at', 'timestamp with time zone', 'NO')
    ) as expected(column_name, data_type, is_nullable)
  loop
    select column_info.data_type, column_info.is_nullable
    into actual_type, actual_nullable
    from information_schema.columns as column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'admin_users'
      and column_info.column_name = expected_column.column_name;

    if not found then
      raise exception 'public.admin_users is missing required column %', expected_column.column_name;
    end if;
    if actual_type is distinct from expected_column.data_type
      or actual_nullable is distinct from expected_column.is_nullable then
      raise exception 'public.admin_users column % is incompatible: expected % nullable %, found % nullable %',
        expected_column.column_name, expected_column.data_type, expected_column.is_nullable,
        actual_type, actual_nullable;
    end if;
  end loop;

  probe_table := '_account_admin_constraint_probe_' || replace(gen_random_uuid()::text, '-', '');
  execute format('CREATE TEMP TABLE IF NOT EXISTS %I (LIKE public.admin_users) ON COMMIT DROP', probe_table);

  for constraint_spec in
    select * from (values
      ('admin_users_pkey', 'p', null::text, 'PRIMARY KEY (user_id)', array['user_id']::text[]),
      ('admin_users_user_id_fkey', 'f',
        'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
        'FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE', null::text[]),
      ('admin_users_role_check', 'c', null::text,
        'CHECK (role = ''admin'')', null::text[])
    ) as expected(name, kind, definition, add_definition, key_columns)
  loop
    if constraint_spec.kind = 'f' then
      expected_definition := constraint_spec.definition;
    else
      execute format(
        'ALTER TABLE pg_temp.%I ADD CONSTRAINT %I %s',
        probe_table,
        'expected_account_constraint',
        constraint_spec.add_definition
      );
      select pg_get_constraintdef(constraint_info.oid)
      into expected_definition
      from pg_constraint as constraint_info
      where constraint_info.conrelid = to_regclass(format('pg_temp.%I', probe_table))
        and constraint_info.conname = 'expected_account_constraint';
      execute format(
        'ALTER TABLE pg_temp.%I DROP CONSTRAINT %I',
        probe_table,
        'expected_account_constraint'
      );
    end if;

    select constraint_info.contype, pg_get_constraintdef(constraint_info.oid), constraint_info.convalidated
    into actual_kind, actual_definition, actual_valid
    from pg_constraint as constraint_info
    where constraint_info.conrelid = 'public.admin_users'::regclass
      and constraint_info.conname = constraint_spec.name;

    if found then
      if not actual_valid
        or actual_kind::text is distinct from constraint_spec.kind
        or regexp_replace(lower(actual_definition), '[[:space:]"]', '', 'g')
          is distinct from regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g') then
        raise exception 'public.admin_users has conflicting constraint %: found %',
          constraint_spec.name, actual_definition;
      end if;
      continue;
    end if;

    if exists (
      select 1
      from pg_constraint as constraint_info
      where constraint_info.conrelid = 'public.admin_users'::regclass
        and constraint_info.convalidated
        and constraint_info.contype::text = constraint_spec.kind
        and regexp_replace(lower(pg_get_constraintdef(constraint_info.oid)), '[[:space:]"]', '', 'g')
          = regexp_replace(lower(expected_definition), '[[:space:]"]', '', 'g')
    ) then
      continue;
    end if;

    equivalent_index_name := null;
    equivalent_index_oid := null;
    if constraint_spec.kind in ('p', 'u') and constraint_spec.key_columns is not null then
      select index_relation.relname, index_info.indexrelid
      into equivalent_index_name, equivalent_index_oid
      from pg_index as index_info
      join pg_class as index_relation on index_relation.oid = index_info.indexrelid
      join pg_am as access_method on access_method.oid = index_relation.relam
      where index_info.indrelid = 'public.admin_users'::regclass
        and access_method.amname = 'btree'
        and index_info.indisunique
        and index_info.indisvalid
        and index_info.indpred is null
        and index_info.indexprs is null
        and array(
          select attribute.attname::text
          from unnest(index_info.indkey) with ordinality as index_key(attnum, ordinal)
          join pg_attribute as attribute
            on attribute.attrelid = index_info.indrelid
            and attribute.attnum = index_key.attnum
          where index_key.ordinal <= index_info.indnkeyatts
          order by attribute.attname::text
        ) = array(
          select expected_key.column_name
          from unnest(constraint_spec.key_columns) as expected_key(column_name)
          order by expected_key.column_name
        )
      order by exists (
        select 1 from pg_constraint as existing_constraint
        where existing_constraint.conindid = index_info.indexrelid
      ), index_info.indexrelid
      limit 1;
    end if;

    if equivalent_index_oid is not null then
      if constraint_spec.kind = 'p' then
        select constraint_info.conname
        into equivalent_index_constraint
        from pg_constraint as constraint_info
        where constraint_info.conindid = equivalent_index_oid;
        if found then
          raise exception 'public.admin_users equivalent unique index % is already owned by constraint %',
            equivalent_index_name, equivalent_index_constraint;
        end if;
        execute format(
          'ALTER TABLE public.admin_users ADD CONSTRAINT %I PRIMARY KEY USING INDEX %I',
          constraint_spec.name,
          equivalent_index_name
        );
      end if;
      continue;
    end if;

    if constraint_spec.kind in ('p', 'u') and exists (
      select 1
      from pg_class as relation
      join pg_namespace as schema_info on schema_info.oid = relation.relnamespace
      where schema_info.nspname = 'public'
        and relation.relname = constraint_spec.name
        and relation.relkind = 'i'
    ) then
      raise exception 'public.admin_users index % conflicts with required constraint %',
        constraint_spec.name, constraint_spec.name;
    end if;

    execute format(
      'ALTER TABLE public.admin_users ADD CONSTRAINT %I %s',
      constraint_spec.name,
      constraint_spec.add_definition
    );
  end loop;
end;
$preflight_admin_users$;

alter table public.admin_users enable row level security;

do $guard_admin_policies$
declare
  unexpected_policy text;
begin
  select policy.policyname into unexpected_policy
  from pg_policies as policy
  where policy.schemaname = 'public'
    and policy.tablename = 'admin_users'
  limit 1;
  if found then
    raise exception 'Unexpected policy % on public.admin_users; remove or review it before rerunning this migration',
      unexpected_policy;
  end if;
end;
$guard_admin_policies$;

revoke all on table public.admin_users from public, anon, authenticated;

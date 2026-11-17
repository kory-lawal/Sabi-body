import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/20261117020000_create_sabibody_account_data.sql', import.meta.url);
const expectedColumns = {
  profiles: ['id', 'full_name', 'email', 'created_at', 'updated_at'],
  workout_sessions: [
    'id', 'user_id', 'client_session_id', 'exercise_name', 'exercise_type',
    'completed_reps', 'target_reps', 'target_duration_seconds',
    'duration_seconds', 'completed', 'started_at', 'ended_at',
    'completed_at', 'created_at',
  ],
  reminder_preferences: [
    'id', 'user_id', 'email_reminders_enabled', 'morning_reminder_enabled',
    'morning_reminder_time', 'evening_reminder_enabled',
    'evening_reminder_time', 'timezone', 'created_at', 'updated_at',
  ],
};

function tableDefinition(sql, table) {
  const match = sql.match(new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    'i',
  ));
  assert.ok(match, `expected a CREATE TABLE definition for ${table}`);
  return match[1];
}

function declaredColumns(sql, table) {
  return tableDefinition(sql, table)
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([a-z_][a-z0-9_]*)\s+/i)?.[1])
    .filter((column) => column && column.toLowerCase() !== 'constraint');
}

test('account migration preserves service-compatible columns and summary results', async () => {
  const sql = await readFile(fileURLToPath(migrationPath), 'utf8');

  for (const [table, columns] of Object.entries(expectedColumns)) {
    assert.deepEqual(
      columns.filter((column) => !declaredColumns(sql, table).includes(column)),
      [],
      `${table} is missing columns consumed by its service`,
    );
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
  }
  for (const [table, ownerColumn] of [
    ['profiles', 'id'],
    ['workout_sessions', 'user_id'],
    ['reminder_preferences', 'user_id'],
  ]) {
    const policyBlocks = [...sql.matchAll(/create\s+policy\b[\s\S]*?;/gi)]
      .map(([policy]) => policy)
      .filter((policy) => new RegExp(`on\\s+public\\.${table}\\b`, 'i').test(policy));
    assert.ok(policyBlocks.length > 0, `${table} has no ownership policies`);
    assert.ok(
      policyBlocks.every((policy) => new RegExp(`${ownerColumn}\\s*=\\s*auth\\.uid\\(\\)`, 'i').test(policy)),
      `${table} policy does not constrain access to the authenticated owner`,
    );
  }

  const serviceFiles = {
    profiles: '../src/services/profile.js',
    workout_sessions: '../src/services/workout-history.js',
    reminder_preferences: '../src/services/reminder-preferences.js',
  };
  for (const [table, relativePath] of Object.entries(serviceFiles)) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`from\\('${table}'\\)`));
    const referencedColumns = new Set(source.match(/\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? []);
    referencedColumns.delete(table);
    assert.deepEqual(
      [...referencedColumns].filter((column) => !expectedColumns[table].includes(column)),
      [],
      `${table} service references fields outside its declared schema`,
    );
    for (const select of source.matchAll(/\.select\('([^']+)'\)/g)) {
      for (const column of select[1].split(/\s*,\s*/)) {
        assert.ok(expectedColumns[table].includes(column), `${table} service selects undeclared field ${column}`);
      }
    }
  }

  const summaryService = await readFile(new URL('../src/services/workout-summary.js', import.meta.url), 'utf8');
  assert.match(summaryService, /rpc\('get_workout_summary'\)/);
  for (const field of ['total_workouts', 'total_reps', 'total_duration_seconds']) {
    assert.match(sql, new RegExp(`\\b${field}\\b`));
    assert.match(summaryService, new RegExp(`\\b${field}\\b`));
  }
});

test('account migration hardens ownership, admin privacy, and rerun safety', async () => {
  const sql = await readFile(fileURLToPath(migrationPath), 'utf8');

  for (const table of [...Object.keys(expectedColumns), 'admin_users']) {
    assert.match(sql, new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i'));
  }
  assert.deepEqual(declaredColumns(sql, 'admin_users'), ['user_id', 'role', 'created_at']);
  assert.match(sql, /user_id\s+uuid\s+not\s+null/i);
  assert.match(sql, /constraint\s+admin_users_pkey\s+primary\s+key\s*\(\s*user_id\s*\)/i);
  assert.match(sql, /constraint\s+admin_users_user_id_fkey\s+foreign\s+key\s*\(\s*user_id\s*\)\s+references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
  assert.match(sql, /role\s+text\s+not\s+null\s+default\s+'admin'/i);
  assert.match(sql, /constraint\s+admin_users_role_check\s+check\s*\(\s*role\s*=\s*'admin'\s*\)/i);
  assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.admin_users\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.doesNotMatch(sql, /(?:grant|create\s+policy)[^;]*admin_users/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.admin_users/i);

  assert.match(sql, /create\s+trigger\s+on_auth_user_created[\s\S]*?create_profile_for_new_user/i);
  assert.match(sql, /create\s+trigger\s+on_auth_user_email_updated[\s\S]*?sync_profile_email/i);
  assert.match(sql, /grant\s+update\s*\(\s*full_name\s*\)\s+on\s+table\s+public\.profiles\s+to\s+authenticated/i);
  for (const [trigger, table] of [
    ['on_auth_user_created', 'auth.users'],
    ['on_auth_user_email_updated', 'auth.users'],
    ['profiles_set_updated_at', 'public.profiles'],
    ['reminder_preferences_set_updated_at', 'public.reminder_preferences'],
  ]) {
    assert.match(sql, new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+${trigger}\\s+on\\s+${table.replace('.', '\\.')}`, 'i'));
  }

  for (const constraint of [
    'workout_sessions_time_order',
    'workout_sessions_completion_time',
    'workout_sessions_completion_status',
    'workout_sessions_quantity_bounds',
    'workout_sessions_exercise_measure',
    'workout_sessions_completed_target',
    'workout_sessions_user_attempt_unique',
  ]) {
    assert.match(sql, new RegExp(`constraint\\s+${constraint}\\b`, 'i'));
  }
  assert.match(sql, /create\s+index\s+if\s+not\s+exists\s+workout_sessions_user_started_at_idx\s+on\s+public\.workout_sessions\s*\(\s*user_id\s*,\s*started_at\s+desc\s*\)/i);
  assert.match(sql, /create\s+index\s+if\s+not\s+exists\s+workout_sessions_user_completed_started_at_idx\s+on\s+public\.workout_sessions\s*\(\s*user_id\s*,\s*completed\s*,\s*started_at\s+desc\s*\)/i);

  assert.doesNotMatch(sql, /\b(?:drop\s+table|truncate|delete\s+from)\b/i);
  assert.doesNotMatch(sql, /\bcreate\s+(?:temp(?:orary)?\s+)?table\s+(?!if\s+not\s+exists)/i);
  assert.doesNotMatch(sql, /\bcreate\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists)/i);
  assert.match(sql, /information_schema\.columns/i);
  assert.match(sql, /column_info\.data_type/i);
  assert.match(sql, /column_info\.is_nullable/i);
  assert.match(sql, /pg_constraint/i);
  assert.match(sql, /constraint_info\.convalidated/i);
  assert.match(sql, /pg_get_constraintdef/i);
  assert.match(sql, /pg_indexes/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.get_workout_summary\(\)[\s\S]*?security\s+invoker[\s\S]*?auth\.uid\(\)/i);
  assert.doesNotMatch(sql, /get_workout_summary\s*\([^)]/i);
  assert.match(sql, /pg_policies/i);
  assert.match(sql, /policyname\s+not\s+in[\s\S]*?Unexpected policy/i);
  assert.match(sql, /drop\s+policy\s+if\s+exists/i);
  assert.match(sql, /drop\s+trigger\s+if\s+exists/i);
  assert.match(sql, /raise\s+exception/i);
  assert.doesNotMatch(sql, /service[_-]?role/i);
});

test('account migration uses equivalent unique indexes for required primary keys', async () => {
  const sql = await readFile(fileURLToPath(migrationPath), 'utf8');

  for (const table of [...Object.keys(expectedColumns), 'admin_users']) {
    const preflight = sql.match(new RegExp(
      `do\\s+\\$preflight_${table}\\$([\\s\\S]*?)\\$preflight_${table}\\$;`,
      'i',
    ))?.[1];
    assert.ok(preflight, `expected a constraint preflight for ${table}`);
    assert.ok(
      /constraint_spec\.kind\s+in\s*\(\s*'p'\s*,\s*'u'\s*\)\s+and\s+constraint_spec\.key_columns\s+is\s+not\s+null\s+then/i.test(preflight),
      `${table} does not check equivalent unique indexes for primary keys`,
    );
    assert.ok(/index_info\.indisunique/i.test(preflight), `${table} does not require unique indexes`);
    assert.ok(/index_info\.indisvalid/i.test(preflight), `${table} does not require valid indexes`);
    assert.ok(
      /not\s+exists\s*\([\s\S]*?unnest\(index_info\.indoption\)[\s\S]*?index_order\.ordinal\s*<=\s*index_info\.indnkeyatts[\s\S]*?index_order\.sort_option\s*<>\s*0/i.test(preflight),
      `${table} does not require ASC NULLS LAST on primary-key index key attributes`,
    );
    assert.ok(
      /constraint_spec\.kind\s*<>\s*'p'\s+or\s+not\s+exists/i.test(preflight),
      `${table} applies primary-key ordering restrictions to unrelated unique constraints`,
    );
    assert.ok(
      /and\s+exists\s*\([\s\S]*?unnest\(index_info\.indoption\)[\s\S]*?index_order\.ordinal\s*<=\s*index_info\.indnkeyatts[\s\S]*?index_order\.sort_option\s*<>\s*0/i.test(preflight),
      `${table} does not reject same-key unique indexes with non-default ordering`,
    );
    assert.ok(
      /non-default key ordering; expected ASC NULLS LAST/i.test(preflight),
      `${table} does not report incompatible primary-key index ordering`,
    );
    assert.ok(/primary\s+key\s+using\s+index/i.test(preflight), `${table} does not preserve its primary-key constraint`);
    assert.ok(
      /actual_kind::text\s+is\s+distinct\s+from\s+constraint_spec\.kind/i.test(preflight),
      `${table} no longer validates existing primary-key constraints`,
    );
  }
});

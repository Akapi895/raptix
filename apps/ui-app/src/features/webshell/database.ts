import type { DbProfile, DbSchema, DbType } from './model';

export function quoteShell(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }
export function quoteIdentifier(type: DbType, name: string): string {
  if (type === 'mysql') return '`' + name.replace(/`/g, '``') + '`';
  if (type === 'mssql') return '[' + name.replace(/]/g, ']]') + ']';
  return '"' + name.replace(/"/g, '""') + '"';
}
export function quoteLiteral(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }
export function buildWebshellDbCommand(profile: DbProfile, testOnly = false, sqlOverride?: string): string {
  const sql = (testOnly ? 'SELECT 1;' : sqlOverride || profile.sql).trim();
  if (!sql) throw new Error('Enter SQL first');
  const bytes = new TextEncoder().encode(sql);
  const sqlBase64 = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  const file = '/tmp/.csai_sql_$$.sql';
  const start = 'printf %s ' + quoteShell(sqlBase64) + ' | base64 -d > ' + file + '; ';
  const end = '; rc=$?; rm -f ' + file + '; echo "__CSAI_DB_RC__:$rc"; exit $rc';
  const q = quoteShell;
  const database = profile.selectedDatabase || profile.database;
  switch (profile.type) {
    case 'mysql': return start + `MYSQL_PWD=${q(profile.password)} mysql -h ${q(profile.host || '127.0.0.1')} -P ${q(profile.port || '3306')} -u ${q(profile.username || 'root')}${database ? ' -D ' + q(database) : ''} --batch --raw < ${file}` + end;
    case 'pgsql': return start + `PGPASSWORD=${q(profile.password)} psql -h ${q(profile.host || '127.0.0.1')} -p ${q(profile.port || '5432')} -U ${q(profile.username || 'postgres')} -d ${q(database || 'postgres')} -v ON_ERROR_STOP=1 -A -F "|" -P footer=off -f ${file}` + end;
    case 'sqlite': return start + `sqlite3 -header -separator "|" ${q(profile.sqlitePath || '/tmp/test.db')} < ${file}` + end;
    case 'mssql': return start + `sqlcmd -S ${q((profile.host || '127.0.0.1') + ',' + (profile.port || '1433'))} -U ${q(profile.username || 'sa')} -P ${q(profile.password)} -W -s "|" -d ${q(database || 'master')} -i ${file}` + end;
  }
}
export function schemaSQL(type: DbType): string {
  switch (type) {
    case 'mysql': return "SELECT SCHEMA_NAME AS db_name, '' AS table_name, '' AS column_name FROM INFORMATION_SCHEMA.SCHEMATA UNION ALL SELECT TABLE_SCHEMA AS db_name, TABLE_NAME AS table_name, '' AS column_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' UNION ALL SELECT TABLE_SCHEMA AS db_name, TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS ORDER BY db_name, table_name, column_name;";
    case 'pgsql': return "SELECT table_schema AS db_name, table_name, '' AS column_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema') UNION ALL SELECT table_schema AS db_name, table_name, column_name FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY db_name, table_name, column_name;";
    case 'sqlite': return "SELECT 'main' AS db_name, name AS table_name, '' AS column_name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' UNION ALL SELECT 'main' AS db_name, m.name AS table_name, p.name AS column_name FROM sqlite_master m JOIN pragma_table_info(m.name) p ON 1=1 WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' ORDER BY db_name, table_name, column_name;";
    case 'mssql': return "SELECT TABLE_SCHEMA AS db_name, TABLE_NAME AS table_name, '' AS column_name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' UNION ALL SELECT TABLE_SCHEMA AS db_name, TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS ORDER BY db_name, table_name, column_name;";
  }
}
export function columnsSQL(type: DbType, database: string, table?: string): string {
  const db = quoteLiteral(database);
  const name = quoteLiteral(table || '');
  if (type === 'sqlite') return table ? `SELECT name AS column_name FROM pragma_table_info(${name}) ORDER BY cid;` : "SELECT m.name AS table_name, p.name AS column_name FROM sqlite_master m JOIN pragma_table_info(m.name) p ON 1=1 WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid;";
  const schema = type === 'pgsql' ? 'information_schema.columns' : 'INFORMATION_SCHEMA.COLUMNS';
  return `SELECT ${table ? '' : 'TABLE_NAME AS table_name, '}COLUMN_NAME AS column_name FROM ${schema} WHERE TABLE_SCHEMA=${db}${table ? ' AND TABLE_NAME=' + name : ''} ORDER BY ${table ? '' : 'TABLE_NAME, '}ORDINAL_POSITION;`;
}
export function parseWebshellDbExecOutput(raw: string): { rc: number | null; output: string } {
  let rc: number | null = null;
  const output = raw.replace(/__CSAI_DB_RC__:(\d+)\s*$/m, (_match: string, code: string) => { rc = Number(code); return ''; }).trim();
  return { rc, output };
}
export function parseDbTable(output: string): { headers: string[]; rows: string[][] } {
  const lines = output.trim().split(/\r?\n/).filter(line => line.trim() && !/^\(\d+\s+rows?\)$/i.test(line.trim()) && !/^[-+\s|]+$/.test(line));
  const first = lines.shift() || '';
  const delimiter = first.includes('\t') ? '\t' : first.includes('|') ? '|' : '';
  const headers = first.split(delimiter || '\0').map(value => value.trim());
  const rows = lines.map(line => line.split(delimiter || '\0').map(value => value.trim())).filter(row => row.length === headers.length);
  return { headers, rows };
}
export function parseWebshellDbSchema(output: string): DbSchema {
  const { headers, rows } = parseDbTable(output);
  const dbIndex = headers.indexOf('db_name'); const tableIndex = headers.indexOf('table_name'); const columnIndex = headers.indexOf('column_name');
  const result: DbSchema = {};
  if (dbIndex < 0 || tableIndex < 0) return result;
  for (const row of rows) {
    const db = row[dbIndex] || 'default'; const table = row[tableIndex]; const column = row[columnIndex];
    const entry = result[db] ??= { tables: {} };
    if (!table) continue;
    const columns = entry.tables[table] ??= [];
    if (column && !columns.includes(column)) columns.push(column);
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)).map(([db, entry]) => [db, { tables: Object.fromEntries(Object.entries(entry.tables).sort(([a], [b]) => a.localeCompare(b)).map(([table, columns]) => [table, columns.sort((a, b) => a.localeCompare(b))])) }]));
}
export function parseWebshellDbColumns(output: string): string[] {
  const { headers, rows } = parseDbTable(output); const index = headers.indexOf('column_name');
  return index < 0 ? [] : [...new Set(rows.map(row => row[index] || '').filter(Boolean))];
}
export function parseWebshellDbTableColumns(output: string): Record<string, string[]> {
  const { headers, rows } = parseDbTable(output); const ti = headers.indexOf('table_name'); const ci = headers.indexOf('column_name');
  const result: Record<string, string[]> = {};
  for (const row of rows) { const table = row[ti]; const column = row[ci]; if (table && column) { const columns = result[table] ??= []; if (!columns.includes(column)) columns.push(column); } }
  return result;
}
